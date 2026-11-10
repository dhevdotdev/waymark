import { isolateHistory } from "@codemirror/commands";
import { Annotation, type Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export function placeCaret(cell: HTMLElement, offset: number | "start" | "end"): void {
  const selection = getSelection();
  const range = document.createRange();
  const text = cell.firstChild;
  if (typeof offset === "number" && text?.nodeType === Node.TEXT_NODE) {
    range.setStart(text, Math.min(offset, text.textContent?.length ?? 0));
    range.collapse(true);
  } else {
    range.selectNodeContents(cell);
    range.collapse(offset === "start");
  }
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function caretOffset(cell: HTMLElement): number {
  const selection = getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) return -1;
  const before = selection.getRangeAt(0).cloneRange();
  before.selectNodeContents(cell);
  before.setEnd(selection.anchorNode!, selection.anchorOffset);
  return before.toString().length;
}

/** The smallest change that turns the table's lines `before` into `after`, starting at document position `from`. */
export function lineChange(doc: Text, lineBreak: string, from: number, before: string[], after: string[]) {
  let first = 0;
  while (first < before.length && first < after.length && before[first] === after[first]) first++;
  let last = 0;
  while (last < before.length - first && last < after.length - first && before.at(-1 - last) === after.at(-1 - last)) last++;
  const startLine = doc.lineAt(from).number + first;
  const removed = before.length - first - last;
  const added = after.slice(first, after.length - last);
  const start = removed > 0 ? doc.line(startLine).from : doc.line(startLine - 1).to;
  const end = removed > 0 ? doc.line(startLine + removed - 1).to : start;
  return added.length
    ? { from: start, to: end, insert: (removed > 0 ? "" : lineBreak) + added.join(lineBreak) }
    : { from: Math.max(from, start - lineBreak.length), to: end };
}

/** Holds the columns at their width for as long as the table is being edited, so typing never slides them. */
export function freezeColumns(table: HTMLTableElement): void {
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

export function releaseColumns(table: HTMLTableElement): void {
  table.querySelector("colgroup")?.remove();
  table.style.width = "";
  table.style.tableLayout = "";
}

/** Extends the selection as the pointer moves, for a drag that began on a cell which had to take focus first. */
export function followDragSelection(cell: HTMLElement): void {
  const onMove = (e: MouseEvent) => {
    const to = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (to && cell.contains(to.startContainer)) getSelection()?.extend(to.startContainer, to.startOffset);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", () => window.removeEventListener("mousemove", onMove), { once: true });
}

/** What to remove with a table: the blank line after it, or at the end of a note the blank line before it. */
export function tableRemoval(doc: Text, range: { from: number; to: number }): { from: number; to: number } {
  const next = range.to < doc.length ? doc.lineAt(range.to + 1) : null;
  if (next && !next.text.trim() && next.to < doc.length) return { from: range.from, to: next.to + 1 };
  if (next?.text.trim()) return { from: range.from, to: next.from };
  const previous = range.from > 0 ? doc.lineAt(range.from - 1) : null;
  if (previous && !previous.text.trim() && previous.from > 0) return { from: previous.from - 1, to: range.to };
  return range;
}

/** Marks the table's own edits, so the guard on text typed beside a table leaves them alone. */
export const tableWrite = Annotation.define<true>();

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

/** WebKit's right-click selection runs past a cell's end into the next one. Only a selection inside this cell may stay. */
export function keepSelectionInCell(cell: HTMLElement): void {
  const selection = getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return;
  if (cell.contains(selection.anchorNode) && cell.contains(selection.focusNode) && selection.toString().trim()) return;
  if (cell.contains(selection.anchorNode)) selection.collapse(selection.anchorNode, selection.anchorOffset);
  else selection.removeAllRanges();
}
