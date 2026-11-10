import { isBaseFile, type VaultIndex } from "../vault/index";
import { ancestors, buildTree, type TreeFolder } from "../vault/tree";
import { icons } from "./icons";
import { isPointerAction } from "./input-origin";
import { instantly } from "./instant";
import { flashLanded } from "./list-motion";
import { isShown, ROW } from "./tree-keys";
import { captureTree, settleTree, type TreeBefore } from "./tree-motion";

const CHEVRON = `<svg class="tree-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`;
const treeIcon = (svg: string) => svg.replace("<svg", '<svg class="tree-icon"');
/** Long enough for a sort by date to read file times before the rebuild it waits on. */
const EDIT_WINDOW_MS = 1000;

/** The folder tree in the sidebar. Rows are built once per index and updated in place. */
export class FileTree {
  private readonly folders = new Map<string, HTMLElement>();
  private readonly notes = new Map<string, HTMLElement>();
  private builtFor: VaultIndex | null = null;
  private current = "";
  /** Shown above the folders. */
  leading: HTMLElement | null = null;
  private byDate = false;
  private times: { index: VaultIndex; seconds: Map<string, number> } | null = null;
  private timesLoading: VaultIndex | null = null;
  private lastCurrent = "";
  private editExpectedUntil = 0;
  /** Reads when each note last changed, for sorting by date. */
  fileTimes: ((paths: string[]) => Promise<Map<string, number>>) | null = null;

  constructor(
    private readonly box: HTMLElement,
    private readonly opened: Set<string>,
    private readonly onChange: () => void,
  ) {}

  get openFolders(): string[] {
    return [...this.opened];
  }

  /** Rebuilds if the vault's files changed, then marks and reveals `current`. */
  render(index: VaultIndex, current: string): void {
    this.lastCurrent = current;
    if (this.needsTimes(index)) {
      if (this.box.querySelector(".tree")) this.reveal(current);
      return;
    }
    let lost: HTMLElement | null = null;
    let before: TreeBefore | null = null;
    const moved = current !== this.current;
    if (this.builtFor !== index || !this.box.querySelector(".tree")) {
      lost = this.focusedRow();
      before = this.takeExpectedEdit() ? captureTree(this.box) : null;
      this.rebuild(index);
    }
    this.reveal(current, moved);
    if (lost) this.refocus(lost);
    if (before) settleTree(this.box, before);
  }

  private focusedRow(): HTMLElement | null {
    const active = document.activeElement;
    return active && this.box.contains(active) ? active.closest<HTMLElement>(ROW) : null;
  }

  /** Moves focus to the row that had it, or else the nearest folder still in the list, or else the open note. */
  private refocus({ dataset: { path, folder } }: HTMLElement): void {
    const head = (name: string) => this.folders.get(name)?.querySelector<HTMLElement>(":scope > .tree-head") ?? null;
    const same = path ? (this.notes.get(path) ?? null) : head(folder ?? "");
    const parents = ancestors(path ?? `${folder}/`)
      .reverse()
      .map(head);
    const row = [same, ...parents, this.notes.get(this.current) ?? null].find((r) => r && isShown(r));
    (row ?? this.box.querySelector<HTMLElement>(ROW))?.focus({ preventScroll: true });
  }

  /** The next rebuild is the result of this action. Changes arriving from outside are never expected, so they stay instant. */
  expectEdit(): void {
    this.editExpectedUntil = isPointerAction() ? performance.now() + EDIT_WINDOW_MS : 0;
  }

  private takeExpectedEdit(): boolean {
    const expected = performance.now() < this.editExpectedUntil;
    this.editExpectedUntil = 0;
    return expected;
  }

  private rebuild(index: VaultIndex): void {
    this.folders.clear();
    this.notes.clear();
    const tree = document.createElement("div");
    tree.className = "tree";
    if (this.leading) tree.append(this.leading);
    tree.append(...this.children(buildTree([...index.notes, ...index.bases], this.noteOrder(index)), 0, index));
    const keep = this.box.scrollTop;
    this.box.replaceChildren(tree);
    this.box.scrollTop = keep;
    this.builtFor = index;
    this.current = "";
  }

  /** Sets the order before the first draw. */
  startSorted(byDate: boolean): void {
    this.byDate = byDate;
  }

  /** Switches between name order and newest first, then redraws. */
  sortByDate(on: boolean, index: VaultIndex, current: string): void {
    this.byDate = on;
    this.builtFor = null;
    this.render(index, current);
  }

  private needsTimes(index: VaultIndex): boolean {
    if (!this.byDate || !this.fileTimes || this.times?.index === index) return false;
    if (this.timesLoading !== index) {
      this.timesLoading = index;
      const done = (seconds: Map<string, number>) => {
        this.times = { index, seconds };
        this.timesLoading = null;
        this.builtFor = null;
        this.render(index, this.lastCurrent);
      };
      this.fileTimes([...index.notes, ...index.bases]).then(done, () => done(new Map()));
    }
    return true;
  }

