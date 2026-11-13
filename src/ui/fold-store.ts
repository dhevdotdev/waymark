import type { PrefStore } from "../prefs";

const NOTES_KEPT = 500;

/** Which headings are folded in each note. Kept in the app's preferences, never in the note. */
export class FoldStore {
  constructor(
    private readonly prefs: PrefStore,
    private readonly root: string,
  ) {}

  get(path: string): string[] {
    const saved = this.prefs.value.vaults[this.root]?.folds?.[path];
    return Array.isArray(saved) ? saved.filter((key): key is string => typeof key === "string") : [];
  }

  set(path: string, keys: string[]): void {
    const next = [...new Set(keys)];
    const current = this.get(path);
    if (next.length === current.length && next.every((key, i) => key === current[i])) return;
    this.prefs.update((p) => {
      p.vaults[this.root] ??= { tabs: [], active: 0, lastSync: null };
      const folds: Record<string, unknown> = p.vaults[this.root].folds ?? {};
      p.vaults[this.root].folds = folds;
      /* Deleting first puts the note last, so the oldest notes are the first keys. */
      delete folds[path];
      if (next.length) folds[path] = next;
      const paths = Object.keys(folds);
      for (const old of paths.slice(0, Math.max(0, paths.length - NOTES_KEPT))) delete folds[old];
    });
  }

  /** Keeps a note's folds when it is renamed or moved. */
  move(from: string, to: string): void {
    const keys = this.get(from);
    if (!keys.length) return;
    this.set(from, []);
    this.set(to, keys);
  }
}
