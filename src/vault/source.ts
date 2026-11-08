/** Read-only access to vault files. The desktop build backs this with Rust commands. */
export interface VaultSource {
  list(): Promise<string[]>;
  readText(path: string): Promise<string>;
  readMany(paths: string[]): Promise<(string | null)[]>;
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
    assetUrl: fileUrl,
  };
}
