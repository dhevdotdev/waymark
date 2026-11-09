import { isDesktop, native } from "../platform";
import type { PrefStore, Prefs } from "../prefs";
import { renderDiagrams } from "../render/diagrams";
import type { Highlighter } from "../render/highlight";
import { type RenderContext, renderInlineMarkdown, renderNote } from "../render/note";
import type { Scheme } from "../themes";
import type { VaultStore } from "../vault/store";
import type { GraphScope, View } from "../vault/trail";
import { type Tab, Workspace } from "../vault/workspace";
import { CommandTable } from "./commands";
import { FindBar, paint } from "./find";
import { type GraphTabView, GraphView } from "./graph-view";
import { Inspector } from "./inspector";
import { LinkPreview } from "./link-preview";
import { isNarrow, railFloats } from "./media";
import { NoteEditing } from "./note-editing";
import { NoteFiles } from "./note-files";
import { NoteView } from "./note-view";
import { toast } from "./overlays";
import { Palette } from "./palette";
import { bindReaderClicks } from "./reader-clicks";
import { paletteItems, paletteRecent, readerCommands } from "./reader-commands";
import { restoreTabs } from "./restore-tabs";
import { applySound, toggleSettings } from "./settings";
import { mountShell, type ShellElements } from "./shell";
import { Sidebar } from "./sidebar";
import type { Sound } from "./sound";
import { rememberNote, startPage } from "./start-page";
import { SyncController } from "./sync-controller";
import { renderTabStrip } from "./tab-strip";
import { bindTooltips } from "./tooltips";
import { TrailMap } from "./trail-map";

export type Metrics = Record<string, number>;
type Appearance = Prefs["appearance"];

export interface ReaderDeps {
  host: HTMLElement;
  vault: VaultStore;
  root: string;
  name: string;
  prefs: PrefStore;
  sound: Sound;
  highlighter: Highlighter;
  codeThemeReady: Promise<void>;
  metrics: Metrics;
  scheme: () => Scheme;
  setAppearance: (appearance: Appearance) => void;
  setFamily: (id: string) => void;
  openAnotherVault: () => void;
  closeVault: () => void;
}

export interface OpenOptions {
  anchor?: string;
  newTab?: boolean;
  focus?: boolean;
  find?: string;
  keyboard?: boolean;
  via?: "link" | "jump";
}

interface ShowOptions {
  anchor?: string;
  entering?: number;
  find?: string;
  keepScroll?: boolean;
  quiet?: boolean;
  restoring?: boolean;
  keyboard?: boolean;
  onPainted?: () => void;
}

/** One open vault's window: its panels, its tabs and how the user moves between notes. */
export class Reader {
  readonly vault: VaultStore;
  readonly commands: CommandTable;
  readonly palette: Palette;
  readonly find: FindBar;
  readonly sync: SyncController;
  readonly sidebar: Sidebar;
  readonly inspector: Inspector;
  readonly preview: LinkPreview;
  readonly editing: NoteEditing;
  readonly files: NoteFiles;
  readonly workspace = new Workspace();
  /** The note on screen, or the note a graph tab was opened from. */
  current = "";

  private readonly els: ShellElements;
  private readonly noteView: NoteView;
  private readonly trailMap: TrailMap;
  private graph: GraphView | null = null;
  private renderSeq = 0;

