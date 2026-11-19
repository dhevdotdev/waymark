import type { VaultIndex } from "./index";

/** A note handed over from outside the app, as `src-tauri/src/open_requests.rs` describes it. */
export type OpenRequest =
  | { kind: "file"; path: string; heading: string | null }
  | { kind: "inVault"; path: string; heading: string | null }
  | { kind: "refused"; reason: string };

/** The known vault holding an absolute file path, and the file's path inside it. The deepest vault wins. */
export function vaultHolding(file: string, roots: readonly string[]): { root: string; path: string } | null {
  let best: string | null = null;
  for (const root of roots) {
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (file.startsWith(prefix) && (best === null || root.length > best.length)) best = root;
  }
  if (best === null) return null;
  return { root: best, path: file.slice(best.endsWith("/") ? best.length : best.length + 1) };
}

export type FoundNote = { kind: "found"; path: string } | { kind: "refused"; reason: string };

/** A note in the open vault by its path or by its name as a link would give it. Only notes the vault shows can match. */
export function noteNamed(index: VaultIndex, wanted: string): FoundNote {
  const lower = wanted.toLowerCase();
  const exact = index.notes.find((note) => note.toLowerCase() === lower || note.toLowerCase() === `${lower}.md`);
  if (exact) return { kind: "found", path: exact };
  const found = index.resolve(wanted);
  if (found.kind === "found") return found;
  if (found.kind === "ambiguous") {
    return { kind: "refused", reason: `More than one note is called “${wanted}”. Give its path inside the vault instead.` };
  }
  return { kind: "refused", reason: `This vault has no note “${wanted}”.` };
}
