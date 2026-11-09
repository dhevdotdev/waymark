import { isDesktop, native } from "../platform";
import type { PrefStore } from "../prefs";
import { nameProblem, rewriteLinks } from "../vault/link-rewrite";
import type { VaultStore } from "../vault/store";
import type { Workspace } from "../vault/workspace";
import { showContextMenu } from "./context-menu";
import type { NoteEditing } from "./note-editing";
import { Palette, type PaletteItem } from "./palette";
import { confirmAction, promptText } from "./prompts";
import { renameRecent } from "./start-page";

export interface NoteFilesHost {
  sidebar: HTMLElement;
  vault: VaultStore;
  prefs: PrefStore;
  root: string;
  workspace: Workspace;
  editing: NoteEditing;
  toast: (message: string) => void;
  notePath: () => string;
  open: (path: string, newTab?: boolean) => Promise<void>;
  /** Redraws whatever depends on which files exist. */
  redraw: () => Promise<void>;
}

interface LinkUpdate {
  path: string;
  text: string;
  next: string;
}

const UNTITLED = "Untitled";
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const inFolder = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Creating, renaming, moving and deleting notes, and keeping links true afterwards. */
export class NoteFiles {
  private readonly folderPicker: Palette;
  private moving = "";
  private moveRunning = false;

  constructor(private readonly host: NoteFilesHost) {
    this.folderPicker = new Palette(
      (query) => this.folderItems(query),
      () => this.folderItems(""),
      { placeholder: "Move to a folder, or type a new one", compact: true },
    );
    host.sidebar.addEventListener("contextmenu", (e) => this.onContextMenu(e));
  }

  async newNote(folder?: string): Promise<void> {
    const { vault, toast, open, editing } = this.host;
    const target = folder ?? (await this.defaultFolder());
    const path = this.unusedPath(target);
    try {
      const outcome = await vault.save(path, "", null);
      if (outcome.kind !== "saved") throw new Error("A note with that name appeared just now.");
      await vault.applyChanges([path]);
      await open(path);
      await editing.open({ focusTitle: true });
    } catch (error) {
      toast(error instanceof Error ? error.message : "The note could not be created.");
    }
  }

  async promptRename(path: string): Promise<void> {
    const links = this.host.vault.links.backlinks(path).length;
    const name = await promptText({
      title: "Rename note",
      value: nameOf(path),
      action: "Rename",
      hint: links ? `${plural(links, "note")} linking here will be updated.` : "",
      validate: (value) => this.renameProblem(path, value),
    });
    if (name !== null) await this.renameTo(path, name);
  }

  /** Renames a note in place. Reports the problem and returns false if the name cannot be used. */
  async renameTo(path: string, name: string): Promise<boolean> {
    const problem = this.renameProblem(path, name);
    if (problem) {
      this.host.toast(problem);
      return false;
    }
    return name === nameOf(path) || this.move(path, inFolder(folderOf(path), `${name}.md`));
  }

  promptMove(path: string): void {
    this.moving = path;
    this.folderPicker.open();
  }

  async remove(path: string): Promise<void> {
    const { vault, editing, workspace, toast, redraw } = this.host;
    const links = vault.links.backlinks(path).length;
    const confirmed = await confirmAction({
      title: `Move “${nameOf(path)}” to the Trash?`,
      body: links
        ? `${plural(links, "note")} link here, and those links will stop working.`
        : "You can put it back from the Trash in Finder.",
      action: "Move to Trash",
    });
    if (!confirmed) return;
    const beingEdited = editing.path === path;
    if (beingEdited) {
      await editing.flush();
      editing.setFrozen(true);
    }
    try {
      await vault.source.trashNote(path);
    } catch (error) {
      editing.setFrozen(false);
      toast(error instanceof Error ? error.message : "The note could not be moved to the Trash.");
      return;
    }
    if (beingEdited) editing.discard();
    await vault.applyChanges([]);
    workspace.forgetNote(path);
    await redraw();
    toast("Moved to the Trash");
  }

  private async defaultFolder(): Promise<string> {
    const { new_location, folder } = await this.obsidianNewNotePlace();
    if (new_location === "current") return folderOf(this.host.notePath());
    return new_location === "folder" ? folder : "";
  }

  private async obsidianNewNotePlace(): Promise<{ new_location: string; folder: string }> {
    const settings = await this.host.vault.source.settings();
    return { new_location: settings.newNoteLocation, folder: settings.newNoteFolder.replace(/^\/+|\/+$/g, "") };
  }

  private unusedPath(folder: string): string {
    const { notes } = this.host.vault.index;
    const taken = (path: string) => notes.some((note) => note.toLowerCase() === path.toLowerCase());
    let path = inFolder(folder, `${UNTITLED}.md`);
    for (let n = 1; taken(path); n++) path = inFolder(folder, `${UNTITLED} ${n}.md`);
    return path;
  }

