import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  type ParsedTable,
  setAlignment,
} from "../vault/markdown-table";

export interface TableAt {
  row: number;
  column: number;
}

export interface TableContext {
  at: TableAt;
  rows: number;
  columns: number;
  align: ParsedTable["align"];
}

export type TableMode = "edit" | "grid";

interface Shortcut {
  key: string;
  shift?: boolean;
}

export interface TableAction {
  label: string;
  scope: "row" | "column";
  /** Every shortcut holds Command and Option. */
  shortcut?: Shortcut;
  hint?: string;
  danger?: boolean;
  startsGroup?: boolean;
  checked?: (context: TableContext) => boolean;
  /** Why this cannot happen here, or null when it can. */
  blocked?: (context: TableContext) => string | null;
  edit: (lines: string[], context: TableContext) => string[];
  /** The cell the cursor belongs in afterwards. */
  lands: (context: TableContext) => TableAt;
}

const stay = ({ at }: TableContext) => at;
const CMD_OPT = "⌘⌥";
const CMD_OPT_SHIFT = "⌘⌥⇧";

function aligned(label: string, value: "left" | "center" | "right", startsGroup = false): TableAction {
  const current = ({ align, at }: TableContext) => align[at.column] || "left";
  return {
    label,
    scope: "column",
    startsGroup,
    checked: (context) => current(context) === value,
    blocked: (context) => (current(context) === value ? `Already ${value}` : null),
    edit: (lines, { at }) => setAlignment(lines, at.column, value),
    lands: stay,
  };
}

const onlyRow = "A table needs its header row";
const onlyColumn = "A table needs one column";

export const TABLE_ACTIONS: TableAction[] = [
  {
    label: "Insert row above",
    scope: "row",
    shortcut: { key: "ArrowUp" },
    hint: `${CMD_OPT}↑`,
    edit: (lines, { at }) => (at.row === 0 ? moveRow(insertRow(lines, 0), 1, 0) : insertRow(lines, at.row - 1)),
    lands: stay,
  },
  {
    label: "Insert row below",
    scope: "row",
    shortcut: { key: "ArrowDown" },
    hint: `${CMD_OPT}↓`,
    edit: (lines, { at }) => insertRow(lines, at.row),
    lands: ({ at }) => ({ row: at.row + 1, column: at.column }),
  },
  {
    label: "Move row up",
    scope: "row",
    startsGroup: true,
    shortcut: { key: "ArrowUp", shift: true },
    hint: `${CMD_OPT_SHIFT}↑`,
    blocked: ({ at }) => (at.row === 0 ? "Already first" : null),
    edit: (lines, { at }) => moveRow(lines, at.row, at.row - 1),
    lands: ({ at }) => ({ row: at.row - 1, column: at.column }),
  },
  {
    label: "Move row down",
    scope: "row",
    shortcut: { key: "ArrowDown", shift: true },
    hint: `${CMD_OPT_SHIFT}↓`,
    blocked: ({ at, rows }) => (at.row === rows - 1 ? "Already last" : null),
    edit: (lines, { at }) => moveRow(lines, at.row, at.row + 1),
    lands: ({ at }) => ({ row: at.row + 1, column: at.column }),
  },
  {
    label: "Delete row",
    scope: "row",
    danger: true,
    startsGroup: true,
    shortcut: { key: "Backspace", shift: true },
    hint: `${CMD_OPT_SHIFT}⌫`,
    blocked: ({ rows }) => (rows === 1 ? onlyRow : null),
    edit: (lines, { at }) => (at.row === 0 ? deleteRow(moveRow(lines, 0, 1), 1) : deleteRow(lines, at.row)),
    lands: ({ at, rows }) => ({ row: Math.min(at.row, rows - 2), column: at.column }),
  },
  {
    label: "Insert column left",
    scope: "column",
    shortcut: { key: "ArrowLeft" },
    hint: `${CMD_OPT}←`,
    edit: (lines, { at }) => insertColumn(lines, at.column - 1),
    lands: stay,
  },
  {
    label: "Insert column right",
    scope: "column",
    shortcut: { key: "ArrowRight" },
    hint: `${CMD_OPT}→`,
    edit: (lines, { at }) => insertColumn(lines, at.column),
    lands: ({ at }) => ({ row: at.row, column: at.column + 1 }),
  },
  {
    label: "Move column left",
    scope: "column",
    startsGroup: true,
    shortcut: { key: "ArrowLeft", shift: true },
    hint: `${CMD_OPT_SHIFT}←`,
    blocked: ({ at }) => (at.column === 0 ? "Already first" : null),
    edit: (lines, { at }) => moveColumn(lines, at.column, at.column - 1),
    lands: ({ at }) => ({ row: at.row, column: at.column - 1 }),
  },
  {
    label: "Move column right",
    scope: "column",
    shortcut: { key: "ArrowRight", shift: true },
    hint: `${CMD_OPT_SHIFT}→`,
    blocked: ({ at, columns }) => (at.column === columns - 1 ? "Already last" : null),
    edit: (lines, { at }) => moveColumn(lines, at.column, at.column + 1),
    lands: ({ at }) => ({ row: at.row, column: at.column + 1 }),
  },
  aligned("Align left", "left", true),
  aligned("Align center", "center"),
  aligned("Align right", "right"),
  {
    label: "Delete column",
    scope: "column",
    danger: true,
    startsGroup: true,
    shortcut: { key: "Backspace" },
    hint: `${CMD_OPT}⌫`,
    blocked: ({ columns }) => (columns === 1 ? onlyColumn : null),
    edit: (lines, { at }) => deleteColumn(lines, at.column),
    lands: ({ at, columns }) => ({ row: at.row, column: Math.min(at.column, columns - 2) }),
  },
];

export function actionForKey(e: KeyboardEvent): TableAction | null {
  if (!(e.metaKey || e.ctrlKey) || !e.altKey) return null;
  return TABLE_ACTIONS.find(({ shortcut }) => shortcut?.key === e.key && !!shortcut.shift === e.shiftKey) ?? null;
}

const PAGE_ROWS = 5;

/** Where a grid-navigation key goes from `at`, stopping at the table's edges. */
export function gridTarget({ row, column }: TableAt, rows: number, columns: number, e: KeyboardEvent): TableAt | undefined {
  const mod = e.metaKey || e.ctrlKey;
  const targets: Record<string, TableAt> = {
    ArrowUp: { row: Math.max(0, row - 1), column },
    ArrowDown: { row: Math.min(rows - 1, row + 1), column },
    ArrowLeft: { row, column: Math.max(0, column - 1) },
    ArrowRight: { row, column: Math.min(columns - 1, column + 1) },
    Home: mod ? { row: 0, column: 0 } : { row, column: 0 },
    End: mod ? { row: rows - 1, column: columns - 1 } : { row, column: columns - 1 },
    PageUp: { row: Math.max(0, row - PAGE_ROWS), column },
    PageDown: { row: Math.min(rows - 1, row + PAGE_ROWS), column },
  };
  return targets[e.key];
}
