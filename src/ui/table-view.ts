import { isolateHistory, redo, undo } from "@codemirror/commands";
import { Annotation, type EditorState, type StateCommand } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertColumn, insertRow, moveColumn, moveRow, parseTable, setCell } from "../vault/markdown-table";
import { toast } from "./overlays";
import { actionForKey, gridTarget, type TableAction, type TableAt, type TableContext, type TableMode } from "./table-actions";
import { type ControlsHost, TableControls, type TargetKind } from "./table-controls";
import { caretOffset, lineChange, placeCaret } from "./table-dom";
import { reveal, snapshot } from "./table-feedback";

export interface TableEditorOptions {
  renderInline: (text: string) => DocumentFragment;
  openWikilink: (target: string, newTab: boolean) => void;
  frontmatterEnd: (state: EditorState) => number;
}

export interface TableRange {
  from: number;
  to: number;
}

export interface TableHost {
  options: TableEditorOptions;
  range: (view: EditorView, root: HTMLElement) => TableRange | null;
  showAsText: (view: EditorView, from: number) => void;
}

/** Marks the table's own edits, so the guard on text typed beside a table leaves them alone. */
export const tableWrite = Annotation.define<true>();

const HANG = 16;
let nextId = 0;

const linesOf = (state: EditorState, { from, to }: TableRange): string[] => state.sliceDoc(from, to).split(state.lineBreak);
const positionOf = (cell: HTMLElement): TableAt => ({ row: Number(cell.dataset.row), column: Number(cell.dataset.column) });
const openMenu = () => document.querySelector(".context-menu:not(.is-leaving)");
const menuHolds = (node: Node | null) => !!openMenu()?.contains(node);

const consume = (e: Event) => {
  e.preventDefault();
  e.stopPropagation();
};

/** Opens a paragraph beside a table at the very start or end of a note, where no line exists to put a caret on. */
export function writeBeside(view: EditorView, before: boolean): void {
  const { doc, lineBreak } = view.state;
  const gap = lineBreak + lineBreak;
  view.dispatch({
    changes: { from: before ? 0 : doc.length, insert: gap },
    selection: { anchor: before ? 0 : doc.length + gap.length },
    userEvent: "input",
    annotations: [tableWrite.of(true), isolateHistory.of("full")],
    scrollIntoView: true,
  });
  view.focus();
}

const tables = new WeakMap<HTMLElement, EditableTable>();

/** A rebuilt table fires pointer events under a pointer that has not moved. Only real movement may re-aim the handles. */
let lastPointer = "";
function pointerMoved(e: PointerEvent): boolean {
  const at = `${e.clientX},${e.clientY}`;
  if (at === lastPointer) return false;
  lastPointer = at;
  return true;
}

/** A table in the editor: each cell edits its own text in the file, and the DOM survives while the shape holds. */
export class EditableTable implements ControlsHost {
  readonly root = document.createElement("div");
  private readonly wrap = document.createElement("div");
  private readonly table: HTMLTableElement;
  private readonly live = document.createElement("div");
  private readonly controls: TableControls;
  private readonly observer: ResizeObserver;
  private lines: string[];
  private aim: TableAt | null = null;
  private at: TableAt | null = null;
  private mode: TableMode = "edit";
  private isolateNext = false;
  private savedCaret: number | null = null;

  constructor(
    private readonly view: EditorView,
    lines: string[],
    private readonly host: TableHost,
    noGapAbove: boolean,
    noGapBelow: boolean,
  ) {
    this.lines = lines;
    this.root.className = "cm-table-widget";
    this.root.classList.toggle("no-gap-above", noGapAbove);
    this.root.classList.toggle("no-gap-below", noGapBelow);
    this.wrap.className = "table-wrap";
    this.table = this.buildTable();
    this.wrap.append(this.table);
    this.live.className = "cm-table-live";
    this.live.setAttribute("role", "status");
    this.controls = new TableControls(this);
    this.root.append(this.wrap, ...this.controls.all, this.live);
    this.bind();
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(this.root);
    tables.set(this.root, this);
  }

