import type { Commit } from "../platform";
import { desktopVaultSource, type GitStatus, git, isDesktop, native } from "../platform";
import { PrefStore } from "../prefs";
import { renderDiagrams } from "../render/diagrams";
import { Highlighter } from "../render/highlight";
import { type RenderedNote, renderNote } from "../render/note";
import { applyTheme, FAMILIES, findFamily, type Scheme } from "../themes";
import { type CommunityResult, detectCommunities } from "../vault/communities";
import { parseFrontmatter } from "../vault/frontmatter";
import { headingKey, VaultIndex } from "../vault/index";
import { LinkGraph } from "../vault/links";
import { type Hit, SearchIndex } from "../vault/search";
import type { VaultSource } from "../vault/source";
import { type GraphScope, Trail, type View } from "../vault/trail";
import { ancestors, buildTree, type TreeFolder } from "../vault/tree";
import { FindBar, findRanges, paint, scrollToRange } from "./find";
import { GitPanel, relative, type SyncState } from "./git-panel";
import { GraphCanvas, type GraphData, groupColor } from "./graph";
import { icons } from "./icons";
import { LocalGraph } from "./local-graph";
import { Palette, type PaletteItem } from "./palette";
import { Sound } from "./sound";
import { TrailMap } from "./trail-map";
import { showWelcome } from "./welcome";

interface Tab {
  id: number;
  trail: Trail;
}

type GraphView = Extract<View, { kind: "graph" }>;

const HISTORY_LIMIT = 100;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = () => matchMedia("(max-width: 900px)").matches;
const railFloats = () => matchMedia("(max-width: 1240px)").matches;

export class App {
  index!: VaultIndex;
  texts = new Map<string, string>();
  private source!: VaultSource;
  private vaultRoot = "dev";
  private vaultName = "";
  private links!: LinkGraph;
  private search = new SearchIndex();
  private highlighter = new Highlighter();
  private prefs = new PrefStore();
  private sound = new Sound(false);
  private palette!: Palette;
  private find!: FindBar;
  private gitPanel!: GitPanel;
  private tabs: Tab[] = [];
  private active = 0;
  private nextId = 1;
  private renderSeq = 0;
  private current = "";
  private rendered: RenderedNote | null = null;
  private sidebarMode: "files" | "search" = "files";
  private communities: CommunityResult | null = null;
  private spotGroup: number | null = null;
  private searchQuery = "";
  private searchHits: Hit[] = [];
  private searchSel = 0;
  private localGraph: LocalGraph | null = null;
  private graphView: { root: HTMLElement; canvas: GraphCanvas; depth: number } | null = null;
  private trailMap!: TrailMap;
  private historySeq = 0;
  private historyShown = "";
  private backgroundTimer = 0;
  private gitRefreshTimer = 0;
  private openFolders = new Set<string>();
  private treeIndex: VaultIndex | null = null;
  private treeCurrent = "";
  private folderEls = new Map<string, HTMLElement>();
  private noteEls = new Map<string, HTMLElement>();
  private spyActive: HTMLElement | null = null;
  private els!: {
    shell: HTMLElement;
    tabs: HTMLElement;
    sidebar: HTMLElement;
    searchPane: HTMLElement;
    scroller: HTMLElement;
    outline: HTMLElement;
    links: HTMLElement;
    info: HTMLElement;
    railBody: HTMLElement;
    railGraph: HTMLElement;
    back: HTMLButtonElement;
    forward: HTMLButtonElement;
    sync: HTMLButtonElement;
    reader: HTMLElement;
    paneHead: HTMLElement;
    crumbs: HTMLElement;
    paneMeta: HTMLElement;
    branch: HTMLElement;
  };
  readonly metrics: Record<string, number> = {};

  constructor(private host: HTMLElement) {}

  async start(devSource?: VaultSource, initial?: string, override?: string): Promise<void> {
    const t0 = performance.now();
    this.prefs.ephemeral = override !== undefined;
    await this.prefs.load();
    this.sound.muted = !this.prefs.value.sound;
    this.applyTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    window.addEventListener("keydown", (e) => this.onKey(e), true);
    if (isDesktop) await native.onVaultChanged((paths) => void this.onVaultChanged(paths));
    if (devSource) {
      this.source = devSource;
      await this.loadVault("dev", "Vault", initial);
    } else if (override) {
      await this.openVault(override);
    } else if (this.prefs.value.lastVault) {
      await this.openVault(this.prefs.value.lastVault).catch((err: Error) => this.welcome(err.message));
    } else {
      this.welcome();
    }
    this.metrics.startMs = performance.now() - t0;
  }

  private welcome(error?: string): void {
    this.localGraph = null;
    this.els = undefined as never;
    showWelcome(
      this.host,
      this.prefs.value.recentVaults,
      (path) => {
        void this.openVault(path).catch((err: Error) => this.welcome(err.message));
      },
      error,
    );
  }

  async openVault(path: string): Promise<void> {
    const info = await native.openVault(path);
    this.source = desktopVaultSource();
    this.prefs.update((p) => {
      p.lastVault = info.root;
      p.recentVaults = [info.root, ...p.recentVaults.filter((r) => r !== info.root)].slice(0, 8);
    });
    this.tabs = [];
    this.current = "";
    await this.loadVault(info.root, info.name);
  }

  // ---------- Vault loading ----------

  /**
   * Shows the restored note as soon as it is read, then reads and indexes the
   * rest of the vault. Nothing here waits on the network.
   */
  private async loadVault(root: string, name: string, initial?: string): Promise<void> {
    const t0 = performance.now();
    this.vaultRoot = root;
    this.vaultName = name;
    this.texts.clear();
    this.mount();
    const files = await this.source.list();
    this.index = new VaultIndex(files);
    this.links = new LinkGraph(this.index);
    this.search = new SearchIndex();
    const highlighterReady = this.highlighter.init().then(() => this.syncCodeTheme());

    const saved = this.prefs.value.vaults[root];
    const wanted = initial ? this.index.resolve(initial) : null;
    this.openFolders = new Set(saved?.openFolders ?? []);
    const fallback = this.index.notes.find((p) => /^(readme|index|home)\.md$/i.test(p)) ?? this.index.notes[0];
    this.tabs = [];
    const noteTab = (path: string, scroll = 0): Tab => ({ id: this.nextId++, trail: new Trail({ kind: "note", path }, scroll) });
    const exists = (view: View) => this.index.notes.includes(view.kind === "note" ? view.path : view.note);
    if (wanted?.kind === "found") {
      this.tabs = [noteTab(wanted.path)];
    } else if (saved?.tabs?.length) {
      this.tabs = saved.tabs.flatMap((value): Tab[] => {
        const trail = Trail.restore(value, exists);
        if (trail) return [{ id: this.nextId++, trail }];
        /* Earlier versions saved a single note per tab. */
        if (
          typeof value === "object" &&
          value !== null &&
          "path" in value &&
          typeof value.path === "string" &&
          this.index.notes.includes(value.path)
        ) {
          return [noteTab(value.path, "scroll" in value && typeof value.scroll === "number" ? value.scroll : 0)];
        }
        return [];
      });
      this.active = Math.max(0, Math.min(saved.active ?? 0, this.tabs.length - 1));
    }
    if (!this.tabs.length) {
      if (!fallback) {
        this.els.scroller.innerHTML = `<div class="empty-state is-page"><strong>No Markdown notes here</strong><p>Waymark reads .md files. Open a different folder from the palette: press ⌘K and choose “Open another vault”.</p></div>`;
        return;
      }
      this.tabs = [noteTab(fallback)];
      this.active = 0;
    }

    const firstView = this.tab.trail.current.view;
    if (firstView.kind === "note") this.texts.set(firstView.path, await this.source.readText(firstView.path));
    await highlighterReady;
    /* Animation frames are withheld from hidden or occluded windows, so startup never waits on one. */
    await this.show({ restoring: true, onPainted: () => (this.metrics.firstNoteMs = performance.now() - t0) });

    const rest = this.index.notes.filter((p) => !this.texts.has(p));
    for (let i = 0; i < rest.length; i += 120) {
      const chunk = rest.slice(i, i + 120);
      const contents = await this.source.readMany(chunk);
      chunk.forEach((p, j) => {
        if (contents[j] !== null) this.texts.set(p, contents[j]!);
      });
    }
    for (const path of this.index.notes) this.ingest(path);
    this.metrics.indexMs = performance.now() - t0;
    await this.show({ keepScroll: true, quiet: true });
    this.renderSidebar();
    void this.initGit();
  }

  /** Updates every derived index for one note. A note with no text has been removed. */
  private ingest(path: string): void {
    this.communities = null;
    const text = this.texts.get(path) ?? null;
    if (text === null) {
      this.links.update(path, null);
      this.search.set(path, "", null);
      return;
    }
    const { data } = parseFrontmatter(text);
    const aliases = data.aliases ?? data.alias;
    const list = aliases ? (Array.isArray(aliases) ? aliases : [aliases]) : [];
    if (list.length) this.index.addAliases(path, list);
    this.links.update(path, text);
    this.search.set(path, this.index.title(path), text, list);
  }

  /** External edits: re-read what changed, re-index it and re-render the open note in place. */
  private async onVaultChanged(paths: string[]): Promise<void> {
    if (!this.index || !this.els) return;
    if (paths.some((p) => p.startsWith(".git/"))) this.scheduleGitRefresh();
    const notes = paths.filter((p) => !p.startsWith("."));
    if (!notes.length) return;
    const files = await this.source.list();
    const fileSet = new Set(files);
    const known = new Set([...this.index.notes, ...this.index.attachments]);
    const structural = files.length !== known.size || files.some((f) => !known.has(f));
    if (structural) {
      this.index = new VaultIndex(files);
      this.links = new LinkGraph(this.index);
      for (const p of [...this.texts.keys()]) if (!fileSet.has(p)) this.texts.delete(p);
    }
    const changed = notes.filter((p) => p.endsWith(".md") && fileSet.has(p));
    const contents = await this.source.readMany(changed);
    changed.forEach((p, i) => {
      if (contents[i] !== null) this.texts.set(p, contents[i]!);
    });
    const missing = this.index.notes.filter((p) => !this.texts.has(p));
    if (missing.length) {
      const extra = await this.source.readMany(missing);
      missing.forEach((p, i) => {
        if (extra[i] !== null) this.texts.set(p, extra[i]!);
      });
    }
    if (structural) for (const p of this.index.notes) this.ingest(p);
    else for (const p of changed) this.ingest(p);
    this.scheduleGitRefresh();

    if (this.tab.trail.current.view.kind === "graph") await this.show({ quiet: true });
    else if (!this.texts.has(this.current)) this.renderMissing(this.current);
    else if (changed.includes(this.current) || structural) await this.show({ keepScroll: true, quiet: true });
    else {
      this.renderSidebar();
      this.renderRail();
    }
    if (this.sidebarMode === "search") this.runSearch();
  }

  // ---------- Theme ----------

