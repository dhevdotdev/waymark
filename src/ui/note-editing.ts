import { Draft, type DraftState } from "../vault/draft";
import type { VaultStore } from "../vault/store";
import { lineEnding, toggleTask } from "../vault/tasks";
import type { LinkOption } from "./editor-insert";
import type { EditorHandle } from "./editor-view";
import type { ShellElements } from "./shell";
import { StatusStats } from "./status-stats";

export interface EditingHost {
  els: ShellElements;
  vault: VaultStore;
  notePath: () => string;
  reshow: () => Promise<void>;
  toast: (message: string) => void;
  incomingCommits: () => number;
  open: (path: string, newTab: boolean, anchor?: string) => void;
  openUrl: (url: string) => void;
  renderInline: (text: string, path: string) => DocumentFragment;
  rename: (path: string, name: string) => Promise<boolean>;
}

interface Session {
  path: string;
  draft: Draft;
  editor: EditorHandle;
  banner: HTMLElement;
  heading: HTMLElement;
}

const CLIPBOARD = "clipboard";
const ATTACHABLE = /\.(png|jpe?g|gif|webp|avif|pdf)$/i;
const TYPE_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const SHOWN_AS_IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
const STATE_LABEL: Record<DraftState["kind"], string> = {
  saved: "Saved",
  unsaved: "Saving…",
  saving: "Saving…",
  conflict: "Not saved",
  missing: "Not saved",
  failed: "Not saved",
};

function stamp(compact = false): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())];
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return compact ? `${date.join("")}${time}${pad(now.getSeconds())}` : `${date.join("-")} ${time}`;
}

/** Everything that changes a note: clicking a task, and editing one note at a time. */
export class NoteEditing {
  private session: Session | null = null;
  private opening = false;
  private toggling = false;
  private readonly undoTasks: { path: string; line: number; wrote: string }[] = [];
  readonly stats: StatusStats;

  constructor(private readonly host: EditingHost) {
    this.stats = new StatusStats(host.els.statusStats, host.vault, () => host.els.scroller.querySelector(".doc"));
  }

  get path(): string {
    return this.session?.path ?? "";
  }

  /** The note being edited was renamed or moved, so saves follow it. */
  noteMoved(from: string, to: string): void {
    if (this.session?.path === from) this.session.path = to;
  }

  /** Leaves the editor without saving, because the note is being deleted. */
  discard(): void {
    this.session?.editor.destroy();
    this.teardown();
  }

  private teardown(): void {
    this.session = null;
    this.host.els.shell.classList.remove("is-editing");
    this.stats.hide();
    this.markMode(false);
  }

  get isOpen(): boolean {
    return this.session !== null;
  }

  async toggle(): Promise<void> {
    if (this.session) await this.finish();
    else await this.open();
  }

  /** Leaves the editor and returns to the reading view of the same note. */
  async finish(): Promise<void> {
    const { scroller } = this.host.els;
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    if (!(await this.close())) return;
    await this.host.reshow();
    scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
  }