  static of(dom: HTMLElement): EditableTable | undefined {
    return tables.get(dom);
  }

  /** The table whose widget starts at `from`, after the editor has drawn it. */
  static find(view: EditorView, from: number): EditableTable | null {
    for (const dom of view.dom.querySelectorAll<HTMLElement>(".cm-table-widget")) {
      if (view.posAtDOM(dom) === from) return tables.get(dom) ?? null;
    }
    return null;
  }

  destroy(): void {
    this.observer.disconnect();
  }

  private get rowCount(): number {
    return this.table.rows.length;
  }

  private get columnCount(): number {
    return this.table.rows[0].cells.length;
  }

  private cells(): HTMLElement[] {
    return [...this.table.querySelectorAll<HTMLElement>("th, td")];
  }

  private cell({ row, column }: TableAt): HTMLElement | null {
    return this.table.querySelector(`[data-row="${row}"][data-column="${column}"]`);
  }

  private render(text: string): DocumentFragment {
    return this.host.options.renderInline(text);
  }

  private buildTable(): HTMLTableElement {
    const { rows, align } = parseTable(this.lines);
    const id = `cm-table-${nextId++}`;
    const table = document.createElement("table");
    table.setAttribute("role", "grid");
    table.setAttribute("aria-label", "Table");
    table.setAttribute("aria-rowcount", String(rows.length));
    table.setAttribute("aria-colcount", String(rows[0].length));
    const head = table.createTHead();
    const body = table.createTBody();
    rows.forEach((cells, row) => {
      const tr = (row === 0 ? head : body).insertRow();
      tr.setAttribute("aria-rowindex", String(row + 1));
      cells.forEach((text, column) => {
        const cell = document.createElement(row === 0 ? "th" : "td");
        cell.setAttribute("contenteditable", "plaintext-only");
        cell.setAttribute("role", row === 0 ? "columnheader" : "gridcell");
        cell.setAttribute("aria-colindex", String(column + 1));
        if (row === 0) {
          cell.id = `${id}-${column}`;
          cell.setAttribute("scope", "col");
        } else {
          cell.setAttribute("headers", `${id}-${column}`);
        }
        cell.dataset.row = String(row);
        cell.dataset.column = String(column);
        cell.dataset.source = text;
        if (align[column]) cell.style.textAlign = align[column];
        cell.append(this.render(text));
        tr.append(cell);
      });
    });
    return table;
  }

  /** Takes on a new version of the table if its shape still fits. */
  sync(lines: string[]): boolean {
    const { rows, align } = parseTable(lines);
    if (rows.length !== this.rowCount || rows[0].length !== this.columnCount) return false;
    this.lines = lines;
    for (const cell of this.cells()) {
      const { row, column } = positionOf(cell);
      const text = rows[row][column];
      cell.style.textAlign = align[column];
      const active = cell === document.activeElement;
      /* The file trims a cell, but the space just typed at its end must stay on screen for the next word. */
      if (active && this.mode === "edit" && (cell.textContent ?? "").trim() === text) continue;
      if (cell.dataset.source === text) continue;
      cell.dataset.source = text;
      this.present(cell, active);
    }
    return true;
  }

  private present(cell: HTMLElement, active: boolean): void {
    const source = cell.dataset.source ?? "";
    if (active && this.mode === "edit") {
      cell.textContent = source;
      placeCaret(cell, "end");
    } else {
      cell.replaceChildren(this.render(source));
    }
  }

  context(at: TableAt): TableContext {
    return { at, rows: this.rowCount, columns: this.columnCount, align: parseTable(this.lines).align };
  }

  aimed(): TableAt | null {
    return this.aim;
  }

  private say(text: string): void {
    this.live.textContent = text;
  }

