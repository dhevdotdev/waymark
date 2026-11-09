import { parse } from "yaml";

const MAX_BASE_BYTES = 256 * 1024;
const FILE_FIELDS = new Set(["name", "basename", "path", "folder", "ext", "size", "mtime", "ctime"]);

export type Filter =
  | { all: Filter[] }
  | { any: Filter[] }
  | { none: Filter[] }
  | { property: string; equals: boolean; value: string };

export interface BaseSort {
  property: string;
  descending: boolean;
}

export interface BaseView {
  name: string;
  columns: string[];
  sort: BaseSort[];
  filter: Filter | null;
  limit: number | null;
  /** Why this view cannot be shown faithfully, in words for the reader. */
  problem: string | null;
}

export interface BaseFile {
  filter: Filter | null;
  labels: Map<string, string>;
  views: BaseView[];
  problem: string | null;
}

export type ParsedBase = { ok: true; base: BaseFile } | { ok: false; error: string };

export interface BaseRow {
  path: string;
  note: Record<string, string | string[]>;
  file: { name: string; basename: string; path: string; folder: string; ext: string; size: number; mtime: number; ctime: number };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

class Unsupported extends Error {}

/** Every property is `note.x` or `file.x` from here on. A bare name means the note's own property. */
function normalise(property: string): string {
  const name = property.trim();
  const quoted = /^note\[\s*["'](.+)["']\s*\]$/.exec(name);
  if (quoted) return `note.${quoted[1]}`;
  if (name.startsWith("note.")) return name;
  if (name.startsWith("file.")) {
    if (!FILE_FIELDS.has(name.slice(5))) throw new Unsupported(`the property ${name}`);
    return name;
  }
  if (/^(formula|this)\.|[()]/.test(name)) throw new Unsupported(`the property ${name}`);
  return `note.${name}`;
}

const COMPARISON = /^\s*(.+?)\s*(==|!=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?|true|false)\s*$/;

function comparison(expression: string): Filter {
  const match = COMPARISON.exec(expression);
  if (!match) throw new Unsupported(`the filter ${expression}`);
  const literal = /^["']/.test(match[3]) ? match[3].slice(1, -1).replace(/\\(.)/g, "$1") : match[3];
  return { property: normalise(match[1]), equals: match[2] === "==", value: literal };
}

function parseFilter(value: unknown): Filter {
  if (typeof value === "string") return comparison(value);
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && ["and", "or", "not"].includes(keys[0]) && Array.isArray(value[keys[0]])) {
      const parts = (value[keys[0]] as unknown[]).map(parseFilter);
      return keys[0] === "and" ? { all: parts } : keys[0] === "or" ? { any: parts } : { none: parts };
    }
  }
  throw new Unsupported(`the filter ${JSON.stringify(value)}`);
}

const VIEW_KEYS_THAT_CHANGE_THE_RESULT = ["groupBy", "summaries"];

function parseView(raw: unknown, index: number): BaseView {
  const record = isRecord(raw) ? raw : {};
  const name = typeof record.name === "string" && record.name ? record.name : `View ${index + 1}`;
  const view: BaseView = { name, columns: ["file.name"], sort: [], filter: null, limit: null, problem: null };
  try {
    if (record.type !== "table") throw new Unsupported(`the view type ${String(record.type ?? "(none)")}`);
    for (const key of VIEW_KEYS_THAT_CHANGE_THE_RESULT) if (record[key] !== undefined) throw new Unsupported(`the option ${key}`);
    if (record.order !== undefined) {
      if (!Array.isArray(record.order) || !record.order.length) throw new Unsupported("this list of columns");
      view.columns = record.order.map((column) => normalise(String(column)));
    }
    if (record.sort !== undefined) {
      if (!Array.isArray(record.sort)) throw new Unsupported("this sort order");
      view.sort = record.sort.map((entry) => {
        if (!isRecord(entry) || typeof entry.property !== "string") throw new Unsupported("this sort order");
        return { property: normalise(entry.property), descending: String(entry.direction ?? "ASC").toUpperCase() === "DESC" };
      });
    }
    if (record.filters !== undefined) view.filter = parseFilter(record.filters);
    if (record.limit !== undefined) {
      if (!Number.isInteger(record.limit) || (record.limit as number) < 0) throw new Unsupported("this limit");
      view.limit = record.limit as number;
    }
  } catch (error) {
    if (!(error instanceof Unsupported)) throw error;
    view.problem = `Waymark cannot evaluate ${error.message}, so this view is not shown.`;
  }
  return view;
}

/** Reads a `.base` file. Aliases are capped and only plain YAML types are built, so a hostile file cannot run anything. */
export function parseBase(text: string): ParsedBase {
  if (text.length > MAX_BASE_BYTES) return { ok: false, error: "This file is too large to read as a view." };
  let raw: unknown;
  try {
    raw = parse(text, { maxAliasCount: 20, schema: "core", logLevel: "error" });
  } catch (error) {
    return { ok: false, error: `This file is not valid YAML. ${(error as Error).message.split("\n")[0]}` };
  }
  if (raw === null || raw === undefined) raw = {};
  if (!isRecord(raw)) return { ok: false, error: "This file does not describe a view." };
  if (raw.views !== undefined && !Array.isArray(raw.views)) return { ok: false, error: "The views in this file are not a list." };
  const base: BaseFile = { filter: null, labels: new Map(), views: [], problem: null };
  if (raw.filters !== undefined) {
    try {
      base.filter = parseFilter(raw.filters);
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error;
      base.problem = `Waymark cannot evaluate ${error.message}, so this file's views are not shown.`;
    }
  }
  if (isRecord(raw.properties)) {
    for (const [key, value] of Object.entries(raw.properties)) {
      if (!isRecord(value) || typeof value.displayName !== "string") continue;
      try {
        base.labels.set(normalise(key), value.displayName);
      } catch (error) {
        if (!(error instanceof Unsupported)) throw error;
      }
    }
  }
  base.views = ((raw.views as unknown[] | undefined) ?? []).map(parseView);
  return { ok: true, base };
}

export function cellValue(row: BaseRow, property: string): string | string[] | number | undefined {
  const dot = property.indexOf(".");
  const field = property.slice(dot + 1);
  return property.startsWith("file.") ? row.file[field as keyof BaseRow["file"]] : row.note[field];
}

export function matches(filter: Filter | null, row: BaseRow): boolean {
  if (!filter) return true;
  if ("all" in filter) return filter.all.every((part) => matches(part, row));
  if ("any" in filter) return filter.any.some((part) => matches(part, row));
  if ("none" in filter) return !filter.none.some((part) => matches(part, row));
  const value = cellValue(row, filter.property);
  const same = !Array.isArray(value) && value !== undefined && String(value) === filter.value;
  return same === filter.equals;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(a: BaseRow, b: BaseRow, { property, descending }: BaseSort): number {
  const [x, y] = [cellValue(a, property), cellValue(b, property)];
  if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
  const order = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
  return descending ? -order : order;
}

/** The rows a view shows, in its order. */
export function rowsFor(base: BaseFile, view: BaseView, rows: BaseRow[]): BaseRow[] {
  const kept = rows.filter((row) => matches(base.filter, row) && matches(view.filter, row));
  const sorted = view.sort.length
    ? [...kept].sort((a, b) => {
        for (const key of view.sort) {
          const order = compare(a, b, key);
          if (order) return order;
        }
        return 0;
      })
    : kept;
  return view.limit === null ? sorted : sorted.slice(0, view.limit);
}

/** The heading of a column: the file's display name, or the property's own name. */
export function columnLabel(base: BaseFile, property: string): string {
  return base.labels.get(property) ?? property.replace(/^note\./, "");
}