  async open(options: { focusTitle?: boolean } = {}): Promise<void> {
    const { vault, els, notePath, toast, incomingCommits } = this.host;
    const path = notePath();
    if (this.session || this.opening || !path) return;
    this.opening = true;
    try {
      const text = await vault.read(path);
      const separator = lineEnding(text);
      if (separator === null) {
        toast("This note mixes Windows and Unix line endings, so editing it here could rewrite every line.");
        return;
      }
      const { createEditor } = await import("./editor-view");
      if (notePath() !== path) return;
      const { scroller } = els;
      const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
      const title = scroller.querySelector(".doc-title")?.textContent ?? vault.index.title(path);
      const { page, banner, surface, heading } = this.mountPage(title);
      const session: Session = {
        path,
        banner,
        heading,
        draft: new Draft(
          text,
          (next, expected) => vault.save(session.path, next, expected),
          (state) => this.showState(state),
        ),
        editor: createEditor(surface, {
          text,
          lineSeparator: separator,
          onChange: (next) => session.draft.update(next),
          onStats: (stats) => this.stats.editing(stats),
          openWikilink: (link, newTab) => {
            const [name, anchor] = link.split("#");
            const found = vault.index.resolve(name);
            if (found.kind === "found") this.host.open(found.path, newTab, anchor);
          },
          openUrl: this.host.openUrl,
          renderInline: (cell) => this.host.renderInline(cell, this.session?.path ?? path),
          assetUrl: (target) => this.assetUrl(target),
          linkTargets: (embed) => this.linkTargets(embed),
          headingsOf: (target) => this.headingsOf(target),
          addFile: (file) => this.addFile(file, session.path),
          today: () => new Date().toLocaleDateString("en-CA"),
        }),
      };
      scroller.replaceChildren(page);
      this.session = session;
      const { draft, editor } = session;
      els.shell.classList.add("is-editing");
      this.showState(draft.state);
      this.markMode(true);
      scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
      const box = surface.getBoundingClientRect();
      editor.placeCursorAt(box.left + 8, Math.max(box.top, scroller.getBoundingClientRect().top) + 12);
      if (options.focusTitle) {
        heading.focus();
        getSelection()?.selectAllChildren(heading);
      } else {
        editor.focus();
      }
      if (incomingCommits() > 0) toast("Incoming commits are waiting. Syncing before you edit avoids a conflict.");
    } finally {
      this.opening = false;
    }
  }

  /** Saves what is pending. False means a choice is still needed, so Git should not run yet. */
  async flush(): Promise<boolean> {
    return this.session ? this.session.draft.flush() : true;
  }

  /** Closes the editor without ever dropping text: anything that cannot be saved in place is kept as a copy. */
  async close(): Promise<boolean> {
    const session = this.session;
    if (!session) return true;
    session.editor.setFrozen(true);
    const saved = await session.draft.flush();
    if (!saved) {
      const copy = await this.saveCopy(session.path, session.draft.text);
      if (copy === null) {
        this.host.toast("Your edits could not be saved anywhere, so the editor is staying open.");
        session.editor.setFrozen(false);
        return false;
      }
      this.host.toast(
        copy === CLIPBOARD
          ? "Your edits could not be saved, so they were copied to the clipboard."
          : `Your edits were kept in “${copy}”.`,
      );
    }
    session.editor.destroy();
    this.teardown();
    return true;
  }

  find(): boolean {
    this.session?.editor.find();
    return this.session !== null;
  }

  /** The vault changed on disk: follow it when nothing is unsaved, otherwise let the next save raise the choice. */
  async vaultChanged(): Promise<void> {
    const session = this.session;
    if (!session) return;
    await session.draft.settled();
    /* Read again: the event may describe a save that has already been followed by a newer one. */
    const disk = await this.host.vault.reread(session.path);
    if (this.session !== session) return;
    if (disk === null) {
      session.draft.diskMissing();
      return;
    }
    const follow = session.draft.diskChanged(disk);
    if (follow !== null) session.editor.replace(follow);
  }

  async toggleTask(box: HTMLElement): Promise<void> {
    await this.flipTask(this.host.notePath(), Number(box.dataset.taskLine), true);
  }

  /** Undoes the last task clicked in the reading view. */
  async undoTask(): Promise<void> {
    const last = this.undoTasks.pop();
    if (!last || last.path !== this.host.notePath()) return;
    /* Any other change since then means the line number may now point at a different task. */
    if (this.host.vault.texts.get(last.path) === last.wrote) await this.flipTask(last.path, last.line, false);
    else this.undoTasks.length = 0;
  }

