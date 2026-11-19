import { nameProblem } from "./link-rewrite";

/** Where the vault's Obsidian settings put a new note. */
export interface NewNotePlace {
  /** Obsidian's `newFileLocation`: "current", "folder", or anything else for the vault root. */
  location: string;
  /** Obsidian's `newFileFolderPath`, without leading or trailing slashes. */
  folder: string;
  /** The folder of the note the link is written in. */
  here: string;
}

export type LinkedNote = { kind: "path"; path: string } | { kind: "refused"; reason: string };

/**
 * The file a missing link asks for. A target that names a folder, or starts with "/", is a path from the vault root, as
 * in Obsidian. A bare name goes where new notes go.
 */
export function linkedNotePath(target: string, place: NewNotePlace): LinkedNote {
  const written = target.trim().replace(/\.md$/i, "");
  const parts = written.split("/").filter((part) => part !== "");
  if (!parts.length) return { kind: "refused", reason: "This link has no name to give a note." };
  for (const part of parts) {
    const problem = nameProblem(part);
    if (problem) return { kind: "refused", reason: `No note was created for “${target}”. ${problem}` };
  }
  const name = parts.join("/");
  if (written.startsWith("/") || parts.length > 1) return { kind: "path", path: `${name}.md` };
  const folder = place.location === "current" ? place.here : place.location === "folder" ? place.folder : "";
  return { kind: "path", path: folder ? `${folder}/${name}.md` : `${name}.md` };
}
