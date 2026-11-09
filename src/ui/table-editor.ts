import { redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { deleteColumn, deleteRow, insertColumn, insertRow, parseTable, setAlignment, setCell } from "../vault/markdown-table";
import { type MenuItem, showContextMenu } from "./context-menu";
import { icons } from "./icons";

export interface TableEditorOptions {
  renderInline: (text: string) => DocumentFragment;
  openWikilink: (target: string, newTab: boolean) => void;
  frontmatterEnd: (state: EditorState) => number;
}

interface TableRange {
  from: number;
  to: number;
}

interface FieldValue {
  tables: TableRange[];
  /** The table being edited as text, if any. */
  raw: number | null;
  decorations: DecorationSet;
}

const showAsText = StateEffect.define<number | null>();
const PARSE_BUDGET_MS = 100;
const MENU_GAP = 4;
const HANDLE_DEPTH = 13;

const linesOf = (state: EditorState, { from, to }: TableRange): string[] => state.sliceDoc(from, to).split(state.lineBreak);
const cellsIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("th, td")];
const position = (cell: HTMLElement) => ({ row: Number(cell.dataset.row), column: Number(cell.dataset.column) });

function caretToEnd(cell: HTMLElement, atStart = false): void {
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(atStart);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function caretOffset(cell: HTMLElement): number {
  const selection = getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return -1;
  const before = selection.getRangeAt(0).cloneRange();
  before.selectNodeContents(cell);
  before.setEnd(selection.anchorNode!, selection.anchorOffset);
  return before.toString().length;
}

/** Shows a table as a table. Each cell edit is written back to just that cell's text in the file. */
class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly lines: string[],
    readonly options: TableEditorOptions,
    readonly range: () => (view: EditorView, root: HTMLElement) => TableRange | null,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-table-widget";
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.append(this.buildTable());
    root.append(wrap, ...this.buildHandles(view, root));
    this.bind(view, root);
    return root;
  }

  /** Keeps the same DOM while the table's shape holds, so typing in a cell never loses focus. */
  updateDOM(dom: HTMLElement): boolean {
    const { rows, align } = parseTable(this.lines);
    const cells = cellsIn(dom);
    if (cells.length !== rows.length * rows[0].length || dom.querySelectorAll("tr").length !== rows.length) return false;
    for (const cell of cells) {
      const { row, column } = position(cell);
      const text = rows[row][column];
      cell.style.textAlign = align[column];
      /* The file trims a cell, but the space just typed at its end must stay on screen for the next word. */
      if (cell === document.activeElement && (cell.textContent ?? "").trim() === text) continue;
      if (cell.dataset.source === text) continue;
      cell.dataset.source = text;
      this.showCell(cell);
      if (cell === document.activeElement) caretToEnd(cell);
    }
    return true;
  }

  ignoreEvent(): boolean {
    return true;
  }

  private showCell(cell: HTMLElement): void {
    const source = cell.dataset.source ?? "";
    if (cell === document.activeElement) cell.textContent = source;
    else cell.replaceChildren(this.options.renderInline(source));
  }

  private buildTable(): HTMLElement {
    const { rows, align } = parseTable(this.lines);
    const table = document.createElement("table");
    const head = table.createTHead();
    const body = table.createTBody();
    rows.forEach((cells, row) => {
      const tr = (row === 0 ? head : body).insertRow();
      cells.forEach((text, column) => {
        const cell = document.createElement(row === 0 ? "th" : "td");
        cell.setAttribute("contenteditable", "plaintext-only");
        cell.dataset.row = String(row);
        cell.dataset.column = String(column);
        cell.dataset.source = text;
        cell.setAttribute("aria-label", `Row ${row + 1}, column ${column + 1}`);
        if (align[column]) cell.style.textAlign = align[column];
        cell.append(this.options.renderInline(text));
        tr.append(cell);
      });
    });
    return table;
  }

  /** The row and column handles, and the bars that add to the table's edges. They float over the page, so nothing moves. */
  private buildHandles(view: EditorView, root: HTMLElement): HTMLElement[] {
    const handle = (className: string, label: string, icon: string, run: (button: HTMLElement) => void) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.tabIndex = -1;
      button.innerHTML = icon;
      button.setAttribute("aria-label", label);
      button.addEventListener("mousedown", (e) => e.preventDefault());
      button.addEventListener("click", () => run(button));
      return button;
    };
    const at = (button: HTMLElement) => {
      const { left, bottom } = button.getBoundingClientRect();
      return [left, bottom + MENU_GAP] as const;
    };
    const aimed = () => root.querySelector<HTMLElement>("[data-aimed]");
    return [
      handle("cm-table-grip is-row", "Row actions", icons.grip, (button) => {
        const cell = aimed();
        if (cell) showContextMenu(...at(button), this.rowMenu(view, root, cell));
      }),
      handle("cm-table-grip is-column", "Column actions", icons.gripWide, (button) => {
        const cell = aimed();
        if (cell) showContextMenu(...at(button), this.columnMenu(view, root, cell));
      }),
      handle("cm-table-add is-row", "Add a row", icons.plus, () => {
        const last = root.querySelectorAll("tr").length - 1;
        this.reshape(view, root, (lines) => insertRow(lines, last), last + 1, 0);
      }),
      handle("cm-table-add is-column", "Add a column", icons.plus, () => {
        const last = root.querySelectorAll("th").length - 1;
        this.reshape(view, root, (lines) => insertColumn(lines, last), 0, last + 1);
      }),
    ];
  }

  private asText(view: EditorView, root: HTMLElement): MenuItem {
    return {
      label: "Edit as Markdown",
      startsGroup: true,
      run: () => {
        const range = this.range()(view, root);
        if (!range) return;
        view.dispatch({ effects: showAsText.of(range.from), selection: { anchor: range.from } });
        view.focus();
      },
    };
  }

  private rowMenu(view: EditorView, root: HTMLElement, cell: HTMLElement): MenuItem[] {
    const { row, column } = position(cell);
    const change = (edit: (lines: string[]) => string[], toRow: number) => () => this.reshape(view, root, edit, toRow, column);
    return [
      ...(row > 0 ? [{ label: "Insert row above", run: change((lines) => insertRow(lines, row - 1), row) }] : []),
      { label: "Insert row below", run: change((lines) => insertRow(lines, row), row + 1) },
      ...(row > 0 ? [{ label: "Delete row", startsGroup: true, run: change((lines) => deleteRow(lines, row), row - 1) }] : []),
      this.asText(view, root),
    ];
  }

  private columnMenu(view: EditorView, root: HTMLElement, cell: HTMLElement): MenuItem[] {
    const { row, column } = position(cell);
    const change = (edit: (lines: string[]) => string[], toColumn: number) => () => this.reshape(view, root, edit, row, toColumn);
    const align = (label: string, value: "left" | "center" | "right", startsGroup = false) => ({
      label,
      startsGroup,
      run: () => this.write(view, root, (lines) => setAlignment(lines, column, value), "input"),
    });
    const columns = root.querySelectorAll("th").length;
    return [
      { label: "Insert column left", run: change((lines) => insertColumn(lines, column - 1), column) },
      { label: "Insert column right", run: change((lines) => insertColumn(lines, column), column + 1) },
      align("Align left", "left", true),
      align("Align center", "center"),
      align("Align right", "right"),
      ...(columns > 1
        ? [
            {
              label: "Delete column",
              startsGroup: true,
              run: change((lines) => deleteColumn(lines, column), Math.max(0, column - 1)),
            },
          ]
        : []),
      this.asText(view, root),
    ];
  }

  /** Puts the handles on the row and column of `cell`. */
  private aim(root: HTMLElement, cell: HTMLElement): void {
    root.querySelector("[data-aimed]")?.removeAttribute("data-aimed");
    cell.dataset.aimed = "";
    root.classList.add("has-handles");
    const box = root.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    const row = cell.parentElement!.getBoundingClientRect();
    const table = root.querySelector("table")!.getBoundingClientRect();
    const rowGrip = root.querySelector<HTMLElement>(".cm-table-grip.is-row")!;
    rowGrip.style.insetBlockStart = `${row.top - box.top}px`;
    rowGrip.style.blockSize = `${row.height}px`;
    const columnGrip = root.querySelector<HTMLElement>(".cm-table-grip.is-column")!;
    columnGrip.style.insetInlineStart = `${rect.left - box.left}px`;
    columnGrip.style.inlineSize = `${rect.width}px`;
    columnGrip.style.insetBlockStart = `${table.top - box.top - HANDLE_DEPTH}px`;
  }

  /** Holds the columns at their width for as long as the table is being edited, so typing never slides them. */
  private freeze(root: HTMLElement): void {
    const table = root.querySelector("table")!;
    if (table.style.tableLayout === "fixed") return;
    const widths = [...table.querySelectorAll("th")].map((head) => head.getBoundingClientRect().width);
    const columns = document.createElement("colgroup");
    for (const width of widths) {
      const column = document.createElement("col");
      column.style.width = `${width}px`;
      columns.append(column);
    }
    table.prepend(columns);
    table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
    table.style.tableLayout = "fixed";
  }

  private release(root: HTMLElement): void {
    const table = root.querySelector("table")!;
    table.querySelector("colgroup")?.remove();
    table.style.width = "";
    table.style.tableLayout = "";
  }

  private write(view: EditorView, root: HTMLElement, change: (lines: string[]) => string[], userEvent: string): boolean {
    const range = this.range()(view, root);
    if (!range || view.state.readOnly) return false;
    const before = linesOf(view.state, range);
    const after = change(before);
    if (after === before || after.join("\n") === before.join("\n")) return false;
    let first = 0;
    while (first < before.length && first < after.length && before[first] === after[first]) first++;
    let last = 0;
    while (last < before.length - first && last < after.length - first && before.at(-1 - last) === after.at(-1 - last)) last++;
    const { doc, lineBreak } = view.state;
    const startLine = doc.lineAt(range.from).number + first;
    const removed = before.length - first - last;
    const added = after.slice(first, after.length - last);
    const from = removed > 0 ? doc.line(startLine).from : doc.line(startLine - 1).to;
    const to = removed > 0 ? doc.line(startLine + removed - 1).to : from;
    if (added.length) {
      view.dispatch({ changes: { from, to, insert: (removed > 0 ? "" : lineBreak) + added.join(lineBreak) }, userEvent });
    } else {
      view.dispatch({ changes: { from: Math.max(range.from, from - 1), to }, userEvent });
    }
    return true;
  }

  /** Runs a change that alters the table's shape, then puts the cursor back in the right cell of the new table. */
  private reshape(view: EditorView, root: HTMLElement, change: (lines: string[]) => string[], row: number, column: number): void {
    const range = this.range()(view, root);
    if (!range || !this.write(view, root, change, "input")) return;
    const { from } = range;
    requestAnimationFrame(() => {
      for (const table of view.dom.querySelectorAll<HTMLElement>(".cm-table-widget")) {
        if (view.posAtDOM(table) === from) this.focusCell(table, row, column);
      }
    });
  }

  private focusCell(root: HTMLElement, row: number, column: number): void {
    const cell = root.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`);
    if (!cell) return;
    cell.focus();
    caretToEnd(cell);
  }

  private leave(view: EditorView, root: HTMLElement, before: boolean): void {
    const range = this.range()(view, root);
    if (!range) return;
    const { doc } = view.state;
    view.dispatch({ selection: { anchor: before ? Math.max(0, range.from - 1) : Math.min(doc.length, range.to + 1) } });
    view.focus();
  }

  private move(view: EditorView, root: HTMLElement, cell: HTMLElement, key: string, back: boolean): void {
    const { row, column } = position(cell);
    const cells = cellsIn(root);
    const rowCount = root.querySelectorAll("tr").length;
    const columnCount = cells.length / rowCount;
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const index = cells.indexOf(cell) + (key === "ArrowLeft" ? -1 : 1);
      const target = cells[index];
      if (!target) return;
      target.focus();
      caretToEnd(target, key === "ArrowRight");
    } else if (key === "Tab") {
      const next = cells.indexOf(cell) + (back ? -1 : 1);
      if (next >= cells.length) this.reshape(view, root, (lines) => insertRow(lines, row), row + 1, 0);
      else if (next >= 0) this.focusCell(root, Math.floor(next / columnCount), next % columnCount);
    } else if (key === "Enter") {
      if (row + 1 < rowCount) this.focusCell(root, row + 1, column);
      else this.reshape(view, root, (lines) => insertRow(lines, row), row + 1, column);
    } else if (key === "ArrowUp") {
      if (row > 0) this.focusCell(root, row - 1, column);
      else this.leave(view, root, true);
    } else if (key === "ArrowDown") {
      if (row + 1 < rowCount) this.focusCell(root, row + 1, column);
      else this.leave(view, root, false);
    }
  }

  private onKey(view: EditorView, root: HTMLElement, cell: HTMLElement, e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(view);
      else undo(view);
    } else if (mod && (e.key === "b" || e.key === "i")) {
      e.preventDefault();
      const marker = e.key === "b" ? "**" : "*";
      document.execCommand("insertText", false, `${marker}${getSelection()?.toString() ?? ""}${marker}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.leave(view, root, false);
    } else if (
      ((e.key === "ArrowLeft" && caretOffset(cell) === 0) ||
        (e.key === "ArrowRight" && caretOffset(cell) === (cell.textContent ?? "").length)) &&
      !mod &&
      !e.shiftKey
    ) {
      e.preventDefault();
      this.move(view, root, cell, e.key, false);
    } else if (["Tab", "Enter", "ArrowUp", "ArrowDown"].includes(e.key) && !mod) {
      e.preventDefault();
      this.move(view, root, cell, e.key, e.shiftKey);
    }
  }

  private openOnClick(cell: HTMLElement, e: MouseEvent): void {
    const link = (e.target as HTMLElement).closest<HTMLElement>("a.wikilink");
    if (e.metaKey && link?.dataset.path) {
      e.preventDefault();
      this.options.openWikilink(link.dataset.path.replace(/\.md$/i, ""), e.shiftKey);
      return;
    }
    if (cell === document.activeElement) return;
    e.preventDefault();
    cell.focus();
    const at = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (at && cell.contains(at.startContainer)) {
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(at);
    } else {
      caretToEnd(cell);
    }
  }

  private bind(view: EditorView, root: HTMLElement): void {
    const cellOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>("th, td");
    root.addEventListener("mousedown", (e) => {
      const cell = cellOf(e);
      if (cell) this.openOnClick(cell, e);
    });
    /* However a cell gets focus, it must show its Markdown before anything is typed, or typing would flatten the markup. */
    root.addEventListener("focusin", (e) => {
      const cell = cellOf(e);
      if (!cell) return;
      this.freeze(root);
      cell.textContent = cell.dataset.source ?? "";
      caretToEnd(cell);
      this.aim(root, cell);
    });
    root.addEventListener("focusout", (e) => {
      const cell = cellOf(e);
      if (cell) cell.replaceChildren(this.options.renderInline(cell.dataset.source ?? ""));
      if (!root.contains(e.relatedTarget as Node | null)) this.release(root);
    });
    root.addEventListener("mouseover", (e) => {
      const cell = cellOf(e);
      if (cell && !root.contains(document.activeElement)) this.aim(root, cell);
    });
    root.addEventListener("mouseleave", () => {
      if (!root.contains(document.activeElement)) root.classList.remove("has-handles");
    });
    root.querySelector(".table-wrap")!.addEventListener("scroll", () => {
      const cell = root.querySelector<HTMLElement>("[data-aimed]");
      if (cell) this.aim(root, cell);
    });
    root.addEventListener("keydown", (e) => {
      const cell = cellOf(e);
      if (cell) this.onKey(view, root, cell, e);
    });
    root.addEventListener("beforeinput", (e) => {
      if (view.state.readOnly || e.inputType === "insertLineBreak" || e.inputType === "insertParagraph") e.preventDefault();
    });
    root.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain").replace(/\s*\r?\n\s*/g, " ") ?? "";
      document.execCommand("insertText", false, text);
    });
    root.addEventListener("input", (e) => {
      const cell = cellOf(e);
      if (!cell) return;
      const text = (cell.textContent ?? "").replace(/ /g, " ");
      const { row, column } = position(cell);
      cell.dataset.source = text;
      this.write(view, root, (lines) => setCell(lines, row, column, text), "input.type");
      this.aim(root, cell);
    });
  }
}

