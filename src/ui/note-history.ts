import { type Commit, type FileChange, type GitStatus, git, isDesktop } from "../platform";
import { relative } from "./git-panel";

const HISTORY_LIMIT = 100;

export interface NoteHistoryHost {
  status: () => GitStatus | null;
  showWorktreeDiff: (change: FileChange) => void;
  showCommit: (commit: Commit, path: string) => void;
  currentNote: () => string;
}

const emptyLine = (text: string): HTMLElement => {
  const p = document.createElement("p");
  p.className = "rail-empty";
  p.textContent = text;
  return p;
};

/** The open note's Git history in the Info pane, reloaded only when the note or HEAD has moved. */
export class NoteHistory {
  private shown = "";
  private seq = 0;

  constructor(private readonly host: NoteHistoryHost) {}

  /** Forget what is drawn, because the container was rebuilt. */
  reset(): void {
    this.shown = "";
  }

  async render(box: HTMLElement): Promise<void> {
    const path = this.host.currentNote();
    if (!path) return;
    const status = this.host.status();
    const changed = status?.files.find((f) => f.path === path);
    const key = `${path}|${status?.head ?? ""}|${changed ? `${changed.staged}${changed.unstaged}` : ""}`;
    if (key === this.shown) return;
    this.shown = key;
    const seq = ++this.seq;

    const heading = document.createElement("div");
    heading.className = "rail-title";
    heading.textContent = "History";
    if (!isDesktop || (status && !status.isRepo)) {
      box.replaceChildren(
        heading,
        emptyLine(isDesktop ? "This vault is not a Git repository." : "File history runs in the desktop app."),
      );
      return;
    }

    let commits: Commit[];
    try {
      commits = await git.log(path, HISTORY_LIMIT, 0);
    } catch (err) {
      if (seq !== this.seq) return;
      box.replaceChildren(heading, emptyLine((err as Error).message.split("\n")[0]));
      this.shown = "";
      return;
    }
    if (seq !== this.seq || path !== this.host.currentNote()) return;

    const capped = commits.length === HISTORY_LIMIT;
    heading.textContent = commits.length ? `History · ${commits.length}${capped ? "+" : ""}` : "History";
    const nodes: HTMLElement[] = [];
    if (commits.length) nodes.push(this.facts(commits, capped));
    nodes.push(heading);
    if (changed) {
      nodes.push(this.row("Uncommitted changes", "Edited since the last commit", () => this.host.showWorktreeDiff(changed)));
    }
    for (const commit of commits) {
      nodes.push(
        this.row(commit.subject || "(no message)", `${relative(commit.date)} · ${commit.short}`, () =>
          this.host.showCommit(commit, path),
        ),
      );
    }
    if (!commits.length && !changed) nodes.push(emptyLine("Not committed yet."));
    box.replaceChildren(...nodes);
  }

  private facts(commits: Commit[], capped: boolean): HTMLElement {
    const list = document.createElement("dl");
    list.className = "props rail-history-facts";
    const fact = (key: string, value: string) => {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      list.append(dt, dd);
    };
    fact("Updated", relative(commits[0].date));
    if (!capped) {
      fact(
        "Created",
        new Date(commits[commits.length - 1].date).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      );
    }
    return list;
  }

  private row(subject: string, meta: string, onClick: () => void): HTMLElement {
    const button = document.createElement("button");
    button.className = "rail-commit";
    const line = document.createElement("span");
    line.className = "rail-commit-subject";
    line.textContent = subject;
    const when = document.createElement("span");
    when.className = "rail-commit-meta";
    when.textContent = meta;
    button.append(line, when);
    button.onclick = onClick;
    return button;
  }
}
