import { type GitStatus, isDesktop, native } from "../platform";
import type { PrefStore, Prefs } from "../prefs";
import { renderDiagrams } from "../render/diagrams";
import type { Highlighter } from "../render/highlight";
import { type RenderContext, renderNote } from "../render/note";
import type { Scheme } from "../themes";
import type { VaultStore } from "../vault/store";
import type { GraphScope, View } from "../vault/trail";
import { type Tab, Workspace } from "../vault/workspace";
import { CommandTable } from "./commands";
import { FindBar, paint } from "./find";
import { GitPanel, type SyncState } from "./git-panel";
import { type GraphTabView, GraphView } from "./graph-view";
import { Inspector, type RailPane } from "./inspector";
import { LinkPreview } from "./link-preview";
import { isNarrow, railFloats, reducedMotion } from "./media";
import { chooseAmbiguous, copyCode, toggleCallout } from "./note-actions";
import { NoteView } from "./note-view";
import { lightbox, toast } from "./overlays";
import { Palette } from "./palette";
import { paletteItems, paletteRecent, readerCommands } from "./reader-commands";
import { toggleSettings } from "./settings";
import { mountShell, type ShellElements } from "./shell";
import { Sidebar } from "./sidebar";
import type { Sound } from "./sound";
import { describeSync } from "./sync-status";
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

const GIT_REFRESH_DEBOUNCE_MS = 400;
const LINK_SELECTOR = "a.wikilink, a.wikilink-plain, .nav-item[data-path]";

/** One open vault's window: its panels, its tabs and how the user moves between notes. */
export class Reader {
  readonly vault: VaultStore;
  readonly commands: CommandTable;
  readonly palette: Palette;
  readonly find: FindBar;
  readonly gitPanel: GitPanel;
  readonly sidebar: Sidebar;
  readonly inspector: Inspector;
  readonly workspace = new Workspace();
  /** The note on screen, or the note a graph tab was opened from. */
  current = "";

  private readonly els: ShellElements;
  private readonly noteView: NoteView;
  private readonly trailMap: TrailMap;
  private readonly preview: LinkPreview;
  private graph: GraphView | null = null;
  private renderSeq = 0;
  private backgroundTimer = 0;
  private gitRefreshTimer = 0;

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

    this.gitPanel = this.makeGitPanel();
    this.inspector = new Inspector(
      els,
      vault,
      {
        status: () => this.gitPanel.status,
        currentNote: () => this.current,
        showWorktreeDiff: (change) => void this.gitPanel.showWorktreeDiff(change, change.unstaged === " " || !change.unstaged),
        showCommit: (commit, path) => void this.gitPanel.showCommit(commit, path),
        openFromGraph: (path, newTab) => void this.open(path, { newTab, focus: !newTab, via: "link" }),
      },
      p.railPane,
    );

    this.commands = new CommandTable(readerCommands(this), { desktop: isDesktop, hasNote: () => !this.workspace.isEmpty });
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

