/** What a save did. Anything but `saved` left the file as it was. */
export type WriteOutcome = { kind: "saved" } | { kind: "changed"; current: string } | { kind: "missing" };

/** Access to vault files. The desktop build backs this with Rust commands. */
/** The Obsidian settings the app follows. Empty means Obsidian's default. */
export interface VaultSettings {
  attachmentFolder: string;
  newNoteLocation: string;
  newNoteFolder: string;
  /** Obsidian's "Excluded files" list, as written in its settings. */
  ignoreFilters: string[];
}

export interface FileStat {
  mtime: number;
  ctime: number;
  size: number;
}

export interface VaultSource {
  list(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readMany(paths: string[]): Promise<(string | null)[]>;
  /** Replaces a note only if it still holds `expected`. A null `expected` creates a note that must not exist yet. */
  writeNote(path: string, text: string, expected: string | null): Promise<WriteOutcome>;
  /** Moves a note. Fails rather than landing on anything that exists. */
  renameNote(from: string, to: string): Promise<void>;
  trashNote(path: string): Promise<void>;
  /** Puts text in the macOS Trash as a new file named `name`, so a version being replaced can be recovered. */
  keepInTrash(name: string, text: string): Promise<void>;
  /** Moves a folder and everything in it. Fails rather than landing on anything that exists. */
  renameFolder(from: string, to: string): Promise<void>;
  trashFolder(path: string): Promise<void>;
  /** Adds an image or PDF. Fails rather than replacing a file. */
  writeAttachment(path: string, bytes: Uint8Array): Promise<void>;
  settings(): Promise<VaultSettings>;
  /** When each file was last changed and created, and its size. A file that is gone is left out. */
  fileStats(paths: string[]): Promise<Record<string, FileStat>>;
  assetUrl(path: string): string;
}

const post = async (url: string, body: BodyInit, failure: string) => {
  const res = await fetch(url, { method: "POST", headers: { "x-waymark": "1" }, body });
  if (!res.ok) throw new Error(failure);
};

export function devVaultSource(): VaultSource {
  const fileUrl = (path: string) => `/@vault/file?path=${encodeURIComponent(path)}`;
  const readText = async (path: string) => {
    const res = await fetch(fileUrl(path));
    if (!res.ok) throw new Error(`Could not read ${path} (${res.status})`);
    return res.text();
  };
  return {
    async list() {
      const res = await fetch("/@vault/index");
      if (!res.ok) throw new Error(`Vault index unavailable (${res.status})`);
      return res.json();
    },
    readText,
    readMany: (paths) => Promise.all(paths.map((p) => readText(p).catch(() => null))),
    async renameNote(from, to) {
      await post("/@vault/rename", JSON.stringify({ from, to }), `Could not move ${from}`);
    },
    async trashNote(path) {
      await post("/@vault/trash", JSON.stringify({ path }), `Could not remove ${path}`);
    },
    async keepInTrash(name, text) {
      await post("/@vault/keep-in-trash", JSON.stringify({ name, text }), `Could not keep ${name}`);
    },
    async renameFolder(from, to) {
      await post("/@vault/rename", JSON.stringify({ from, to }), `Could not rename ${from}`);
    },
    async trashFolder(path) {
      await post("/@vault/trash-folder", JSON.stringify({ path }), `Could not remove ${path}`);
    },
    async writeAttachment(path, bytes) {
      await post(`/@vault/attachment?path=${encodeURIComponent(path)}`, bytes as BodyInit, `Could not add ${path}`);
    },
    async fileStats(paths) {
      const res = await fetch("/@vault/stats", { method: "POST", headers: { "x-waymark": "1" }, body: JSON.stringify(paths) });
      return res.json();
    },
    async settings() {
      const res = await fetch("/@vault/settings");
      return res.json();
    },
    async writeNote(path, text, expected) {
      const res = await fetch("/@vault/write", {
        method: "POST",
        headers: { "x-waymark": "1" },
        body: JSON.stringify({ path, text, expected }),
      });
      if (!res.ok) throw new Error(`Could not save ${path} (${res.status})`);
      return res.json();
    },
    assetUrl: fileUrl,
  };
}
