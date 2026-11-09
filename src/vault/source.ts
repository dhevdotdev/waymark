/** What a save did. Anything but `saved` left the file as it was. */
export type WriteOutcome = { kind: "saved" } | { kind: "changed"; current: string } | { kind: "missing" };

/** Access to vault files. The desktop build backs this with Rust commands. */
export interface VaultSource {
  list(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readMany(paths: string[]): Promise<(string | null)[]>;
  /** Replaces a note only if it still holds `expected`. A null `expected` creates a note that must not exist yet. */
  writeNote(path: string, text: string, expected: string | null): Promise<WriteOutcome>;
  assetUrl(path: string): string;
}

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
