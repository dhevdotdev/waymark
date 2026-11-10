import type { ParsedTable } from "./markdown-table";

/** What separates two versions of a table, in the terms a person would use to describe the edit. */
export type TableChange =
  | { kind: "none" }
  | { kind: "rowsAdded"; from: number; count: number }
  | { kind: "rowsRemoved"; from: number; count: number }
  | { kind: "columnsAdded"; from: number; count: number }
  | { kind: "columnsRemoved"; from: number; count: number }
  | { kind: "rowMoved"; from: number; to: number }
  | { kind: "columnMoved"; from: number; to: number }
  | { kind: "aligned"; column: number }
  | { kind: "cells"; cells: { row: number; column: number }[] };

const key = (cells: string[]) => cells.join("\u0000");
const keys = (rows: string[][]) => rows.map(key);
const columnsOf = (rows: string[][]) => rows[0].map((_, column) => rows.map((row) => row[column]));

/** How many entries match at the start, then at the end of what is left. */
function sharedEnds(a: string[], b: string[]): [start: number, end: number] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [start, end];
}

/** The one entry that moved, if `after` is `before` with a single entry taken out and put back elsewhere. */
function singleMove(before: string[], after: string[]): { from: number; to: number } | null {
  const [start, end] = sharedEnds(before, after);
  const last = before.length - 1 - end;
  if (last <= start) return null;
  const matches = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);
  if (after[start] === before[last] && matches(before.slice(start, last), after.slice(start + 1, last + 1))) {
    return { from: last, to: start };
  }
  if (after[last] === before[start] && matches(before.slice(start + 1, last + 1), after.slice(start, last))) {
    return { from: start, to: last };
  }
  return null;
}

function sameShapeChange(before: ParsedTable, after: ParsedTable): TableChange {
  const row = singleMove(keys(before.rows), keys(after.rows));
  if (row) return { kind: "rowMoved", ...row };
  const column = singleMove(keys(columnsOf(before.rows)), keys(columnsOf(after.rows)));
  if (column) return { kind: "columnMoved", ...column };
  const cells = after.rows.flatMap((cellsInRow, r) =>
    cellsInRow.flatMap((text, c) => (text === before.rows[r][c] ? [] : [{ row: r, column: c }])),
  );
  if (cells.length) return { kind: "cells", cells };
  const aligned = after.align.findIndex((value, i) => value !== before.align[i]);
  return aligned >= 0 ? { kind: "aligned", column: aligned } : { kind: "none" };
}

export function describeTableChange(before: ParsedTable, after: ParsedTable): TableChange {
  const rowDelta = after.rows.length - before.rows.length;
  if (rowDelta !== 0) {
    const [from] = sharedEnds(keys(before.rows), keys(after.rows));
    return { kind: rowDelta > 0 ? "rowsAdded" : "rowsRemoved", from, count: Math.abs(rowDelta) };
  }
  const columnDelta = after.rows[0].length - before.rows[0].length;
  if (columnDelta !== 0) {
    const [from] = sharedEnds(keys(columnsOf(before.rows)), keys(columnsOf(after.rows)));
    return { kind: columnDelta > 0 ? "columnsAdded" : "columnsRemoved", from, count: Math.abs(columnDelta) };
  }
  return sameShapeChange(before, after);
}
