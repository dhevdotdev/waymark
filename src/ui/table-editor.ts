import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, Prec, type Range, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { tableWrite, writeBeside } from "./table-dom";
import { EditableTable, type TableEditorOptions, type TableHost, type TableRange } from "./table-view";

export type { TableEditorOptions } from "./table-view";

interface FieldValue {
  tables: TableRange[];
  /** The table being edited as text, if any. */
  raw: number | null;
  decorations: DecorationSet;
}

const showAsText = StateEffect.define<number | null>();
const PARSE_BUDGET_MS = 100;

const linesOf = (state: EditorState, { from, to }: TableRange): string[] => state.sliceDoc(from, to).split(state.lineBreak);

/** Shows a table as a table. Each cell edit is written back to just that cell's text in the file. */
class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly lines: string[],
    readonly host: TableHost,
    readonly noGapAbove: boolean,
    readonly noGapBelow: boolean,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.text === this.text && other.noGapAbove === this.noGapAbove && other.noGapBelow === this.noGapBelow;
  }

  toDOM(view: EditorView): HTMLElement {
    return new EditableTable(view, this.lines, this.host, this.noGapAbove, this.noGapBelow).root;
  }

  updateDOM(dom: HTMLElement): boolean {
    return EditableTable.of(dom)?.sync(this.lines) ?? false;
  }

  destroy(dom: HTMLElement): void {
    EditableTable.of(dom)?.destroy();
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** Starts typing in the first header of the table at `from`. */
export function focusTableAt(view: EditorView, from: number): void {
  EditableTable.find(view, from)?.focusCell({ row: 0, column: 0 });
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

/** True when the line next to the table has text, so the table's controls need room of their own. */
function touches(state: EditorState, line: number): boolean {
  return line >= 1 && line <= state.doc.lines && state.doc.line(line).text.trim() !== "";
}

export function tableEditor(options: TableEditorOptions): Extension {
  const host: TableHost = {
    options,
    range: (view, root) => {
      const from = view.posAtDOM(root);
      return view.state.field(field).tables.find((table) => from >= table.from && from <= table.to) ?? null;
    },
    showAsText: (view, from) => {
      view.dispatch({ effects: showAsText.of(from), selection: { anchor: from } });
      view.focus();
    },
  };
  const compute = (state: EditorState, raw: number | null): FieldValue => {
    const tables = findTables(state, options.frontmatterEnd(state));
    const ranges: Range<Decoration>[] = tables
      .filter((table) => table.from !== raw)
      .map((table) => {
        const lines = linesOf(state, table);
        const above = touches(state, state.doc.lineAt(table.from).number - 1);
        const below = touches(state, state.doc.lineAt(table.to).number + 1);
        const widget = new TableWidget(lines.join("\n"), lines, host, above, below);
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
  const drawn = (view: EditorView) =>
    view.state.field(field).tables.filter((table) => table.from !== view.state.field(field).raw);

  const enter = (view: EditorView, table: TableRange, last: boolean): boolean => {
    const editable = EditableTable.find(view, table.from);
    if (!editable) return false;
    const { rows, columns } = editable.context({ row: 0, column: 0 });
    editable.focusCell(last ? { row: rows - 1, column: columns - 1 } : { row: 0, column: 0 });
    return true;
  };
  const heads = (view: EditorView) => {
    const main = view.state.selection.main;
    return main.empty ? { head: main.head, line: view.state.doc.lineAt(main.head), main } : null;
  };
  const crossDown = (view: EditorView) => {
    const at = heads(view);
    if (!at) return false;
    const table = drawn(view).find((t) => t.from === at.line.to + 1 || t.from === at.head);
    return !!table && view.moveVertically(at.main, true).head >= table.from && enter(view, table, false);
  };
  const crossUp = (view: EditorView) => {
    const at = heads(view);
    if (!at) return false;
    const table = drawn(view).find((t) => t.to + 1 === at.line.from || t.to === at.head);
    return !!table && view.moveVertically(at.main, false).head <= table.to && enter(view, table, true);
  };
  const atLineEnd = (view: EditorView) => {
    const at = heads(view);
    if (!at || at.head !== at.line.to) return false;
    const table = drawn(view).find((t) => t.from === at.line.to + 1);
    return !!table && enter(view, table, false);
  };
  const atLineStart = (view: EditorView) => {
    const at = heads(view);
    if (!at || at.head !== at.line.from) return false;
    const table = drawn(view).find((t) => t.to + 1 === at.line.from);
    return !!table && enter(view, table, true);
  };
  /** The blank line beside a table keeps text out of it, so deleting that line goes into the table instead. */
  const keepsGap = (view: EditorView, direction: 1 | -1) => {
    const at = heads(view);
    if (!at?.line.text.trim()) return false;
    const { doc } = view.state;
    const gapNumber = at.line.number + direction;
    if (gapNumber < 1 || gapNumber > doc.lines || doc.line(gapNumber).text.trim()) return false;
    const gap = doc.line(gapNumber);
    const table = drawn(view).find((t) => (direction < 0 ? t.to + 1 === gap.from : t.from === gap.to + 1));
    return !!table && enter(view, table, direction < 0);
  };
  const backspace = (view: EditorView) =>
    atLineStart(view) || (heads(view)?.head === heads(view)?.line.from && keepsGap(view, -1));
  /** Deleting the blank line under a table would join the text below to it as a row, so Delete moves onto that text. */
  const gapBelow = (view: EditorView) => {
    const at = heads(view);
    if (!at || at.line.text.trim() || at.line.number >= view.state.doc.lines) return false;
    const next = view.state.doc.line(at.line.number + 1);
    if (!next.text.trim() || !drawn(view).some((t) => t.to + 1 === at.line.from)) return false;
    view.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
    return true;
  };
  const forwardDelete = (view: EditorView) =>
    atLineEnd(view) || gapBelow(view) || (heads(view)?.head === heads(view)?.line.to && keepsGap(view, 1));

  /** The line breaks typed text needs at `head` so a blank line stays between it and any table. */
  const separation = (state: EditorState, head: number): { before: string; after: string } | null => {
    const tables = state.field(field).tables;
    const { doc, lineBreak } = state;
    const gap = lineBreak + lineBreak;
    if (tables.some((t) => t.from === head)) return { before: "", after: gap };
    if (tables.some((t) => t.to === head)) return { before: gap, after: "" };
    const line = doc.lineAt(head);
    if (line.text.trim()) return null;
    const under = tables.some((t) => t.to + 1 === line.from);
    const over = tables.some((t) => t.from === line.to + 1);
    if (!under && !over) return null;
    const text = (number: number) => number >= 1 && number <= doc.lines && doc.line(number).text.trim() !== "";
    return {
      before: under || text(line.number - 1) ? lineBreak : "",
      after: over || text(line.number + 1) ? lineBreak : "",
    };
  };

  /** Text typed against a table, or on the one blank line beside it, starts its own paragraph, or Markdown would read it as a row. */
  const typingBeside = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(tableWrite) || !(tr.isUserEvent("input") || tr.isUserEvent("paste"))) return tr;
    const { main } = tr.startState.selection;
    const around = main.empty ? separation(tr.startState, main.head) : null;
    if (!around) return tr;
    let inserted: string | null = null;
    let elsewhere = false;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
      if (fromA !== main.head || toA !== main.head) elsewhere = true;
      inserted = text.toString();
    });
    if (elsewhere || inserted === null) return tr;
    const text: string = inserted;
    return {
      changes: { from: main.head, insert: `${around.before}${text}${around.after}` },
      selection: { anchor: main.head + around.before.length + text.length },
      annotations: Transaction.userEvent.of("input.type"),
      scrollIntoView: true,
    };
  });

  /** A press below a table that ends the note, or above one that starts it, belongs beside the table. */
  const pressPastEdge = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false;
      if ((e.target as HTMLElement).closest(".cm-table-widget")) return false;
      const { doc } = view.state;
      const tables = drawn(view);
      const edge = (table: TableRange | undefined) =>
        table ? EditableTable.find(view, table.from)?.root.getBoundingClientRect() : undefined;
      const last = tables.at(-1);
      const below = last?.to === doc.length && e.clientY > (edge(last)?.bottom ?? Number.POSITIVE_INFINITY);
      const above = tables[0]?.from === 0 && e.clientY < (edge(tables[0])?.top ?? Number.NEGATIVE_INFINITY);
      if (!below && !above) return false;
      e.preventDefault();
      writeBeside(view, above);
      return true;
    },
  });

  return [
    field,
    typingBeside,
    pressPastEdge,
    EditorView.scrollHandler.of(
      (view) => view.dom.contains(document.activeElement) && !!document.activeElement?.closest(".cm-table-widget"),
    ),
    Prec.high(
      keymap.of([
        { key: "ArrowDown", run: crossDown },
        { key: "ArrowUp", run: crossUp },
        { key: "ArrowRight", run: atLineEnd },
        { key: "ArrowLeft", run: atLineStart },
        { key: "Delete", run: forwardDelete },
        { key: "Backspace", run: backspace },
      ]),
    ),
  ];
}
