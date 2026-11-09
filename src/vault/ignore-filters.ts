/** Obsidian's "Excluded files": each entry is a path prefix, or a regular expression written as /pattern/. */
export function excludedBy(filters: unknown): (path: string) => boolean {
  if (!Array.isArray(filters)) return () => false;
  const tests: ((path: string) => boolean)[] = [];
  for (const filter of filters) {
    if (typeof filter !== "string" || !filter) continue;
    const pattern = /^\/(.+)\/$/.exec(filter);
    if (!pattern) {
      tests.push((path) => path.startsWith(filter));
      continue;
    }
    try {
      const expression = new RegExp(pattern[1]);
      tests.push((path) => expression.test(path));
    } catch {
      /* Obsidian ignores a pattern it cannot read, so one bad entry hides nothing. */
    }
  }
  return (path) => tests.some((test) => test(path));
}