  private scheme(): Scheme {
    const a = this.prefs.value.appearance;
    if (a !== "system") return a;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  private codeFamily = "";

  /**
   * Appearance changes repaint through CSS alone: code carries both variants'
   * colours, diagrams are bound to theme variables, and canvases re-read their
   * palette. Only a new theme family re-highlights code, keeping scroll.
   */
  private applyTheme(): void {
    const family = findFamily(this.prefs.value.family);
    applyTheme(family, this.scheme());
    this.localGraph?.refreshTheme();
    this.graphView?.canvas.refreshTheme();
    if (family.id === this.codeFamily) return;
    const first = this.codeFamily === "";
    this.codeFamily = family.id;
    void this.syncCodeTheme().then(() => {
      if (!first && this.current && this.els) void this.show({ keepScroll: true, quiet: true });
    });
  }

  private async syncCodeTheme(): Promise<void> {
    const family = findFamily(this.prefs.value.family);
    await this.highlighter.setThemes(family.light.code, family.dark.code);
  }

  // ---------- Shell ----------

  private mount(): void {
    const p = this.prefs.value;
    this.host.innerHTML = `
      <div class="shell${p.sidebar ? "" : " sidebar-closed"}${p.rail ? "" : " rail-closed"}${isDesktop ? " is-desktop" : ""}" style="--sidebar-w:${p.sidebarWidth}px">
        <header class="titlebar" data-tauri-drag-region>
          ${isDesktop ? "" : `<div class="traffic" aria-hidden="true"><i></i><i></i><i></i></div>`}
          <div class="titlebar-lead" data-tauri-drag-region>
            <div class="titlebar-nav">
              <button class="icon-btn" data-act="sidebar" data-tip="Sidebar" data-key="⌘\\" aria-label="Toggle sidebar">${icons.sidebar}</button>
              <button class="icon-btn" data-act="palette" data-tip="Go to note" data-key="⌘K" aria-label="Go to a note or run a command">${icons.search}</button>
            </div>
            <div class="titlebar-nav">
              <button class="icon-btn" data-act="back" data-tip="Back" data-key="⌘[" aria-label="Back">${icons.back}</button>
              <button class="icon-btn" data-act="forward" data-tip="Forward" data-key="⌘]" aria-label="Forward">${icons.forward}</button>
            </div>
          </div>
          <div class="tabs" role="tablist" data-tauri-drag-region></div>
          <div class="titlebar-trail">
            <button class="icon-btn" data-act="rail" data-tip="Inspector" data-key="⌥⌘\\" aria-label="Toggle inspector">${icons.inspector}</button>
          </div>
        </header>
        <nav class="sidebar" aria-label="Navigation">
          <div class="sidebar-head">
            <div class="seg seg-full" role="tablist" aria-label="Sidebar view">
              <button class="seg-btn" role="tab" data-side="files" data-tip="Files" data-key="⌘⇧E">Files</button>
              <button class="seg-btn" role="tab" data-side="search" data-tip="Search inside notes" data-key="⌘⇧F">Search</button>
            </div>
          </div>
          <div class="sidebar-inner" data-side-pane="files"></div>
          <div class="sidebar-search" data-side-pane="search" hidden>
            <div class="search-head">
              <div class="search-field">${icons.search}<input type="text" spellcheck="false" autocomplete="off" placeholder="Search inside notes" aria-label="Search inside notes" /><button class="icon-btn" data-act="search-clear" aria-label="Clear search">${icons.close}</button></div>
            </div>
            <div class="search-results" role="listbox" aria-label="Search results"></div>
          </div>
          <div class="sidebar-resize" aria-hidden="true"></div>
        </nav>
        <main class="reader">
          <div class="pane-head"><div class="crumbs"></div><span class="pane-meta"></span></div>
          <div class="scroller" tabindex="-1"><article class="doc"></article></div>
        </main>
        <aside class="rail" aria-label="Inspector">
          <div class="rail-inner">
            <div class="seg seg-full rail-tabs" role="tablist">
              <button class="seg-btn" role="tab" data-rail="outline">Outline</button>
              <button class="seg-btn" role="tab" data-rail="links">Links</button>
              <button class="seg-btn" role="tab" data-rail="info">Info</button>
            </div>
            <div class="rail-body">
              <div class="rail-pane rail-outline" data-pane="outline"></div>
              <div class="rail-pane rail-links" data-pane="links"></div>
              <div class="rail-pane rail-info" data-pane="info"></div>
            </div>
            <div class="rail-graph"></div>
          </div>
        </aside>
        <footer class="statusbar">
          <div class="status-lead">
            <span class="status-branch" hidden>${icons.branch}<span></span></span>
            <button class="sync-btn" data-act="sync-panel" aria-label="Sync status"><span class="sync-dot"></span><span class="sync-label">Local</span></button>
          </div>
          <div class="status-trail">
            <button class="icon-btn" data-act="graph" data-tip="Graph" data-key="⌘G" aria-label="Graph view">${icons.graph}</button>
            <button class="icon-btn" data-act="settings" data-tip="Appearance and sync" data-key="⌘," aria-label="Appearance and sync">${icons.sliders}</button>
          </div>
        </footer>
      </div>`;
    const q = <T extends HTMLElement>(s: string) => this.host.querySelector(s) as T;
    this.els = {
      shell: q(".shell"),
      tabs: q(".tabs"),
      sidebar: q(".sidebar-inner"),
      searchPane: q(".sidebar-search"),
      scroller: q(".scroller"),
      outline: q(".rail-outline"),
      links: q(".rail-links"),
      info: q(".rail-info"),
      railBody: q(".rail-body"),
      railGraph: q(".rail-graph"),
      back: q('[data-act="back"]'),
      forward: q('[data-act="forward"]'),
      sync: q(".sync-btn"),
      reader: q(".reader"),
      paneHead: q(".pane-head"),
      crumbs: q(".crumbs"),
      paneMeta: q(".pane-meta"),
      branch: q(".status-branch"),
    };
    this.trailMap = new TrailMap({
      select: (id, newTab) => this.selectOnTrail(id, newTab),
      remove: (id) => this.removeFromTrail(id),
      toggle: (id) => {
        this.tab.trail.toggleCollapsed(id);
        this.renderTrail();
        this.persist();
      },
    });
    this.els.reader.prepend(this.trailMap.root);
    this.localGraph = null;
    this.treeIndex = null;
    this.bindSidebarResize(q(".sidebar-resize"));
    this.setRailPane(p.railPane);
    this.sidebarMode = "files";
    this.bindSearchField();
    this.syncSideTabs();
    this.palette = new Palette(
      (query) => this.paletteItems(query),
      () => this.paletteRecent(),
    );
    this.find = new FindBar(this.els.reader, () => this.els.scroller.querySelector(".doc"), this.els.scroller);
    this.gitPanel = new GitPanel({
      play: (c) => this.sound.play(c),
      toast: (m) => this.toast(m),
      openNote: (path) => void this.open(path),
      lastSync: () => this.prefs.value.vaults[this.vaultRoot]?.lastSync ?? null,
      onVisible: (open) => this.els.sync.classList.toggle("is-on", open),
      setLastSync: (at) =>
        this.prefs.update((pr) => {
          pr.vaults[this.vaultRoot] ??= { tabs: [], active: 0, lastSync: null };
          pr.vaults[this.vaultRoot].lastSync = at;
        }),
      onStatus: (st, state) => this.renderSync(st, state),
      renderNoteAt: async (md, path, into) => {
        const r = await renderNote(md, path, {
          index: this.index,
          highlighter: this.highlighter,
          assetUrl: this.source.assetUrl,
        });
        into.append(r.fragment);
        await renderDiagrams(into);
      },
      title: (path) => this.index.title(path),
    });
    this.renderSync(null, { kind: "idle" });

    this.host.onclick = (e) => this.onClick(e);
    this.host.onauxclick = (e) => {
      if (e.button === 1) this.onClick(e);
    };
    this.els.scroller.addEventListener("scroll", () => this.spy(), { passive: true });
    this.bindTooltips();
    window.onbeforeunload = () => {
      this.persist();
      void this.prefs.flush();
    };
  }

  private get tab(): Tab {
    return this.tabs[this.active];
  }

  /** The note on screen, or an empty string while a graph is. */
  private get path(): string {
    const view = this.tab.trail.current.view;
    return view.kind === "note" ? view.path : "";
  }

  // ---------- Navigation ----------

  async open(
    path: string,
    opts: { anchor?: string; newTab?: boolean; focus?: boolean; find?: string; keyboard?: boolean; via?: "link" | "jump" } = {},
  ): Promise<void> {
    const view: View = { kind: "note", path };
    if (opts.newTab) {
      const tab: Tab = { id: this.nextId++, trail: new Trail(view) };
      this.tabs.splice(this.active + 1, 0, tab);
      this.sound.play("open");
      if (opts.focus === false) {
        this.renderTabs(opts.keyboard ? undefined : tab.id);
        this.persist();
        return;
      }
      this.saveScroll();
      this.active += 1;
      await this.show({
        anchor: opts.anchor,
        entering: opts.keyboard ? undefined : tab.id,
        find: opts.find,
        keyboard: opts.keyboard,
      });
      return;
    }
    if (path === this.path) {
      if (opts.anchor) this.scrollToAnchor(opts.anchor);
      if (opts.find) this.jumpToText(opts.find);
      return;
    }
    this.saveScroll();
    if (opts.via === "link") this.tab.trail.follow(view);
    else this.tab.trail.jump(view);
    await this.show({ anchor: opts.anchor, find: opts.find });
  }

  private saveScroll(): void {
    const node = this.tab?.trail.current;
    if (node && this.els && node.view.kind === "note") node.scroll = this.els.scroller.scrollTop;
  }

  private async go(delta: number): Promise<void> {
    this.saveScroll();
    const moved = delta < 0 ? this.tab.trail.back() : this.tab.trail.forward();
    if (moved) await this.show({ keyboard: true });
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

  private viewLabel(view: View): string {
    return view.kind === "note" ? this.index.title(view.path) : "Graph";
  }

  private renderTrail(): void {
    const trail = this.tab.trail;
    this.trailMap.root.hidden = trail.size < 2;
    if (trail.size < 2) return;
    this.trailMap.render(
      this.tab.id,
      trail.layout().map((p) => {
        const view = trail.view(p.id)!;
        return { ...p, label: this.viewLabel(view), isGraph: view.kind === "graph" };
      }),
      trail.current.id,
      trail.pathToCurrent(),
      trail.crossLinks(),
    );
  }

  /** The parts of the window that follow the active tab, whichever view it shows. */
  private renderTabChrome(entering?: number): void {
    const graph = this.tab.trail.current.view.kind === "graph";
    this.renderTabs(entering);
    this.renderTrail();
    this.els.shell.classList.toggle("is-graph", graph);
    const button = this.host.querySelector<HTMLElement>('[data-act="graph"]')!;
    button.classList.toggle("is-on", graph);
    button.setAttribute("aria-pressed", String(graph));
    this.els.back.disabled = !this.tab.trail.canBack;
    this.els.forward.disabled = !this.tab.trail.canForward;
  }

  private async show(
    opts: {
      anchor?: string;
      entering?: number;
      find?: string;
      keepScroll?: boolean;
      quiet?: boolean;
      restoring?: boolean;
      keyboard?: boolean;
      onPainted?: () => void;
    } = {},
  ): Promise<void> {
    const seq = ++this.renderSeq;
    this.metrics.navStart = performance.now();
    const entry = this.tab.trail.current;
    if (entry.view.kind === "graph") {
      this.showGraph(entry.view, opts.entering);
      return;
    }
    this.unmountGraph();
    const path = entry.view.path;
    const prevScroll = this.els.scroller.scrollTop;
    let text = this.texts.get(path);
    if (text === undefined) {
      try {
        text = await this.source.readText(path);
        this.texts.set(path, text);
      } catch {
        if (seq === this.renderSeq) this.renderMissing(path);
        return;
      }
    }
    const rendered = await renderNote(text, path, {
      index: this.index,
      highlighter: this.highlighter,
      assetUrl: this.source.assetUrl,
    });
    if (seq !== this.renderSeq) return;
    const changedNote = path !== this.current;
    this.current = path;
    this.rendered = rendered;
    this.metrics.lastRenderMs = rendered.ms;
    this.metrics.lastGrammarMs = rendered.grammarMs;

    const doc = document.createElement("article");
    doc.className = "doc";
    if (changedNote && !opts.quiet && !opts.keyboard && !opts.restoring) doc.classList.add("doc-enter");
    doc.append(this.head(path), rendered.fragment);
    this.els.scroller.replaceChildren(doc);
    this.appendBacklinks();
    this.els.scroller.scrollTop = opts.keepScroll ? prevScroll : entry.scroll;
    if (opts.anchor) this.scrollToAnchor(opts.anchor);
    if (opts.find) this.jumpToText(opts.find);
    else if (changedNote) paint("search", []);
    this.metrics.paintMs = performance.now() - this.metrics.navStart;
    opts.onPainted?.();

    this.renderTabChrome(opts.entering);
    this.renderPaneHead(path);
    if (changedNote || !opts.quiet) this.renderSidebar();
    this.renderRail();
    this.persist();
    this.find.refresh();

    const t0 = performance.now();
    await renderDiagrams(doc);
    this.metrics.diagramsMs = performance.now() - t0;
    if (opts.anchor) this.scrollToAnchor(opts.anchor, true);
    if (opts.find) this.jumpToText(opts.find);
  }

  private renderMissing(path: string): void {
    const box = document.createElement("div");
    box.className = "empty-state is-page";
    const strong = document.createElement("strong");
    strong.textContent = `“${this.index.title(path)}” is no longer in the vault`;
    const p = document.createElement("p");
    p.textContent = "It was moved, renamed or deleted outside Waymark. Press ⌘K to find it, or go back with ⌘[.";
    box.append(strong, p);
    this.els.scroller.replaceChildren(box);
  }

  private head(path: string): HTMLElement {
    const head = document.createElement("header");
    head.className = "doc-head";
    const title = document.createElement("h1");
    title.className = "doc-title";
    title.textContent = this.index.title(path);
    head.append(title);
    return head;
  }

  /** The note's real location and its reading time. */
  private renderPaneHead(path: string): void {
    const crumbs = this.els.crumbs;
    crumbs.replaceChildren();
    const add = (text: string, folder: string | null) => {
      const b = document.createElement(folder === null ? "span" : "button");
      b.className = "crumb";
      if (folder !== null) b.dataset.crumb = folder;
      b.textContent = text;
      crumbs.append(b);
    };
    const folders = ancestors(path);
    add(this.vaultName, null);
    for (const f of folders) add(f.slice(f.lastIndexOf("/") + 1), f);
    this.els.paneMeta.textContent = `${Math.max(1, Math.round(this.wordCount(path) / 230))} min read`;
  }

  private wordCount(path: string): number {
    return (this.texts.get(path) ?? "").split(/\s+/).filter(Boolean).length;
  }

  private appendBacklinks(): void {
    const doc = this.els?.scroller.querySelector(".doc");
    if (!doc || !this.links) return;
    doc.querySelector(".backlinks")?.remove();
    const sources = this.links.backlinks(this.current);
    if (!sources.length) return;
    const section = document.createElement("section");
    section.className = "backlinks";
    section.id = "backlinks";
    const h = document.createElement("h2");
    h.className = "backlinks-title";
    h.textContent = "Linked from";
    section.append(h);
    const list = document.createElement("ul");
    const sorted = [...sources].sort((x, y) => x.localeCompare(y));
    for (const s of sorted) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.className = "wikilink";
      link.dataset.path = s;
      link.textContent = this.index.title(s);
      li.append(link);
      const ctx = this.linkContext(s, this.current);
      if (ctx) {
        const p = document.createElement("span");
        p.className = "backlink-context";
        p.textContent = ctx;
        li.append(p);
      }
      list.append(li);
    }
    section.append(list);
    doc.append(section);
  }

  /** The line in `from` that links to `to`, cleaned for display. */
  private linkContext(from: string, to: string): string | null {
    const text = this.texts.get(from);
    if (!text) return null;
    const title = this.index.title(to).toLowerCase();
    for (const line of text.split("\n")) {
      for (const m of line.matchAll(/\[\[([^\]|#]+)/g)) {
        const t = m[1].trim().toLowerCase();
        if (t !== title && !t.endsWith(`/${title}`)) continue;
        const clean = line
          .replace(/!?\[\[([^\]|]*?)(?:\|([^\]]*))?\]\]/g, (_, target: string, alias?: string) => alias || target.split("#")[0])
          .replace(/^\s*(?:[-*+]|\d+\.|>|#+)\s*/, "")
          .replace(/^\[![a-z]+\][+-]?\s*/i, "")
          .replace(/[*_`]/g, "")
          .trim();
        if (clean.toLowerCase() === title || !clean) return null;
        return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
      }
    }
    return null;
  }

  // ---------- Tabs ----------

  private renderTabs(entering?: number): void {
    const frag = document.createDocumentFragment();
    this.tabs.forEach((tab, i) => {
      const el = document.createElement("div");
      el.className = `tab${i === this.active ? " is-active" : ""}${tab.id === entering && !reducedMotion() ? " is-entering" : ""}`;
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(i === this.active));
      el.dataset.tab = String(i);
      const view = tab.trail.current.view;
      const title = this.viewLabel(view);
      el.innerHTML = `<span class="tab-title"></span><button class="icon-btn tab-close" data-act="close" aria-label="Close tab">${icons.close}</button>`;
      el.querySelector(".tab-title")!.textContent = title;
      el.classList.toggle("is-graph-tab", view.kind === "graph");
      el.dataset.tip = title;
      if (tab.id === entering) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("is-entering")));
      frag.append(el);
    });
    const plus = document.createElement("button");
    plus.className = "icon-btn tab-new";
    plus.dataset.act = "new-tab";
    plus.dataset.tip = "New tab";
    plus.dataset.key = "⌘T";
    plus.setAttribute("aria-label", "New tab");
    plus.innerHTML = icons.plus;
    frag.append(plus);
    this.els.tabs.replaceChildren(frag);
    this.els.shell.classList.toggle("single-tab", this.tabs.length === 1);
    requestAnimationFrame(() => {
      /* Tabs keep their natural width while they fit; once crowded they share the strip equally. */
      const strip = this.els.tabs;
      const natural = [...strip.querySelectorAll<HTMLElement>(".tab-title")].reduce(
        (sum, t) => sum + Math.min(t.scrollWidth + 40, 320) + 2,
        32,
      );
      strip.classList.toggle("is-crowded", natural > strip.clientWidth);
      for (const t of this.els.tabs.querySelectorAll<HTMLElement>(".tab")) {
        const title = t.querySelector<HTMLElement>(".tab-title")!;
        t.classList.toggle("is-clipped", title.scrollWidth > title.clientWidth + 1);
      }
    });
  }

  /** A new tab starts on the current note with the palette open, so the next pick replaces it. */
  private newTab(): void {
    void this.open(this.current, { newTab: true, focus: true, keyboard: true }).then(() => this.palette.open());
  }

  private switchTab(i: number): void {
    if (i === this.active || !this.tabs[i]) return;
    this.saveScroll();
    this.active = i;
    void this.show({ keyboard: true });
  }

  private closeTab(i: number): void {
    if (this.tabs.length === 1) return;
    this.saveScroll();
    this.tabs.splice(i, 1);
    if (this.active >= this.tabs.length) this.active = this.tabs.length - 1;
    else if (i < this.active) this.active -= 1;
    void this.show({ keyboard: true });
  }

  // ---------- Sidebar ----------

  private renderSidebar(): void {
    if (!this.els) return;
    const box = this.els.sidebar;
    if (this.treeIndex !== this.index || !box.querySelector(".tree")) {
      const tree = document.createElement("div");
      tree.className = "tree";
      this.folderEls.clear();
      this.noteEls.clear();
      tree.append(...this.treeChildren(buildTree(this.index.notes), 0));
      const keep = box.scrollTop;
      box.replaceChildren(tree);
      box.scrollTop = keep;
      this.treeIndex = this.index;
      this.treeCurrent = "";
    }
    this.revealInTree(this.current);
  }

  private treeChildren(folder: TreeFolder, depth: number): HTMLElement[] {
    return [...folder.folders.map((f) => this.treeFolder(f, depth)), ...folder.notes.map((p) => this.treeNote(p, depth))];
  }

  private treeFolder(folder: TreeFolder, depth: number): HTMLElement {
    const wrap = document.createElement("div");
    const open = this.openFolders.has(folder.path);
    wrap.className = `tree-folder${open ? " is-open" : ""}`;
    const head = document.createElement("button");
    head.className = "tree-head";
    head.dataset.folder = folder.path;
    head.style.setProperty("--d", String(depth));
    head.setAttribute("aria-expanded", String(open));
    const section = depth === 0;
    const chevron = `<svg class="tree-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`;
    head.classList.toggle("is-section", section);
    head.style.setProperty("--d", String(Math.max(0, depth - 1)));
    head.innerHTML = section
      ? `<span class="tree-name"></span>${chevron}<span class="tree-count"></span>`
      : `${chevron}${icons.folder.replace("<svg", '<svg class="tree-icon"')}<span class="tree-name"></span><span class="tree-count"></span>`;
    head.querySelector(".tree-name")!.textContent = folder.name;
    head.querySelector(".tree-count")!.textContent = String(folder.count);
    const body = document.createElement("div");
    body.className = "tree-body";
    body.style.setProperty("--d", String(Math.max(0, depth - 1)));
    body.classList.toggle("is-top", section);
    const inner = document.createElement("div");
    inner.className = "tree-inner";
    inner.append(...this.treeChildren(folder, depth + 1));
    body.append(inner);
    wrap.append(head, body);
    this.folderEls.set(folder.path, wrap);
    return wrap;
  }

  private treeNote(path: string, depth: number): HTMLElement {
    const item = document.createElement("button");
    item.className = "nav-item";
    item.dataset.path = path;
    item.style.setProperty("--d", String(Math.max(0, depth - 1)));
    item.dataset.tip = this.index.title(path);
    item.innerHTML = icons.note.replace("<svg", '<svg class="tree-icon"');
    const label = document.createElement("span");
    label.className = "nav-text";
    label.textContent = this.index.title(path);
    item.append(label);
    this.noteEls.set(path, item);
    return item;
  }

  private setFolderOpen(path: string, open: boolean): void {
    const wrap = this.folderEls.get(path);
    if (!wrap) return;
    if (open) this.openFolders.add(path);
    else this.openFolders.delete(path);
    wrap.classList.toggle("is-open", open);
    wrap.querySelector(":scope > .tree-head")!.setAttribute("aria-expanded", String(open));
  }

  /** Marks the open note and, when the note has changed, opens its folders and brings it into view. */
  private revealInTree(path: string): void {
    if (path === this.treeCurrent) return;
    this.noteEls.get(this.treeCurrent)?.classList.remove("is-current");
    this.treeCurrent = path;
    const row = this.noteEls.get(path);
    if (!row) return;
    row.classList.add("is-current");
    this.expandTo(path, row);
    this.persist();
  }

  private expandTo(path: string, row: HTMLElement): void {
    const box = this.els.sidebar;
    const tree = box.querySelector(".tree")!;
    tree.classList.add("is-instant");
    for (const f of ancestors(path)) this.setFolderOpen(f, true);
    void box.offsetHeight;
    tree.classList.remove("is-instant");
    const view = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < view.top + 36 || r.bottom > view.bottom - 28) box.scrollTop += r.top - view.top - view.height / 2 + r.height / 2;
  }

  private bindSidebarResize(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (down) => {
      down.preventDefault();
      const shell = this.els.shell;
      const start = this.prefs.value.sidebarWidth;
      handle.setPointerCapture(down.pointerId);
      shell.classList.add("no-anim", "is-resizing");
      const move = (e: PointerEvent) => {
        const width = Math.round(Math.min(440, Math.max(200, start + e.clientX - down.clientX)));
        shell.style.setProperty("--sidebar-w", `${width}px`);
        this.prefs.value.sidebarWidth = width;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        shell.classList.remove("no-anim", "is-resizing");
        this.prefs.update(() => undefined);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up, { once: true });
      handle.addEventListener("pointercancel", up, { once: true });
    });
  }

  private revealFolder(path: string): void {
    this.setSide("files");
    if (narrow()) this.els.shell.classList.add("sidebar-peek");
    else if (this.els.shell.classList.contains("sidebar-closed")) this.toggleSidebar(true);
    for (const f of ancestors(`${path}/`)) this.setFolderOpen(f, true);
    const head = this.folderEls.get(path)?.querySelector<HTMLElement>(".tree-head");
    head?.focus({ preventScroll: true });
    head?.scrollIntoView({ block: "nearest" });
    this.persist();
  }

  private toggleSidebar(force?: boolean): void {
    const shell = this.els.shell;
    if (narrow()) {
      shell.classList.remove("sidebar-closed");
      shell.classList.toggle("sidebar-peek", force);
      return;
    }
    const closed = force === undefined ? !shell.classList.contains("sidebar-closed") : !force;
    shell.classList.toggle("sidebar-closed", closed);
    this.prefs.update((p) => (p.sidebar = !closed));
  }

  // ---------- Search (sidebar mode) ----------

  private setSide(mode: "files" | "search"): void {
    this.sidebarMode = mode;
    this.syncSideTabs();
    if (mode === "files") paint("search", []);
  }

  private syncSideTabs(): void {
    for (const b of this.host.querySelectorAll<HTMLElement>("[data-side]")) {
      const on = b.dataset.side === this.sidebarMode;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const pane of this.host.querySelectorAll<HTMLElement>("[data-side-pane]"))
      pane.hidden = pane.dataset.sidePane !== this.sidebarMode;
  }

  private searchInput(): HTMLInputElement {
    return this.els.searchPane.querySelector("input")!;
  }

  private bindSearchField(): void {
    const input = this.searchInput();
    input.value = this.searchQuery;
    input.addEventListener("input", () => {
      this.searchQuery = input.value;
      this.runSearch();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectHit(this.searchSel + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectHit(this.searchSel - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.openHit(this.searchSel, e.metaKey);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.closeSearch();
      }
    });
    this.runSearch();
  }

  private openSearch(prefill?: string): void {
    if (narrow()) this.els.shell.classList.add("sidebar-peek");
    else if (this.els.shell.classList.contains("sidebar-closed")) this.toggleSidebar(true);
    this.setSide("search");
    const input = this.searchInput();
    if (prefill) {
      input.value = prefill;
      this.searchQuery = prefill;
    }
    this.runSearch();
    input.focus();
    input.select();
  }

  /** Returns to Files. The query and results are kept for the next visit to Search. */
  private closeSearch(): void {
    this.setSide("files");
    this.els.scroller.focus({ preventScroll: true });
  }

  private clearSearch(): void {
    const input = this.searchInput();
    input.value = "";
    this.searchQuery = "";
    paint("search", []);
    this.runSearch();
    input.focus();
  }

  private runSearch(): void {
    const results = this.els.searchPane.querySelector(".search-results");
    if (!results) return;
    const t0 = performance.now();
    this.searchHits = this.search.search(this.searchQuery, 60);
    this.metrics.searchMs = performance.now() - t0;
    this.searchSel = 0;
    results.replaceChildren();
    if (!this.searchQuery.trim()) {
      const hint = document.createElement("div");
      hint.className = "empty-state is-compact";
      hint.innerHTML = `<p>Searches the titles, headings and text of every note. Words can match anywhere; put a phrase in "quotes" to match it exactly.</p><p><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>↵</kbd> open at the match · <kbd>⌘↵</kbd> new tab</p>`;
      results.append(hint);
      return;
    }
    if (!this.searchHits.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state is-compact";
      const strong = document.createElement("strong");
      strong.textContent = `No note contains “${this.searchQuery.trim()}”`;
      const p = document.createElement("p");
      p.textContent = "Try fewer words or the start of a word. Note titles are also in the palette (⌘K).";
      empty.append(strong, p);
      results.append(empty);
      return;
    }
    const count = document.createElement("div");
    count.className = "search-count";
    count.textContent = `${this.searchHits.length === 60 ? "60+" : this.searchHits.length} note${this.searchHits.length === 1 ? "" : "s"}`;
    results.append(count);
    this.searchHits.forEach((hit, i) => {
      const row = document.createElement("button");
      row.className = "search-hit";
      row.dataset.hit = String(i);
      row.setAttribute("role", "option");
      const title = document.createElement("span");
      title.className = "search-hit-title";
      title.textContent = hit.title;
      row.append(title);
      if (hit.snippet) {
        if (hit.snippet.heading) {
          const h = document.createElement("span");
          h.className = "search-hit-heading";
          h.textContent = hit.snippet.heading;
          row.append(h);
        }
        const s = document.createElement("span");
        s.className = "search-hit-snippet";
        const mark = document.createElement("mark");
        mark.textContent = hit.snippet.match;
        s.append(hit.snippet.before, mark, hit.snippet.after);
        row.append(s);
      }
      results.append(row);
    });
    this.selectHit(0);
  }

  private selectHit(i: number): void {
    if (!this.searchHits.length) return;
    this.searchSel = Math.max(0, Math.min(i, this.searchHits.length - 1));
    for (const row of this.els.searchPane.querySelectorAll<HTMLElement>(".search-hit")) {
      const on = Number(row.dataset.hit) === this.searchSel;
      row.classList.toggle("is-selected", on);
      row.setAttribute("aria-selected", String(on));
      if (on) row.scrollIntoView({ block: "nearest" });
    }
  }

  private openHit(i: number, newTab: boolean): void {
    const hit = this.searchHits[i];
    if (!hit) return;
    this.selectHit(i);
    if (narrow()) this.els.shell.classList.remove("sidebar-peek");
    void this.open(hit.path, { newTab, focus: true, find: hit.snippet?.match ?? hit.terms[0] });
  }

  /** Scrolls to the first occurrence of `text` in the note body and marks every occurrence. */
  private jumpToText(text: string): void {
    const doc = this.els.scroller.querySelector(".doc");
    if (!doc || !text) return;
    const ranges = findRanges(doc, text, 300).filter((r) => !r.startContainer.parentElement?.closest(".doc-head, .backlinks"));
    paint("search", ranges);
    if (ranges[0]) scrollToRange(ranges[0], this.els.scroller);
  }

  // ---------- Right rail: outline and local graph ----------

  private renderRail(): void {
    if (!this.rendered || !this.els) return;
    this.renderOutline();
    this.renderLinks();
    this.renderInfo();
    this.renderLocalGraph();
    this.spyActive = null;
    this.spy();
  }

  private setRailPane(pane: "outline" | "links" | "info"): void {
    for (const b of this.host.querySelectorAll<HTMLElement>("[data-rail]")) {
      const on = b.dataset.rail === pane;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const el of this.host.querySelectorAll<HTMLElement>("[data-pane]")) el.hidden = el.dataset.pane !== pane;
    this.els.railBody.scrollTop = 0;
    if (pane === "info") void this.renderNoteHistory();
  }

  private railEmpty(text: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "rail-empty";
    p.textContent = text;
    return p;
  }

  private renderOutline(): void {
    const items = this.rendered!.headings.filter((h) => h.level === 2 || h.level === 3);
    const outline = this.els.outline;
    outline.replaceChildren();
    if (!items.length) {
      outline.append(this.railEmpty("This note has no headings."));
      return;
    }
    const list = document.createElement("nav");
    list.className = "outline";
    for (const h of items) {
      const a = document.createElement("a");
      a.href = `#${h.id}`;
      a.className = `l${h.level}`;
      a.dataset.target = h.id;
      a.textContent = h.text.replace(/`/g, "");
      list.append(a);
    }
    outline.append(list);
  }

  private renderLinks(): void {
    const box = this.els.links;
    box.replaceChildren();
    if (!this.links) return;
    const from = [...this.links.backlinks(this.current)].sort((a, b) => a.localeCompare(b));
    const to = [...(this.links.out.get(this.current) ?? [])].sort((a, b) => a.localeCompare(b));
    const group = (label: string, paths: string[], context: boolean) => {
      if (!paths.length) return;
      const title = document.createElement("div");
      title.className = "rail-title";
      title.textContent = `${label} · ${paths.length}`;
      box.append(title);
      for (const p of paths) {
        const a = document.createElement("a");
        a.href = "#";
        a.className = "wikilink-plain rail-link";
        a.dataset.path = p;
        a.dataset.tip = this.index.title(p);
        a.innerHTML = icons.note;
        const name = document.createElement("span");
        name.className = "rail-link-name";
        name.textContent = this.index.title(p);
        a.append(name);
        const ctx = context ? this.linkContext(p, this.current) : null;
        if (ctx) {
          const line = document.createElement("span");
          line.className = "rail-link-context";
          line.textContent = ctx;
          a.append(line);
        }
        box.append(a);
      }
    };
    group("Linked from", from, true);
    group("Links to", to, false);
    if (!from.length && !to.length) box.append(this.railEmpty("No links to or from this note."));
    const total = new Set([...from, ...to]).size;
    this.host.querySelector('[data-rail="links"]')!.textContent = total ? `Links ${total}` : "Links";
  }

  /** Folder, length and every frontmatter property, shown as written and without meaning attached to any key. */
  private renderInfo(): void {
    const box = this.els.info;
    box.replaceChildren();
    const list = document.createElement("dl");
    list.className = "props";
    const addRow = (target: HTMLElement, key: string, value: string | string[]) => {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      if (Array.isArray(value)) {
        for (const v of value) {
          const chip = document.createElement("span");
          chip.className = "prop-chip";
          chip.textContent = v;
          dd.append(chip);
        }
      } else dd.textContent = value;
      target.append(dt, dd);
    };
    addRow(list, "Folder", ancestors(this.current).at(-1) ?? "Vault root");
    addRow(list, "Words", this.wordCount(this.current).toLocaleString());
    box.append(list);
    const history = document.createElement("div");
    history.className = "rail-history";
    this.historyShown = "";
    const finish = () => {
      box.append(history);
      void this.renderNoteHistory();
    };
    const properties = Object.entries(this.rendered!.frontmatter).filter(([, v]) => v.length > 0);
    if (!properties.length) {
      finish();
      return;
    }
    const title = document.createElement("div");
    title.className = "rail-title";
    title.textContent = "Properties";
    const own = document.createElement("dl");
    own.className = "props";
    for (const [k, v] of properties) addRow(own, k, v);
    box.append(title, own);
    finish();
  }

  /** The open note's Git history, loaded only while the Info pane is showing and only when the note or HEAD has moved. */
  private async renderNoteHistory(): Promise<void> {
    const box = this.els.info.querySelector<HTMLElement>(".rail-history");
    if (!box || this.els.info.hidden || !this.current) return;
    const path = this.current;
    const status = this.gitPanel.status;
    const changed = status?.files.find((f) => f.path === path);
    const key = `${path}|${status?.head ?? ""}|${changed ? `${changed.staged}${changed.unstaged}` : ""}`;
    if (key === this.historyShown) return;
    this.historyShown = key;
    const seq = ++this.historySeq;
    const heading = document.createElement("div");
    heading.className = "rail-title";
    heading.textContent = "History";
    if (!isDesktop || (status && !status.isRepo)) {
      box.replaceChildren(
        heading,
        this.railEmpty(isDesktop ? "This vault is not a Git repository." : "File history runs in the desktop app."),
      );
      return;
    }
    let commits: Commit[];
    try {
      commits = await git.log(path, HISTORY_LIMIT, 0);
    } catch (err) {
      if (seq !== this.historySeq) return;
      box.replaceChildren(heading, this.railEmpty((err as Error).message.split("\n")[0]));
      this.historyShown = "";
      return;
    }
    if (seq !== this.historySeq || path !== this.current) return;
    heading.textContent = commits.length
      ? `History · ${commits.length}${commits.length === HISTORY_LIMIT ? "+" : ""}`
      : "History";
    const nodes: HTMLElement[] = [];
    if (commits.length) {
      const facts = document.createElement("dl");
      facts.className = "props rail-history-facts";
      const fact = (key: string, value: string) => {
        const dt = document.createElement("dt");
        dt.textContent = key;
        const dd = document.createElement("dd");
        dd.textContent = value;
        facts.append(dt, dd);
      };
      fact("Updated", relative(commits[0].date));
      if (commits.length < HISTORY_LIMIT)
        fact(
          "Created",
          new Date(commits.at(-1)!.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
        );
      nodes.push(facts);
    }
    nodes.push(heading);
    const row = (subject: string, meta: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.className = "rail-commit";
      const line = document.createElement("span");
      line.className = "rail-commit-subject";
      line.textContent = subject;
      const when = document.createElement("span");
      when.className = "rail-commit-meta";
      when.textContent = meta;
      b.append(line, when);
      b.onclick = onClick;
      nodes.push(b);
    };
    if (changed)
      row(
        "Uncommitted changes",
        "Edited since the last commit",
        () => void this.gitPanel.showWorktreeDiff(changed, changed.unstaged === " " || !changed.unstaged),
      );
    for (const c of commits)
      row(c.subject || "(no message)", `${relative(c.date)} · ${c.short}`, () => void this.gitPanel.showCommit(c, path));
    if (!commits.length && !changed) nodes.push(this.railEmpty("Not committed yet."));
    box.replaceChildren(...nodes);
  }

  /** Link communities for the whole vault, so a note keeps its colour in every view. */
  private linkCommunities(): CommunityResult {
    if (!this.communities) {
      const edges: [string, string][] = [];
      for (const p of this.index.notes) for (const t of this.links.out.get(p) ?? []) edges.push([p, t]);
      this.communities = detectCommunities(this.index.notes, edges);
    }
    return this.communities;
  }

  private graphData(paths: Set<string> | null): GraphData {
    const nodes = (paths ? [...paths] : this.index.notes).filter((p) => this.texts.has(p));
    const set = new Set(nodes);
    const links: GraphData["links"] = [];
    for (const p of nodes) for (const t of this.links.out.get(p) ?? []) if (set.has(t)) links.push({ source: p, target: t });
    const { groupOf, communities } = this.linkCommunities();
    const groups = communities
      .map((c) => ({ id: c.id, label: this.index.title(c.top), size: nodes.filter((p) => groupOf.get(p) === c.id).length }))
      .filter((g) => g.size > 0);
    return {
      nodes: nodes.map((p) => ({
        id: p,
        label: this.index.title(p),
        degree: this.links.degree(p),
        group: groupOf.get(p) ?? -1,
      })),
      links,
      groups,
    };
  }

  private renderLocalGraph(): void {
    const box = this.els.railGraph;
    if (!this.links || !this.current) return;
    const out = this.links.out.get(this.current) ?? new Set<string>();
    const inc = this.links.in.get(this.current) ?? new Set<string>();
    const ids = new Set([...out, ...inc]);
    if (!this.localGraph) {
      box.innerHTML = `<div class="rail-title"><span>Graph</span><button class="link-btn" data-act="graph-local">Expand</button></div>`;
      this.localGraph = new LocalGraph((id, newTab) => void this.open(id, { newTab, focus: !newTab, via: "link" }));
      box.append(this.localGraph.root);
    }
    box.classList.toggle("is-empty", ids.size === 0);
    const edges: [string, string][] = [];
    for (const a of ids) for (const b of this.links.out.get(a) ?? []) if (ids.has(b) && a !== b) edges.push([a, b]);
    const { groupOf } = this.linkCommunities();
    this.localGraph.set(
      edges,
      [...ids].map((id) => ({
        id,
        label: this.index.title(id),
        outgoing: out.has(id),
        incoming: inc.has(id),
        group: groupOf.get(id) ?? -1,
      })),
      groupOf.get(this.current) ?? -1,
    );
  }

  private spy(): void {
    const s = this.els.scroller;
    const scrollerTop = s.getBoundingClientRect().top;
    this.els.paneHead.classList.toggle("is-scrolled", s.scrollTop > 2);
    const links = [...this.els.outline.querySelectorAll<HTMLAnchorElement>("a[data-target]")];
    if (!links.length) return;
    const top = scrollerTop + 96;
    let current = links[0];
    for (const a of links) {
      const el = document.getElementById(a.dataset.target!);
      if (el && el.getBoundingClientRect().top <= top) current = a;
    }
    if (s.scrollTop + s.clientHeight >= s.scrollHeight - 4 && s.scrollTop > 0) current = links[links.length - 1];
    if (current === this.spyActive) return;
    this.spyActive = current;
    for (const a of links) a.classList.toggle("is-active", a === current);
    if (this.els.outline.hidden) return;
    const body = this.els.railBody;
    const view = body.getBoundingClientRect();
    const r = current.getBoundingClientRect();
    if (r.top < view.top) body.scrollTop += r.top - view.top - 8;
    else if (r.bottom > view.bottom) body.scrollTop += r.bottom - view.bottom + 8;
  }

  private scrollToAnchor(anchor: string, quiet = false): void {
    const key = headingKey(anchor.split("#").pop() ?? anchor);
    const target = this.els.scroller.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!target) {
      if (!quiet && !anchor.startsWith("^")) this.toast(`This note has no heading “${anchor}”. Showing the top instead.`);
      return;
    }
    target.scrollIntoView({ block: "start" });
    if (quiet) return;
    target.classList.remove("is-target");
    void target.offsetWidth;
    target.classList.add("is-target");
  }

  // ---------- Graph overlay ----------

  /** The graph is a tab, as in Obsidian: an open one comes forward, otherwise it opens beside the current tab. */
  private openGraph(scope: GraphScope): void {
    const note = this.current;
    const view: GraphView = { kind: "graph", note, scope };
    const existing = this.tabs.findIndex((t) => t.trail.current.view.kind === "graph");
    this.saveScroll();
    if (existing >= 0) {
      this.tabs[existing].trail.setCurrentView(view);
      this.active = existing;
      void this.show({ keyboard: true });
      return;
    }
    const tab: Tab = { id: this.nextId++, trail: new Trail(view) };
    this.tabs.splice(this.active + 1, 0, tab);
    this.active += 1;
    void this.show({ entering: tab.id });
  }

  /** Leaves the graph: back along the trail if there is somewhere to go, otherwise closes its tab. */
  private leaveGraph(): void {
    if (this.tab.trail.current.view.kind !== "graph") return;
    if (this.tab.trail.canBack) void this.go(-1);
    else this.closeTab(this.active);
  }

  private mountGraph(): { root: HTMLElement; canvas: GraphCanvas; depth: number } {
    if (this.graphView) return this.graphView;
    const root = document.createElement("div");
    root.className = "graph-view";
    root.innerHTML = `
      <div class="graph-stage"></div>
      <div class="graph-toolbar">
        <div class="seg" role="tablist"><button class="seg-btn" data-gmode="local">This note</button><button class="seg-btn" data-gmode="vault">Whole vault</button></div>
        <div class="graph-depth" role="group" aria-label="Link depth"><div class="seg"><button class="seg-btn" data-depth="1">1 step</button><button class="seg-btn" data-depth="2">2 steps</button><button class="seg-btn" data-depth="3">3 steps</button></div></div>
        <span class="graph-stats"></span>
        <div class="graph-filter">${icons.search}<input type="text" placeholder="Highlight notes" aria-label="Highlight notes by name" spellcheck="false" /></div>
        <div class="graph-zoom"><button class="icon-btn" data-gz="out" aria-label="Zoom out">${icons.minus}</button><button class="icon-btn" data-gz="fit" aria-label="Fit to view">${icons.fit}</button><button class="icon-btn" data-gz="in" aria-label="Zoom in">${icons.plus}</button></div>
      </div>
      <div class="graph-foot"><div class="graph-groups"></div></div>`;
    const canvas = new GraphCanvas({ onOpen: (id, newTab) => void this.open(id, { newTab, focus: !newTab, via: "link" }) });
    root.querySelector(".graph-stage")!.append(canvas.canvas);
    this.els.reader.append(root);
    this.gitPanel.close();
    const mounted = { root, canvas, depth: 2 };
    this.graphView = mounted;
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const view = this.tab.trail.current.view;
      if (view.kind !== "graph") return;
      const m = t.closest<HTMLElement>("[data-gmode]")?.dataset.gmode;
      const d = t.closest<HTMLElement>("[data-depth]")?.dataset.depth;
      const z = t.closest<HTMLElement>("[data-gz]")?.dataset.gz;
      const chip = t.closest<HTMLElement>("[data-ggroup]");
      if (chip) {
        const id = Number(chip.dataset.ggroup);
        this.spotGroup = this.spotGroup === id ? null : id;
        canvas.spotlight(this.spotGroup);
        if (this.spotGroup === null) canvas.recenter();
        else canvas.flyToGroup(id);
        this.markGroupChips();
      } else if (m === "local" || m === "vault") {
        this.tab.trail.setCurrentView({ ...view, scope: m });
        this.refreshGraphView(view.note, m);
        this.persist();
      } else if (d) {
        mounted.depth = Number(d);
        this.refreshGraphView(view.note, view.scope);
      } else if (z === "in") canvas.zoomBy(1.3);
      else if (z === "out") canvas.zoomBy(1 / 1.3);
      else if (z === "fit") canvas.recenter();
    });
    root.querySelector("input")!.addEventListener("input", (e) => canvas.setFilter((e.target as HTMLInputElement).value));
    const strip = root.querySelector<HTMLElement>(".graph-groups")!;
    strip.addEventListener("scroll", () => this.markStripEnds(strip), { passive: true });
    strip.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    const preview = (group: number | null) => this.graphView?.canvas.spotlight(group ?? this.spotGroup);
    root.addEventListener("pointerover", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-ggroup]");
      if (chip) preview(Number(chip.dataset.ggroup));
    });
    root.addEventListener("pointerout", (e) => {
      if ((e.target as HTMLElement).closest("[data-ggroup]")) preview(null);
    });
    return mounted;
  }

  private showGraph(view: GraphView, entering?: number): void {
    if (this.find.isOpen) this.find.close();
    this.current = view.note;
    const g = this.mountGraph();
    this.renderTabChrome(entering);
    this.renderSidebar();
    requestAnimationFrame(() => this.refreshGraphView(view.note, view.scope));
    g.canvas.canvas.focus({ preventScroll: true });
    this.persist();
  }

  private refreshGraphView(note: string, scope: GraphScope): void {
    const g = this.graphView;
    if (!g) return;
    const data = this.graphData(scope === "local" ? this.links.neighbourhood(note, g.depth) : null);
    g.canvas.setData(data, note);
    for (const b of g.root.querySelectorAll<HTMLElement>("[data-gmode]")) b.classList.toggle("is-on", b.dataset.gmode === scope);
    for (const b of g.root.querySelectorAll<HTMLElement>("[data-depth]"))
      b.classList.toggle("is-on", Number(b.dataset.depth) === g.depth);
    g.root.querySelector<HTMLElement>(".graph-depth")!.hidden = scope !== "local";
    g.root.querySelector(".graph-stats")!.textContent = `${data.nodes.length} notes · ${data.links.length} links`;
    this.spotGroup = null;
    const chips = g.root.querySelector<HTMLElement>(".graph-groups")!;
    chips.replaceChildren();
    for (const group of [...data.groups].sort((a, b) => b.size - a.size)) {
      const chip = document.createElement("button");
      chip.className = "graph-chip";
      chip.dataset.ggroup = String(group.id);
      chip.style.setProperty("--h", groupColor(group.id));
      const name = document.createElement("span");
      name.textContent = group.label;
      const count = document.createElement("small");
      count.textContent = String(group.size);
      chip.append(name, count);
      chips.append(chip);
    }
    this.markStripEnds(chips);
  }

  /** The strip fades only on a side that has more to scroll to. */
  private markStripEnds(strip: Element): void {
    strip.classList.toggle("has-before", strip.scrollLeft > 1);
    strip.classList.toggle("has-after", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
  }

  private markGroupChips(): void {
    for (const chip of this.graphView?.root.querySelectorAll<HTMLElement>("[data-ggroup]") ?? []) {
      chip.classList.toggle("is-on", Number(chip.dataset.ggroup) === this.spotGroup);
    }
  }

  private unmountGraph(): void {
    const g = this.graphView;
    if (!g) return;
    this.graphView = null;
    g.canvas.destroy();
    g.root.remove();
  }

  // ---------- Git ----------

  private async initGit(): Promise<void> {
    if (!isDesktop) return;
    await this.gitPanel.refresh();
    if (this.gitPanel.status?.isRepo && this.prefs.value.syncOnLaunch) void this.gitPanel.fetch();
    this.scheduleBackground();
  }

  private scheduleBackground(): void {
    clearInterval(this.backgroundTimer);
    const minutes = this.prefs.value.backgroundMinutes;
    if (!minutes || !isDesktop) return;
    this.backgroundTimer = window.setInterval(() => {
      if (this.gitPanel.status?.isRepo && this.gitPanel.state.kind !== "busy") void this.gitPanel.fetch(true);
    }, minutes * 60_000);
  }

  private scheduleGitRefresh(): void {
    if (!isDesktop || !this.gitPanel) return;
    clearTimeout(this.gitRefreshTimer);
    this.gitRefreshTimer = window.setTimeout(() => {
      if (this.gitPanel.state.kind !== "busy") void this.gitPanel.refresh();
    }, 400);
  }

  private renderSync(st: GitStatus | null, state: SyncState): void {
    const btn = this.els?.sync;
    if (!btn) return;
    const label = btn.querySelector(".sync-label")!;
    const branch = isDesktop && st?.isRepo ? st.branch : null;
    this.els.branch.hidden = !branch;
    this.els.branch.lastElementChild!.textContent = branch ?? "";
    let tone = "ok";
    let text = "Synced";
    let tip = "Up to date with the remote";
    if (!isDesktop) {
      tone = "off";
      text = "Preview";
      tip = "Git sync runs in the desktop app";
    } else if (state.kind === "busy") {
      tone = "busy";
      text = state.label;
      tip = state.label;
    } else if (!st?.isRepo) {
      tone = "off";
      text = "Local";
      tip = "This vault is not a Git repository";
    } else if (state.kind === "error") {
      const k = state.error.kind;
      tone = k === "offline" ? "off" : "warn";
      text =
        (
          {
            offline: "Offline",
            auth: "Sign-in needed",
            diverged: "Diverged",
            localChangesBlock: "Blocked",
            rejected: "Push rejected",
            timeout: "Timed out",
          } as Record<string, string>
        )[k] ?? "Sync problem";
      tip = state.error.message.split("\n")[0];
    } else if (st.operation) {
      tone = "warn";
      text = `${st.operation} in progress`;
      tip = "Finish it in a terminal";
    } else if (st.ahead && st.behind) {
      tone = "warn";
      text = "Diverged";
      tip = `${st.ahead} local and ${st.behind} remote commits`;
    } else if (st.behind) {
      tone = "incoming";
      text = `${st.behind} incoming`;
      tip = "Press Sync to apply";
    } else if (st.ahead) {
      tone = "outgoing";
      text = `${st.ahead} to push`;
      tip = "Committed here, not yet pushed";
    } else if (st.files.length) {
      tone = "changed";
      text = `${st.files.length} changed`;
      tip = "Edited outside Waymark and not committed";
    } else if (!st.upstream) {
      tone = "off";
      text = "No remote";
      tip = "This branch does not track a remote branch";
    } else if (this.prefs.value.vaults[this.vaultRoot]?.lastSync == null) {
      tone = "off";
      text = "Not checked";
      tip = "Press Sync to compare with the remote";
    }
    if (this.index && this.current) void this.renderNoteHistory();
    btn.dataset.tone = tone;
    label.textContent = text;
    btn.dataset.tip = tip;
  }

  // ---------- Palette ----------

  private paletteRecent(): PaletteItem[] {
    const seen = new Set<string>([this.current]);
    const items: PaletteItem[] = [];
    for (const t of this.tabs) {
      for (const view of t.trail.views()) {
        if (view.kind !== "note" || seen.has(view.path)) continue;
        seen.add(view.path);
        items.push(this.noteItem(view.path, "Recent"));
      }
    }
    return [...items.slice(0, 10), ...this.commands().slice(0, 5)];
  }

  private noteItem(path: string, group = "Notes"): PaletteItem {
    return {
      id: path,
      label: this.index.title(path),
      detail: ancestors(path).at(-1),
      group,
      keywords: path,
      run: ({ newTab }) => void this.open(path, { newTab, focus: true, keyboard: true }),
    };
  }

  private paletteItems(query: string): PaletteItem[] {
    if (query.startsWith(">")) return this.commands();
    return [...this.index.notes.map((p) => this.noteItem(p)), ...this.commands()];
  }

  private commands(): PaletteItem[] {
    const c = (id: string, label: string, run: () => void, hint?: string, keywords?: string): PaletteItem => ({
      id,
      label,
      hint,
      keywords,
      group: "Commands",
      run,
    });
    const st = this.gitPanel?.status;
    const list: PaletteItem[] = [
      c("files", "Show files", () => this.closeSearch(), "⌘⇧E", "folders tree sidebar"),
      c("search", "Search inside notes", () => this.openSearch(), "⌘⇧F", "find full text"),
      c("graph", "Show graph of the vault", () => this.openGraph("vault"), "⌘G"),
      c("graph-local", "Show graph around this note", () => this.openGraph("local"), "⌘⇧G", "local links"),
      c("find", "Find in this note", () => this.find.open(), "⌘F"),
      c("sidebar", "Toggle sidebar", () => this.toggleSidebar(), "⌘\\"),
      c("rail", "Toggle inspector", () => this.toggleRail(), "⌥⌘\\", "outline linked notes properties"),
      c("theme", "Change theme…", () => this.openSettings(), "⌘,", "appearance colour catppuccin rose pine gruvbox everforest"),
      c(
        "appearance",
        this.scheme() === "dark" ? "Use light appearance" : "Use dark appearance",
        () => this.setAppearance(this.scheme() === "dark" ? "light" : "dark"),
        "⌘⇧L",
      ),
      c(
        "sound",
        this.prefs.value.sound ? "Mute sounds" : "Turn sounds on",
        () => this.setSound(!this.prefs.value.sound),
        undefined,
        "audio mute",
      ),
      c("text-bigger", "Make text larger", () => this.scaleText(1), "⌘+"),
      c("text-smaller", "Make text smaller", () => this.scaleText(-1), "⌘−"),
      c("text-reset", "Reset text size", () => this.scaleText(0), "⌘0"),
    ];
    if (isDesktop) {
      list.push(
        c("sync", "Sync now", () => void this.gitPanel.sync(), "⌘⇧S", "git pull fetch update"),
        c("sync-panel", "Show changes and sync", () => this.gitPanel.open(), "⌘⇧Y", "git status commit push"),
        c(
          "history",
          "Show history of this note",
          () => this.gitPanel.open(undefined, { historyPath: this.current }),
          "⌘⇧H",
          "git log revisions",
        ),
        c(
          "vault-history",
          "Show history of the vault",
          () => this.gitPanel.open(undefined, { historyPath: null }),
          undefined,
          "git log",
        ),
        c("reveal", "Reveal note in Finder", () => void native.reveal(this.current)),
        c("terminal", "Open vault in Terminal", () => void native.openTerminal()),
        c("open-vault", "Open another vault…", async () => {
          const p = await native.pickFolder("Open a vault");
          if (p) await this.openVault(p).catch((err: Error) => this.toast(err.message));
        }),
        c("close-vault", "Close vault", () => {
          this.persist();
          this.prefs.update((p) => (p.lastVault = null));
          this.welcome();
        }),
      );
      if (st?.ahead && !st.behind)
        list.push(c("push", `Push ${st.ahead} commit${st.ahead === 1 ? "" : "s"}`, () => this.gitPanel.open()));
    }
    return list;
  }

  // ---------- Settings ----------

  private openSettings(): void {
    const existing = document.querySelector(".popover.settings");
    const anchor = this.host.querySelector<HTMLElement>('[data-act="settings"]')!;
    if (existing) {
      existing.remove();
      anchor.classList.remove("is-on");
      return;
    }
    anchor.classList.add("is-on");
    const pop = document.createElement("div");
    pop.className = "popover settings";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Appearance and sync");
    const p = this.prefs.value;
    const scheme = this.scheme();
    const swatches = FAMILIES.map((f) => {
      const v = f[scheme];
      return `<button class="theme-swatch${f.id === p.family ? " is-on" : ""}" data-family="${f.id}" aria-pressed="${f.id === p.family}">
        <span class="swatch" style="--s-bg:${v.p.mantle};--s-paper:${v.paper};--s-ink:${v.p.text};--s-accent:${v.accent};--s-2:${v.p.green};--s-3:${v.p.peach}"><i></i><b></b><em></em></span>
        <span class="swatch-label">${f.label}<small>${v.label}</small></span></button>`;
    }).join("");
    pop.innerHTML = `
      <div class="pop-section"><div class="pop-label">Theme</div><div class="theme-grid">${swatches}</div></div>
      <div class="pop-section"><div class="pop-label">Appearance</div>
        <div class="seg seg-full">${(["system", "light", "dark"] as const).map((a) => `<button class="seg-btn${p.appearance === a ? " is-on" : ""}" data-appearance="${a}">${a === "system" ? "Match system" : a[0].toUpperCase() + a.slice(1)}</button>`).join("")}</div></div>
      <div class="pop-section pop-toggles">
        <label class="toggle"><span>Sounds for sync, copy and new tabs</span><input type="checkbox" data-pref="sound" ${p.sound ? "checked" : ""}/><i aria-hidden="true"></i></label>
        ${
          isDesktop
            ? `<label class="toggle"><span>Check the remote on launch</span><input type="checkbox" data-pref="syncOnLaunch" ${p.syncOnLaunch ? "checked" : ""}/><i aria-hidden="true"></i></label>
        <label class="toggle"><span>Check every 15 minutes</span><input type="checkbox" data-pref="background" ${p.backgroundMinutes ? "checked" : ""}/><i aria-hidden="true"></i></label>
        <p class="pop-note">Checks only fetch. Incoming changes apply when you press Sync, and only as a fast-forward.</p>`
            : ""
        }
      </div>`;
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
    pop.style.right = `${Math.max(8, window.innerWidth - r.right - 4)}px`;
    pop.style.transformOrigin = `calc(100% - ${r.width / 2 + 4}px) bottom`;
    pop.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const fam = t.closest<HTMLElement>("[data-family]")?.dataset.family;
      const appearance = t.closest<HTMLElement>("[data-appearance]")?.dataset.appearance as
        | "system"
        | "light"
        | "dark"
        | undefined;
      if (fam) {
        this.prefs.update((pr) => (pr.family = fam));
        this.applyTheme();
        for (const b of pop.querySelectorAll<HTMLElement>("[data-family]")) {
          b.classList.toggle("is-on", b.dataset.family === fam);
          b.setAttribute("aria-pressed", String(b.dataset.family === fam));
        }
      }
      if (appearance) {
        this.setAppearance(appearance);
        pop.remove();
        cleanup();
        this.openSettings();
      }
    });
    pop.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.pref === "sound") this.setSound(t.checked);
      if (t.dataset.pref === "syncOnLaunch") this.prefs.update((pr) => (pr.syncOnLaunch = t.checked));
      if (t.dataset.pref === "background") {
        this.prefs.update((pr) => (pr.backgroundMinutes = t.checked ? 15 : 0));
        this.scheduleBackground();
      }
    });
    const dismiss = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && (pop.contains(e.target as Node) || anchor.contains(e.target as Node))) return;
      pop.remove();
      cleanup();
    };
    const cleanup = () => {
      anchor.classList.remove("is-on");
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", dismiss, true);
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", dismiss, true);
    pop.querySelector<HTMLElement>(".theme-swatch.is-on")?.focus({ preventScroll: true });
  }

  private setAppearance(a: "system" | "light" | "dark"): void {
    this.prefs.update((p) => (p.appearance = a));
    this.applyTheme();
  }

  private setSound(on: boolean): void {
    this.prefs.update((p) => (p.sound = on));
    this.sound.muted = !on;
    if (on) this.sound.play("synced");
    this.toast(on ? "Sounds on" : "Sounds muted");
  }

  private scaleText(step: number): void {
    const root = document.documentElement;
    const now = Number(root.style.getPropertyValue("--text-scale") || 1);
    const next = step === 0 ? 1 : Math.min(1.375, Math.max(0.8125, now + step * 0.0625));
    root.style.setProperty("--text-scale", String(next));
    this.toast(`Text size ${Math.round(next * 100)}%`);
  }

  private toggleRail(): void {
    if (railFloats()) {
      this.els.shell.classList.toggle("rail-peek");
      return;
    }
    const closed = !this.els.shell.classList.contains("rail-closed");
    this.els.shell.classList.toggle("rail-closed", closed);
    this.prefs.update((p) => (p.rail = !closed));
  }

  // ---------- Events ----------

  private onClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    if (!el.closest(".sidebar, .rail, [data-act]")) this.els.shell.classList.remove("sidebar-peek", "rail-peek");
    const act = el.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act) {
      e.preventDefault();
      if (act === "sidebar") this.toggleSidebar();
      else if (act === "back") void this.go(-1);
      else if (act === "forward") void this.go(1);
      else if (act === "palette") this.palette.open();
      else if (act === "settings") this.openSettings();
      else if (act === "search-clear") this.clearSearch();
      else if (act === "new-tab") this.newTab();
      else if (act === "rail") this.toggleRail();
      else if (act === "graph") this.tab.trail.current.view.kind === "graph" ? this.leaveGraph() : this.openGraph("vault");
      else if (act === "graph-local") this.openGraph("local");
      else if (act === "sync-panel")
        isDesktop ? this.gitPanel.toggle(this.els.sync) : this.toast("Git sync runs in the desktop app");
      else if (act === "close") this.closeTab(Number(el.closest<HTMLElement>(".tab")!.dataset.tab));
      return;
    }
    const tab = el.closest<HTMLElement>(".tab");
    if (tab) {
      if (e.button === 1) this.closeTab(Number(tab.dataset.tab));
      else this.switchTab(Number(tab.dataset.tab));
      return;
    }
    const side = el.closest<HTMLElement>("[data-side]")?.dataset.side;
    if (side === "search") {
      this.openSearch();
      return;
    }
    if (side === "files") {
      this.closeSearch();
      return;
    }
    const folder = el.closest<HTMLElement>(".tree-head");
    if (folder) {
      const path = folder.dataset.folder!;
      this.setFolderOpen(path, !this.openFolders.has(path));
      this.persist();
      return;
    }
    const crumb = el.closest<HTMLElement>("[data-crumb]");
    if (crumb) {
      this.revealFolder(crumb.dataset.crumb!);
      return;
    }
    const railTab = el.closest<HTMLElement>("[data-rail]");
    if (railTab) {
      const pane = railTab.dataset.rail as "outline" | "links" | "info";
      this.prefs.update((p) => (p.railPane = pane));
      this.setRailPane(pane);
      this.spyActive = null;
      this.spy();
      return;
    }
    const hit = el.closest<HTMLElement>(".search-hit");
    if (hit) {
      this.openHit(Number(hit.dataset.hit), e.metaKey);
      return;
    }
    const copy = el.closest<HTMLButtonElement>(".code-copy");
    if (copy) {
      void this.copyCode(copy);
      return;
    }
    const fold = el.closest<HTMLElement>("button.callout-title");
    if (fold) {
      const callout = fold.closest<HTMLElement>(".callout")!;
      const open = callout.dataset.fold !== "open";
      callout.dataset.fold = open ? "open" : "closed";
      fold.setAttribute("aria-expanded", String(open));
      return;
    }
    const expand = el.closest<HTMLElement>(".diagram-expand");
    if (expand) {
      const svg = expand.closest(".diagram")!.querySelector("svg")!;
      this.lightbox(svg.cloneNode(true) as Element);
      return;
    }
    if (el instanceof HTMLImageElement && el.classList.contains("embed-image")) {
      this.lightbox(el.cloneNode() as Element);
      return;
    }
    const outline = el.closest<HTMLAnchorElement>(".outline a");
    if (outline) {
      e.preventDefault();
      document
        .getElementById(outline.dataset.target!)
        ?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
      return;
    }
    const link = el.closest<HTMLElement>("a.wikilink, a.wikilink-plain, .nav-item[data-path]");
    if (link?.closest(".sidebar, .rail")) this.els.shell.classList.remove("sidebar-peek", "rail-peek");
    if (link) {
      e.preventDefault();
      this.hidePreview();
      if (link.classList.contains("is-ambiguous")) {
        this.chooseAmbiguous(link, JSON.parse(link.dataset.candidates!) as string[], e.metaKey);
        return;
      }
      if (!link.dataset.path) return;
      const newTab = e.metaKey || e.button === 1;
      const via = link.classList.contains("nav-item") ? "jump" : "link";
      void this.open(link.dataset.path, { anchor: link.dataset.anchor, newTab, focus: newTab ? e.shiftKey : true, via });
      return;
    }
    const attachment = el.closest<HTMLAnchorElement>("a.attachment-link, a.embed-file");
    if (attachment) {
      e.preventDefault();
      if (isDesktop) void native.reveal(attachment.dataset.attachment ?? undefined);
      else window.open(attachment.href, "_blank", "noopener");
      return;
    }
    const external = el.closest<HTMLAnchorElement>(".doc a[href^='http'], .doc a[href^='mailto:']");
    if (external) {
      e.preventDefault();
      void native.openExternal(external.href);
      return;
    }
    const remote = el.closest<HTMLElement>(".remote-image");
    if (remote?.dataset.src) void native.openExternal(remote.dataset.src);
  }

  private chooseAmbiguous(anchor: HTMLElement, candidates: string[], newTab: boolean): void {
    document.querySelector(".popover.choose")?.remove();
    const pop = document.createElement("div");
    pop.className = "popover choose";
    const label = document.createElement("div");
    label.className = "pop-label";
    label.textContent = `${candidates.length} notes share this name. Open which?`;
    pop.append(label);
    for (const c of candidates) {
      const b = document.createElement("button");
      b.className = "choose-row";
      const name = document.createElement("span");
      name.textContent = this.index.title(c);
      const dir = document.createElement("span");
      dir.className = "choose-dir";
      dir.textContent = c.split("/").slice(0, -1).join("/") || "Vault root";
      b.append(name, dir);
      b.onclick = () => {
        pop.remove();
        void this.open(c, { newTab, focus: true, anchor: anchor.dataset.anchor });
      };
      pop.append(b);
    }
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.min(r.left, window.innerWidth - 320)}px`;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.transformOrigin = "left top";
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof PointerEvent && pop.contains(e.target as Node)) return;
      pop.remove();
      window.removeEventListener("pointerdown", off, true);
      window.removeEventListener("keydown", off, true);
    };
    window.addEventListener("pointerdown", off, true);
    window.addEventListener("keydown", off, true);
    pop.querySelector<HTMLElement>(".choose-row")?.focus();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.els || !this.index) return;
    const k = e.key.toLowerCase();
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === "Escape") {
      if (this.palette.isOpen || document.querySelector(".lightbox, .sheet-overlay, .popover")) return;
      if (this.find.isOpen) this.find.close();
      else if (this.tab.trail.current.view.kind === "graph" && !inField) this.leaveGraph();
      else if (this.gitPanel.isOpen) this.gitPanel.close();
      else if (this.els.shell.matches(".sidebar-peek, .rail-peek")) this.els.shell.classList.remove("sidebar-peek", "rail-peek");
      else if (this.sidebarMode === "search" && !inField) this.closeSearch();
      else paint("search", []);
      return;
    }
    if (e.ctrlKey && e.key === "Tab") {
      e.preventDefault();
      this.switchTab((this.active + (e.shiftKey ? -1 : 1) + this.tabs.length) % this.tabs.length);
      return;
    }
    if (!e.metaKey) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if ((k === "k" || k === "o" || k === "p") && !e.shiftKey) {
      handled();
      this.palette.open();
    } else if (k === "t" && !e.shiftKey) {
      handled();
      this.newTab();
    } else if (k === "e" && e.shiftKey) {
      handled();
      this.closeSearch();
    } else if (k === "f" && e.shiftKey) {
      handled();
      this.openSearch(window.getSelection()?.toString().trim() || undefined);
    } else if (k === "f") {
      handled();
      this.find.open();
    } else if (k === "g" && e.shiftKey) {
      handled();
      this.openGraph("local");
    } else if (k === "g") {
      handled();
      this.tab.trail.current.view.kind === "graph" ? this.leaveGraph() : this.openGraph("vault");
    } else if (k === "l" && e.shiftKey) {
      handled();
      this.setAppearance(this.scheme() === "dark" ? "light" : "dark");
    } else if (k === "s" && e.shiftKey && isDesktop) {
      handled();
      void this.gitPanel.sync();
    } else if (k === "y" && e.shiftKey && isDesktop) {
      handled();
      this.gitPanel.open();
    } else if (k === "h" && e.shiftKey && isDesktop) {
      handled();
      this.gitPanel.open(undefined, { historyPath: this.current });
    } else if (k === ",") {
      handled();
      this.openSettings();
    } else if (inField) return;
    else if (e.key === "[" && !e.shiftKey) {
      handled();
      void this.go(-1);
    } else if (e.key === "]" && !e.shiftKey) {
      handled();
      void this.go(1);
    } else if (e.key === "{" || (e.key === "[" && e.shiftKey)) {
      handled();
      this.switchTab((this.active - 1 + this.tabs.length) % this.tabs.length);
    } else if (e.key === "}" || (e.key === "]" && e.shiftKey)) {
      handled();
      this.switchTab((this.active + 1) % this.tabs.length);
    } else if (e.code === "Backslash" && e.altKey) {
      handled();
      this.toggleRail();
    } else if (e.code === "Backslash") {
      handled();
      this.els.shell.classList.add("no-anim");
      this.toggleSidebar();
      requestAnimationFrame(() => requestAnimationFrame(() => this.els.shell.classList.remove("no-anim")));
    } else if (k === "w") {
      handled();
      this.closeTab(this.active);
    } else if (k === "=" || k === "+") {
      handled();
      this.scaleText(1);
    } else if (k === "-") {
      handled();
      this.scaleText(-1);
    } else if (k === "0") {
      handled();
      this.scaleText(0);
    } else if (/^[1-9]$/.test(k)) {
      handled();
      this.switchTab(k === "9" ? this.tabs.length - 1 : Math.min(Number(k), this.tabs.length) - 1);
    }
  }

  private async copyCode(button: HTMLButtonElement): Promise<void> {
    const code = button.closest(".code")!.querySelector("pre")!.textContent ?? "";
    const label = button.querySelector("span")!;
    try {
      await navigator.clipboard.writeText(code);
      label.textContent = "Copied";
      this.sound.play("copy");
    } catch {
      label.textContent = "Copy failed";
    }
    button.classList.add("is-done");
    setTimeout(() => {
      label.textContent = "Copy";
      button.classList.remove("is-done");
    }, 1400);
  }

  private lightbox(content: Element): void {
    const box = document.createElement("div");
    box.className = "overlay lightbox";
    const sheet = document.createElement("div");
    sheet.className = "lightbox-sheet";
    if (content instanceof SVGElement) {
      content.removeAttribute("style");
      content.removeAttribute("width");
      content.removeAttribute("height");
    }
    sheet.append(content);
    box.append(sheet);
    const close = () => {
      box.classList.add("is-leaving");
      setTimeout(() => box.remove(), 150);
      window.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    box.addEventListener("click", close);
    window.addEventListener("keydown", onKey, true);
    document.body.append(box);
  }

  toast(message: string): void {
    document.querySelector(".toast:not(.is-leaving)")?.remove();
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = message;
    document.body.append(t);
    setTimeout(() => {
      t.classList.add("is-leaving");
      setTimeout(() => t.remove(), 220);
    }, 2600);
  }

  // ---------- Tooltips and link previews ----------

  private bindTooltips(): void {
    let tip: HTMLElement | null = null;
    let timer = 0;
    let warmUntil = 0;
    const hide = () => {
      clearTimeout(timer);
      tip?.remove();
      tip = null;
    };
    this.host.onpointerover = (e) => {
      this.onPreviewOver(e);
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tip]");
      if (!target || target.closest(".tab.is-active")) return;
      const label = target.querySelector<HTMLElement>(":scope > :is(.nav-text, .rail-link-name)");
      if (label && label.scrollWidth <= label.clientWidth) return;
      if (target.classList.contains("tab")) {
        const title = target.querySelector<HTMLElement>(".tab-title");
        if (title && title.scrollWidth <= title.clientWidth) return;
      }
      hide();
      const show = () => {
        tip = document.createElement("div");
        tip.className = `tooltip${performance.now() < warmUntil ? " is-instant" : ""}`;
        tip.textContent = target.dataset.tip!;
        if (target.dataset.key) {
          const kbd = document.createElement("kbd");
          kbd.textContent = target.dataset.key;
          tip.append(kbd);
        }
        document.body.append(tip);
        const r = target.getBoundingClientRect();
        const w = tip.offsetWidth;
        tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
        tip.style.top = `${r.bottom + 40 > window.innerHeight ? r.top - tip.offsetHeight - 6 : r.bottom + 6}px`;
      };
      if (performance.now() < warmUntil) show();
      else timer = window.setTimeout(show, 550);
    };
    this.host.onpointerout = (e) => {
      this.onPreviewOut(e);
      const from = (e.target as HTMLElement).closest("[data-tip]");
      if (from && !from.contains(e.relatedTarget as Node)) {
        if (tip) warmUntil = performance.now() + 800;
        hide();
      }
    };
    this.host.onpointerdown = hide;
  }

  private previewTimer = 0;
  private preview: HTMLElement | null = null;

  private onPreviewOver(e: PointerEvent): void {
    const link = (e.target as HTMLElement).closest<HTMLElement>(".doc a.wikilink[data-path]");
    if (!link || link.closest(".preview")) return;
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => void this.showPreview(link), 650);
  }

  private onPreviewOut(e: PointerEvent): void {
    const link = (e.target as HTMLElement).closest(".doc a.wikilink");
    if (link && !link.contains(e.relatedTarget as Node)) {
      clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => {
        if (!this.preview?.matches(":hover")) this.hidePreview();
      }, 250);
    }
  }

  private async showPreview(link: HTMLElement): Promise<void> {
    const path = link.dataset.path!;
    const text = this.texts.get(path);
    if (!text || path === this.current) return;
    const { body } = parseFrontmatter(text);
    const excerpt = body.split(/\n(?=## )/)[0].slice(0, 2000);
    const r = await renderNote(excerpt, path, {
      index: this.index,
      highlighter: this.highlighter,
      assetUrl: this.source.assetUrl,
    });
    if (!link.matches(":hover")) return;
    this.hidePreview();
    const pop = document.createElement("div");
    pop.className = "preview";
    const doc = document.createElement("div");
    doc.className = "doc is-preview";
    const h = document.createElement("div");
    h.className = "preview-title";
    h.textContent = this.index.title(path);
    doc.append(h, r.fragment);
    for (const d of doc.querySelectorAll(".diagram")) d.remove();
    pop.append(doc);
    document.body.append(pop);
    const lr = link.getBoundingClientRect();
    const below = lr.bottom + 360 < window.innerHeight;
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - 472, lr.left - 16))}px`;
    if (below) pop.style.top = `${lr.bottom + 8}px`;
    else pop.style.bottom = `${window.innerHeight - lr.top + 8}px`;
    pop.style.transformOrigin = below ? "left top" : "left bottom";
    pop.addEventListener("pointerleave", () => this.hidePreview());
    this.preview = pop;
  }

  private hidePreview(): void {
    clearTimeout(this.previewTimer);
    this.preview?.remove();
    this.preview = null;
  }

  // ---------- Persistence ----------

  private persist(): void {
    if (!this.tabs.length || !this.els) return;
    this.saveScroll();
    const root = this.vaultRoot;
    this.prefs.update((p) => {
      const prev = p.vaults[root];
      p.vaults[root] = {
        tabs: this.tabs.map((t) => t.trail.save()),
        active: this.active,
        lastSync: prev?.lastSync ?? null,
        openFolders: [...this.openFolders],
      };
    });
  }
}