  private async flipTask(path: string, line: number, remember: boolean): Promise<void> {
    if (this.toggling || !path) return;
    this.toggling = true;
    const { vault, toast, reshow, els } = this.host;
    try {
      const before = await vault.read(path);
      const after = toggleTask(before, line);
      if (after === null) {
        toast("That task has moved. Showing the latest version.");
        await vault.applyChanges([path]);
        await reshow();
        return;
      }
      const outcome = await vault.save(path, after, before);
      if (outcome.kind !== "saved") {
        toast("This note just changed elsewhere, so the task was left alone.");
        await vault.applyChanges([path]);
        await reshow();
        return;
      }
      if (remember) this.undoTasks.push({ path, line, wrote: after });
      const box = els.scroller.querySelector<HTMLElement>(`.task-box[data-task-line="${line}"]`);
      if (!box) return;
      const done = box.getAttribute("aria-checked") !== "true";
      box.setAttribute("aria-checked", String(done));
      box.closest("li")?.classList.toggle("is-done", done);
    } catch (error) {
      toast(error instanceof Error ? error.message : "The task could not be saved.");
    } finally {
      this.toggling = false;
    }
  }

  private assetUrl(target: string): string | null {
    const { vault } = this.host;
    const found = vault.index.resolve(target, false);
    return found.kind === "found" && SHOWN_AS_IMAGE.test(found.path) ? vault.source.assetUrl(found.path) : null;
  }

