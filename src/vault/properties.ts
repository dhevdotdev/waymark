import { type Document, isAlias, isMap, isScalar, isSeq, type Pair, Scalar, type YAMLSeq } from "yaml";
import { type FrontmatterParts, frontmatterParts, type PropertyValue, parseYamlBlock, propertyValue } from "./frontmatter";
import { lineEnding } from "./tasks";

export type PropertyForm = "text" | "list" | "fixed";

export interface Property {
  key: string;
  value: PropertyValue;
  /** What can be offered. Anything that cannot be rewritten exactly is "fixed" and only opens as text. */
  form: PropertyForm;
  /** The property's line in the file, counted from zero. */
  line: number;
}

export interface PropertySheet {
  properties: Property[];
  canAdd: boolean;
}

interface Entry {
  key: string;
  pair: Pair;
  form: PropertyForm;
}

interface Located {
  parts: FrontmatterParts;
  yaml: string;
  doc: Document.Parsed;
  entries: Entry[];
}

const INLINE_STYLES: unknown[] = [Scalar.PLAIN, Scalar.QUOTE_DOUBLE, Scalar.QUOTE_SINGLE];

const simple = (node: unknown): node is Scalar =>
  isScalar(node) &&
  INLINE_STYLES.includes(node.type) &&
  !node.anchor &&
  !node.tag &&
  !node.comment &&
  !node.commentBefore &&
  !node.spaceBefore &&
  !(node.source ?? "").includes("\n");

/** A comment after a value is left where it is, so it does not stop the value being edited. */
function inlineValue(value: Scalar, yaml: string): boolean {
  const [start, end] = value.range ?? [0, 0];
  return (
    INLINE_STYLES.includes(value.type) &&
    !value.anchor &&
    !value.tag &&
    !value.commentBefore &&
    !yaml.slice(start, end).includes("\n")
  );
}

function formOf(pair: Pair, yaml: string): PropertyForm {
  const { value } = pair;
  if (value === null || (isScalar(value) && value.value === null && !value.anchor && !value.tag)) return "text";
  if (isScalar(value)) return inlineValue(value, yaml) ? "text" : "fixed";
  if (isSeq(value) && !value.anchor && !value.tag && !value.comment && !value.commentBefore) {
    return value.items.every(simple) ? "list" : "fixed";
  }
  return "fixed";
}

/** Writes refuse mixed line endings, as the editor does, because no single ending would keep the file as it was. */
function locate(source: string): Located | null {
  return lineEnding(source) === null ? null : read(source);
}

