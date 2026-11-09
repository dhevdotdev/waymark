import { isBaseFile, type VaultIndex } from "../vault/index";
import { ancestors, buildTree, type TreeFolder } from "../vault/tree";
import { icons } from "./icons";

const CHEVRON = `<svg class="tree-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`;
const treeIcon = (svg: string) => svg.replace("<svg", '<svg class="tree-icon"');

/** The folder tree in the sidebar. Rows are built once per index and updated in place. */
export class FileTree {
  private readonly folders = new Map<string, HTMLElement>();
  private readonly notes = new Map<string, HTMLElement>();
  private builtFor: VaultIndex | null = null;
  private current = "";
  /** Shown above the folders. */
  leading: HTMLElement | null = null;

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
    if (this.builtFor !== index || !this.box.querySelector(".tree")) {
      this.folders.clear();
      this.notes.clear();
      const tree = document.createElement("div");
      tree.className = "tree";
      if (this.leading) tree.append(this.leading);
      tree.append(...this.children(buildTree([...index.notes, ...index.bases]), 0, index));
      const keep = this.box.scrollTop;
      this.box.replaceChildren(tree);
      this.box.scrollTop = keep;
      this.builtFor = index;
      this.current = "";
    }
    this.reveal(current);
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
    for (const folder of ancestors(`${path}/`)) this.setOpen(folder, true);
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
    const section = depth === 0;
    const indent = String(Math.max(0, depth - 1));

    const head = document.createElement("button");
    head.className = "tree-head";
    head.classList.toggle("is-section", section);
    head.dataset.folder = folder.path;
    head.style.setProperty("--d", indent);
    head.setAttribute("aria-expanded", String(open));
    head.innerHTML = section
      ? `<span class="tree-name"></span>${CHEVRON}<span class="tree-count"></span>`
      : `${CHEVRON}${treeIcon(icons.folder)}<span class="tree-name"></span><span class="tree-count"></span>`;
    head.querySelector(".tree-name")!.textContent = folder.name;
    head.querySelector(".tree-count")!.textContent = folder.count.toLocaleString();
    head.dataset.tip = folder.name;

    const inner = document.createElement("div");
    inner.className = "tree-inner";
    inner.append(...this.children(folder, depth + 1, index));
    const body = document.createElement("div");
    body.className = "tree-body";
    body.classList.toggle("is-top", section);
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
    row.style.setProperty("--d", String(Math.max(0, depth - 1)));
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
  private reveal(path: string): void {
    if (path === this.current) return;
    this.notes.get(this.current)?.classList.remove("is-current");
    this.current = path;
    const row = this.notes.get(path);
    if (!row) return;
    row.classList.add("is-current");
    this.expandTo(path, row);
    this.onChange();
  }

  private expandTo(path: string, row: HTMLElement): void {
    const tree = this.box.querySelector(".tree")!;
    tree.classList.add("is-instant");
    for (const folder of ancestors(path)) this.setOpen(folder, true);
    void this.box.offsetHeight;
    tree.classList.remove("is-instant");
    const view = this.box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < view.top + 36 || r.bottom > view.bottom - 28) {
      this.box.scrollTop += r.top - view.top - view.height / 2 + r.height / 2;
    }
  }
}