  private linkTargets(embed: boolean): LinkOption[] {
    const { index } = this.host.vault;
    const detail = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined);
    const notes = index.notes.map((path) => {
      const label = index.title(path);
      return { label, target: index.resolve(label).kind === "found" ? label : path.replace(/\.md$/i, ""), detail: detail(path) };
    });
    if (!embed) return notes;
    const files = index.attachments.map((path) => {
      const label = path.slice(path.lastIndexOf("/") + 1);
      return { label, target: index.resolve(label, false).kind === "found" ? label : path, detail: detail(path) };
    });
    return [...files, ...notes];
  }

  private headingsOf(target: string): string[] {
    const { vault } = this.host;
    const found = vault.index.resolve(target);
    if (found.kind !== "found") return [];
    const text = vault.texts.get(found.path) ?? "";
    return [...text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)].map((match) => match[1]);
  }

  /** Saves a pasted or dropped file where Obsidian is set to keep attachments, and returns the embed for it. */
  private async addFile(file: File, notePath: string): Promise<string | null> {
    const { vault, toast } = this.host;
    const pasted = /^image\.\w+$/.test(file.name) || !file.name;
    const extension = TYPE_EXTENSION[file.type];
    const name = pasted ? `Pasted image ${stamp(true)}.${extension ?? file.name.split(".").pop()}` : file.name;
    if (!ATTACHABLE.test(name)) {
      toast("Only images and PDFs can be added to a note.");
      return null;
    }
    try {
      const { attachmentFolder } = await vault.source.settings();
      const folder = this.attachmentFolder(attachmentFolder, notePath);
      const path = this.unusedFile(folder, name);
      await vault.source.writeAttachment(path, new Uint8Array(await file.arrayBuffer()));
      await vault.applyChanges([]);
      const short = path.slice(path.lastIndexOf("/") + 1);
      return `![[${vault.index.resolve(short, false).kind === "found" ? short : path}]]`;
    } catch (error) {
      toast(error instanceof Error ? error.message : "The file could not be added.");
      return null;
    }
  }

  private attachmentFolder(setting: string, notePath: string): string {
    const noteFolder = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
    if (setting === "./" || setting === ".") return noteFolder;
    if (setting.startsWith("./")) return [noteFolder, setting.slice(2).replace(/\/+$/, "")].filter(Boolean).join("/");
    return setting.replace(/^\/+|\/+$/g, "");
  }

  private unusedFile(folder: string, name: string): string {
    const { attachments } = this.host.vault.index;
    const dot = name.lastIndexOf(".");
    const inFolder = (file: string) => (folder ? `${folder}/${file}` : file);
    let path = inFolder(name);
    for (let n = 1; attachments.includes(path); n++) path = inFolder(`${name.slice(0, dot)} ${n}${name.slice(dot)}`);
    return path;
  }

  private bindTitle(heading: HTMLElement): void {
    heading.setAttribute("contenteditable", "plaintext-only");
    heading.spellcheck = false;
    let before = heading.textContent ?? "";
    const commit = async () => {
      const name = (heading.textContent ?? "").trim();
      const session = this.session;
      if (!session || name === before) return;
      if (await this.host.rename(session.path, name)) before = name;
      else heading.textContent = before;
    };
    heading.addEventListener("focus", () => {
      before = heading.textContent ?? "";
    });
    heading.addEventListener("blur", () => void commit());
    heading.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.session?.editor.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        heading.textContent = before;
        this.session?.editor.focus();
      }
    });
  }

  private mountPage(title: string): { page: HTMLElement; banner: HTMLElement; surface: HTMLElement; heading: HTMLElement } {
    const page = document.createElement("article");
    page.className = "doc doc-editing";
    const head = document.createElement("header");
    head.className = "doc-head";
    const heading = document.createElement("h1");
    heading.className = "doc-title";
    heading.textContent = title;
    this.bindTitle(heading);
    head.append(heading);
    const banner = document.createElement("div");
    banner.className = "edit-banner";
    banner.hidden = true;
    banner.setAttribute("role", "alert");
    const surface = document.createElement("div");
    surface.className = "edit-surface";
    page.append(head, banner, surface);
    return { page, banner, surface, heading };
  }

  private markMode(editing: boolean): void {
    for (const button of this.host.els.modeSwitch.querySelectorAll<HTMLElement>("button")) {
      const on = (button.dataset.act === "mode-edit") === editing;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }

  private showState(state: DraftState): void {
    const { editState } = this.host.els;
    editState.textContent = STATE_LABEL[state.kind];
    editState.dataset.state = state.kind;
    const banner = this.session?.banner;
    if (banner) this.renderBanner(banner, state);
  }

  private renderBanner(banner: HTMLElement, state: DraftState): void {
    const session = this.session!;
    const button = (label: string, primary: boolean, run: () => void) => {
      const b = document.createElement("button");
      b.className = primary ? "btn btn-primary btn-small" : "btn btn-small";
      b.textContent = label;
      b.addEventListener("click", run);
      return b;
    };
    const text = document.createElement("p");
    banner.hidden = !(state.kind === "conflict" || state.kind === "missing" || state.kind === "failed");
    banner.replaceChildren();
    if (state.kind === "conflict") {
      text.textContent =
        "This note changed outside this editor. Your version is safe here. Keep mine replaces the other version. Keep both saves yours as a copy.";
      banner.append(
        text,
        button("Keep mine", true, () => void session.draft.keepMine()),
        button("Keep both", false, () => void this.keepBoth(session, state.disk)),
      );
    } else if (state.kind === "missing") {
      text.textContent = "This note was moved or deleted. Your version is safe here and has not been saved.";
      banner.append(
        text,
        button("Save it here again", true, () => void session.draft.keepMine()),
      );
    } else if (state.kind === "failed") {
      text.textContent = `This note could not be saved. ${state.message}`;
      banner.append(
        text,
        button("Try again", true, () => void session.draft.flush()),
      );
    }
  }

  private async keepBoth(session: Session, disk: string): Promise<void> {
    session.editor.setFrozen(true);
    const copy = await this.saveCopy(session.path, session.draft.text, false);
    session.editor.setFrozen(false);
    if (!copy) {
      this.host.toast("Your version could not be saved as a copy, so nothing was changed.");
      return;
    }
    session.editor.replace(disk);
    session.draft.adopt(disk);
    this.host.toast(`Your version was saved as “${copy}”.`);
  }

  /** Writes text to a new note beside the original, then the vault root. Null means it was kept nowhere. */
  private async saveCopy(path: string, text: string, clipboardLast = true): Promise<string | null> {
    const base = path.replace(/\.md$/i, "");
    const name = `${base.split("/").pop()} (conflict ${stamp()}).md`;
    const folder = path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";
    for (const target of [`${folder}${name}`, name]) {
      try {
        const outcome = await this.host.vault.save(target, text, null);
        if (outcome.kind === "saved") return target.split("/").pop()!.replace(/\.md$/i, "");
      } catch {
        /* The folder may be gone with the note; the next location is tried. */
      }
    }
    if (!clipboardLast) return null;
    return navigator.clipboard.writeText(text).then(
      () => CLIPBOARD,
      () => null,
    );
  }
}
