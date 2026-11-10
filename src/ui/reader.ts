import { isDesktop, native } from "../platform";
import { renderDiagrams } from "../render/diagrams";
import { type RenderContext, renderInlineMarkdown, renderNote } from "../render/note";
import { isBaseFile } from "../vault/index";
import type { VaultStore } from "../vault/store";
import type { GraphScope, View } from "../vault/trail";
import { type Tab, Workspace } from "../vault/workspace";
import type { BaseView } from "./base-view";
import { Bookmarks } from "./bookmarks";
import { CommandTable } from "./commands";
import { FindBar, paint } from "./find";
import { type GraphTabView, GraphView } from "./graph-view";
import { Inspector } from "./inspector";
import { LinkPreview } from "./link-preview";
import { isNarrow } from "./media";
import { NoteEditing } from "./note-editing";
import { NoteFiles } from "./note-files";
import { NoteView } from "./note-view";
import { ESCAPE_IS_TAKEN, toast } from "./overlays";
import { Palette } from "./palette";
import { bindReaderClicks } from "./reader-clicks";
import { paletteItems, paletteRecent, readerCommands } from "./reader-commands";
import { TrailActions } from "./reader-trail";
import type { Metrics, OpenOptions, ReaderDeps, ShowOptions } from "./reader-types";
import { ReadingSpots } from "./reading-spots";
import { restoreTabs } from "./restore-tabs";
import { applySound, previewKeys, toggleSettings } from "./settings";
import { mountShell, type ShellElements } from "./shell";
import { Sidebar } from "./sidebar";
import { rememberNote, startPage } from "./start-page";
import { SyncController } from "./sync-controller";
import { renderTabStrip } from "./tab-strip";
import { bindTooltips } from "./tooltips";

