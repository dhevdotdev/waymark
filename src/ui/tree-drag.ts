import type { FileTree } from "./file-tree";

const DRAG_START_PX = 5;
const OPEN_FOLDER_MS = 600;
const EDGE_PX = 28;
const EDGE_SPEED = 10;
/** A pointer passing near the edge on its way to a folder should not set the list moving. */
const EDGE_DELAY_MS = 250;

interface TreeDragHost {
  box: HTMLElement;
  tree: FileTree;
  folderOf: (path: string) => string;
  labelOf: (path: string) => string;
  drop: (path: string, folder: string) => void;
}

/** Dragging a note onto a folder in the file list. The list stays put: only the marks change until the drop. */
export class TreeDrag {
  private openTimer = 0;
  private scrollFrame = 0;

  constructor(private readonly host: TreeDragHost) {
    host.box.addEventListener("pointerdown", (e) => this.onDown(e));
  }

  private onDown(down: PointerEvent): void {
    const row = (down.target as HTMLElement).closest<HTMLElement>(".nav-item[data-path]");
    const interactive = (down.target as HTMLElement).closest(".row-actions, input");
    if (!row || interactive || down.button !== 0 || row.dataset.bookmark !== undefined) return;
    this.track(row, row.dataset.path!, down);
  }

  private folderUnder(x: number, y: number): string | null {
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!under || !this.host.box.contains(under)) return null;
    const head = under.closest<HTMLElement>(".tree-head[data-folder]");
    if (head) return head.dataset.folder!;
    const within = under.closest<HTMLElement>(".tree-folder")?.querySelector<HTMLElement>(":scope > .tree-head");
    return within?.dataset.folder ?? "";
  }

  private mark(folder: string | null, source: string): void {
    const { box } = this.host;
    box.querySelector(".is-drop-target")?.classList.remove("is-drop-target");
    box.querySelector(".tree")?.classList.remove("is-drop-root");
    if (folder === null || folder === this.host.folderOf(source)) return;
    if (folder === "") box.querySelector(".tree")?.classList.add("is-drop-root");
    else box.querySelector(`.tree-head[data-folder="${CSS.escape(folder)}"]`)?.classList.add("is-drop-target");
  }

  /** Opens a closed folder once the pointer has rested on it. */
  private watchFolder(folder: string | null, last: string | null): void {
    if (folder === last) return;
    clearTimeout(this.openTimer);
    if (folder && !this.host.tree.isOpen(folder)) {
      this.openTimer = window.setTimeout(() => this.host.tree.openFolder(folder), OPEN_FOLDER_MS);
    }
  }

  private scrollNearEdges(y: () => number): void {
    let enteredAt = 0;
    const step = (now: number) => {
      const { box } = this.host;
      const rect = box.getBoundingClientRect();
      const direction = y() < rect.top + EDGE_PX ? -1 : y() > rect.bottom - EDGE_PX ? 1 : 0;
      if (direction === 0) enteredAt = 0;
      else if (enteredAt === 0) enteredAt = now;
      else if (now - enteredAt > EDGE_DELAY_MS) box.scrollTop += direction * EDGE_SPEED;
      this.scrollFrame = requestAnimationFrame(step);
    };
    this.scrollFrame = requestAnimationFrame(step);
  }

  private chip(path: string): HTMLElement {
    const chip = document.createElement("div");
    chip.className = "tree-drag-chip";
    chip.textContent = this.host.labelOf(path);
    document.body.append(chip);
    return chip;
  }

  private track(row: HTMLElement, path: string, down: PointerEvent): void {
    const { box } = this.host;
    let chip: HTMLElement | null = null;
    let folder: string | null = null;
    let pointerY = down.clientY;
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(this.openTimer);
      cancelAnimationFrame(this.scrollFrame);
      chip?.remove();
      row.classList.remove("is-drag-source");
      box.classList.remove("is-dragging-note");
      this.mark(null, path);
    };
    const onMove = (e: PointerEvent) => {
      pointerY = e.clientY;
      if (!chip) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_START_PX) return;
        chip = this.chip(path);
        row.classList.add("is-drag-source");
        box.classList.add("is-dragging-note");
        this.scrollNearEdges(() => pointerY);
      }
      chip.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 8}px)`;
      const next = this.folderUnder(e.clientX, e.clientY);
      this.watchFolder(next, folder);
      folder = next;
      this.mark(folder, path);
    };
    const onUp = () => {
      const dragged = chip !== null;
      const target = folder;
      finish();
      if (!dragged) return;
      window.addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true });
      if (target !== null && target !== this.host.folderOf(path)) this.host.drop(path, target);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  }
}
