import { Draft, type DraftState } from "../vault/draft";
import type { VaultStore } from "../vault/store";
import { lineEnding, toggleTask } from "../vault/tasks";
import type { EditorHandle, EditorStats } from "./editor-view";
import type { ShellElements } from "./shell";

export interface EditingHost {
  els: ShellElements;
  vault: VaultStore;
  notePath: () => string;
  reshow: () => Promise<void>;
  toast: (message: string) => void;
  incomingCommits: () => number;
  open: (path: string, newTab: boolean, anchor?: string) => void;
  openUrl: (url: string) => void;
}

interface Session {
  path: string;
  draft: Draft;
  editor: EditorHandle;
  banner: HTMLElement;
}

const WORDS_PER_MINUTE = 230;
const CLIPBOARD = "clipboard";
const STATE_LABEL: Record<DraftState["kind"], string> = {
  saved: "Saved",
  unsaved: "Saving…",
  saving: "Saving…",
  conflict: "Not saved",
  missing: "Not saved",
  failed: "Not saved",
};

function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Everything that changes a note: clicking a task, and editing one note at a time. */
export class NoteEditing {
  private session: Session | null = null;
  private opening = false;
  private toggling = false;
  private readonly undoTasks: { path: string; line: number; wrote: string }[] = [];

  constructor(private readonly host: EditingHost) {}

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

  async open(): Promise<void> {
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
      const { page, banner, surface } = this.mountPage(title);
      const draft = new Draft(
        text,
        (next, expected) => vault.save(path, next, expected),
        (state) => this.showState(state),
      );
      const editor = createEditor(surface, {
        text,
        lineSeparator: separator,
        onChange: (next) => draft.update(next),
        onStats: (stats) => this.showStats(stats),
        openWikilink: (link, newTab) => {
          const [name, anchor] = link.split("#");
          const found = vault.index.resolve(name);
          if (found.kind === "found") this.host.open(found.path, newTab, anchor);
        },
        openUrl: this.host.openUrl,
      });
      scroller.replaceChildren(page);
      this.session = { path, draft, editor, banner };
      els.shell.classList.add("is-editing");
      this.showState(draft.state);
      this.markMode(true);
      scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
      const box = surface.getBoundingClientRect();
      editor.placeCursorAt(box.left + 8, Math.max(box.top, scroller.getBoundingClientRect().top) + 12);
      editor.focus();
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
    this.session = null;
    this.host.els.shell.classList.remove("is-editing");
    this.host.els.statusStats.hidden = true;
    this.markMode(false);
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

  private mountPage(title: string): { page: HTMLElement; banner: HTMLElement; surface: HTMLElement } {
    const page = document.createElement("article");
    page.className = "doc doc-editing";
    const head = document.createElement("header");
    head.className = "doc-head";
    const heading = document.createElement("h1");
    heading.className = "doc-title";
    heading.textContent = title;
    head.append(heading);
    const banner = document.createElement("div");
    banner.className = "edit-banner";
    banner.hidden = true;
    banner.setAttribute("role", "alert");
    const surface = document.createElement("div");
    surface.className = "edit-surface";
    page.append(head, banner, surface);
    return { page, banner, surface };
  }

  private markMode(editing: boolean): void {
    for (const button of this.host.els.modeSwitch.querySelectorAll<HTMLElement>("button")) {
      const on = (button.dataset.act === "mode-edit") === editing;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }

  private showStats({ line, column, words }: EditorStats): void {
    const { statusStats } = this.host.els;
    statusStats.hidden = false;
    statusStats.textContent = `Ln ${line}, Col ${column} · ${words} words · ${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min`;
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
