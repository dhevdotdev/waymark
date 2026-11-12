import type { PrefStore } from "../prefs";
import type { VaultIndex } from "../vault/index";
import { FileTree } from "./file-tree";
import { paint } from "./find";
import { isNarrow } from "./media";
import { glidePanel } from "./panel-glide";
import { bindEdgeDrag } from "./panel-resize";
import { SearchPane, type SearchPaneHost } from "./search-pane";
import type { ShellElements } from "./shell";
import { bindTreeKeys } from "./tree-keys";

type SideMode = "files" | "search";

const MIN_WIDTH = 200;
const MAX_WIDTH = 440;

export interface SidebarHost extends Omit<SearchPaneHost, "close" | "clearHighlights"> {
  focusReader: () => void;
  /** Only one search marks the note at a time. */
  searchOpened: () => void;
  persist: () => void;
}

/** The left panel: the file tree and full-text search, one showing at a time. */
export class Sidebar {
  readonly tree: FileTree;
  readonly searchPane: SearchPane;
  private mode: SideMode = "files";

  constructor(
    private readonly els: ShellElements,
    private readonly prefs: PrefStore,
    openFolders: string[],
    private readonly host: SidebarHost,
  ) {
    this.tree = new FileTree(els.sidebar, new Set(openFolders), () => host.persist());
    bindTreeKeys(els.sidebar);
    this.searchPane = new SearchPane(els.searchPane, {
      ...host,
      close: () => this.showFiles(),
      clearHighlights: () => paint("search", []),
    });
    bindEdgeDrag(els.sidebarResize, {
      shell: els.shell,
      axis: "x",
      direction: 1,
      range: () => [MIN_WIDTH, MAX_WIDTH],
      read: () => prefs.value.sidebarWidth,
      apply: (width) => {
        els.shell.style.setProperty("--sidebar-w", `${width}px`);
        prefs.value.sidebarWidth = width;
      },
      save: () => prefs.update(() => undefined),
    });
    this.syncMode();
  }

  get isSearching(): boolean {
    return this.mode === "search";
  }

  renderTree(index: VaultIndex, current: string): void {
    this.tree.render(index, current);
  }

  /** Returns to Files. The query and results are kept for the next visit to Search. */
  showFiles(): void {
    this.setMode("files");
    this.host.focusReader();
  }

  showSearch(prefill?: string): void {
    this.host.searchOpened();
    this.ensureVisible();
    this.setMode("search");
    this.searchPane.focus(prefill);
  }

  revealFolder(path: string): void {
    this.setMode("files");
    this.ensureVisible();
    this.tree.focusFolder(path);
  }

  toggle(force?: boolean): void {
    const { shell } = this.els;
    if (isNarrow()) {
      shell.classList.remove("sidebar-closed");
      shell.classList.toggle("sidebar-peek", force);
      return;
    }
    const closed = force === undefined ? !shell.classList.contains("sidebar-closed") : !force;
    if (closed === shell.classList.contains("sidebar-closed")) return;
    glidePanel(shell, () => shell.classList.toggle("sidebar-closed", closed));
    this.prefs.update((p) => {
      p.sidebar = !closed;
    });
  }

  private ensureVisible(): void {
    if (isNarrow()) this.els.shell.classList.add("sidebar-peek");
    else if (this.els.shell.classList.contains("sidebar-closed")) this.toggle(true);
  }

  private setMode(mode: SideMode): void {
    this.mode = mode;
    this.syncMode();
    if (mode === "files") paint("search", []);
  }

  private syncMode(): void {
    const { shell } = this.els;
    for (const pane of shell.querySelectorAll<HTMLElement>("[data-side-pane]")) pane.hidden = pane.dataset.sidePane !== this.mode;
  }
}
