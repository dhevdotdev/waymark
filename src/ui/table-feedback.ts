import { parseTable } from "../vault/markdown-table";
import { describeTableChange, type TableChange } from "../vault/table-change";
import { fadeAway, timing, tokenPx } from "./list-motion";
import { reducedMotion } from "./media";
import type { TableAt } from "./table-actions";

const entering = () => timing("--t-menu", "--ease-out");
const travelling = () => timing("--t-menu", "--ease-in-out");

export interface Snapshot {
  lines: string[];
  cells: Map<string, DOMRect>;
  texts: Map<string, number>;
  labels: Map<string, string>;
}

const keyOf = (row: number, column: number) => `${row},${column}`;
const cellAt = (root: HTMLElement, row: number, column: number) =>
  root.querySelector<HTMLElement>(`[data-row="${row}"][data-column="${column}"]`);
const allCells = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("th, td")];

function textLeft(cell: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(cell);
  return range.getBoundingClientRect().left;
}

export function snapshot(root: HTMLElement, lines: string[]): Snapshot {
  const cells = new Map<string, DOMRect>();
  const texts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const cell of allCells(root)) {
    const key = keyOf(Number(cell.dataset.row), Number(cell.dataset.column));
    cells.set(key, cell.getBoundingClientRect());
    texts.set(key, textLeft(cell));
    labels.set(key, cell.textContent ?? "");
  }
  return { lines, cells, texts, labels };
}

/** Marks cells with a tint that goes on its own: a fade after the pointer, a plain hold after the keyboard. */
function mark(cells: (HTMLElement | null)[]): void {
  const present = cells.filter((cell): cell is HTMLElement => cell !== null);
  for (const cell of present) cell.classList.remove("is-marked");
  void present[0]?.offsetWidth;
  for (const cell of present) {
    cell.classList.add("is-marked");
    cell.addEventListener("animationend", () => cell.classList.remove("is-marked"), { once: true });
  }
}

/** Draws what was removed, where it was, and fades it out over the table that closed up around it. */
function ghost(root: HTMLElement, before: Snapshot, keys: string[]): void {
  const box = root.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "cm-table-ghost";
  layer.setAttribute("aria-hidden", "true");
  for (const key of keys) {
    const rect = before.cells.get(key);
    if (!rect) continue;
    const cell = document.createElement("div");
    cell.className = "cm-table-ghost-cell";
    cell.style.insetInlineStart = `${rect.left - box.left}px`;
    cell.style.insetBlockStart = `${rect.top - box.top}px`;
    cell.style.inlineSize = `${rect.width}px`;
    cell.style.blockSize = `${rect.height}px`;
    cell.textContent = before.labels.get(key) ?? "";
    layer.append(cell);
  }
  root.append(layer);
  fadeAway(layer, timing("--t-press", "--ease-out"));
}

function arrive(cells: (HTMLElement | null)[], x: number, y: number): void {
  const options = entering();
  for (const cell of cells)
    cell?.animate({ opacity: [0, 1], transform: [`translate(${x}px, ${y}px)`, "translate(0, 0)"] }, options);
}

/** Where each moved index ended up: the mover goes straight there, the ones it passed shift one place. */
function shiftedIndex(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

function slideMoved(root: HTMLElement, before: Snapshot, axis: "row" | "column", from: number, to: number): void {
  const options = travelling();
  for (const cell of allCells(root)) {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const key = axis === "row" ? keyOf(reverseIndex(row, from, to), column) : keyOf(row, reverseIndex(column, from, to));
    const old = before.cells.get(key);
    if (!old) continue;
    const now = cell.getBoundingClientRect();
    const x = old.left - now.left;
    const y = old.top - now.top;
    if (x !== 0 || y !== 0) cell.animate({ transform: [`translate(${x}px, ${y}px)`, "translate(0, 0)"] }, options);
  }
}

/** Which old index a new index came from. */
function reverseIndex(index: number, from: number, to: number): number {
  for (let old = Math.min(from, to); old <= Math.max(from, to); old++) {
    if (shiftedIndex(old, from, to) === index) return old;
  }
  return index;
}

function columnCells(root: HTMLElement, column: number): HTMLElement[] {
  return allCells(root).filter((cell) => Number(cell.dataset.column) === column);
}

function rowCells(root: HTMLElement, row: number): HTMLElement[] {
  return allCells(root).filter((cell) => Number(cell.dataset.row) === row);
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

function removedKeys(before: Snapshot, change: Extract<TableChange, { kind: "rowsRemoved" | "columnsRemoved" }>): string[] {
  const indices = new Set(range(change.from, change.count));
  return [...before.cells.keys()].filter((key) => {
    const [row, column] = key.split(",").map(Number);
    return indices.has(change.kind === "rowsRemoved" ? row : column);
  });
}

function slideAligned(root: HTMLElement, before: Snapshot, column: number): void {
  const options = travelling();
  for (const cell of columnCells(root, column)) {
    const old = before.texts.get(keyOf(Number(cell.dataset.row), column));
    if (old === undefined) continue;
    cell.animate({ transform: [`translateX(${old - textLeft(cell)}px)`, "translateX(0)"] }, options);
  }
}

/** The moved row of an adjacent swap is the one the cursor followed. */
function oriented(from: number, to: number, focus: number): [number, number] {
  return Math.abs(from - to) === 1 && focus === from ? [to, from] : [from, to];
}

function moved(
  root: HTMLElement,
  before: Snapshot,
  axis: "row" | "column",
  change: { from: number; to: number },
  focus: number,
  motion: boolean,
): void {
  const [from, to] = oriented(change.from, change.to, focus);
  if (motion) slideMoved(root, before, axis, from, to);
  mark(axis === "row" ? rowCells(root, to) : columnCells(root, to));
}

/** Shows what a change did, using only the two versions of the table, so undo and redo confirm themselves too. */
export function reveal(root: HTMLElement, before: Snapshot, after: string[], focus: TableAt | null, pointer: boolean): void {
  for (const animation of root.getAnimations({ subtree: true })) animation.cancel();
  for (const cell of root.querySelectorAll(".is-marked")) cell.classList.remove("is-marked");
  const motion = pointer && !reducedMotion();
  const rise = tokenPx("--rise");
  const change = describeTableChange(parseTable(before.lines), parseTable(after));
  switch (change.kind) {
    case "rowsAdded": {
      const cells = range(change.from, change.count).flatMap((row) => rowCells(root, row));
      mark(cells);
      if (motion) arrive(cells, 0, -rise);
      break;
    }
    case "columnsAdded": {
      const cells = range(change.from, change.count).flatMap((column) => columnCells(root, column));
      mark(cells);
      if (motion) arrive(cells, -rise, 0);
      break;
    }
    case "rowsRemoved":
    case "columnsRemoved":
      if (motion) ghost(root, before, removedKeys(before, change));
      break;
    case "rowMoved":
      moved(root, before, "row", change, focus?.row ?? -1, motion);
      break;
    case "columnMoved":
      moved(root, before, "column", change, focus?.column ?? -1, motion);
      break;
    case "aligned": {
      if (motion) slideAligned(root, before, change.column);
      mark(columnCells(root, change.column));
      break;
    }
    case "cells":
      mark(change.cells.map(({ row, column }) => cellAt(root, row, column)));
      break;
    case "none":
      break;
  }
}