  private renameProblem(path: string, name: string): string | null {
    const problem = nameProblem(name);
    if (problem) return problem;
    const next = inFolder(folderOf(path), `${name}.md`).toLowerCase();
    const clash = this.host.vault.index.notes.some((note) => note.toLowerCase() === next && note !== path);
    return clash ? "A note with that name is already in this folder." : null;
  }

  /**
   * Moves the file, then updates every note that links to it. The new text is
   * worked out first, while links still resolve as they did, and each update
   * states the text it expects, like any save.
   */
  private async move(from: string, to: string): Promise<boolean> {
    const { editing, toast } = this.host;
    if (this.moveRunning) return false;
    if (!(await editing.flush())) {
      toast("Choose what to keep in the note you are editing first.");
      return false;
    }
    this.moveRunning = true;
    editing.setFrozen(true);
    try {
      return await this.moveAndRelink(from, to);
    } catch (error) {
      toast(error instanceof Error ? error.message : "The note could not be moved.");
      return false;
    } finally {
      this.moveRunning = false;
      editing.setFrozen(false);
    }
  }

  private async moveAndRelink(from: string, to: string): Promise<boolean> {
    const { vault, workspace, prefs, root, editing, toast, redraw } = this.host;
    const planned = await this.planLinkUpdates(from, to);
    await vault.source.renameNote(from, to);
    editing.noteMoved(from, to);
    await vault.applyChanges([to]);
    workspace.replaceNote(from, to);
    renameRecent(prefs, root, from, to);
    const { count, failed } = await this.applyLinkUpdates(planned, from, to);
    await editing.vaultChanged();
    await redraw();
    if (failed) toast(`Moved, but ${plural(failed, "note")} could not be updated.`);
    else toast(count ? `Updated links in ${plural(count, "note")}` : "Moved");
    return true;
  }

  private async planLinkUpdates(from: string, to: string): Promise<LinkUpdate[]> {
    const { vault } = this.host;
    const newName = nameOf(to).toLowerCase();
    const unique = !vault.index.notes.some((note) => note !== from && nameOf(note).toLowerCase() === newName);
    const resolves = (target: string) => {
      const found = vault.index.resolve(target);
      return found.kind === "found" && found.path === from;
    };
    const updates: LinkUpdate[] = [];
    for (const path of new Set([...vault.links.backlinks(from), from])) {
      const text = await vault.read(path);
      const next = rewriteLinks(text, from, to, unique, resolves);
      if (next !== text) updates.push({ path, text, next });
    }
    return updates;
  }

  private async applyLinkUpdates(updates: LinkUpdate[], from: string, to: string): Promise<{ count: number; failed: number }> {
    const { vault } = this.host;
    let count = 0;
    let failed = 0;
    for (const { path, text, next } of updates) {
      const outcome = await vault.save(path === from ? to : path, next, text).catch(() => null);
      if (outcome?.kind === "saved") count++;
      else failed++;
    }
    return { count, failed };
  }

  private folderItems(query: string): PaletteItem[] {
    const folders = [...new Set(this.host.vault.index.notes.flatMap((note) => this.parents(note)))].sort((a, b) =>
      a.localeCompare(b),
    );
    const go = (folder: string) => void this.move(this.moving, inFolder(folder, `${nameOf(this.moving)}.md`));
    const items: PaletteItem[] = [
      { id: "root", label: "Vault root", group: "Folders", run: () => go("") },
      ...folders.map((folder) => ({ id: folder, label: folder, group: "Folders", run: () => go(folder) })),
    ];
    const typed = query.trim().replace(/^\/+|\/+$/g, "");
    const valid = typed !== "" && typed.split("/").every((part) => nameProblem(part) === null);
    if (valid && !folders.includes(typed)) {
      items.push({ id: `new:${typed}`, label: typed, detail: "New folder", group: "Folders", run: () => go(typed) });
    }
    return items;
  }

  private parents(path: string): string[] {
    const parts = path.split("/").slice(0, -1);
    return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  }

  private onContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const note = target.closest<HTMLElement>(".nav-item[data-path]");
    const folder = target.closest<HTMLElement>(".tree-head[data-folder]");
    if (!note && !folder) return;
    e.preventDefault();
    if (folder) {
      showContextMenu(e.clientX, e.clientY, [{ label: "New note here", run: () => void this.newNote(folder.dataset.folder) }]);
      return;
    }
    const path = note!.dataset.path!;
    showContextMenu(e.clientX, e.clientY, [
      { label: "Open in new tab", run: () => void this.host.open(path, true) },
      { label: "Rename…", run: () => void this.promptRename(path) },
      { label: "Move to…", run: () => this.promptMove(path) },
      ...(isDesktop ? [{ label: "Reveal in Finder", run: () => void native.reveal(path) }] : []),
      { label: "Move to Trash", run: () => void this.remove(path) },
    ]);
  }
}
