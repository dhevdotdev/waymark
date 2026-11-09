export type Resolution = { kind: "found"; path: string } | { kind: "ambiguous"; candidates: string[] } | { kind: "missing" };

const NOTE_EXT = ".md";

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function stripExt(name: string): string {
  return name.toLowerCase().endsWith(NOTE_EXT) ? name.slice(0, -NOTE_EXT.length) : name;
}

export function folderOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** Follows a relative path from a folder. Null means it climbs out of the vault. */
export function joinPath(folder: string, relative: string): string | null {
  const parts = folder ? folder.split("/") : [];
  for (const part of relative.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part !== "." && part !== "") {
      parts.push(part);
    }
  }
  return parts.join("/");
}

/** A Markdown link's destination, as a source for a larger pattern. */
export const MARKDOWN_DESTINATION = String.raw`(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)`;
export const MARKDOWN_TITLE = String.raw`(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?`;

export interface LocalTarget {
  /** The path as the file system knows it, with percent escapes undone. */
  path: string;
  /** Any `#heading`, exactly as written. */
  fragment: string;
}

/** What a Markdown link's destination names inside the vault, or null for a URL, a heading in this note or malformed escapes. */
export function localTarget(destination: string): LocalTarget | null {
  const raw = destination.startsWith("<") ? destination.slice(1, -1) : destination;
  if (!raw || raw.startsWith("#") || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const hash = raw.indexOf("#");
  const encoded = hash < 0 ? raw : raw.slice(0, hash);
  try {
    return { path: decodeURI(encoded), fragment: hash < 0 ? "" : raw.slice(hash) };
  } catch {
    return null;
  }
}

const fold = (s: string) => s.normalize("NFC").toLowerCase();

/**
 * Maps link text to vault paths the way Obsidian does, except that a name shared
 * by several files resolves to "ambiguous" instead of silently picking one.
 */
const BASE_EXT = /\.base$/i;

export const isBaseFile = (path: string): boolean => BASE_EXT.test(path);

export class VaultIndex {
  readonly notes: string[];
  readonly attachments: string[];
  /** Saved views. These are files the app shows but never writes. */
  readonly bases: string[];
  /** Everything on disk, including what the vault's settings exclude. */
  readonly allFiles: string[];
  private byName = new Map<string, string[]>();
  private byPath = new Map<string, string>();
  private aliases = new Map<string, string[]>();
  private aliasesOf = new Map<string, string[]>();

  /** Excluded files disappear from every list, but a link to one still resolves. */
  constructor(files: string[], excluded: (path: string) => boolean = () => false) {
    const shown = files.filter((f) => !excluded(f));
    this.allFiles = files;
    this.notes = shown.filter((f) => f.toLowerCase().endsWith(NOTE_EXT));
    this.attachments = shown.filter((f) => !f.toLowerCase().endsWith(NOTE_EXT));
    this.bases = shown.filter(isBaseFile);
    for (const file of files) {
      const isNote = file.toLowerCase().endsWith(NOTE_EXT);
      const key = fold(isNote ? stripExt(basename(file)) : basename(file));
      const list = this.byName.get(key) ?? [];
      list.push(file);
      this.byName.set(key, list);
      this.byPath.set(fold(isNote ? stripExt(file) : file), file);
    }
  }

  /** Replaces a note's aliases. Returns whether they changed, since links may then resolve differently. */
  setAliases(path: string, aliases: string[]): boolean {
    const next = [...new Set(aliases.map(fold))];
    const previous = this.aliasesOf.get(path) ?? [];
    if (previous.length === next.length && previous.every((key) => next.includes(key))) return false;
    for (const key of previous) {
      const remaining = (this.aliases.get(key) ?? []).filter((owner) => owner !== path);
      if (remaining.length) this.aliases.set(key, remaining);
      else this.aliases.delete(key);
    }
    for (const key of next) this.aliases.set(key, [...(this.aliases.get(key) ?? []), path]);
    this.aliasesOf.set(path, next);
    return true;
  }

  /** Resolves the target part of `[[target#heading|alias]]` or `![[file.png]]`. */
  resolve(target: string, wantNote = true): Resolution {
    const raw = target.trim().replace(/^\.?\//, "");
    if (!raw) return { kind: "missing" };
    const key = fold(wantNote ? stripExt(raw) : raw);

    if (key.includes("/")) {
      const wanted = (file: string) => !wantNote || file.toLowerCase().endsWith(NOTE_EXT);
      const exact = this.byPath.get(key);
      if (exact && wanted(exact)) return { kind: "found", path: exact };
      return pick([...this.byPath.entries()].filter(([p, f]) => p.endsWith(`/${key}`) && wanted(f)).map(([, f]) => f));
    }

    const named = (this.byName.get(key) ?? []).filter((f) => f.toLowerCase().endsWith(NOTE_EXT) === wantNote || !wantNote);
    if (named.length) return pick(named);
    if (wantNote) return pick(this.aliases.get(key) ?? []);
    return { kind: "missing" };
  }

  /** Resolves a Markdown link written in the note at `source`. It means a path from that note's folder before it means a name in the vault. */
  resolveFrom(target: string, source: string, wantNote = true): Resolution {
    if (target.startsWith("/")) return this.resolve(target, wantNote);
    const joined = joinPath(folderOf(source), target);
    const exact = joined === null ? undefined : this.byPath.get(fold(wantNote ? stripExt(joined) : joined));
    if (exact) return { kind: "found", path: exact };
    return target.startsWith(".") ? { kind: "missing" } : this.resolve(target, wantNote);
  }

  title(path: string): string {
    return stripExt(basename(path)).replace(BASE_EXT, "");
  }
}

function pick(candidates: string[]): Resolution {
  if (candidates.length === 1) return { kind: "found", path: candidates[0] };
  if (candidates.length > 1) return { kind: "ambiguous", candidates: [...candidates].sort() };
  return { kind: "missing" };
}

/** Obsidian heading match: case-insensitive, punctuation-insensitive text comparison. */
/** A link names an attachment only when it has a file extension and no note answers to it, so "Node.js" can be a note. */
export function isAttachmentTarget(index: VaultIndex, target: string): boolean {
  return /\.[a-z0-9]{2,5}$/i.test(target) && !/\.md$/i.test(target) && index.resolve(target, true).kind === "missing";
}

export function headingKey(text: string): string {
  return fold(text)
    .replace(/[`*_~=[\]]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function headingId(text: string): string {
  return `h-${headingKey(text).replace(/ /g, "-")}`;
}
