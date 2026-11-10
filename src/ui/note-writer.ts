import type { VaultStore } from "../vault/store";
import { toggleTask } from "../vault/tasks";

/** A note open in the editor. Changes to it go through the editor, so its undo and its save protection apply. */
export interface LiveNote {
  text: () => string;
  blocked: () => boolean;
  /** One undo step. False when the editor is not accepting changes. */
  apply: (text: string) => boolean;
  flush: () => Promise<boolean>;
}

export type WriteResult =
  | { kind: "done"; text: string }
  | { kind: "refused" }
  | { kind: "changed" }
  | { kind: "busy" }
  | { kind: "failed"; message: string };

export interface WriterHost {
  vault: VaultStore;
  notePath: () => string;
  live: (path: string) => LiveNote | null;
  syncBusy: () => boolean;
  reshow: () => Promise<void>;
  toast: (message: string) => void;
  scroller: () => HTMLElement;
}

interface Undo {
  path: string;
  wrote: string;
  run: () => Promise<void>;
}

const failure = (error: unknown): WriteResult => ({
  kind: "failed",
  message: error instanceof Error ? error.message : "The note could not be saved.",
});

/** The one way a note's text changes outside typing: through the open editor, or straight to the file if there is none. */
export class NoteWriter {
  private readonly undoStack: Undo[] = [];
  private toggling = false;

  constructor(private readonly host: WriterHost) {}

  /** `edit` gets the current text and returns the new text, or null to refuse. */
  async change(path: string, edit: (text: string) => string | null): Promise<WriteResult> {
    const { vault, live, syncBusy } = this.host;
    if (syncBusy()) return { kind: "busy" };
    const open = live(path);
    if (open) return this.changeLive(open, edit);
    try {
      const before = await vault.read(path);
      const after = edit(before);
      if (after === null) return { kind: "refused" };
      if (after === before) return { kind: "done", text: before };
      const outcome = await vault.save(path, after, before);
      if (outcome.kind !== "saved") {
        await vault.applyChanges([path]);
        return { kind: "changed" };
      }
      this.undoStack.push({ path, wrote: after, run: () => this.restore(path, before, after) });
      return { kind: "done", text: after };
    } catch (error) {
      return failure(error);
    }
  }

  private async changeLive(open: LiveNote, edit: (text: string) => string | null): Promise<WriteResult> {
    if (open.blocked()) return { kind: "changed" };
    const before = open.text();
    const after = edit(before);
    if (after === null) return { kind: "refused" };
    if (after === before) return { kind: "done", text: before };
    if (!open.apply(after)) return { kind: "busy" };
    try {
      if (await open.flush()) return { kind: "done", text: after };
    } catch (error) {
      open.apply(before);
      return failure(error);
    }
    if (open.blocked()) return { kind: "changed" };
    open.apply(before);
    return { kind: "failed", message: "The note could not be saved." };
  }

  private async restore(path: string, before: string, after: string): Promise<void> {
    await this.change(path, (text) => (text === after ? before : null));
    this.undoStack.pop();
    if (path === this.host.notePath()) await this.host.reshow();
  }

  /** Undoes the last change made outside the editor, as long as nothing has changed the note since. */
  async undo(): Promise<void> {
    const last = this.undoStack.pop();
    if (!last || last.path !== this.host.notePath()) return;
    if (this.host.vault.texts.get(last.path) === last.wrote) await last.run();
    else this.undoStack.length = 0;
  }

  async toggleTask(path: string, line: number, remember: boolean): Promise<void> {
    if (this.toggling || !path) return;
    this.toggling = true;
    const { vault, toast, reshow, scroller } = this.host;
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
      if (remember) this.undoStack.push({ path, wrote: after, run: () => this.toggleTask(path, line, false) });
      const box = scroller().querySelector<HTMLElement>(`.task-box[data-task-line="${line}"]`);
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
}
