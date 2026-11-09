import { undo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { deleteColumn, deleteRow, insertColumn, insertRow, parseTable, setCell } from "../vault/markdown-table";

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

const linesOf = (state: EditorState, { from, to }: TableRange): string[] => state.sliceDoc(from, to).split(state.lineBreak);
const cellsIn = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("th, td")];
const position = (cell: HTMLElement) => ({ row: Number(cell.dataset.row), column: Number(cell.dataset.column) });

function caretToEnd(cell: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(false);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
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
    root.append(this.buildTools(view, root), wrap);
    this.bind(view, root);
    return root;
  }

  /** Keeps the same DOM while the table's shape holds, so typing in a cell never loses focus. */
  updateDOM(dom: HTMLElement): boolean {
    const { rows } = parseTable(this.lines);
    const cells = cellsIn(dom);
    if (cells.length !== rows.length * rows[0].length || dom.querySelectorAll("tr").length !== rows.length) return false;
    for (const cell of cells) {
      const { row, column } = position(cell);
      const text = rows[row][column];
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

  private buildTools(view: EditorView, root: HTMLElement): HTMLElement {
    const tools = document.createElement("div");
    tools.className = "cm-table-tools edit-bubble";
    tools.setAttribute("role", "toolbar");
    tools.setAttribute("aria-label", "Table");
    const button = (label: string, run: (cell: HTMLElement) => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "edit-bubble-btn";
      b.textContent = label;
      b.addEventListener("mousedown", (e) => {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) run(document.activeElement);
      });
      tools.append(b);
    };
    button("Add row", (cell) => {
      const { row, column } = position(cell);
      this.reshape(view, root, (lines) => insertRow(lines, row), row + 1, column);
    });
    button("Add column", (cell) => {
      const { row, column } = position(cell);
      this.reshape(view, root, (lines) => insertColumn(lines, column), row, column + 1);
    });
    button("Delete row", (cell) => {
      const { row, column } = position(cell);
      if (row > 0) this.reshape(view, root, (lines) => deleteRow(lines, row), row - 1, column);
    });
    button("Delete column", (cell) => {
      const { row, column } = position(cell);
      this.reshape(view, root, (lines) => deleteColumn(lines, column), row, Math.max(0, column - 1));
    });
    button("Edit as text", () => {
      const range = this.range()(view, root);
      if (!range) return;
      view.dispatch({ effects: showAsText.of(range.from), selection: { anchor: range.from } });
      view.focus();
    });
    return tools;
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
    if (cell !== document.activeElement) {
      cell.textContent = cell.dataset.source ?? "";
      cell.focus();
    }
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
    if (key === "Tab") {
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
    if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undo(view);
    } else if (mod && (e.key === "b" || e.key === "i")) {
      e.preventDefault();
      const marker = e.key === "b" ? "**" : "*";
      document.execCommand("insertText", false, `${marker}${getSelection()?.toString() ?? ""}${marker}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.leave(view, root, false);
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
    cell.textContent = cell.dataset.source ?? "";
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
    root.addEventListener("focusout", (e) => {
      const cell = cellOf(e);
      if (cell) cell.replaceChildren(this.options.renderInline(cell.dataset.source ?? ""));
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
    });
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
    return view.state.field(field).tables.find((table) => table.from === from) ?? null;
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
    const end = table ? tr.changes.mapPos(table.to) : raw;
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