  constructor(readonly deps: ReaderDeps) {
    const { host, vault, prefs } = deps;
    const p = prefs.value;
    this.vault = vault;
    this.els = mountShell(host, { sidebarOpen: p.sidebar, railOpen: p.rail, sidebarWidth: p.sidebarWidth });
    const { els } = this;

    this.noteView = new NoteView(els, vault, deps.name, toast);
    this.trailMap = new TrailMap({
      select: (id, newTab) => this.selectOnTrail(id, newTab),
      remove: (id) => this.removeFromTrail(id),
      toggle: (id) => this.toggleTrailBranch(id),
    });
    els.reader.prepend(this.trailMap.root);

    this.sidebar = new Sidebar(els, prefs, p.vaults[deps.root]?.openFolders ?? [], {
      search: (query, limit) => vault.search.search(query, limit),
      open: (hit, newTab) => {
        if (isNarrow()) els.shell.classList.remove("sidebar-peek");
        void this.open(hit.path, { newTab, focus: true, find: hit.snippet?.match ?? hit.terms[0] });
      },
      recordSearchMs: (ms) => {
        deps.metrics.searchMs = ms;
      },
      focusReader: () => els.scroller.focus({ preventScroll: true }),
      persist: () => this.persist(),
    });

    this.inspector = new Inspector(
      els,
      vault,
      {
        status: () => this.sync.panel.status,
        currentNote: () => this.current,
        showWorktreeDiff: (change) => void this.sync.panel.showWorktreeDiff(change, change.unstaged === " " || !change.unstaged),
        showCommit: (commit, path) => void this.sync.panel.showCommit(commit, path),
        openFromGraph: (path, newTab) => void this.open(path, { newTab, focus: !newTab, via: "link" }),
      },
      p.railPane,
    );

    this.editing = new NoteEditing({
      els,
      vault,
      highlighter: deps.highlighter,
      toast,
      notePath: () => this.notePath,
      reshow: () => this.show({ keepScroll: true, keyboard: true }),
      incomingCommits: () => this.sync.panel.status?.behind ?? 0,
      open: (path, newTab, anchor) => void this.open(path, { newTab, focus: true, anchor, via: "link" }),
      openUrl: (url) => void native.openExternal(url),
      renderInline: (text, path) => renderInlineMarkdown(text, path, this.renderContext()),
      rename: (path, name) => this.files.renameTo(path, name),
    });
    this.files = new NoteFiles({
      sidebar: els.sidebar,
      vault,
      prefs,
      root: deps.root,
      workspace: this.workspace,
      editing: this.editing,
      folderRenamed: (from, to) => this.sidebar.tree.folderRenamed(from, to),
      toast,
      notePath: () => this.notePath,
      open: (path, newTab) => this.open(path, { newTab, focus: true }),
      redraw: () => this.redraw(),
    });

    this.sync = new SyncController({
      els,
      prefs,
      root: deps.root,
      panelHost: {
        flushEdits: () => this.editing.flush(),
        play: (cue) => deps.sound.play(cue),
        toast,
        openNote: (path) => void this.open(path),
        renderNoteAt: async (markdown, path, into) => {
          const rendered = await renderNote(markdown, path, this.renderContext());
          into.append(rendered.fragment);
          await renderDiagrams(into);
        },
        title: (path) => vault.index.title(path),
      },
      onStatusChanged: () => this.inspector.refreshHistory(),
    });

    this.commands = new CommandTable(readerCommands(this), {
      desktop: isDesktop,
      hasNote: () => !this.workspace.isEmpty && !this.onBlank,
    });
    this.palette = new Palette(
      (query) => paletteItems(this, query),
      () => paletteRecent(this),
    );
    this.find = new FindBar(els.reader, () => els.scroller.querySelector(".doc"), els.scroller);
    this.preview = new LinkPreview(els.shell, {
      vault,
      renderContext: () => this.renderContext(),
      currentNote: () => this.current,
    });

    bindReaderClicks(els.shell, this);
    els.scroller.addEventListener("scroll", () => this.inspector.spy(), { passive: true });
    bindTooltips(els.shell);
  }

  /** Shows the restored note as soon as it is read, then reads and indexes the rest of the vault. */
  async start(startedAt: number, initial?: string): Promise<void> {
    const { vault, metrics, codeThemeReady } = this.deps;
    restoreTabs(this.workspace, vault.index, this.deps.prefs.value.vaults[this.deps.root], initial);
    if (this.workspace.isEmpty) {
      this.noteView.showEmptyVault();
      return;
    }
    const firstView = this.tab.trail.current.view;
    if (firstView.kind === "note") await vault.read(firstView.path);
    await codeThemeReady;
    await this.show({
      restoring: true,
      onPainted: () => {
        metrics.firstNoteMs = performance.now() - startedAt;
      },
    });
    await vault.loadAll();
    metrics.indexMs = performance.now() - startedAt;
    await this.show({ keepScroll: true, quiet: true });
    this.renderTree();
    void this.sync.start();
  }

  dispose(): void {
    this.sync.dispose();
    this.preview.hide();
    this.closeGraphView();
  }

  private get tab(): Tab {
    return this.workspace.active;
  }

  private get onGraph(): boolean {
    return this.tab?.trail.current.view.kind === "graph";
  }

  get onBlank(): boolean {
    return this.tab?.trail.current.view.kind === "blank";
  }

  private get notePath(): string {
    const view = this.tab.trail.current.view;
    return view.kind === "note" ? view.path : "";
  }

  // Navigation