  private describe(at: TableAt): string {
    const header = this.cell({ row: 0, column: at.column })?.dataset.source || `Column ${at.column + 1}`;
    const value = this.cell(at)?.dataset.source || "empty";
    return `${header}, row ${at.row + 1} of ${this.rowCount}, column ${at.column + 1} of ${this.columnCount}: ${value}`;
  }

  focusCell(at: TableAt, mode: TableMode = "edit"): void {
    const cell = this.cell(at);
    if (!cell) return;
    this.mode = mode;
    if (document.activeElement === cell) this.enter(cell);
    else cell.focus({ preventScroll: true });
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private enter(cell: HTMLElement): void {
    this.root.classList.toggle("is-grid", this.mode === "grid");
    if (this.mode === "edit") {
      cell.textContent = cell.dataset.source ?? "";
      placeCaret(cell, this.savedCaret ?? "end");
      this.savedCaret = null;
    } else {
      cell.replaceChildren(this.render(cell.dataset.source ?? ""));
      getSelection()?.removeAllRanges();
    }
  }

  private go(to: TableAt, mode: TableMode): void {
    this.focusCell(to, mode);
    this.say(this.describe(to));
  }

  private aimAt(at: TableAt): void {
    this.aim = at;
    this.root.classList.add("has-handles");
    this.layout();
  }

  /** Keeps a table that is too wide for the column scrolling inside its own box, and clear of the handles. */
  private layout(): void {
    const overflowing = this.root.classList.contains("is-overflowing");
    const needed = this.table.getBoundingClientRect().width - (overflowing ? 0 : HANG * 2);
    this.root.classList.toggle("is-overflowing", needed > this.root.clientWidth + 1);
    this.placeHandles();
  }

  private placeHandles(): void {
    if (!this.aim) return;
    const cell = this.cell(this.aim);
    if (!cell) return;
    const box = this.root.getBoundingClientRect();
    const view = this.wrap.getBoundingClientRect();
    const row = (cell.parentElement as HTMLElement).getBoundingClientRect();
    const column = cell.getBoundingClientRect();
    const left = Math.max(column.left, view.left);
    const right = Math.min(column.right, view.right);
    this.controls.rowGrip.style.insetBlockStart = `${row.top - box.top}px`;
    this.controls.rowGrip.style.blockSize = `${row.height}px`;
    this.controls.columnGrip.style.insetInlineStart = `${left - box.left}px`;
    this.controls.columnGrip.style.inlineSize = `${Math.max(0, right - left)}px`;
    this.controls.columnGrip.hidden = right - left < 24;
    this.controls.rowGrip.setAttribute("aria-label", `Row ${this.aim.row + 1} actions`);
    this.controls.columnGrip.setAttribute("aria-label", `Column ${this.aim.column + 1} actions`);
  }

  /** Holds the columns at their width for as long as the table is being edited, so typing never slides them. */
  private freeze(): void {
    if (this.table.style.tableLayout === "fixed") return;
    const widths = [...this.table.querySelectorAll("th")].map((head) => head.getBoundingClientRect().width);
    const columns = document.createElement("colgroup");
    for (const width of widths) {
      const column = document.createElement("col");
      column.style.width = `${width}px`;
      columns.append(column);
    }
    this.table.prepend(columns);
    this.table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    this.table.style.tableLayout = "fixed";
  }

  private release(): void {
    this.table.querySelector("colgroup")?.remove();
    this.table.style.width = "";
    this.table.style.tableLayout = "";
  }

  private write(change: (lines: string[]) => string[], userEvent: string, isolate?: "full" | "before"): boolean {
    const range = this.host.range(this.view, this.root);
    if (!range || this.view.state.readOnly) return false;
    const before = linesOf(this.view.state, range);
    const after = change(before);
    if (after === before || after.join("\n") === before.join("\n")) return false;
    const annotations = [tableWrite.of(true), ...(isolate ? [isolateHistory.of(isolate)] : [])];
    const changes = lineChange(this.view.state.doc, this.view.state.lineBreak, range.from, before, after);
    this.view.dispatch({ changes, userEvent, annotations });
    return true;
  }

  /** Runs a structural change as one undo step, puts the cursor in the right cell and shows what happened. */
  private apply(edit: (lines: string[]) => string[], lands: TableAt, pointer: boolean, spoken: string): void {
    const range = this.host.range(this.view, this.root);
    if (!range) return;
    if (this.view.state.readOnly) {
      this.refuse("This note can't be edited right now");
      return;
    }
    const mode = this.mode;
    const before = snapshot(this.root, this.lines);
    if (!this.write(edit, "input", "full")) return;
    const table = EditableTable.find(this.view, range.from) ?? this;
    table.focusCell(lands, mode);
    table.say(`${spoken}. ${table.describe(lands)}`);
    reveal(table.root, before, table.lines, lands, pointer);
  }

  private refuse(reason: string): void {
    toast(reason);
  }

  perform(action: TableAction, at: TableAt, pointer: boolean): void {
    const context = this.context(at);
    const reason = action.blocked?.(context);
    if (reason) this.refuse(reason);
    else this.apply((lines) => action.edit(lines, context), action.lands(context), pointer, action.label);
  }

  addRow(pointer = true): void {
    const last = this.rowCount - 1;
    this.apply((lines) => insertRow(lines, last), { row: last + 1, column: 0 }, pointer, "Row added");
  }

  addColumn(): void {
    const last = this.columnCount - 1;
    this.apply((lines) => insertColumn(lines, last), { row: 0, column: last + 1 }, true, "Column added");
  }

  move(kind: TargetKind, from: number, to: number): void {
    const at = this.aim ?? { row: 0, column: 0 };
    if (kind === "row") this.apply((lines) => moveRow(lines, from, to), { row: to, column: at.column }, true, "Row moved");
    else this.apply((lines) => moveColumn(lines, from, to), { row: at.row, column: to }, true, "Column moved");
  }

  editAsMarkdown(): void {
    const range = this.host.range(this.view, this.root);
    if (range) this.host.showAsText(this.view, range.from);
  }

  deleteTable(): void {
    const range = this.host.range(this.view, this.root);
    if (!range) return;
    const { doc } = this.view.state;
    const next = range.to < doc.length ? doc.lineAt(range.to + 1) : null;
    const to = next && !next.text.trim() ? Math.min(doc.length, next.to + 1) : range.to;
    this.view.dispatch({
      changes: { from: range.from, to },
      selection: { anchor: range.from },
      userEvent: "delete",
      annotations: [tableWrite.of(true), isolateHistory.of("full")],
    });
    this.view.focus();
    toast("Table deleted. Undo brings it back.");
  }

  focusBack(): void {
    this.focusCell(this.at ?? this.aim ?? { row: 0, column: 0 }, "grid");
  }

  /** Goes to the text beside the table. At the edge of a note only a deliberate move makes a line to go to. */
  leave(before = false, deliberate = false): void {
    const range = this.host.range(this.view, this.root);
    if (!range) return;
    const { doc } = this.view.state;
    if (before ? range.from === 0 : range.to === doc.length) {
      if (deliberate) writeBeside(this.view, before);
      else
        toast(
          before
            ? "This table starts the note. Press ↑ to write above it."
            : "This table ends the note. Press ↓ to write below it.",
        );
      return;
    }
    this.view.dispatch({ selection: { anchor: before ? range.from - 1 : range.to + 1 } });
    this.view.focus();
  }

  private history(command: StateCommand): void {
    const range = this.host.range(this.view, this.root);
    const at = this.at;
    const mode = this.mode;
    const before = snapshot(this.root, this.lines);
    if (!command(this.view) || !range) return;
    const table = EditableTable.find(this.view, range.from);
    if (!table) {
      this.view.focus();
      return;
    }
    const lands = at && { row: Math.min(at.row, table.rowCount - 1), column: Math.min(at.column, table.columnCount - 1) };
    if (lands && document.activeElement !== table.cell(lands)) table.focusCell(lands, mode);
    reveal(table.root, before, table.lines, lands, false);
  }

  private toGrid(cell: HTMLElement): void {
    this.mode = "grid";
    this.enter(cell);
    this.say(`Cell selected. ${this.describe(positionOf(cell))}. Arrows move, Enter edits.`);
  }

  private toEdit(cell: HTMLElement): void {
    this.mode = "edit";
    this.enter(cell);
  }

  private onKey(cell: HTMLElement, e: KeyboardEvent): void {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    const action = actionForKey(e);
    if (action) {
      consume(e);
      this.perform(action, positionOf(cell), false);
    } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey) || (mod && e.key === ".")) {
      consume(e);
      if (this.mode === "edit") this.savedCaret = caretOffset(cell);
      this.controls.openForCell(positionOf(cell), true);
    } else if (mod && e.key.toLowerCase() === "z") {
      consume(e);
      this.history(e.shiftKey ? redo : undo);
    } else if (this.mode === "grid") {
      this.gridKey(cell, e);
    } else {
      this.editKey(cell, e);
    }
  }

  private gridKey(cell: HTMLElement, e: KeyboardEvent): void {
    const at = positionOf(cell);
    const target = gridTarget(at, this.rowCount, this.columnCount, e);
    if (target) {
      consume(e);
      this.go(target, "grid");
    } else if (e.key === "Enter" || e.key === "F2") {
      consume(e);
      this.toEdit(cell);
    } else if (e.key === "Escape") {
      consume(e);
      this.leave();
    } else if (e.key === "Tab") {
      consume(e);
      if (e.shiftKey) this.leave(true);
      else this.controls.all[0].focus();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      consume(e);
      this.write((lines) => setCell(lines, at.row, at.column, ""), "delete", "full");
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.toEdit(cell);
    }
  }

  private tabFrom(at: TableAt, back: boolean): void {
    const index = at.row * this.columnCount + at.column + (back ? -1 : 1);
    if (index >= this.rowCount * this.columnCount) this.addRow(false);
    else if (index >= 0) this.go({ row: Math.floor(index / this.columnCount), column: index % this.columnCount }, "edit");
  }

  private verticalFrom(at: TableAt, e: KeyboardEvent): void {
    const down = e.key === "ArrowDown";
    if (down ? at.row + 1 < this.rowCount : at.row > 0) this.go({ row: at.row + (down ? 1 : -1), column: at.column }, "edit");
    else this.leave(!down, true);
  }

  private enterFrom(at: TableAt, back: boolean): void {
    if (back) {
      if (at.row > 0) this.go({ row: at.row - 1, column: at.column }, "edit");
    } else if (at.row + 1 < this.rowCount) {
      this.go({ row: at.row + 1, column: at.column }, "edit");
    } else {
      this.apply((lines) => insertRow(lines, at.row), { row: at.row + 1, column: at.column }, false, "Row added");
    }
  }

  /** Left and right cross into the next cell only from the very edge of the text. */
  private horizontalFrom(cell: HTMLElement, at: TableAt, e: KeyboardEvent): boolean {
    const offset = caretOffset(cell);
    const left = e.key === "ArrowLeft";
    if (offset !== (left ? 0 : (cell.textContent ?? "").length)) return false;
    const index = at.row * this.columnCount + at.column + (left ? -1 : 1);
    if (index < 0 || index >= this.rowCount * this.columnCount) return true;
    const to = { row: Math.floor(index / this.columnCount), column: index % this.columnCount };
    this.focusCell(to, "edit");
    if (!left) placeCaret(this.cell(to)!, "start");
    this.say(this.describe(to));
    return true;
  }

  private editKey(cell: HTMLElement, e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    const at = positionOf(cell);
    if (mod && (e.key === "b" || e.key === "i")) {
      consume(e);
      const marker = e.key === "b" ? "**" : "*";
      document.execCommand("insertText", false, `${marker}${getSelection()?.toString() ?? ""}${marker}`);
    } else if (e.key === "Escape" || e.key === "F2") {
      consume(e);
      this.toGrid(cell);
    } else if (mod || e.altKey) {
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) consume(e);
    } else if (e.key === "Tab") {
      consume(e);
      this.tabFrom(at, e.shiftKey);
    } else if (e.key === "Enter") {
      consume(e);
      this.enterFrom(at, e.shiftKey);
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey) {
      consume(e);
      this.verticalFrom(at, e);
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && this.horizontalFrom(cell, at, e)) {
      consume(e);
    }
  }

  private openOnClick(cell: HTMLElement, e: MouseEvent): void {
    const link = (e.target as HTMLElement).closest<HTMLElement>("a.wikilink");
    if (e.metaKey && link?.dataset.path) {
      e.preventDefault();
      this.host.options.openWikilink(link.dataset.path.replace(/\.md$/i, ""), e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (cell === document.activeElement) {
      if (this.mode === "grid") this.toEdit(cell);
      return;
    }
    e.preventDefault();
    this.mode = "edit";
    cell.focus({ preventScroll: true });
    const at = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (at && cell.contains(at.startContainer)) {
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(at);
    }
  }

  private onFocusIn(e: Event): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("th, td");
    if (!cell) {
      if (!this.aim) this.aimAt(this.at ?? { row: 0, column: 0 });
      this.root.classList.add("has-handles");
      return;
    }
    this.at = positionOf(cell);
    this.isolateNext = true;
    this.freeze();
    this.enter(cell);
    this.aimAt(this.at);
  }

  private onFocusOut(e: FocusEvent): void {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("th, td");
    if (cell) cell.replaceChildren(this.render(cell.dataset.source ?? ""));
    const next = e.relatedTarget as Node | null;
    if (this.root.contains(next) || menuHolds(next)) return;
    this.release();
    this.mode = "edit";
    this.root.classList.remove("is-grid");
    if (!this.root.matches(":hover")) this.root.classList.remove("has-handles");
  }

  private onInput(cell: HTMLElement): void {
    const text = (cell.textContent ?? "").replace(/ /g, " ");
    if (!text) cell.replaceChildren();
    const { row, column } = positionOf(cell);
    cell.dataset.source = text;
    this.write((lines) => setCell(lines, row, column, text), "input.type", this.isolateNext ? "before" : undefined);
    this.isolateNext = false;
    this.layout();
  }

  private bind(): void {
    const root = this.root;
    const cellOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("th, td");
    root.addEventListener("mousedown", (e) => {
      const cell = cellOf(e);
      if (cell) this.openOnClick(cell, e);
    });
    root.addEventListener("contextmenu", (e) => {
      const cell = cellOf(e);
      if (!cell) return;
      e.preventDefault();
      this.controls.openForCell(positionOf(cell), false, e.clientX);
    });
    /* However a cell gets focus, it must show its Markdown before anything is typed, or typing would flatten the markup. */
    root.addEventListener("focusin", (e) => this.onFocusIn(e));
    root.addEventListener("focusout", (e) => this.onFocusOut(e));
    root.addEventListener("pointerover", (e) => {
      const cell = cellOf(e);
      if (cell && pointerMoved(e) && !openMenu() && !root.classList.contains("is-dragging")) this.aimAt(positionOf(cell));
    });
    root.addEventListener("pointerleave", () => {
      if (!root.contains(document.activeElement) && !openMenu()) root.classList.remove("has-handles");
    });
    this.wrap.addEventListener("scroll", () => this.placeHandles());
    root.addEventListener("keydown", (e) => {
      const cell = cellOf(e);
      if (cell) this.onKey(cell, e);
    });
    root.addEventListener("beforeinput", (e) => {
      if (this.view.state.readOnly || e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") e.preventDefault();
    });
    root.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain").replace(/\s*\r?\n\s*/g, " ") ?? "";
      document.execCommand("insertText", false, text);
    });
    root.addEventListener("input", (e) => {
      const cell = cellOf(e);
      if (cell) this.onInput(cell);
    });
  }
}
