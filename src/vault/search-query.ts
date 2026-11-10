/** A search as typed, split into what must match and what narrows the result. */
export interface SearchQuery {
  words: string[];
  phrases: string[];
  notWords: string[];
  notPhrases: string[];
  paths: string[];
  notPaths: string[];
}

const TOKEN = /(-?)(?:(path):)?(?:"([^"]*)"|(\S+))/gi;

/** Reads `path:folder`, `-word` and `"a phrase"`, in any order. A half-typed filter counts for nothing yet. */
export function parseSearchQuery(raw: string): SearchQuery {
  const query: SearchQuery = { words: [], phrases: [], notWords: [], notPhrases: [], paths: [], notPaths: [] };
  for (const [, minus, field, quoted, bare] of raw.matchAll(TOKEN)) {
    const value = (quoted ?? bare ?? "").replace(/"/g, "").trim();
    const not = minus === "-";
    const openQuote = quoted === undefined && bare?.startsWith('"') && (not || !!field);
    if (!value || value === "-" || value.toLowerCase() === "path:" || openQuote) continue;
    if (field) (not ? query.notPaths : query.paths).push(value);
    else if (quoted !== undefined) (not ? query.notPhrases : query.phrases).push(value);
    else (not ? query.notWords : query.words).push(value);
  }
  return query;
}

/** True when the query needs more than plain text search, which keeps its own ranking for phrases and typed order. */
export function usesFilters(query: SearchQuery): boolean {
  const { notWords, notPhrases, paths, notPaths, phrases, words } = query;
  return (
    notWords.length + notPhrases.length + paths.length + notPaths.length > 0 ||
    phrases.length > 1 ||
    (phrases.length === 1 && words.length > 0)
  );
}

const includesWord = (text: string, word: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text);

/** Whether a note passes every filter. `text` is the note's title and body. */
export function passesFilters(query: SearchQuery, path: string, text: string): boolean {
  const lowerPath = path.toLowerCase();
  const lower = text.toLowerCase();
  return (
    query.paths.every((part) => lowerPath.includes(part.toLowerCase())) &&
    !query.notPaths.some((part) => lowerPath.includes(part.toLowerCase())) &&
    query.phrases.every((phrase) => lower.includes(phrase.toLowerCase())) &&
    !query.notPhrases.some((phrase) => lower.includes(phrase.toLowerCase())) &&
    !query.notWords.some((word) => includesWord(text, word))
  );
}
