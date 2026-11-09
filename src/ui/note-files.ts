import { isDesktop, native } from "../platform";
import type { PrefStore } from "../prefs";
import { isBaseFile } from "../vault/index";
import { linkMoves, nameProblem, rewriteLinks } from "../vault/link-rewrite";
import type { VaultStore } from "../vault/store";
import type { Workspace } from "../vault/workspace";
import type { Bookmarks } from "./bookmarks";
import { type MenuItem, showContextMenu } from "./context-menu";
import type { FileTree } from "./file-tree";
import { icons } from "./icons";
import { nameInPlace } from "./inline-name";
import type { NoteEditing } from "./note-editing";
import { Palette, type PaletteItem } from "./palette";
import { plural } from "./plural";
import { confirmAction, promptText } from "./prompts";
import { moveSpot } from "./reading-spots";
import { type RowAction, RowActions } from "./row-actions";
import { renameRecent } from "./start-page";

export interface NoteFilesHost {
  sidebar: HTMLElement;
  vault: VaultStore;
  prefs: PrefStore;
  root: string;
  workspace: Workspace;
  editing: NoteEditing;
  tree: FileTree;
  toast: (message: string) => void;
  notePath: () => string;
  open: (path: string, newTab?: boolean) => Promise<void>;
  bookmarks: Bookmarks;
  /** Redraws whatever depends on which files exist. */
  redraw: () => Promise<void>;
}

interface LinkUpdate {
  path: string;
  text: string;
  next: string;
}

const UNTITLED = "Untitled";
const MENU_GAP = 4;
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const inFolder = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
const folderName = (folder: string) => folder.slice(folder.lastIndexOf("/") + 1);
const isInside = (folder: string, path: string) => path.startsWith(`${folder}/`);

/** Creating, renaming, moving and deleting notes, and keeping links true afterwards. */
export class NoteFiles {
  private readonly folderPicker: Palette;
  private moving = "";
  private moveRunning = false;
  private readonly rows: RowActions;