/** Starts typing in the header of the table at `from`, with its placeholder text selected. */
export function focusTableAt(view: EditorView, from: number): void {
  for (const table of view.dom.querySelectorAll<HTMLElement>(".cm-table-widget")) {
    if (view.posAtDOM(table) !== from) continue;
    const cell = table.querySelector<HTMLElement>('[data-row="0"][data-column="0"]');
    cell?.focus();
    if (cell) getSelection()?.selectAllChildren(cell);
  }
}

/** Only tables at the top level can be edited as cells, because a quoted or listed table has a prefix on every line. */
function findTables(state: EditorState, frontmatterEnd: number): TableRange[] {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
  const tables: TableRange[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Table" || node.from < frontmatterEnd) continue;
    tables.push({ from: state.doc.lineAt(node.from).from, to: state.doc.lineAt(node.to).to });
  }
  return tables;
}

export function tableEditor(options: TableEditorOptions): Extension {
  const locate = (view: EditorView, root: HTMLElement): TableRange | null => {
    const from = view.posAtDOM(root);
    return view.state.field(field).tables.find((table) => from >= table.from && from <= table.to) ?? null;
  };
  const compute = (state: EditorState, raw: number | null): FieldValue => {
    const tables = findTables(state, options.frontmatterEnd(state));
    const ranges: Range<Decoration>[] = tables
      .filter((table) => table.from !== raw)
      .map((table) => {
        const lines = linesOf(state, table);
        const widget = new TableWidget(lines.join("\n"), lines, options, () => locate);
        return Decoration.replace({ widget, block: true }).range(table.from, table.to);
      });
    return { tables, raw, decorations: Decoration.set(ranges) };
  };
  const nextRaw = (value: FieldValue, tr: Transaction): number | null => {
    for (const effect of tr.effects) if (effect.is(showAsText)) return effect.value;
    if (value.raw === null) return null;
    const raw = tr.changes.mapPos(value.raw);
    const table = value.tables.find((t) => t.from === value.raw);
    const end = table ? tr.changes.mapPos(table.to, 1) : raw;
    const head = tr.state.selection.main.head;
    return head >= raw && head <= end ? raw : null;
  };
  const field: StateField<FieldValue> = StateField.define<FieldValue>({
    create: (state) => compute(state, null),
    update(value, tr) {
      const raw = nextRaw(value, tr);
      return tr.docChanged || raw !== value.raw ? compute(tr.state, raw) : value;
    },
    provide: (f) => [
      EditorView.decorations.from(f, (v) => v.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(f).decorations),
    ],
  });
  return field;
}
