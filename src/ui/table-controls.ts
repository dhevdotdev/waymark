import { type MenuItem, showContextMenu } from "./context-menu";
import { icons } from "./icons";
import { trackPointerDrag } from "./pointer-drag";
import { TABLE_ACTIONS, type TableAction, type TableAt, type TableContext } from "./table-actions";

const MENU_GAP = 4;

export type TargetKind = "row" | "column";

/** What the table's controls need from the table they sit on. */
export interface ControlsHost {
  root: HTMLElement;
  aimed(): TableAt | null;
  context(at: TableAt): TableContext;
  perform(action: TableAction, at: TableAt, pointer: boolean): void;
  addRow(): void;
  addColumn(): void;
  move(kind: TargetKind, from: number, to: number): void;
  editAsMarkdown(): void;
  deleteTable(): void;
  focusBack(): void;
  leave(): void;
}

/** Below the row if it fits, above it if not. */
function besideRow(row: DOMRect, x: number) {
  return (_width: number, height: number) => {
    const below = row.bottom + MENU_GAP;
    if (below + height <= innerHeight - MENU_GAP) return [x, below, "left top"] as const;
    return [x, Math.max(MENU_GAP, row.top - height - MENU_GAP), "left bottom"] as const;
  };
}

/** Right of the column if it fits, then left of it, then under the table. */
function besideColumn(column: { left: number; right: number; top: number; bottom: number }) {
  return (width: number) => {
    if (column.right + MENU_GAP + width <= innerWidth - MENU_GAP)
      return [column.right + MENU_GAP, column.top, "left top"] as const;
    if (column.left - MENU_GAP - width >= MENU_GAP) return [column.left - MENU_GAP - width, column.top, "right top"] as const;
    return [column.left, column.bottom + MENU_GAP, "left top"] as const;
  };
}

/** The handles and add bars around a table. They float over the page, so nothing moves when they appear. */
export class TableControls {
  readonly rowGrip: HTMLButtonElement;
  readonly columnGrip: HTMLButtonElement;
  readonly tableGrip: HTMLButtonElement;
  readonly addRow: HTMLButtonElement;
  readonly addColumn: HTMLButtonElement;

  constructor(private readonly host: ControlsHost) {
    this.rowGrip = this.button("cm-table-grip is-row", icons.grip, "Row actions", () => this.openFromHandle("row"));
    this.columnGrip = this.button("cm-table-grip is-column", icons.gripWide, "Column actions", () =>
      this.openFromHandle("column"),
    );
    this.tableGrip = this.button("cm-table-grip is-table", icons.more, "Table actions", () => this.openTableMenu());
    this.tableGrip.addEventListener("pointerenter", () => this.highlightTable());
    this.tableGrip.addEventListener("pointerleave", () => {
      if (!document.querySelector(".context-menu:not(.is-leaving)")) this.clearHighlight();
    });
    this.addRow = this.button("cm-table-add is-row", icons.plus, "Add row", () => host.addRow(), "Add row");
    this.addColumn = this.button("cm-table-add is-column", icons.plus, "Add column", () => host.addColumn());
    this.bindDrag(this.rowGrip, "row");
    this.bindDrag(this.columnGrip, "column");
    this.bindTarget(this.rowGrip, "row");
    this.bindTarget(this.columnGrip, "column");
  }

  get all(): HTMLElement[] {
    return [this.rowGrip, this.columnGrip, this.tableGrip, this.addRow, this.addColumn];
  }

  private button(className: string, icon: string, label: string, run: () => void, text?: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.innerHTML = icon;
    if (text) {
      const name = document.createElement("span");
      name.textContent = text;
      button.append(name);
    }
    button.setAttribute("aria-label", label);
    button.dataset.tip = label;
    button.dataset.tipSide = "above";
    button.addEventListener("mousedown", (e) => e.preventDefault());
    button.addEventListener("click", run);
    button.addEventListener("keydown", (e) => this.onKey(button, e));
    return button;
  }

