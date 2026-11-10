import type { Text } from "@codemirror/state";

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
