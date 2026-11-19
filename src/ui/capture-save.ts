import { captureName, captureNames } from "../vault/capture-name";
import { newNoteFolder } from "../vault/new-note-path";
import type { VaultStore } from "../vault/store";

export interface CaptureHost {
  vault: VaultStore;
  /** The note on screen, whose folder is where Obsidian's "same folder as current file" puts new notes. */
  notePath: string;
  /** Brings the tree and indexes up to date with a file that was just written. */
  refresh: (paths: string[]) => Promise<void>;
}

/**
 * Saves a capture as a new note where the vault's Obsidian settings put new notes, named from its first line. It only
 * writes the file: nothing is committed, and an existing note is never replaced.
 */
export async function saveCapture(host: CaptureHost, text: string): Promise<string> {
  const { vault, notePath } = host;
  const settings = await vault.source.settings();
  const folder = newNoteFolder({
    location: settings.newNoteLocation,
    folder: settings.newNoteFolder.replace(/^\/+|\/+$/g, ""),
    here: notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "",
  });
  const taken = new Set(vault.index.allFiles.map((file) => file.toLowerCase()));
  const body = `${text.trim()}\n`;
  for (const name of captureNames(captureName(text))) {
    const path = folder ? `${folder}/${name}.md` : `${name}.md`;
    if (taken.has(path.toLowerCase())) continue;
    const outcome = await vault.save(path, body, null);
    if (outcome.kind !== "saved") continue;
    await host.refresh([path]);
    return path;
  }
  throw new Error("Every name for this note is taken, so nothing was saved.");
}