  async open(path: string, opts: OpenOptions = {}): Promise<void> {
    const view: View = { kind: "note", path };
    if (opts.newTab && (opts.focus === false || !this.onBlank)) {
      const tab = this.workspace.addBeside(view);
      this.deps.sound.play("open");
      if (opts.focus === false) {
        this.renderTabs(opts.keyboard ? undefined : tab.id);
        this.persist();
        return;
      }
      this.saveScroll();
      this.workspace.activeIndex += 1;
      await this.show({
        anchor: opts.anchor,
        entering: opts.keyboard ? undefined : tab.id,
        find: opts.find,
        keyboard: opts.keyboard,
      });
      return;
    }
    if (path === this.notePath) {
      if (opts.anchor) this.noteView.scrollToAnchor(opts.anchor);
      if (opts.find) this.noteView.jumpToText(opts.find);
      return;
    }
    this.saveScroll();
    if (opts.via === "link") this.tab.trail.follow(view);
    else this.tab.trail.jump(view);
    await this.show({ anchor: opts.anchor, find: opts.find });
  }

  async go(delta: -1 | 1): Promise<void> {
    this.saveScroll();
    const moved = delta < 0 ? this.tab.trail.back() : this.tab.trail.forward();
    if (moved) await this.show({ keyboard: true });
  }

  /** A new tab starts blank with the palette open. A blank tab that is already open is reused. */
  newTab(): void {
    if (this.workspace.isEmpty) return;
    this.saveScroll();
    const existing = this.workspace.blankIndex;
    if (existing >= 0) {
      this.workspace.activeIndex = existing;
    } else {
      this.workspace.addBeside({ kind: "blank" });
      this.workspace.activeIndex += 1;
    }
    void this.show({ keyboard: true });
    this.palette.open();
  }

  switchTab(index: number): void {
    this.saveScroll();
    if (this.workspace.activate(index)) void this.show({ keyboard: true });
  }

  cycleTab(step: number): void {
    this.saveScroll();
    if (this.workspace.cycle(step)) void this.show({ keyboard: true });
  }

  closeTab(index: number): void {
    this.saveScroll();
    if (this.workspace.close(index)) void this.show({ keyboard: true });
  }

  /** The graph is a tab, as in Obsidian: an open one comes forward, otherwise it opens beside the current tab. */
  openGraph(scope: GraphScope): void {
    if (this.workspace.isEmpty) return;
    const view: GraphTabView = { kind: "graph", note: this.current, scope };
    const existing = this.workspace.graphIndex;
    this.saveScroll();
    if (existing >= 0) {
      this.workspace.tabs[existing].trail.setCurrentView(view);
      this.workspace.activeIndex = existing;
      void this.show({ keyboard: true });
      return;
    }
    if (this.onBlank) {
      this.tab.trail.setCurrentView(view);
      void this.show({ keyboard: true });
      return;
    }
    const tab = this.workspace.addBeside(view);
    this.workspace.activeIndex += 1;
    void this.show({ entering: tab.id });
  }

  toggleGraph(): void {
    if (this.onGraph) this.leaveGraph();
    else this.openGraph("vault");
  }

  /** Leaves the graph: back along the trail if there is somewhere to go, otherwise closes its tab. */
  leaveGraph(): void {
    if (!this.onGraph) return;
    if (this.tab.trail.canBack) void this.go(-1);
    else this.closeTab(this.workspace.activeIndex);
  }

  toggleRail(): void {
    const { shell } = this.els;
    if (railFloats()) {
      shell.classList.toggle("rail-peek");
      return;
    }
    const closed = !shell.classList.contains("rail-closed");
    shell.classList.toggle("rail-closed", closed);
    this.deps.prefs.update((p) => {
      p.rail = !closed;
    });
  }

  openSyncPanel(origin: "click" | "other"): void {
    if (origin === "other") {
      if (isDesktop) this.sync.panel.open();
    } else if (isDesktop) this.sync.panel.toggle(this.els.sync);
    else toast("Git sync runs in the desktop app");
  }

  openSettings(): void {
    const anchor = this.els.shell.querySelector<HTMLElement>('[data-act="settings"]')!;
    toggleSettings(anchor, {
      prefs: this.deps.prefs,
      scheme: this.deps.scheme,
      setFamily: this.deps.setFamily,
      setAppearance: this.deps.setAppearance,
      setSound: (on) => applySound(this.deps.prefs, this.deps.sound, on),
      rescheduleBackground: () => this.sync.scheduleBackground(),
    });
  }