  private onKey(button: HTMLElement, e: KeyboardEvent): void {
    const at = this.all.indexOf(button);
    if (e.key === "Escape" || (e.key === "Tab" && e.shiftKey && at === 0)) {
      e.preventDefault();
      e.stopPropagation();
      this.host.focusBack();
    } else if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const next = this.all[at + (e.shiftKey ? -1 : 1)];
      if (next) next.focus();
      else this.host.leave();
    }
  }

  private bindTarget(grip: HTMLElement, kind: TargetKind): void {
    grip.addEventListener("pointerenter", () => this.highlight(kind));
    grip.addEventListener("pointerleave", (e) => {
      if (grip.hasPointerCapture(e.pointerId)) return;
      if (!document.querySelector(".context-menu:not(.is-leaving)") && !this.host.root.classList.contains("is-dragging"))
        this.clearHighlight();
    });
  }

  highlight(kind: TargetKind): void {
    const at = this.host.aimed();
    if (at) this.highlightIndex(kind, kind === "row" ? at.row : at.column);
  }

  private highlightIndex(kind: TargetKind, index: number): void {
    this.clearHighlight();
    const name = kind === "row" ? "row" : "column";
    for (const cell of this.host.root.querySelectorAll<HTMLElement>(`[data-${name}="${index}"]`))
      cell.classList.add("is-acted-on");
  }

  private highlightTable(): void {
    for (const cell of this.host.root.querySelectorAll("th, td")) cell.classList.add("is-acted-on");
  }

  clearHighlight(): void {
    for (const cell of this.host.root.querySelectorAll(".is-acted-on")) cell.classList.remove("is-acted-on");
  }

  private menuItem(action: TableAction, at: TableAt, keyboard: boolean): MenuItem {
    const context = this.host.context(at);
    return {
      label: action.label,
      hint: action.hint,
      danger: action.danger,
      startsGroup: action.startsGroup,
      checked: action.checked?.(context),
      blocked: action.blocked?.(context) ?? null,
      run: () => this.host.perform(action, at, !keyboard),
    };
  }

  private tableItems(startsGroup: boolean): MenuItem[] {
    return [
      { label: "Edit as Markdown", startsGroup, run: () => this.host.editAsMarkdown() },
      { label: "Delete table", danger: true, run: () => this.host.deleteTable() },
    ];
  }

  private items(scope: "row" | "column" | "cell", at: TableAt, keyboard: boolean): MenuItem[] {
    const actions = TABLE_ACTIONS.filter((action) => scope === "cell" || action.scope === scope);
    return [...actions.map((action) => this.menuItem(action, at, keyboard)), ...this.tableItems(true)];
  }

  private cellOf(at: TableAt): HTMLElement | null {
    return this.host.root.querySelector(`[data-row="${at.row}"][data-column="${at.column}"]`);
  }

  private columnBox(at: TableAt) {
    const cell = this.cellOf(at)!.getBoundingClientRect();
    const table = this.host.root.querySelector("table")!.getBoundingClientRect();
    return { left: cell.left, right: cell.right, top: table.top, bottom: table.bottom };
  }

  private openFromHandle(kind: TargetKind): void {
    const at = this.host.aimed();
    if (!at) return;
    const keyboard = document.activeElement === (kind === "row" ? this.rowGrip : this.columnGrip);
    this.highlight(kind);
    const cell = this.cellOf(at)!;
    const place =
      kind === "row"
        ? besideRow((cell.parentElement as HTMLElement).getBoundingClientRect(), this.rowGrip.getBoundingClientRect().left)
        : besideColumn(this.columnBox(at));
    showContextMenu(0, 0, this.items(kind, at, keyboard), { place, keyboard, onClose: () => this.clearHighlight() });
  }

  private openTableMenu(): void {
    this.highlightTable();
    const table = this.host.root.querySelector("table")!.getBoundingClientRect();
    const left = this.tableGrip.getBoundingClientRect().left;
    const keyboard = document.activeElement === this.tableGrip;
    showContextMenu(0, 0, this.tableItems(false), {
      place: besideRow(table, left),
      keyboard,
      onClose: () => this.clearHighlight(),
    });
  }

  /** The whole set of actions for one cell, opened from the keyboard or a right-click. */
  openForCell(at: TableAt, keyboard: boolean, pointerX?: number): void {
    const cell = this.cellOf(at);
    if (!cell) return;
    const row = (cell.parentElement as HTMLElement).getBoundingClientRect();
    const place = besideRow(row, pointerX ?? cell.getBoundingClientRect().left);
    showContextMenu(0, 0, this.items("cell", at, keyboard), { place, keyboard });
  }

  private bindDrag(grip: HTMLElement, kind: TargetKind): void {
    grip.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      const at = this.host.aimed();
      if (!at) return;
      this.trackDrag(grip, kind, kind === "row" ? at.row : at.column, down);
    });
  }

  private boundaries(kind: TargetKind): DOMRect[] {
    const root = this.host.root;
    return kind === "row"
      ? [...root.querySelectorAll("tr")].map((row) => row.getBoundingClientRect())
      : [...root.querySelectorAll("th")].map((head) => head.getBoundingClientRect());
  }

  private dropIndex(kind: TargetKind, boxes: DOMRect[], e: PointerEvent): number {
    const position = kind === "row" ? e.clientY : e.clientX;
    const index = boxes.findIndex((box) => position < (kind === "row" ? box.top + box.height / 2 : box.left + box.width / 2));
    return index < 0 ? boxes.length : index;
  }

  private showDrop(line: HTMLElement, kind: TargetKind, boxes: DOMRect[], boundary: number): void {
    const root = this.host.root.getBoundingClientRect();
    const box = boxes[Math.min(boundary, boxes.length - 1)];
    const atEnd = boundary >= boxes.length;
    if (kind === "row") {
      line.style.insetBlockStart = `${(atEnd ? box.bottom : box.top) - root.top - 1}px`;
    } else {
      line.style.insetInlineStart = `${(atEnd ? box.right : box.left) - root.left - 1}px`;
    }
  }

  private trackDrag(grip: HTMLElement, kind: TargetKind, from: number, down: PointerEvent): void {
    const root = this.host.root;
    const line = document.createElement("div");
    line.className = `cm-table-drop is-${kind}`;
    let boxes: DOMRect[] = [];
    let boundary = from;
    grip.setPointerCapture?.(down.pointerId);
    trackPointerDrag(down, {
      start: () => {
        boxes = this.boundaries(kind);
        root.classList.add("is-dragging");
        root.append(line);
        this.highlightIndex(kind, from);
      },
      move: (e) => {
        boundary = this.dropIndex(kind, boxes, e);
        this.showDrop(line, kind, boxes, boundary);
      },
      finish: () => {
        line.remove();
        root.classList.remove("is-dragging");
        this.clearHighlight();
      },
      drop: () => {
        const to = boundary > from ? boundary - 1 : boundary;
        if (to !== from) this.host.move(kind, from, to);
      },
    });
  }
}