    this.renderSync(null, { kind: "idle" });
    els.shell.addEventListener("click", (e) => this.onClick(e));
    els.shell.addEventListener("auxclick", (e) => {
      if (e.button === 1) this.onClick(e);
    });
    els.scroller.addEventListener("scroll", () => this.inspector.spy(), { passive: true });
    bindTooltips(els.shell);
  }

  /** Shows the restored note as soon as it is read, then reads and indexes the rest of the vault. */
  async start(startedAt: number, initial?: string): Promise<void> {
    const { vault, metrics, codeThemeReady } = this.deps;
    this.restoreTabs(initial);
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
    void this.initGit();
  }

  dispose(): void {
    clearInterval(this.backgroundTimer);
    clearTimeout(this.gitRefreshTimer);
    this.preview.hide();
    this.closeGraphView();
  }

  private get tab(): Tab {
    return this.workspace.active;
  }

  private get onGraph(): boolean {
    return this.tab.trail.current.view.kind === "graph";
  }

  private get notePath(): string {
    const view = this.tab.trail.current.view;
    return view.kind === "note" ? view.path : "";
  }

  // Navigation

  async open(path: string, opts: OpenOptions = {}): Promise<void> {
    const view: View = { kind: "note", path };
    if (opts.newTab) {
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

  /** A new tab starts on the current note with the palette open, so the next pick replaces it. */
  newTab(): void {
    void this.open(this.current, { newTab: true, focus: true, keyboard: true }).then(() => this.palette.open());
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
    const view: GraphTabView = { kind: "graph", note: this.current, scope };
    const existing = this.workspace.graphIndex;
    this.saveScroll();
    if (existing >= 0) {
      this.workspace.tabs[existing].trail.setCurrentView(view);
      this.workspace.activeIndex = existing;
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
      if (isDesktop) this.gitPanel.open();
    } else if (isDesktop) this.gitPanel.toggle(this.els.sync);
    else toast("Git sync runs in the desktop app");
  }

  openSettings(): void {
    const anchor = this.els.shell.querySelector<HTMLElement>('[data-act="settings"]')!;
    toggleSettings(anchor, {
      prefs: this.deps.prefs,
      scheme: this.deps.scheme,
      setFamily: this.deps.setFamily,
      setAppearance: this.deps.setAppearance,
      setSound: (on) => this.setSound(on),
      rescheduleBackground: () => this.scheduleBackground(),
    });
  }

  setSound(on: boolean): void {
    const { prefs, sound } = this.deps;
    prefs.update((p) => {
      p.sound = on;
    });
    sound.muted = !on;
    if (on) sound.play("synced");
    toast(on ? "Sounds on" : "Sounds muted");
  }

  // External events

  /** External edits: re-read what changed, re-index it and re-render the open note in place. */
  async onVaultChanged(paths: string[]): Promise<void> {
    if (paths.some((p) => p.startsWith(".git/"))) this.scheduleGitRefresh();
    const notes = paths.filter((p) => !p.startsWith("."));
    if (!notes.length || this.workspace.isEmpty) return;
    const { structural, changed } = await this.vault.applyChanges(notes);
    this.scheduleGitRefresh();
    if (this.onGraph) await this.show({ quiet: true });
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
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
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
    if (this.palette.isOpen || document.querySelector(".lightbox, .sheet-overlay, .popover")) return;
    if (this.find.isOpen) this.find.close();
    else if (!this.workspace.isEmpty && this.onGraph && !inField) this.leaveGraph();
    else if (this.gitPanel.isOpen) this.gitPanel.close();
    else if (shell.matches(".sidebar-peek, .rail-peek")) shell.classList.remove("sidebar-peek", "rail-peek");
    else if (this.sidebar.isSearching && !inField) this.sidebar.showFiles();
    else paint("search", []);
  }

  persist(): void {
    if (this.workspace.isEmpty) return;
    this.saveScroll();
    const { prefs, root } = this.deps;
    prefs.update((p) => {
      p.vaults[root] = {
        ...this.workspace.save(),
        lastSync: p.vaults[root]?.lastSync ?? null,
        openFolders: this.sidebar.tree.openFolders,
      };
    });
  }

  // Rendering

  private renderContext(): RenderContext {
    return { index: this.vault.index, highlighter: this.deps.highlighter, assetUrl: this.vault.source.assetUrl };
  }

  private restoreTabs(initial?: string): void {
    const { index } = this.vault;
    const saved = this.deps.prefs.value.vaults[this.deps.root];
    const wanted = initial ? index.resolve(initial) : null;
    if (wanted?.kind === "found") {
      this.workspace.startWith({ kind: "note", path: wanted.path });
    } else if (saved?.tabs?.length) {
      this.workspace.restore({ tabs: saved.tabs, active: saved.active ?? 0 }, (view) =>
        index.notes.includes(view.kind === "note" ? view.path : view.note),
      );
    }
    if (this.workspace.isEmpty) {
      const fallback = index.notes.find((p) => /^(readme|index|home)\.md$/i.test(p)) ?? index.notes[0];
      if (fallback) this.workspace.startWith({ kind: "note", path: fallback });
    }
  }

  private async show(opts: ShowOptions = {}): Promise<void> {
    const { metrics } = this.deps;
    const seq = ++this.renderSeq;
    metrics.navStart = performance.now();
    const entry = this.tab.trail.current;
    if (entry.view.kind === "graph") {
      this.showGraph(entry.view, opts.entering);
      return;
    }
    this.closeGraphView();
    const path = entry.view.path;
    const prevScroll = this.els.scroller.scrollTop;
    let text: string;
    try {
      text = await this.vault.read(path);
    } catch {
      if (seq === this.renderSeq) this.noteView.showMissing(path);
      return;
    }
    const rendered = await renderNote(text, path, this.renderContext());
    if (seq !== this.renderSeq) return;

    const changedNote = path !== this.current;
    this.current = path;
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
    this.persist();
    this.find.refresh();

    const t0 = performance.now();
    await renderDiagrams(doc);
    metrics.diagramsMs = performance.now() - t0;
    if (opts.anchor) this.noteView.scrollToAnchor(opts.anchor, true);
    if (opts.find) this.noteView.jumpToText(opts.find);
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
      this.gitPanel.close();
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
    this.sidebar.renderTree(this.vault.index, this.current);
  }

  private viewLabel = (view: View): string => (view.kind === "note" ? this.vault.index.title(view.path) : "Graph");

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
    this.trailMap.render(this.tab.id, entries, trail.current.id, trail.pathToCurrent(), trail.crossLinks());
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

  // Git

  private makeGitPanel(): GitPanel {
    const { prefs, sound, root } = this.deps;
    return new GitPanel({
      play: (cue) => sound.play(cue),
      toast,
      openNote: (path) => void this.open(path),
      lastSync: () => prefs.value.vaults[root]?.lastSync ?? null,
      onVisible: (open) => this.els.sync.classList.toggle("is-on", open),
      setLastSync: (at) =>
        prefs.update((p) => {
          p.vaults[root] ??= { tabs: [], active: 0, lastSync: null };
          p.vaults[root].lastSync = at;
        }),
      onStatus: (status, state) => this.renderSync(status, state),
      renderNoteAt: async (markdown, path, into) => {
        const rendered = await renderNote(markdown, path, this.renderContext());
        into.append(rendered.fragment);
        await renderDiagrams(into);
      },
      title: (path) => this.vault.index.title(path),
    });
  }

  private async initGit(): Promise<void> {
    if (!isDesktop) return;
    await this.gitPanel.refresh();
    if (this.gitPanel.status?.isRepo && this.deps.prefs.value.syncOnLaunch) void this.gitPanel.fetch();
    this.scheduleBackground();
  }

  private scheduleBackground(): void {
    clearInterval(this.backgroundTimer);
    const minutes = this.deps.prefs.value.backgroundMinutes;
    if (!minutes || !isDesktop) return;
    this.backgroundTimer = window.setInterval(() => {
      if (this.gitPanel.status?.isRepo && this.gitPanel.state.kind !== "busy") void this.gitPanel.fetch(true);
    }, minutes * 60_000);
  }

  private scheduleGitRefresh(): void {
    if (!isDesktop) return;
    clearTimeout(this.gitRefreshTimer);
    this.gitRefreshTimer = window.setTimeout(() => {
      if (this.gitPanel.state.kind !== "busy") void this.gitPanel.refresh();
    }, GIT_REFRESH_DEBOUNCE_MS);
  }

  private renderSync(status: GitStatus | null, state: SyncState): void {
    const { sync, branch } = this.els;
    const { prefs, root } = this.deps;
    const branchName = isDesktop && status?.isRepo ? status.branch : null;
    branch.hidden = !branchName;
    branch.lastElementChild!.textContent = branchName ?? "";
    const summary = describeSync(status, state, { desktop: isDesktop, everSynced: prefs.value.vaults[root]?.lastSync != null });
    this.inspector?.refreshHistory();
    sync.dataset.tone = summary.tone;
    sync.querySelector(".sync-label")!.textContent = summary.text;
    sync.dataset.tip = summary.tip;
  }

  // Clicks

  /** First match wins, so more specific targets are listed before the elements that contain them. */
  private readonly clickRoutes: [string, (el: HTMLElement, e: MouseEvent) => void][] = [
    ["[data-tab-close]", (el) => this.closeTab(Number(el.closest<HTMLElement>(".tab")!.dataset.tab))],
    ['[data-act="search-clear"]', () => this.sidebar.searchPane.clear()],
    ["[data-act]", (el) => this.commands.run(el.dataset.act!, "click")],
    [".tab", (el, e) => (e.button === 1 ? this.closeTab(Number(el.dataset.tab)) : this.switchTab(Number(el.dataset.tab)))],
    ["[data-side]", (el) => (el.dataset.side === "search" ? this.sidebar.showSearch() : this.sidebar.showFiles())],
    [".tree-head", (el) => this.sidebar.tree.toggle(el.dataset.folder!)],
    ["[data-crumb]", (el) => this.sidebar.revealFolder(el.dataset.crumb!)],
    ["[data-rail]", (el) => this.chooseRailPane(el.dataset.rail as RailPane)],
    [".search-hit", (el, e) => this.sidebar.searchPane.openHit(Number(el.dataset.hit), e.metaKey)],
    [".code-copy", (el) => void copyCode(el as HTMLButtonElement, () => this.deps.sound.play("copy"))],
    ["button.callout-title", (el) => toggleCallout(el)],
    [".diagram-expand", (el) => lightbox(el.closest(".diagram")!.querySelector("svg")!.cloneNode(true) as Element)],
    ["img.embed-image", (el) => lightbox(el.cloneNode() as Element)],
    [".outline a", (el, e) => this.followOutline(el, e)],
    [LINK_SELECTOR, (el, e) => this.followLink(el, e)],
    ["a.attachment-link, a.embed-file", (el, e) => this.openAttachment(el as HTMLAnchorElement, e)],
    [".doc a[href^='http'], .doc a[href^='mailto:']", (el, e) => this.openExternal(el as HTMLAnchorElement, e)],
    [".remote-image", (el) => el.dataset.src && void native.openExternal(el.dataset.src)],
  ];

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    if (!target.closest(".sidebar, .rail, [data-act]")) this.els.shell.classList.remove("sidebar-peek", "rail-peek");
    for (const [selector, handle] of this.clickRoutes) {
      const el = target.closest<HTMLElement>(selector);
      if (!el) continue;
      if (el.matches("[data-act], [data-tab-close]")) e.preventDefault();
      handle(el, e);
      return;
    }
  }

  private chooseRailPane(pane: RailPane): void {
    this.deps.prefs.update((p) => {
      p.railPane = pane;
    });
    this.inspector.setPane(pane);
  }

  private followOutline(el: HTMLElement, e: MouseEvent): void {
    e.preventDefault();
    document
      .getElementById(el.dataset.target!)
      ?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
  }

  private followLink(link: HTMLElement, e: MouseEvent): void {
    if (link.closest(".sidebar, .rail")) this.els.shell.classList.remove("sidebar-peek", "rail-peek");
    e.preventDefault();
    this.preview.hide();
    if (link.classList.contains("is-ambiguous")) {
      const candidates = JSON.parse(link.dataset.candidates!) as string[];
      chooseAmbiguous(link, candidates, this.vault.index, (path) => {
        void this.open(path, { newTab: e.metaKey, focus: true, anchor: link.dataset.anchor });
      });
      return;
    }
    if (!link.dataset.path) return;
    const newTab = e.metaKey || e.button === 1;
    void this.open(link.dataset.path, {
      anchor: link.dataset.anchor,
      newTab,
      focus: newTab ? e.shiftKey : true,
      via: link.classList.contains("nav-item") ? "jump" : "link",
    });
  }

  private openAttachment(link: HTMLAnchorElement, e: MouseEvent): void {
    e.preventDefault();
    if (isDesktop) void native.reveal(link.dataset.attachment ?? undefined);
    else window.open(link.href, "_blank", "noopener");
  }

  private openExternal(link: HTMLAnchorElement, e: MouseEvent): void {
    e.preventDefault();
    void native.openExternal(link.href);
  }
}
