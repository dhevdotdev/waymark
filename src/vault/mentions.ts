import { frontmatterParts } from "./frontmatter";

/** One place where a note's name appears in another note's text without a link. */
export interface Mention {
  /** Offset of the matched text in the note's full source. */
  at: number;
  /** The text as written, which may differ in case from the name. */
  text: string;
  /** The words around it on its line, with the match between `before` and `after`. */
  before: string;
  after: string;
}

/*
 * Everything that is not prose a link could be written into: code, comments, math, existing links and embeds, web
 * addresses, HTML tags and tags. No lookbehind, because the system WebKit runs that form without its JIT.
 */
const NOT_PROSE = new RegExp(
  [
    String.raw`^ {0,3}(\x60{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))`,
    String.raw`(\x60+)[^\x60]*?\2`,
    String.raw`<!--[\s\S]*?-->`,
    String.raw`%%[\s\S]*?%%`,
    String.raw`\$\$[\s\S]*?\$\$`,
    String.raw`!?\[\[[^\]\n]*\]\]`,
    String.raw`!?\[[^\]\n]*\]\([^)\n]*\)`,
    String.raw`\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+`,
    String.raw`\bwww\.[^\s<>]+`,
    String.raw`<\/?[a-z][^>\n]*>`,
    String.raw`(?:^|[ \t])#[^\s#]+`,
  ].join("|"),
  "gimu",
);

const WORD = /[\p{L}\p{N}_]/u;
/* The match leads its snippet, so it stays in sight when the snippet is cut to two lines of a narrow panel. */
const SNIPPET_BEFORE = 28;
const SNIPPET_AFTER = 80;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The source with everything that is not prose blanked out, keeping every offset and line break. */
export function proseOnly(source: string): string {
  const end = frontmatterParts(source)?.end ?? 0;
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return blank(source.slice(0, end)) + source.slice(end).replace(NOT_PROSE, blank);
}

/** The names a note answers to, longest first so a longer name wins where two overlap. One letter would match everywhere. */
export function mentionNames(title: string, aliases: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const name of [title, ...aliases]) {
    const trimmed = name.trim();
    const key = trimmed.normalize("NFC").toLowerCase();
    if ([...trimmed].length > 1 && !seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()].sort((a, b) => b.length - a.length);
}

/** A pattern for any of the names, whole words only, ignoring case. Spaces in a name match a run of spaces or tabs. */
export function namePattern(names: readonly string[]): RegExp | null {
  if (!names.length) return null;
  const alternatives = names.map((name) => name.normalize("NFC").split(/\s+/).map(escapeRegExp).join("[ \\t]+"));
  return new RegExp(alternatives.join("|"), "giu");
}

function standsAlone(text: string, from: number, to: number): boolean {
  return !(from > 0 && WORD.test(text[from - 1])) && !(to < text.length && WORD.test(text[to]));
}

function snippet(source: string, from: number, to: number): Pick<Mention, "before" | "after"> {
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = source.indexOf("\n", to);
  const line = (a: number, b: number) => source.slice(a, b).replace(/\s+/g, " ");
  const start = Math.max(lineStart, from - SNIPPET_BEFORE);
  const end = Math.min(lineEnd < 0 ? source.length : lineEnd, to + SNIPPET_AFTER);
  const before = line(start, from).replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+(?:\[[ xX]\]\s+)?/, "");
  const after = line(to, end);
  return {
    before: start > lineStart ? `…${before.replace(/^\S*\s/, "")}` : before.trimStart(),
    after: end < (lineEnd < 0 ? source.length : lineEnd) ? `${after.replace(/\s\S*$/, "")}…` : after.trimEnd(),
  };
}

/** Every unlinked mention of any of `names` in `source`, in order. */
export function findMentions(source: string, pattern: RegExp, prose = proseOnly(source)): Mention[] {
  const found: Mention[] = [];
  pattern.lastIndex = 0;
  for (const match of prose.matchAll(pattern)) {
    const from = match.index;
    const to = from + match[0].length;
    if (!standsAlone(prose, from, to)) continue;
    found.push({ at: from, text: source.slice(from, to), ...snippet(source, from, to) });
  }
  return found;
}

/** The link that replaces a mention. Text that differs from the target in any way stays as written, as the link's text. */
export function mentionLink(text: string, target: string): string {
  return text === target ? `[[${target}]]` : `[[${target}|${text}]]`;
}

/** Turns the mention at `at` into a link, or returns null if the text there is no longer that unlinked mention. */
export function linkMention(source: string, pattern: RegExp, at: number, text: string, target: string): string | null {
  if (!findMentions(source, pattern).some((m) => m.at === at && m.text === text)) return null;
  return source.slice(0, at) + mentionLink(text, target) + source.slice(at + text.length);
}

/** Finds mentions across a vault, keeping each note's blanked-out text until the note changes. */
export class MentionFinder {
  private readonly prose = new Map<string, { source: string; prose: string }>();

  /** Mentions in each note of `texts` other than `except`, for the notes that have any. */
  find(texts: ReadonlyMap<string, string>, pattern: RegExp, except: string): Map<string, Mention[]> {
    const out = new Map<string, Mention[]>();
    for (const [path, source] of texts) {
      if (path === except) continue;
      let cached = this.prose.get(path);
      if (cached?.source !== source) {
        cached = { source, prose: proseOnly(source) };
        this.prose.set(path, cached);
      }
      const mentions = findMentions(source, pattern, cached.prose);
      if (mentions.length) out.set(path, mentions);
    }
    for (const path of this.prose.keys()) if (!texts.has(path)) this.prose.delete(path);
    return out;
  }
}
