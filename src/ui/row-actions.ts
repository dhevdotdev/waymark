export interface RowAction {
  label: string;
  icon: string;
  run: (button: HTMLElement) => void;
}

const ROWS = ".nav-item[data-path], .tree-head[data-folder]";
const INSET = 3;

/** The buttons on the file tree row under the pointer or keyboard, kept as one set so hundreds of rows carry none of their own. */
export class RowActions {
  private readonly strip = document.createElement("div");
  private row: HTMLElement | null = null;
  private pinned = false;

  constructor(
    tree: HTMLElement,
    private readonly actionsFor: (row: HTMLElement) => RowAction[],
  ) {
    this.strip.className = "row-actions";
    this.strip.hidden = true;
    tree.addEventListener("mouseover", (e) => this.onPointer(e.target as HTMLElement));
    tree.addEventListener("focusin", (e) => this.onFocus(e.target as HTMLElement));
    tree.addEventListener("focusout", (e) => {
      if (!this.strip.contains(e.relatedTarget as Node | null)) this.hide();
    });
    tree.addEventListener("scroll", () => this.hide(), { passive: true });
    tree.parentElement!.addEventListener("mouseleave", () => this.hide());
  }

  /** Keeps the row marked while a menu opened from it is showing. */
  pin(): void {
    this.pinned = true;
  }

  release(): void {
    this.pinned = false;
    this.hide();
  }

  private onPointer(target: HTMLElement): void {
    if (this.pinned || this.strip.contains(target)) return;
    const row = target.closest<HTMLElement>(ROWS);
    if (row) this.show(row);
    else this.hide();
  }

  private onFocus(target: HTMLElement): void {
    if (!this.pinned && target.matches(ROWS) && target.matches(":focus-visible")) this.show(target);
  }

  private show(row: HTMLElement): void {
    if (row === this.row && !this.strip.hidden) return;
    this.row?.classList.remove("has-actions");
    this.row = row;
    row.classList.add("has-actions");
    this.strip.replaceChildren(...this.actionsFor(row).map((action) => this.button(action)));
    row.after(this.strip);
    this.strip.hidden = false;
    const box = this.strip.offsetParent!.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    this.strip.style.insetBlockStart = `${rect.top - box.top}px`;
    this.strip.style.insetInlineEnd = `${box.right - rect.right + INSET}px`;
    this.strip.style.blockSize = `${rect.height}px`;
  }

  private hide(): void {
    if (this.pinned) return;
    this.strip.hidden = true;
    this.row?.classList.remove("has-actions");
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
      action.run(button);
      this.hide();
    });
    return button;
  }
}
