export type Resolution = { kind: "found"; path: string } | { kind: "ambiguous"; candidates: string[] } | { kind: "missing" };

const NOTE_EXT = ".md";

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stripExt(name: string): string {
  return name.toLowerCase().endsWith(NOTE_EXT) ? name.slice(0, -NOTE_EXT.length) : name;
}

const fold = (s: string) => s.normalize("NFC").toLowerCase();

/**
 * Maps link text to vault paths the way Obsidian does, except that a name shared
 * by several files resolves to "ambiguous" instead of silently picking one.
 */
export class VaultIndex {
  readonly notes: string[];
  readonly attachments: string[];
  private byName = new Map<string, string[]>();
  private byPath = new Map<string, string>();
  private aliases = new Map<string, string[]>();

  constructor(files: string[]) {
    this.notes = files.filter((f) => f.toLowerCase().endsWith(NOTE_EXT));
    this.attachments = files.filter((f) => !f.toLowerCase().endsWith(NOTE_EXT));
    for (const file of files) {
      const isNote = file.toLowerCase().endsWith(NOTE_EXT);
      const key = fold(isNote ? stripExt(basename(file)) : basename(file));
      const list = this.byName.get(key) ?? [];
      list.push(file);
      this.byName.set(key, list);
      this.byPath.set(fold(isNote ? stripExt(file) : file), file);
    }
  }

  addAliases(path: string, aliases: string[]): void {
    for (const alias of aliases) {
      const key = fold(alias);
      const list = this.aliases.get(key) ?? [];
      if (!list.includes(path)) list.push(path);
      this.aliases.set(key, list);
    }
  }

  /** Resolves the target part of `[[target#heading|alias]]` or `![[file.png]]`. */
  resolve(target: string, wantNote = true): Resolution {
    const raw = target.trim().replace(/^\.?\//, "");
    if (!raw) return { kind: "missing" };
    const key = fold(wantNote ? stripExt(raw) : raw);

    if (key.includes("/")) {
      const exact = this.byPath.get(key);
      if (exact) return { kind: "found", path: exact };
      const suffix = [...this.byPath.entries()].filter(([p]) => p.endsWith(`/${key}`)).map(([, f]) => f);
      return pick(suffix);
    }

    const named = (this.byName.get(key) ?? []).filter((f) => f.toLowerCase().endsWith(NOTE_EXT) === wantNote || !wantNote);
    if (named.length) return pick(named);
    if (wantNote) return pick(this.aliases.get(key) ?? []);
    return { kind: "missing" };
  }

  title(path: string): string {
    return stripExt(basename(path));
  }
}

function pick(candidates: string[]): Resolution {
  if (candidates.length === 1) return { kind: "found", path: candidates[0] };
  if (candidates.length > 1) return { kind: "ambiguous", candidates: [...candidates].sort() };
  return { kind: "missing" };
}

/** Obsidian heading match: case-insensitive, punctuation-insensitive text comparison. */
export function headingKey(text: string): string {
  return fold(text)
    .replace(/[`*_~=[\]]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function headingId(text: string): string {
  return `h-${headingKey(text).replace(/ /g, "-")}`;
}
