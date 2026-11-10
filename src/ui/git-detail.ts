import { type Commit, type FileChange, type GitStatus, git } from "../platform";
import { diffWithPrefs } from "./diff";
import type { GitHost } from "./git-panel";
import { dayOf, el, momentOf, openSheet } from "./git-panel-parts";

/** The sheets that show one change: a file against the last commit, or a commit and what can be done with it. */
export class GitDetail {
  constructor(
    private readonly host: GitHost,
    private readonly status: () => GitStatus | null,
    private readonly historyPath: () => string | null,
  ) {}

  private diffView(text: string, emptyMessage?: string): HTMLElement {
    return diffWithPrefs(this.host.prefs, text, emptyMessage);
  }

  /** The sheet's title already names the file. */
  private oneFile(view: HTMLElement): HTMLElement {
    view.classList.add("is-one-file");
    return view;
  }

  /** A button that puts this commit's text back in the note, as an uncommitted change. */
  private restoreButton(c: Commit, from: string, target: string): HTMLElement {
    const when = dayOf(c.date);
    const button = el("button", "btn btn-small", "Restore this version");
    button.dataset.tip = "Puts this text back as an uncommitted change";
    button.onclick = async () => {
      try {
        await this.host.restoreVersion(target, await git.fileAt(c.sha, from), when);
      } catch (err) {
        this.host.toast(`That version could not be read. ${(err as Error).message.split("\n")[0]}`);
      }
    };
    return button;
  }

  async showWorktreeDiff(f: FileChange, staged: boolean): Promise<void> {
    try {
      const text = await git.diff(f.path, staged, f.unstaged === "?" && !staged);
      openSheet(
        `${f.path}`,
        staged ? "Staged changes" : f.unstaged === "?" ? "New file" : "Unstaged changes",
        this.oneFile(this.diffView(text)),
      );
    } catch (err) {
      this.host.toast((err as Error).message);
    }
  }

  /** Shows one commit: limited to a note's changes when `notePath` is given, with a way to read or compare that version. */
  async showCommit(c: Commit, notePath: string | null = this.historyPath()): Promise<void> {
    const path = notePath ? (c.path ?? notePath) : null;
    try {
      const text = await git.show(c.sha, path);
      const content = el("div");
      if (path?.endsWith(".md")) {
        const bar = el("div", "sheet-actions");
        const read = el("button", "btn btn-small", "Read this version");
        read.onclick = async () => {
          const md = await git.fileAt(c.sha, path);
          const doc = el("article", "doc is-revision");
          await this.host.renderNoteAt(md, path, doc);
          openSheet(this.host.title(path), `As of ${momentOf(c.date)} · ${c.short} · read-only`, doc);
        };
        const cmp = el("button", "btn btn-small", "Compare with current");
        cmp.onclick = async () => {
          const head = this.status()?.head;
          if (!head) return;
          const d = await git.diffRevs(c.sha, head, path);
          openSheet(this.host.title(path), `${c.short} → current`, this.diffView(d, "Identical to the current version."));
        };
        bar.append(read, cmp, this.restoreButton(c, path, notePath ?? path));
        content.append(bar);
      }
      content.append(this.diffView(text, "This commit changed no file contents."));
      openSheet(c.subject || c.short, `${c.author} · ${momentOf(c.date)} · ${c.short}`, content);
    } catch (err) {
      this.host.toast((err as Error).message);
    }
  }
}