  /** Newest first, compared by the second so files written together in one checkout fall back to name order. */
  private noteOrder(index: VaultIndex): ((a: string, b: string) => number) | undefined {
    if (!this.byDate || this.times?.index !== index) return undefined;
    const { seconds } = this.times;
    return (a, b) => (seconds.get(b) ?? 0) - (seconds.get(a) ?? 0);
  }

  /** Opens one folder, for a note being dragged over it. */
  openFolder(path: string): void {
    if (this.opened.has(path)) return;
    this.setOpen(path, true);
    this.onChange();
  }

  isOpen(path: string): boolean {
    return this.opened.has(path);
  }

  /** Marks a note's row briefly, wherever it now sits, so a move can be seen to have landed. */
  markLanded(path: string): void {
    const row = this.notes.get(path);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    flashLanded(row);
  }

  toggle(path: string): void {
    this.setOpen(path, !this.opened.has(path));
    this.onChange();
  }

  collapseAll(): void {
    for (const path of [...this.opened]) this.setOpen(path, false);
    this.onChange();
  }

  /** Keeps a renamed folder, and the folders inside it, as open as they were. */
  folderRenamed(from: string, to: string): void {
    for (const path of [...this.opened]) {
      if (path !== from && !path.startsWith(`${from}/`)) continue;
      this.opened.delete(path);
      this.opened.add(to + path.slice(from.length));
    }
    this.onChange();
  }

  /** Opens a folder and its parents and moves focus to it. */
  focusFolder(path: string): void {
    instantly(this.box, () => {
      for (const folder of ancestors(`${path}/`)) this.setOpen(folder, true);
    });
    const head = this.folders.get(path)?.querySelector<HTMLElement>(".tree-head");
    head?.focus({ preventScroll: true });
    head?.scrollIntoView({ block: "nearest" });
    this.onChange();
  }

  private children(folder: TreeFolder, depth: number, index: VaultIndex): HTMLElement[] {
    return [
      ...folder.folders.map((f) => this.folderRow(f, depth, index)),
      ...folder.notes.map((p) => this.noteRow(p, depth, index)),
    ];
  }

  private folderRow(folder: TreeFolder, depth: number, index: VaultIndex): HTMLElement {
    const open = this.opened.has(folder.path);
    const indent = String(depth);

    const head = document.createElement("button");
    head.className = "tree-head";
    head.dataset.folder = folder.path;
    head.style.setProperty("--d", indent);
    head.setAttribute("aria-expanded", String(open));
    head.innerHTML = `${CHEVRON}${treeIcon(icons.folder)}<span class="tree-name"></span><span class="tree-count"></span>`;
    head.querySelector(".tree-name")!.textContent = folder.name;
    head.querySelector(".tree-count")!.textContent = folder.count.toLocaleString();
    head.dataset.tip = folder.name;

    const inner = document.createElement("div");
    inner.className = "tree-inner";
    inner.append(...this.children(folder, depth + 1, index));
    const body = document.createElement("div");
    body.className = "tree-body";
    body.style.setProperty("--d", indent);
    body.append(inner);

    const wrap = document.createElement("div");
    wrap.className = `tree-folder${open ? " is-open" : ""}`;
    wrap.append(head, body);
    this.folders.set(folder.path, wrap);
    return wrap;
  }

  private noteRow(path: string, depth: number, index: VaultIndex): HTMLElement {
    const title = index.title(path);
    const row = document.createElement("button");
    row.className = "nav-item";
    row.dataset.path = path;
    row.dataset.tip = title;
    row.style.setProperty("--d", String(depth));
    row.innerHTML = treeIcon(isBaseFile(path) ? icons.table : icons.note);
    const label = document.createElement("span");
    label.className = "nav-text";
    label.textContent = title;
    row.append(label);
    this.notes.set(path, row);
    return row;
  }

  private setOpen(path: string, open: boolean): void {
    const wrap = this.folders.get(path);
    if (!wrap) return;
    if (open) this.opened.add(path);
    else this.opened.delete(path);
    wrap.classList.toggle("is-open", open);
    wrap.querySelector(":scope > .tree-head")!.setAttribute("aria-expanded", String(open));
  }

  /** Marks the open note and, when the note has changed, opens its folders and brings it into view. */
  private reveal(path: string, bringIntoView = true): void {
    if (path === this.current) return;
    this.notes.get(this.current)?.classList.remove("is-current");
    this.current = path;
    const row = this.notes.get(path);
    if (!row) return;
    row.classList.add("is-current");
    this.expandTo(path, row, bringIntoView);
    this.onChange();
  }

  private expandTo(path: string, row: HTMLElement, bringIntoView: boolean): void {
    instantly(this.box, () => {
      for (const folder of ancestors(path)) this.setOpen(folder, true);
    });
    const view = this.box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (bringIntoView && (r.top < view.top + 36 || r.bottom > view.bottom - 28)) {
      this.box.scrollTop += r.top - view.top - view.height / 2 + r.height / 2;
    }
  }
}