  /** External edits: re-read what changed, re-index it and re-render the open note in place. */
  async onVaultChanged(paths: string[]): Promise<void> {
    if (paths.some((p) => p.startsWith(".git/"))) this.sync.scheduleRefresh();
    const notes = paths.filter((p) => !p.startsWith("."));
    if (!notes.length || this.workspace.isEmpty) return;
    const { structural, changed } = await this.vault.applyChanges(notes);
    this.sync.scheduleRefresh();
    if (this.editing.isOpen) {
      await this.editing.vaultChanged();
      this.renderTree();
    } else if (this.onGraph) await this.show({ quiet: true });
    else if (this.onBlank) this.renderTree();
    else if (!this.vault.texts.has(this.current)) this.noteView.showMissing(this.current);
    else if (changed.includes(this.current) || structural) await this.show({ keepScroll: true, quiet: true });
    else {
      this.renderTree();
      this.inspector.refresh();
    }
    if (this.sidebar.isSearching) this.sidebar.searchPane.run();
  }

  refreshTheme(): void {
    this.inspector.refreshTheme();
    this.graph?.refreshTheme();
  }

  /** Re-renders the open note in place, for example after the code theme changed. */
  rerender(): void {
    if (this.current) void this.show({ keepScroll: true, quiet: true });
  }