export type { Metrics, OpenOptions, ReaderDeps };

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
  readonly spots: ReadingSpots;
  readonly bookmarks: Bookmarks;
  private baseView: BaseView | null = null;
  readonly files: NoteFiles;
  readonly workspace = new Workspace();
  /** The note on screen, or the note a graph tab was opened from. */
  current = "";

  readonly els: ShellElements;
  private readonly noteView: NoteView;
  readonly trail: TrailActions;
  private graph: GraphView | null = null;
  private renderSeq = 0;

  constructor(readonly deps: ReaderDeps) {
    const { host, vault, prefs } = deps;
    const p = prefs.value;
    this.vault = vault;
    this.els = mountShell(host, {
      sidebarOpen: p.sidebar,
      railOpen: p.rail,
      sidebarWidth: p.sidebarWidth,
      railWidth: p.railWidth,
    });
    const { els } = this;

    this.noteView = new NoteView(els, vault, deps.name, toast);
    this.trail = new TrailActions(els, {
      tab: () => this.tab,
      label: (view) => this.viewLabel(view),
      open: (path) => void this.open(path, { newTab: true, focus: true }),
      saveScroll: () => this.saveScroll(),
      show: () => void this.show(),
      persist: () => this.persist(),
      chrome: () => this.renderTabChrome(),
      inspector: () => this.inspector,
    });

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
        showWorktreeDiff: (change) =>
          void this.sync.panel.detail.showWorktreeDiff(change, change.unstaged === " " || !change.unstaged),
        showCommit: (commit, path) => void this.sync.panel.detail.showCommit(commit, path),
        showAllHistory: (path) => this.sync.panel.open(undefined, { historyPath: path }),
        openFromGraph: (path, newTab) => void this.open(path, { newTab, focus: !newTab, via: "link" }),
        prefs,
        editing: () => this.editing,
      },
      p.railPane,
      { trail: p.trailFolded, graph: p.graphFolded },
    );

    this.editing = new NoteEditing({
      els,
      vault,
      highlighter: deps.highlighter,
      toast,
      notePath: () => this.notePath,
      reshow: () => this.show({ keepScroll: true }),
      incomingCommits: () => this.sync.panel.status?.behind ?? 0,
      open: (path, newTab, anchor) => void this.open(path, { newTab, focus: true, anchor, via: "link" }),
      openUrl: (url) => void native.openExternal(url),
      renderInline: (text, path) => renderInlineMarkdown(text, path, this.renderContext()),
      rename: (path, name) => this.files.renameTo(path, name),
      prefs,
      syncBusy: () => this.sync.busy,
      noteSaved: () => void this.inspector?.refreshProperties(),
      noteRestored: async (path) => {
        await vault.applyChanges([path]);
        if (path === this.current && !this.editing.isOpen) await this.show({ keepScroll: true, quiet: true });
        this.renderTree();
        this.sync.scheduleRefresh();
      },
    });
    this.spots = new ReadingSpots({
      prefs,
      root: deps.root,
      scroller: els.scroller,
      note: () => (this.onGraph || this.onBlank || this.onBase ? null : this.current || null),
      isEditing: () => this.editing.isOpen,
      editingAnchor: () => this.editing.editingAnchor(),
    });
    this.bookmarks = new Bookmarks({
      prefs,
      root: deps.root,
      index: () => vault.index,
      text: (path) => vault.texts.get(path),
      open: (path, newTab, anchor) => void this.open(path, { newTab, focus: true, anchor }),
      toast,
      current: () => (this.onBlank ? "" : this.current),
    });
    this.sidebar.tree.leading = this.bookmarks.element;
    this.files = new NoteFiles({
      bookmarks: this.bookmarks,
      sidebar: els.sidebar,
      vault,
      prefs,
      root: deps.root,
      workspace: this.workspace,
      editing: this.editing,
      tree: this.sidebar.tree,
      toast,
      notePath: () => this.notePath,
      open: (path, newTab) => this.open(path, { newTab, focus: true }),
      redraw: () => this.redraw(),
      syncBusy: () => this.sync.busy,
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
        restoreVersion: (path, text, when) => this.editing.restoreVersion(path, text, when),
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
    els.scroller.addEventListener(
      "scroll",
      () => {
        this.inspector.spy();
        this.spots.scrolled();
      },
      { passive: true },
    );
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

  get onBase(): boolean {
    return this.tab?.trail.current.view.kind === "base";
  }

  get onBlank(): boolean {
    return this.tab?.trail.current.view.kind === "blank";
  }

  get notePath(): string {
    const view = this.tab.trail.current.view;
    return view.kind === "note" ? view.path : "";
  }

  // Navigation

  async open(path: string, opts: OpenOptions = {}): Promise<void> {
    const view: View = isBaseFile(path) ? { kind: "base", path } : { kind: "note", path };
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
        followed: opts.via === "link",
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
    await this.show({ anchor: opts.anchor, find: opts.find, followed: opts.via === "link" });
  }

  async go(delta: -1 | 1): Promise<void> {
    this.saveScroll();
    const moved = delta < 0 ? this.tab.trail.back() : this.tab.trail.forward();
    if (moved) await this.show();
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
    void this.show();
    this.palette.open();
  }

  switchTab(index: number): void {
    this.saveScroll();
    if (this.workspace.activate(index)) void this.show();
  }

  cycleTab(step: number): void {
    this.saveScroll();
    if (this.workspace.cycle(step)) void this.show();
  }

  closeTab(index: number): void {
    this.saveScroll();
    if (this.workspace.tabs[index]?.pinned) toast("Unpin this tab to close it.");
    else if (this.workspace.close(index)) void this.show();
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
      void this.show();
      return;
    }
    if (this.onBlank) {
      this.tab.trail.setCurrentView(view);
      void this.show();
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
      previewKeys: () => previewKeys(this.deps.prefs, this.deps.sound),
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
    } else if (this.onBase) await this.show({ keepScroll: true, quiet: true });
    else if (this.onGraph) await this.show({ quiet: true });
    else if (this.onBlank) this.renderTree();
    else if (!this.vault.texts.has(this.current)) {
      this.noteView.showMissing(this.current);
      this.renderTree();
    } else if (changed.includes(this.current) || structural) await this.show({ keepScroll: true, quiet: true });
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
    if (this.palette.isOpen || document.querySelector(ESCAPE_IS_TAKEN)) return;
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
        ...p.vaults[root],
        ...this.workspace.save(),
        lastSync: p.vaults[root]?.lastSync ?? null,
        openFolders: this.sidebar.tree.openFolders,
      };
    });
  }

  private renderContext(): RenderContext {
    return { ...this.vault.renderFacts, highlighter: this.deps.highlighter };
  }

  async show(opts: ShowOptions = {}): Promise<void> {
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
    if (entry.view.kind === "base") {
      await this.showBase(entry.view.path, opts, seq);
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

    const doc = this.noteView.mount(path, rendered.fragment, changedNote && opts.followed === true);
    this.els.scroller.scrollTop = opts.keepScroll ? prevScroll : entry.scroll;
    if (!opts.keepScroll && !opts.anchor && !opts.find && (!entry.scroll || opts.restoring)) this.spots.restore(path);
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
    if (seq === this.renderSeq) this.spots.settle();
    if (opts.anchor) this.noteView.scrollToAnchor(opts.anchor, true);
    if (opts.find) this.noteView.jumpToText(opts.find);
  }

  private async showBase(path: string, opts: ShowOptions, seq: number): Promise<void> {
    const scroll = opts.keepScroll ? this.els.scroller.scrollTop : this.tab.trail.current.scroll;
    this.current = path;
    this.noteView.showPaneHead(path, "");
    /* Views bring a YAML parser, which only someone opening one should load. */
    this.baseView ??= new (await import("./base-view")).BaseView({
      vault: this.vault,
      scroller: this.els.scroller,
      open: (target, newTab) => void this.open(target, { newTab, focus: true, via: "link" }),
    });
    await this.baseView.show(path, scroll, () => seq !== this.renderSeq);
    if (seq !== this.renderSeq) return;
    this.renderTabChrome(opts.entering);
    this.renderTree();
    this.persist();
  }

  /** After files move or vanish, redraws without disturbing a note being edited. */
  private async redraw(): Promise<void> {
    if (!this.editing.isOpen) return this.show({ keepScroll: true });
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
        leave: () => this.leaveGraph(),
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
    this.bookmarks.render();
  }

  private viewLabel = (view: View): string => {
    if (view.kind === "note" || view.kind === "base") return this.vault.index.title(view.path);
    return view.kind === "graph" ? "Graph" : "New tab";
  };

  renderTabs(entering?: number): void {
    renderTabStrip(this.els.tabs, this.workspace, this.viewLabel, entering);
    this.els.shell.classList.toggle("single-tab", this.workspace.tabs.length === 1);
  }

  /** The parts of the window that follow the active tab, whichever view it shows. */
  private renderTabChrome(entering?: number): void {
    const { shell, graphButton, back, forward } = this.els;
    const { trail } = this.tab;
    this.renderTabs(entering);
    this.trail.render();
    shell.classList.toggle("is-graph", this.onGraph);
    shell.classList.toggle("is-blank", this.onBlank);
    shell.classList.toggle("is-base", this.onBase);
    if (this.onGraph || this.onBlank || this.onBase) this.editing.stats.hide();
    graphButton.classList.toggle("is-on", this.onGraph);
    graphButton.setAttribute("aria-pressed", String(this.onGraph));
    back.disabled = !trail.canBack;
    forward.disabled = !trail.canForward;
  }

  saveScroll(): void {
    const node = this.tab?.trail.current;
    const drawn = (node?.view.kind === "note" || node?.view.kind === "base") && node.view.path === this.current;
    if (drawn) node.scroll = this.els.scroller.scrollTop;
    this.spots.record();
  }
}