  constructor(private readonly host: NoteFilesHost) {
    this.folderPicker = new Palette(
      (query) => this.folderItems(query),
      () => this.folderItems(""),
      { placeholder: "Move to a folder, or type a new one", compact: true },
    );
    host.sidebar.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    this.rows = new RowActions(host.sidebar, (row) => this.rowActions(row));
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

  async startRename(path: string): Promise<void> {
    const name = await this.askName(this.visibleRow(`.nav-item[data-path="${CSS.escape(path)}"]`), {
      title: "Rename note",
      value: nameOf(path),
      problem: (value) => this.renameProblem(path, value),
    });
    if (name !== null) await this.renameTo(path, name);
  }

  /** A folder appears once it holds a note, because the tree lists notes and Git keeps no empty folders. */
  async newFolder(parent = ""): Promise<void> {
    const row = this.newFolderRow(parent);
    const name = await this.askName(row, {
      title: "New folder",
      value: "",
      problem: (value) => this.folderNameProblem(value, parent, ""),
    });
    row?.remove();
    if (name !== null) await this.newNote(inFolder(parent, name));
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
    const breaksLinks = () =>
      confirmAction({
        danger: true,
        title: `Move “${nameOf(path)}” to the Trash?`,
        body: `${plural(links, "note")} link here, and those links will stop working.`,
        action: "Move to Trash",
      });
    if (links && !(await breaksLinks())) return;
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

  async startRenameFolder(folder: string): Promise<void> {
    const name = await this.askName(this.visibleRow(`.tree-head[data-folder="${CSS.escape(folder)}"]`), {
      title: "Rename folder",
      value: folderName(folder),
      problem: (value) => this.folderNameProblem(value, folderOf(folder), folder),
    });
    if (name !== null) await this.renameFolder(folder, inFolder(folderOf(folder), name));
  }

  async removeFolder(folder: string): Promise<void> {
    const { vault, editing, workspace, toast, redraw } = this.host;
    const notes = vault.index.notes.filter((note) => isInside(folder, note));
    const files = vault.index.attachments.filter((file) => isInside(folder, file)).length;
    const linking = new Set(notes.flatMap((note) => vault.links.backlinks(note)).filter((note) => !isInside(folder, note))).size;
    const contents = files ? `${plural(notes.length, "note")} and ${plural(files, "other file")}` : plural(notes.length, "note");
    const confirmed = await confirmAction({
      danger: true,
      title: `Move “${folderName(folder)}” to the Trash?`,
      body: `This takes ${contents} with it. ${
        linking
          ? `${plural(linking, "note")} outside link in, and those links will stop working.`
          : "You can put it back from the Trash in Finder."
      }`,
      action: "Move to Trash",
    });
    if (!confirmed) return;
    const beingEdited = isInside(folder, editing.path);
    if (beingEdited) {
      await editing.flush();
      editing.setFrozen(true);
    }
    try {
      await vault.source.trashFolder(folder);
    } catch (error) {
      editing.setFrozen(false);
      toast(error instanceof Error ? error.message : "The folder could not be moved to the Trash.");
      return;
    }
    if (beingEdited) editing.discard();
    await vault.applyChanges([]);
    for (const note of notes) workspace.forgetNote(note);
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

  private folderNameProblem(name: string, parent: string, current: string): string | null {
    const problem = nameProblem(name);
    if (problem) return problem;
    const { notes, attachments } = this.host.vault.index;
    const next = inFolder(parent, name).toLowerCase();
    if (next === current.toLowerCase()) return null;
    const clash = [...notes, ...attachments].some((file) => file.toLowerCase().startsWith(`${next}/`));
    return clash ? "A folder with that name is already here." : null;
  }

  private get treeIsVisible(): boolean {
    return !this.host.sidebar.hidden && !this.host.sidebar.closest(".sidebar-closed");
  }

  /** A row the user can see and type on, or null if it is hidden in a closed folder or sidebar. */
  private visibleRow(selector: string): HTMLElement | null {
    const row = this.host.sidebar.querySelector<HTMLElement>(selector);
    return this.treeIsVisible && !row?.parentElement?.closest(".tree-folder:not(.is-open)") ? row : null;
  }

  private askName(row: HTMLElement | null, ask: { title: string; value: string; problem: (value: string) => string | null }) {
    const { title, value, problem } = ask;
    if (row) return nameInPlace(row, { value, label: title, problem, toast: this.host.toast });
    return promptText({ title, value, action: "OK", validate: problem });
  }

  /** A blank row at the top of the folder, to type the new folder's name on. */
  private newFolderRow(parent: string): HTMLElement | null {
    if (!this.treeIsVisible) return null;
    if (parent) this.host.tree.focusFolder(parent);
    const head = parent ? this.host.sidebar.querySelector(`.tree-head[data-folder="${CSS.escape(parent)}"]`) : null;
    const list = head
      ? head.parentElement?.querySelector(":scope > .tree-body .tree-inner")
      : this.host.sidebar.querySelector(".tree");
    if (!list) return null;
    const row = document.createElement("div");
    row.className = "nav-item";
    row.style.setProperty("--d", String(parent ? parent.split("/").length - 1 : 0));
    row.innerHTML = icons.folder.replace("<svg", '<svg class="tree-icon"');
    list.prepend(row);
    row.scrollIntoView({ block: "nearest" });
    return row;
  }

  renameFolder(from: string, to: string): Promise<boolean> {
    const { notes, attachments } = this.host.vault.index;
    const moved = new Map(
      [...notes, ...attachments].filter((file) => isInside(from, file)).map((file) => [file, to + file.slice(from.length)]),
    );
    return this.relocate(moved, async () => {
      await this.host.vault.source.renameFolder(from, to);
      this.host.tree.folderRenamed(from, to);
    });
  }

  private move(from: string, to: string): Promise<boolean> {
    return this.relocate(new Map([[from, to]]), () => this.host.vault.source.renameNote(from, to));
  }

  /**
   * Moves files, then updates every note whose links they affect. The new text
   * is worked out first, while links still resolve as they did, and each update
   * states the text it expects, like any save.
   */
  private async relocate(moved: ReadonlyMap<string, string>, moveFiles: () => Promise<void>): Promise<boolean> {
    const { editing, toast } = this.host;
    if (this.moveRunning) return false;
    if (!(await editing.flush())) {
      toast("Choose what to keep in the note you are editing first.");
      return false;
    }
    this.moveRunning = true;
    editing.setFrozen(true);
    try {
      return await this.moveAndRelink(moved, moveFiles);
    } catch (error) {
      toast(error instanceof Error ? error.message : "The note could not be moved.");
      return false;
    } finally {
      this.moveRunning = false;
      editing.setFrozen(false);
    }
  }

  private async moveAndRelink(moved: ReadonlyMap<string, string>, moveFiles: () => Promise<void>): Promise<boolean> {
    const { vault, workspace, prefs, root, editing, toast, redraw } = this.host;
    const planned = await this.planLinkUpdates(moved);
    await moveFiles();
    const notes = [...moved].filter(([from]) => vault.index.notes.includes(from));
    for (const [from, to] of notes) editing.noteMoved(from, to);
    await vault.applyChanges(notes.map(([, to]) => to));
    for (const [from, to] of notes) {
      workspace.replaceNote(from, to);
      renameRecent(prefs, root, from, to);
      moveSpot(prefs, root, from, to);
      this.host.bookmarks.noteMoved(from, to);
    }
    const { count, failed } = await this.applyLinkUpdates(planned, moved);
    await editing.vaultChanged();
    await redraw();
    if (failed) toast(`Moved, but ${plural(failed, "note")} could not be updated.`);
    else toast(count ? `Updated links in ${plural(count, "note")}` : "Moved");
    return true;
  }

  private async planLinkUpdates(moved: ReadonlyMap<string, string>): Promise<LinkUpdate[]> {
    const { vault } = this.host;
    const moves = linkMoves(vault.index, moved);
    const updates: LinkUpdate[] = [];
    for (const path of vault.index.notes) {
      const text = await vault.read(path);
      const next = rewriteLinks(text, path, moves);
      if (next !== text) updates.push({ path, text, next });
    }
    return updates;
  }

  private async applyLinkUpdates(
    updates: LinkUpdate[],
    moved: ReadonlyMap<string, string>,
  ): Promise<{ count: number; failed: number }> {
    const { vault } = this.host;
    let count = 0;
    let failed = 0;
    for (const { path, text, next } of updates) {
      const outcome = await vault.save(moved.get(path) ?? path, next, text).catch(() => null);
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

  private rowActions(row: HTMLElement): RowAction[] {
    const folder = row.dataset.folder;
    if (row.dataset.bookmark !== undefined) {
      const bookmark = this.host.bookmarks.at(Number(row.dataset.bookmark));
      return bookmark ? [{ label: "Remove bookmark", icon: icons.close, run: () => this.host.bookmarks.remove(bookmark) }] : [];
    }
    const more = (items: MenuItem[]): RowAction => ({
      label: "More",
      icon: icons.more,
      run: (button) => this.openRowMenu(button, items),
    });
    if (folder === undefined) return [more(this.noteMenu(row.dataset.path!))];
    return [{ label: "New note here", icon: icons.plus, run: () => void this.newNote(folder) }, more(this.folderMenu(folder))];
  }

  private openRowMenu(button: HTMLElement, items: MenuItem[]): void {
    const { right, bottom } = button.getBoundingClientRect();
    this.rows.pin();
    showContextMenu(right, bottom + MENU_GAP, items, { alignEnd: true, onClose: () => this.rows.release() });
  }

  private reveal(path: string): MenuItem[] {
    return isDesktop ? [{ label: "Reveal in Finder", run: () => void native.reveal(path) }] : [];
  }

  private folderMenu(folder: string): MenuItem[] {
    return [
      { label: "New note here", run: () => void this.newNote(folder) },
      { label: "New folder here…", run: () => void this.newFolder(folder) },
      { label: "Rename…", startsGroup: true, run: () => void this.startRenameFolder(folder) },
      ...this.reveal(folder),
      { label: "Move to Trash", danger: true, run: () => void this.removeFolder(folder) },
    ];
  }

  private noteMenu(path: string): MenuItem[] {
    if (isBaseFile(path)) return [{ label: "Open in new tab", run: () => void this.host.open(path, true) }, ...this.reveal(path)];
    const { bookmarks } = this.host;
    return [
      {
        label: bookmarks.has({ path }) ? "Remove bookmark" : "Bookmark",
        run: () => bookmarks.toggle({ path }),
      },
      { label: "Open in new tab", run: () => void this.host.open(path, true) },
      { label: "Rename…", run: () => void this.startRename(path) },
      { label: "Move to…", run: () => this.promptMove(path) },
      ...this.reveal(path),
      { label: "Move to Trash", startsGroup: true, danger: true, run: () => void this.remove(path) },
    ];
  }

  private onContextMenu(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const note = target.closest<HTMLElement>(".nav-item[data-path]");
    const folder = target.closest<HTMLElement>(".tree-head[data-folder]")?.dataset.folder;
    e.preventDefault();
    const blank: MenuItem[] = [
      { label: "New note", run: () => void this.newNote() },
      { label: "New folder…", run: () => void this.newFolder() },
    ];
    const items = folder !== undefined ? this.folderMenu(folder) : note ? this.noteMenu(note.dataset.path!) : blank;
    showContextMenu(e.clientX, e.clientY, items);
  }
}