  handleKey(e: KeyboardEvent): void {
    const inField =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target instanceof HTMLElement && e.target.isContentEditable);
    if (e.key === "Escape") {
      this.handleEscape(inField);
      return;
    }
    if (this.commands.handleKey(e, inField)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Escape closes the most recently opened layer first. */
  private handleEscape(inField: boolean): void {
    const { shell } = this.els;
    if (this.palette.isOpen || document.querySelector(".lightbox, .sheet-overlay, .popover, .prompt-overlay")) return;
    if (this.sync.panel.isOpen) this.sync.panel.close();
    else if (this.find.isOpen) this.find.close();
    else if (!this.workspace.isEmpty && this.onGraph && !inField) this.leaveGraph();
    else if (shell.matches(".sidebar-peek, .rail-peek")) shell.classList.remove("sidebar-peek", "rail-peek");
    else if (this.sidebar.isSearching && !inField) this.sidebar.showFiles();
    else if (this.onBlank && !inField) this.dismissBlank();
    else paint("search", []);
  }

  /** Cancels a new tab: the tab it opened beside comes back, rather than whichever sits to the right. */
  private dismissBlank(): void {
    const blank = this.workspace.activeIndex;
    if (blank > 0) this.workspace.activeIndex = blank - 1;
    this.closeTab(blank);
  }

  persist(): void {
    if (this.workspace.isEmpty) return;
    this.saveScroll();
    const { prefs, root } = this.deps;
    prefs.update((p) => {
      p.vaults[root] = {
        ...this.workspace.save(),
        lastSync: p.vaults[root]?.lastSync ?? null,
        recent: p.vaults[root]?.recent,
        openFolders: this.sidebar.tree.openFolders,
      };
    });
  }

  private renderContext(): RenderContext {
    return { index: this.vault.index, highlighter: this.deps.highlighter, assetUrl: this.vault.source.assetUrl };
  }

  private async show(opts: ShowOptions = {}): Promise<void> {
    if (this.editing.isOpen) {
      if (opts.quiet || !(await this.editing.close())) return;
    }
    const { metrics } = this.deps;
    const seq = ++this.renderSeq;
    metrics.navStart = performance.now();
    const entry = this.tab.trail.current;
    if (entry.view.kind === "graph") {
      this.showGraph(entry.view, opts.entering);
      return;
    }
    this.closeGraphView();
    if (entry.view.kind === "blank") {
      this.showBlank();
      return;
    }
    const path = entry.view.path;
    const prevScroll = this.els.scroller.scrollTop;
    let text: string;
    try {
      text = await this.vault.read(path);
    } catch {
      if (seq === this.renderSeq) this.noteView.showMissing(path);
      return;
    }
    const rendered = await renderNote(text, path, this.renderContext(), { interactive: true });
    if (seq !== this.renderSeq) return;

    const changedNote = path !== this.current;
    this.current = path;
    if (changedNote || opts.restoring) rememberNote(this.deps.prefs, this.deps.root, path);
    metrics.lastRenderMs = rendered.ms;
    metrics.lastGrammarMs = rendered.grammarMs;

    const animate = changedNote && !opts.quiet && !opts.keyboard && !opts.restoring;
    const doc = this.noteView.mount(path, rendered.fragment, animate);
    this.els.scroller.scrollTop = opts.keepScroll ? prevScroll : entry.scroll;
    if (opts.anchor) this.noteView.scrollToAnchor(opts.anchor);
    if (opts.find) this.noteView.jumpToText(opts.find);
    else if (changedNote) paint("search", []);
    metrics.paintMs = performance.now() - metrics.navStart;
    opts.onPainted?.();

    this.renderTabChrome(opts.entering);
    if (changedNote || !opts.quiet) this.renderTree();
    this.inspector.render(path, rendered);
    this.editing.stats.read(path);
    this.persist();
    this.find.refresh();

    const t0 = performance.now();
    await renderDiagrams(doc);
    metrics.diagramsMs = performance.now() - t0;
    if (opts.anchor) this.noteView.scrollToAnchor(opts.anchor, true);
    if (opts.find) this.noteView.jumpToText(opts.find);
  }

  /** After files move or vanish, redraws without disturbing a note being edited. */
  private async redraw(): Promise<void> {
    if (!this.editing.isOpen) return this.show({ keepScroll: true, keyboard: true });
    this.current = this.notePath;
    this.renderTabChrome();
    this.renderTree();
  }

  private showBlank(): void {
    if (this.find.isOpen) this.find.close();
    this.els.scroller.replaceChildren(startPage(this.vault, this.deps.prefs, this.deps.root, this.deps.name));
    paint("search", []);
    this.renderTabChrome();
    this.renderTree();
    this.persist();
  }

  private showGraph(view: GraphTabView, entering?: number): void {
    if (this.find.isOpen) this.find.close();
    this.current = view.note;
    if (!this.graph) {
      this.graph = new GraphView(this.els.reader, this.vault, {
        open: (path, newTab) => void this.open(path, { newTab, focus: !newTab, via: "link" }),
        currentView: () => {
          const shown = this.tab.trail.current.view;
          return shown.kind === "graph" ? shown : null;
        },
        setScope: (scope) => {
          const shown = this.tab.trail.current.view;
          if (shown.kind !== "graph") return;
          this.tab.trail.setCurrentView({ ...shown, scope });
          this.persist();
        },
      });
      this.sync.panel.close();
    }
    this.renderTabChrome(entering);
    this.renderTree();
    requestAnimationFrame(() => this.graph?.show(view.note, view.scope));
    this.graph.focus();
    this.persist();
  }

  private closeGraphView(): void {
    this.graph?.destroy();
    this.graph = null;
  }

  private renderTree(): void {
    this.sidebar.renderTree(this.vault.index, this.onBlank ? "" : this.current);
  }

  private viewLabel = (view: View): string => {
    if (view.kind === "note") return this.vault.index.title(view.path);
    return view.kind === "graph" ? "Graph" : "New tab";
  };

  private renderTabs(entering?: number): void {
    renderTabStrip(this.els.tabs, this.workspace, this.viewLabel, entering);
    this.els.shell.classList.toggle("single-tab", this.workspace.tabs.length === 1);
  }

  /** The parts of the window that follow the active tab, whichever view it shows. */
  private renderTabChrome(entering?: number): void {
    const { shell, graphButton, back, forward } = this.els;
    const { trail } = this.tab;
    this.renderTabs(entering);
    this.renderTrail();
    shell.classList.toggle("is-graph", this.onGraph);
    shell.classList.toggle("is-blank", this.onBlank);
    if (this.onGraph || this.onBlank) this.editing.stats.hide();
    graphButton.classList.toggle("is-on", this.onGraph);
    graphButton.setAttribute("aria-pressed", String(this.onGraph));
    back.disabled = !trail.canBack;
    forward.disabled = !trail.canForward;
  }

  private renderTrail(): void {
    const { trail } = this.tab;
    this.trailMap.root.hidden = trail.size < 2;
    if (trail.size < 2) return;
    const entries = trail.layout().map((placement) => {
      const view = trail.view(placement.id)!;
      return { ...placement, label: this.viewLabel(view), isGraph: view.kind === "graph" };
    });
    this.trailMap.render(this.tab.id, entries, trail.current.id, trail.pathToCurrent());
  }

  private saveScroll(): void {
    const node = this.tab?.trail.current;
    if (node?.view.kind === "note") node.scroll = this.els.scroller.scrollTop;
  }

  private selectOnTrail(id: number, newTab: boolean): void {
    const view = this.tab.trail.view(id);
    if (!view) return;
    if (newTab && view.kind === "note") {
      void this.open(view.path, { newTab: true, focus: true });
      return;
    }
    this.saveScroll();
    this.tab.trail.select(id);
    void this.show({ keyboard: true });
  }

  private removeFromTrail(id: number): void {
    this.saveScroll();
    const before = this.tab.trail.current.view;
    this.tab.trail.remove(id);
    if (this.tab.trail.current.view !== before) void this.show({ keyboard: true });
    else {
      this.renderTrail();
      this.persist();
    }
  }

  private toggleTrailBranch(id: number): void {
    this.tab.trail.toggleCollapsed(id);
    this.renderTrail();
    this.persist();
  }
}
