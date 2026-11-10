import type { Document, Scalar } from "yaml";

export type PropertyValue = string | string[];

export interface Frontmatter {
  data: Record<string, PropertyValue>;
  body: string;
  /** Lines consumed by the frontmatter block, so source positions stay meaningful. */
  offset: number;
}

export interface FrontmatterParts {
  /** The YAML between the fences, or null when the block is empty. Line endings as in the file. */
  yaml: string | null;
  /** Where the YAML starts in the file. */
  yamlStart: number;
  /** Where the block ends, closing fence and its line ending included. */
  end: number;
}

const MAX_YAML_CHARS = 64 * 1024;
const CACHED_BLOCKS = 4000;

let yaml_: typeof import("yaml") | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the YAML reader, which is too large to ship in the code a window starts
 * with. First paint only needs the block's position. Until this resolves,
 * properties come from the line reader below, which agrees on ordinary notes.
 */
export function loadYaml(): Promise<void> {
  loading ??= import("yaml")
    .then((module) => {
      yaml_ = module;
    })
    .catch((error: unknown) => console.warn("YAML reader not loaded", error));
  return loading;
}

const BLOCK = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?/;

export function frontmatterParts(source: string): FrontmatterParts | null {
  const match = BLOCK.exec(source);
  if (!match) return null;
  return { yaml: match[1] ?? null, yamlStart: source[3] === "\r" ? 5 : 4, end: match[0].length };
}

/** The note without its frontmatter, for anything that does not need the properties. */
export function noteBody(source: string): string {
  const parts = frontmatterParts(source);
  return parts ? source.slice(parts.end) : source;
}

/** Null when the block is too large, or when parsing it fails outright. Never expands aliases. */
export function parseYamlBlock(yaml: string): Document.Parsed | null {
  if (!yaml_ || yaml.length > MAX_YAML_CHARS) return null;
  try {
    return yaml_.parseDocument(yaml, { schema: "core", logLevel: "silent", uniqueKeys: false });
  } catch {
    return null;
  }
}

/** Numbers and booleans read as they were typed, so `1.0` stays `1.0`. */
function scalarText(node: Scalar): string | null {
  if (node.value === null || node.value === undefined) return null;
  return typeof node.value === "string" ? node.value : (node.source ?? String(node.value));
}

/** A nested value as it appears in the file, with its own indent taken off. */
function asWritten(node: { range?: [number, number, number] | null }, yaml: string): string {
  const [start, end] = node.range ?? [0, 0];
  const indent = start - (yaml.lastIndexOf("\n", start - 1) + 1);
  const margin = new RegExp(`^ {0,${indent}}`, "gm");
  return yaml.slice(start, end).trimEnd().replace(margin, "");
}

export function propertyValue(node: unknown, doc: Document.Parsed, yaml: string): PropertyValue {
  const { isAlias, isMap, isScalar, isSeq } = yaml_ as typeof import("yaml");
  const target = isAlias(node) ? node.resolve(doc) : node;
  if (isScalar(target)) return scalarText(target) ?? [];
  if (isSeq(target) && target.items.every((item) => item === null || isScalar(item))) {
    return (target.items as (Scalar | null)[]).flatMap((item) => (item && scalarText(item)) || []);
  }
  return isMap(target) || isSeq(target) ? asWritten(target, yaml) : [];
}

function fromDocument(doc: Document.Parsed, yaml: string): Record<string, PropertyValue> {
  const { isMap, isScalar } = yaml_ as typeof import("yaml");
  const data: Record<string, PropertyValue> = Object.create(null);
  if (!isMap(doc.contents)) return data;
  for (const pair of doc.contents.items) {
    if (isScalar(pair.key) && pair.key.value !== null) data[String(pair.key.value)] = propertyValue(pair.value, doc, yaml);
  }
  return data;
}

function unquote(v: string): string {
  return v.replace(/^(['"])(.*)\1$/, "$2");
}

/** YAML that does not parse is read line by line, so one bad value does not cost a note its other properties. */
function salvage(yaml: string): Record<string, PropertyValue> {
  const data: Record<string, PropertyValue> = Object.create(null);
  let listKey: string | null = null;
  for (const line of yaml.split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const pair = /^([^\s:#][^:]*?):(?:\s+(.*))?$/.exec(line);
    if (!pair) continue;
    const value = pair[2] ?? "";
    listKey = value === "" ? pair[1] : null;
    if (value === "") data[pair[1]] = [];
    else if (/^\[.*\]$/.test(value)) {
      data[pair[1]] = value
        .slice(1, -1)
        .split(",")
        .map((v) => unquote(v.trim()))
        .filter(Boolean);
    } else data[pair[1]] = unquote(value);
  }
  return data;
}

const cache = new Map<string, Record<string, PropertyValue>>();

function properties(yaml: string): Record<string, PropertyValue> {
  if (!yaml_) return salvage(yaml.slice(0, MAX_YAML_CHARS));
  const known = cache.get(yaml);
  if (known) return known;
  const doc = parseYamlBlock(yaml);
  const data = doc && doc.errors.length === 0 ? fromDocument(doc, yaml) : salvage(yaml.slice(0, MAX_YAML_CHARS));
  if (cache.size >= CACHED_BLOCKS) cache.clear();
  cache.set(yaml, data);
  return data;
}

/** Reads a note's properties. The result may be shared between callers, so it is never changed. */
export function parseFrontmatter(source: string): Frontmatter {
  const parts = frontmatterParts(source);
  if (!parts) return { data: Object.create(null), body: source, offset: 0 };
  const consumed = source.slice(0, parts.end);
  return {
    data: parts.yaml === null ? Object.create(null) : properties(parts.yaml),
    body: source.slice(parts.end),
    offset: consumed.split("\n").length - 1,
  };
}