function read(source: string): Located | null {
  const parts = frontmatterParts(source);
  if (!parts || parts.yaml === null) return null;
  const yaml = parts.yaml;
  if (/^(?:\.\.\.|---|%)/m.test(yaml)) return null;
  const doc = parseYamlBlock(yaml);
  if (!doc || doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return null;
  const pairs = (isMap(doc.contents) ? doc.contents.items : []) as Pair[];
  const names = pairs.map((pair) => (isScalar(pair.key) ? String(pair.key.value) : null));
  const entries = pairs.flatMap((pair, i): Entry[] => {
    const key = names[i];
    if (key === null) return [];
    const plainKey = isScalar(pair.key) && !pair.key.anchor && !pair.key.tag && pair.key.value !== null;
    const unique = names.indexOf(key) === names.lastIndexOf(key);
    return [{ key, pair, form: plainKey && unique && !isAlias(pair.value) ? formOf(pair, yaml) : "fixed" }];
  });
  return { parts, yaml, doc, entries };
}

const lineOf = (source: string, at: number) => source.slice(0, at).split("\n").length - 1;

/** What the panel can show and offer for a note. */
export function readSheet(source: string): PropertySheet {
  const parts = frontmatterParts(source);
  if (!parts || parts.yaml === null) return { properties: [], canAdd: lineEnding(source) !== null };
  const found = read(source);
  if (!found) return { properties: [], canAdd: false };
  const { doc, yaml, entries } = found;
  const canEdit = lineEnding(source) !== null;
  return {
    canAdd: canEdit,
    properties: entries.map(({ key, pair, form }) => ({
      key,
      value: propertyValue(pair.value, doc, yaml),
      form: canEdit ? form : "fixed",
      line: lineOf(source, parts.yamlStart + ((pair.key as Scalar).range?.[0] ?? 0)),
    })),
  };
}

const NUMBER = /^[-+]?(?:\.\d+|\d[\d_]*(?:\.\d*)?)(?:e[-+]?\d+)?$|^0x[\da-f]+$|^0o[0-7]+$|^[-+]?\.(?:inf|nan)$/i;
const BOOLEAN = /^(?:yes|no|on|off|true|false)$/i;
const EMPTY_WORD = /^(?:null|~)$/i;

const staysPlain = (text: string, wrap: (t: string) => string, read: (doc: Document.Parsed) => unknown) => {
  const doc = parseYamlBlock(wrap(text));
  if (!doc || doc.errors.length > 0) return false;
  const node = read(doc);
  return isScalar(node) && node.type === Scalar.PLAIN && node.value === text;
};

function plainSafe(text: string, flow: boolean): boolean {
  if (text !== text.trim() || text === "" || /[\r\n\t]/.test(text)) return false;
  return flow
    ? staysPlain(
        text,
        (t) => `[${t}]`,
        (doc) => (isSeq(doc.contents) && doc.contents.items.length === 1 ? doc.contents.items[0] : null),
      )
    : staysPlain(
        text,
        (t) => `k: ${t}`,
        (doc) => (isMap(doc.contents) && doc.contents.items.length === 1 ? doc.contents.items[0].value : null),
      );
}

/** Written so that any YAML reader gets back this exact text. A value keeps its quoting, and its number or boolean kind. */
function encodeValue(text: string, prior: Scalar | null, flow: boolean): string {
  if (prior?.type === Scalar.QUOTE_SINGLE && !/[\r\n]/.test(text)) return `'${text.replace(/'/g, "''")}'`;
  if (prior?.type === Scalar.QUOTE_DOUBLE) return JSON.stringify(text);
  const sameKind =
    (NUMBER.test(text) && typeof prior?.value === "number") || (BOOLEAN.test(text) && typeof prior?.value === "boolean");
  if (sameKind) return text;
  if (NUMBER.test(text) || BOOLEAN.test(text) || EMPTY_WORD.test(text)) return JSON.stringify(text);
  return plainSafe(text, flow) ? text : JSON.stringify(text);
}

function encodeKey(key: string): string {
  const safe =
    key === key.trim() &&
    key !== "" &&
    !/[\r\n\t]/.test(key) &&
    !NUMBER.test(key) &&
    !BOOLEAN.test(key) &&
    !EMPTY_WORD.test(key) &&
    staysPlain(
      key,
      (t) => `${t}: v`,
      (doc) => (isMap(doc.contents) && doc.contents.items.length === 1 ? doc.contents.items[0].key : null),
    );
  return safe ? key : JSON.stringify(key);
}

const splice = (source: string, from: number, to: number, insert: string) => source.slice(0, from) + insert + source.slice(to);

const dataOf = (source: string): Map<string, string> | null => {
  const found = locate(source);
  if (!found) return null;
  return new Map(found.entries.map(({ key, pair }) => [key, JSON.stringify(propertyValue(pair.value, found.doc, found.yaml))]));
};

/** The last check on every write: the target holds what was asked for and nothing else reads differently. */
function verified(before: string, after: string, key: string, expected: PropertyValue | undefined): string | null {
  const was = dataOf(before);
  const now = frontmatterParts(after)?.yaml ? dataOf(after) : new Map<string, string>();
  if (!now) return null;
  const others = [...(was ?? [])].filter(([k]) => k !== key);
  if (others.length !== (expected === undefined ? now.size : now.size - 1)) return null;
  if (!others.every(([k, v]) => now.get(k) === v)) return null;
  return expected === undefined || now.get(key) === JSON.stringify(expected) ? after : null;
}

const entryFor = (found: Located, key: string, form: PropertyForm) => found.entries.find((e) => e.key === key && e.form === form);

function colonAfterKey(found: Located, pair: Pair): number {
  const keyEnd = (pair.key as Scalar).range?.[1] ?? 0;
  return found.yaml.indexOf(":", keyEnd);
}

/** Replaces one text property's value and touches nothing else on its line. */
export function setText(source: string, key: string, text: string): string | null {
  const found = locate(source);
  const entry = found && entryFor(found, key, "text");
  if (!found || !entry) return null;
  const base = found.parts.yamlStart;
  const colon = colonAfterKey(found, entry.pair);
  const value = entry.pair.value as Scalar | null;
  const hasValue = isScalar(value) && value.value !== null && value.range;
  const trimmed = text.trim();
  let after: string;
  if (hasValue) {
    const [start, end] = value.range as [number, number, number];
    if (trimmed === "") after = splice(source, base + colon + 1, base + end, "");
    else after = splice(source, base + start, base + end, encodeValue(trimmed, value, false));
  } else {
    if (trimmed === "") return source;
    after = splice(source, base + colon + 1, base + colon + 1, ` ${encodeValue(trimmed, null, false)}`);
  }
  return verified(source, after, key, trimmed === "" ? [] : trimmed);
}

function writeItems(found: Located, seq: YAMLSeq, items: string[]): string[] {
  const unused = new Map<string, string[]>();
  for (const item of seq.items as Scalar[]) {
    const [start, end] = item.range ?? [0, 0];
    const text = String(item.value);
    unused.set(text, [...(unused.get(text) ?? []), found.yaml.slice(start, end)]);
  }
  return items.map((item) => unused.get(item)?.shift() ?? encodeValue(item, null, seq.flow === true));
}

/** Replaces one list's items. Items that did not change keep their exact text. */
export function setList(source: string, key: string, items: string[]): string | null {
  const found = locate(source);
  const entry = found && entryFor(found, key, "list");
  if (!found || !entry) return null;
  const clean = items.map((item) => item.trim()).filter(Boolean);
  const seq = entry.pair.value as YAMLSeq;
  const base = found.parts.yamlStart;
  const written = writeItems(found, seq, clean);
  const [start, end] = seq.range ?? [0, 0];
  let after: string;
  if (seq.flow) {
    after = splice(source, base + start, base + end, `[${written.join(", ")}]`);
  } else {
    const first = (seq.items[0] as Scalar).range?.[0] ?? start;
    const lineStart = found.yaml.lastIndexOf("\n", first - 1) + 1;
    const lead = found.yaml.slice(lineStart, first);
    const last = (seq.items.at(-1) as Scalar).range?.[1] ?? end;
    const eol = lineEnding(source) ?? "\n";
    after = written.length
      ? splice(source, base + lineStart, base + last, written.map((item) => lead + item).join(eol))
      : splice(source, base + colonAfterKey(found, entry.pair) + 1, base + last, " []");
  }
  return verified(source, after, key, clean);
}

/** Takes out one property's lines. Removing the only property removes the empty block as well. */
export function removeProperty(source: string, key: string): string | null {
  const found = locate(source);
  const entry = found?.entries.find((e) => e.key === key && e.form !== "fixed");
  if (!found || !entry) return null;
  const { yaml, parts } = found;
  const keyStart = (entry.pair.key as Scalar).range?.[0] ?? 0;
  const lineStart = yaml.lastIndexOf("\n", keyStart - 1) + 1;
  const value = entry.pair.value as Scalar | YAMLSeq | null;
  const seqEnd = isSeq(value) && !value.flow ? (value.items.at(-1) as Scalar | undefined)?.range?.[1] : undefined;
  const contentEnd = seqEnd ?? Math.max(value?.range?.[1] ?? 0, colonAfterKey(found, entry.pair) + 1);
  const newline = yaml.indexOf("\n", contentEnd);
  const remaining = newline < 0 ? yaml.slice(0, lineStart) : yaml.slice(0, lineStart) + yaml.slice(newline + 1);
  const base = parts.yamlStart;
  if (remaining.trim() === "") return verified(source, source.slice(parts.end), key, undefined);
  const after =
    newline < 0
      ? splice(source, base + lineStart - (yaml[lineStart - 2] === "\r" ? 2 : 1), base + yaml.length, "")
      : splice(source, base + lineStart, base + newline + 1, "");
  return verified(source, after, key, undefined);
}

/** Adds a property at the end of the block, creating the block at the very top if the note has none. */
export function addProperty(source: string, key: string, text: string): string | null {
  const eol = lineEnding(source);
  const name = key.trim();
  if (eol === null || name === "") return null;
  const value = text.trim();
  const line = value ? `${encodeKey(name)}: ${encodeValue(value, null, false)}` : `${encodeKey(name)}:`;
  const parts = frontmatterParts(source);
  const expected = value === "" ? [] : value;
  if (!parts) return verified(source, `---${eol}${line}${eol}---${eol}${source}`, name, expected);
  if (parts.yaml === null)
    return verified(source, splice(source, parts.yamlStart, parts.yamlStart, `${line}${eol}`), name, expected);
  const found = locate(source);
  if (!found || found.entries.some((e) => e.key === name)) return null;
  const end = parts.yamlStart + parts.yaml.length;
  return verified(source, splice(source, end, end, `${eol}${line}`), name, expected);
}
