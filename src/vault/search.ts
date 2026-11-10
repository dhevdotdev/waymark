import MiniSearch from "minisearch";
import { noteBody } from "./frontmatter";
import { plainText } from "./links";
import { parseSearchQuery, passesFilters, type SearchQuery, usesFilters } from "./search-query";

export interface Hit {
  path: string;
  title: string;
  score: number;
  terms: string[];
  snippet: { before: string; match: string; after: string; heading: string | null } | null;
}

interface Doc {
  id: string;
  title: string;
  aliases: string;
  headings: string;
  body: string;
}

/**
 * Full-text search over every note. Titles and headings weigh most; matching
 * is prefix- and typo-tolerant only for words long enough to make that useful.
 */
export class SearchIndex {
  private mini = new MiniSearch<Doc>({
    fields: ["title", "aliases", "headings", "body"],
    storeFields: ["title"],
    searchOptions: {
      boost: { title: 4, aliases: 3, headings: 2 },
      prefix: (term) => term.length > 2,
      fuzzy: (term) => (term.length > 5 ? 0.15 : false),
      combineWith: "AND",
    },
  });
  private texts = new Map<string, string>();

  set(path: string, title: string, markdown: string | null, aliases: string[] = []): void {
    if (this.mini.has(path)) this.mini.discard(path);
    this.texts.delete(path);
    if (markdown === null) return;
    const body = plainText(markdown);
    const headings = [...markdown.matchAll(/^#{1,6}\s+(.*)$/gm)].map((m) => m[1]).join("\n");
    this.texts.set(path, markdown);
    this.mini.add({ id: path, title, aliases: aliases.join(" "), headings, body });
  }

  search(query: string, limit = 40): Hit[] {
    const parsed = parseSearchQuery(query);
    if (usesFilters(parsed)) return this.filtered(parsed, limit);
    /* A filter still being typed counts for nothing, so it must not reach the words searched for. */
    const q = parsed.phrases.length ? `"${parsed.phrases[0]}"` : parsed.words.join(" ");
    if (!q) return [];
    const phrase = /^".+"$/.test(q) ? q.slice(1, -1).toLowerCase() : null;
    const matches = this.mini.search(phrase ?? q);
    const results = phrase ? matches.filter((r) => this.texts.get(r.id)?.toLowerCase().includes(phrase)) : matches;
    const hits: Hit[] = [];
    /* A note containing the words as typed, in order, outranks one that has them scattered. */
    const words = q.toLowerCase().replace(/"/g, "");
    const asTyped = !phrase && /\s/.test(words) ? words : null;
    for (const r of results.slice(0, limit * 2)) {
      const text = this.texts.get(r.id) ?? "";
      const lower = text.toLowerCase();
      const exact = phrase ?? (asTyped && lower.includes(asTyped) ? asTyped : null);
      hits.push({
        path: r.id,
        title: r.title as string,
        score: r.score * (exact ? 3 : 1),
        terms: exact ? [exact] : r.terms,
        snippet: snippet(text, exact ? [exact] : r.terms),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /** Only words and phrases are looked for and marked. Filters narrow the list and never count as a match. */
  private filtered(query: SearchQuery, limit: number): Hit[] {
    const looked = [...query.phrases, ...query.words];
    const titleOf = (id: string) => this.mini.getStoredFields(id)?.title as string;
    const found = looked.length
      ? this.mini.search(looked.join(" ")).map((r) => ({ id: r.id as string, score: r.score, terms: r.terms }))
      : [...this.texts.keys()].map((id) => ({ id, score: 0, terms: [] as string[] }));
    const hits = found
      .filter(({ id }) => passesFilters(query, id, `${titleOf(id)}\n${this.texts.get(id) ?? ""}`))
      .map(({ id, score, terms }): Hit => {
        const marked = query.phrases.length ? [...query.phrases, ...query.words].map((part) => part.toLowerCase()) : terms;
        return {
          path: id,
          title: titleOf(id),
          score,
          terms: marked,
          snippet: marked.length ? snippet(this.texts.get(id) ?? "", marked) : null,
        };
      });
    hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return hits.slice(0, limit);
  }
}

/** Terms this short match only as whole words, so the snippet must not mark a longer word that merely starts with them. */
const WHOLE_WORD_TERM_LENGTH = 2;

function snippet(markdown: string, terms: string[]): Hit["snippet"] {
  const body = noteBody(markdown);
  const lower = body.toLowerCase();
  let best = -1;
  let term = "";
  for (const t of [...terms].sort((a, b) => b.length - a.length)) {
    const wholeWord = t.length <= WHOLE_WORD_TERM_LENGTH ? "(?![\\p{L}\\p{N}])" : "";
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(t)}${wholeWord}`, "iu");
    const m = re.exec(body);
    const at = m ? m.index + m[1].length : wholeWord ? -1 : lower.indexOf(t.toLowerCase());
    if (at >= 0 && !isHeadingLine(body, at)) {
      best = at;
      term = t;
      break;
    }
    if (at >= 0 && best < 0) {
      best = at;
      term = t;
    }
  }
  if (best < 0) return null;
  const lineStart = body.lastIndexOf("\n", best) + 1;
  const lineEnd = body.indexOf("\n", best);
  const line = body.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
  const col = best - lineStart;
  const wordEnd = col + (/^[\p{L}\p{N}_-]*/u.exec(line.slice(col + term.length))?.[0].length ?? 0) + term.length;
  const clean = (s: string) => plainText(s).replace(/\s+/g, " ");
  const before = clean(line.slice(Math.max(0, col - 70), col));
  const after = clean(line.slice(wordEnd, wordEnd + 120));
  const headingMatch = [...body.slice(0, best).matchAll(/^#{1,6}\s+(.*)$/gm)].pop();
  return {
    before: (col > 70 ? "…" : "") + before.trimStart(),
    match: line.slice(col, wordEnd),
    after,
    heading: headingMatch ? headingMatch[1].replace(/`/g, "") : null,
  };
}

function isHeadingLine(body: string, at: number): boolean {
  const start = body.lastIndexOf("\n", at) + 1;
  return /^#{1,6}\s/.test(body.slice(start, start + 7));
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
