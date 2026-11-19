/** How long a pause ends a typed name, as in Finder. */
const PAUSE_MS = 500;

/** A key that types a character and is not a shortcut. */
export function isTypeaheadKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export interface Typeahead {
  /** The index of the label that the typed characters now reach, or -1. `from` is where focus is. */
  (key: string, labels: readonly string[], from: number): number;
  /** True while a name is being typed, so Space continues it instead of pressing the row. */
  active: () => boolean;
}

/**
 * Finds a row by typing the start of its name. Characters typed without a pause add up. The same letter pressed
 * again steps through the names that start with it.
 */
export function createTypeahead(): Typeahead {
  let typed = "";
  let last = 0;
  const find = (key: string, labels: readonly string[], from: number) => {
    const now = performance.now();
    if (now - last > PAUSE_MS) typed = "";
    last = now;
    typed += key.toLocaleLowerCase();
    const repeated = [...typed].every((c) => c === typed[0]);
    const query = repeated ? typed[0] : typed;
    const start = repeated ? from + 1 : Math.max(from, 0);
    for (let i = 0; i < labels.length; i++) {
      const at = (start + i) % labels.length;
      if (labels[at].trimStart().toLocaleLowerCase().startsWith(query)) return at;
    }
    return -1;
  };
  return Object.assign(find, { active: () => typed !== "" && performance.now() - last <= PAUSE_MS });
}
