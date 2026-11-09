export interface RowAction {
  label: string;
  icon: string;
  run: () => void;
}

const ROWS = ".nav-item[data-path], .tree-head[data-folder]";
const NOTE_INSET = 4;
const FOLDER_INSET = 26;

/** One strip of buttons that follows the pointer over the file tree, so hundreds of rows carry no buttons of their own. */
export class RowActions {
  private readonly strip = document.createElement("div");
  private row: HTMLElement | null = null;

  constructor(
    private readonly tree: HTMLElement,
    private readonly actionsFor: (row: HTMLElement) => RowAction[],
  ) {
    const sidebar = tree.parentElement!;
    this.strip.className = "row-actions";
    this.strip.hidden = true;
    sidebar.append(this.strip);
    tree.addEventListener("mouseover", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(ROWS);
      if (row) this.show(row);
      else this.hide();
    });
    tree.addEventListener("scroll", () => this.hide(), { passive: true });
    sidebar.addEventListener("mouseleave", () => this.hide());
  }

  private show(row: HTMLElement): void {
    if (row === this.row && !this.strip.hidden) return;
    this.row = row;
    this.strip.replaceChildren(...this.actionsFor(row).map((action) => this.button(action)));
    const box = this.tree.parentElement!.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const inset = row.dataset.folder === undefined ? NOTE_INSET : FOLDER_INSET;
    this.strip.style.insetBlockStart = `${rect.top - box.top}px`;
    this.strip.style.insetInlineEnd = `${box.right - rect.right + inset}px`;
    this.strip.style.blockSize = `${rect.height}px`;
    this.strip.hidden = false;
  }

  private hide(): void {
    this.strip.hidden = true;
    this.row = null;
  }

  private button(action: RowAction): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row-action";
    button.innerHTML = action.icon;
    button.setAttribute("aria-label", action.label);
    button.dataset.tip = action.label;
    button.addEventListener("click", () => {
      this.hide();
      action.run();
    });
    return button;
  }
}
