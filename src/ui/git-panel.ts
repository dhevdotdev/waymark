import { type Commit, type FileChange, GitError, type GitStatus, git, native } from "../platform";
import type { PrefStore } from "../prefs";
import { commitBox } from "./commit-box";
import { GitDetail } from "./git-detail";
import { gitNotice } from "./git-notices";
import { EXPLAIN, el, relative, remoteName, WorkIndicator } from "./git-panel-parts";
import { isPointerAction } from "./input-origin";
import { keepPlace } from "./keep-place";
import { fadeOut } from "./overlays";
import { plural } from "./plural";
import type { Cue } from "./sound";
import { autoStagePaths } from "./sync-status";

export interface GitHost {
  prefs: PrefStore;
  /** Saves any note being edited. False means the user still has to choose what to keep. */
  flushEdits(): Promise<boolean>;
  onVisible?: (open: boolean) => void;
  play(cue: Cue): void;
  toast(message: string): void;
  openNote(path: string): void;
  lastSync(): number | null;
  setLastSync(at: number): void;
  onStatus(status: GitStatus | null, state: SyncState): void;
  renderNoteAt(markdown: string, path: string, into: HTMLElement): Promise<void>;
  title(path: string): string;
  lastBackup(): { at: number; reached: boolean } | null;
  backupOn(): boolean;
  /** Resolves once no backup is running. */
  backupDone(): Promise<void>;
  /** Writes the text of a past version over a note. */
  restoreVersion(path: string, text: string, when: string): Promise<void>;
}

export type SyncState = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; error: GitError };

/**
 * The sync panel: remote, branch, pending changes and history. Every write
 * (stage, commit, push, update) is an explicit button press.
 */
export class GitPanel {
  readonly detail: GitDetail;
  status: GitStatus | null = null;
  state: SyncState = { kind: "idle" };
  private root: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private returnFocus: Element | null = null;
  private tab: "changes" | "history" = "changes";
  private historyPath: string | null = null;
  private commits: Commit[] = [];
  private history: "loading" | "loaded" | "failed" = "loading";
  private busy = false;
  private message: string | null = null;
  private readonly work = new WorkIndicator();
  /** Outlives routine background checks, which would otherwise wipe it from the indicator. A manual action clears it. */
  private backupProblem: GitError | null = null;
  /** Whether the last sync, commit or push was started with the pointer, read when it lands. */
  startedByPointer = false;

  constructor(private host: GitHost) {
    this.detail = new GitDetail(
      host,
      () => this.status,
      () => this.historyPath,
    );
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  async refresh(): Promise<void> {
    try {
      this.status = await git.status();
      if (this.state.kind === "error" && this.state.error.kind === "notARepo") this.state = { kind: "idle" };
    } catch (err) {
      this.status = null;
      this.state = { kind: "error", error: err as GitError };
    }
    this.host.onStatus(this.status, this.state);
    if (this.root) this.render();
  }

  private async run(
    label: string,
    op: () => Promise<GitStatus>,
    after?: (before: GitStatus | null, now: GitStatus) => void,
  ): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    const before = this.status;
    this.state = { kind: "busy", label };
    this.work.start(label, () => {
      this.root?.classList.add("is-working");
      this.host.onStatus(this.status, this.state);
    });
    try {
      await this.host.backupDone();
      const now = await op();
      this.status = now;
      this.state = this.backupProblem ? { kind: "error", error: this.backupProblem } : { kind: "idle" };
      after?.(before, now);
      return true;
    } catch (err) {
      const e = err instanceof GitError ? err : new GitError("other", String(err));
      this.state = { kind: "error", error: e };
      if (e.kind !== "offline") this.host.play("problem");
      await git
        .status()
        .then((s) => (this.status = s))
        .catch(() => {});
      return false;
    } finally {
      this.busy = false;
      this.work.stop();
      this.root?.classList.remove("is-working");
      this.host.onStatus(this.status, this.state);
      if (this.root) this.render();
    }
  }

  /** Shows how a backup ended, without touching anything a manual action has started since. */
  backupFinished(problem: GitError | null): void {
    this.backupProblem = problem;
    if (this.state.kind === "busy") return;
    if (problem) this.state = { kind: "error", error: problem };
    else if (this.state.kind === "error") this.state = { kind: "idle" };
    this.host.onStatus(this.status, this.state);
    if (this.root) this.render();
  }

  /** Fetch only. Used for launch and background checks; never changes files. */
  async fetch(quiet = false): Promise<boolean> {
    return this.run(
      "Checking remote",
      () => git.fetch(),
      (before, now) => {
        this.host.setLastSync(Date.now());
        if (!quiet && now.behind > (before?.behind ?? 0)) this.host.play("incoming");
      },
    );
  }

  /** The deliberate sync: fetch, then fast-forward if that is safe. */
  async sync(): Promise<void> {
    this.startedByPointer = isPointerAction();
    this.backupProblem = null;
    if (!(await this.readyForGit())) return;
    const fetched = await this.fetch(true);
    if (!fetched || !this.status) return;
    const st = this.status;
    if (st.behind > 0 && st.ahead === 0) {
      if (await this.applyIncoming(st.behind)) {
        this.host.toast(`Updated with ${plural(st.behind, "incoming commit")}`);
      }
      return;
    }
    if (st.behind > 0 && st.ahead > 0) {
      this.divergedError(st);
      return;
    }
    this.host.play("synced");
  }

  private async applyIncoming(count: number): Promise<boolean> {
    const applied = await this.run(`Updating ${plural(count, "commit")}`, () => git.fastForward());
    if (applied) this.host.play("incoming");
    return applied;
  }

  private async readyForGit(): Promise<boolean> {
    const ready = await this.host.flushEdits();
    if (!ready) this.host.toast("Choose what to keep in the note you are editing first.");
    return ready;
  }

  private divergedError(st: GitStatus): void {
    this.state = {
      kind: "error",
      error: new GitError(
        "diverged",
        `This copy has ${plural(st.ahead, "commit")} the remote lacks, and the remote has ${plural(st.behind, "commit")} this copy lacks.`,
      ),
    };
    this.host.play("problem");
    this.host.onStatus(this.status, this.state);
    if (this.root) this.render();
  }

  /**
   * One press to publish: bring in the remote first, then commit and push.
   * Pulling before committing is what keeps histories from diverging, and
   * anything that would need a merge stops here with nothing committed.
   */
  async commitAndSync(message: string, publish = true): Promise<void> {
    this.startedByPointer = isPointerAction();
    this.backupProblem = null;
    if (!(await this.readyForGit())) return;
    const hasRemote = Boolean(this.status?.upstream);
    let online = hasRemote;
    if (hasRemote && !(await this.fetch(true))) {
      if (this.state.kind !== "error" || this.state.error.kind !== "offline") return;
      online = false;
    }
    const before = this.status;
    if (online && before && before.behind > 0) {
      if (before.ahead > 0) {
        this.divergedError(before);
        return;
      }
      if (!(await this.applyIncoming(before.behind))) return;
    }
    if (!(await this.commitChanges(message))) return;
    if (!online || !publish) {
      this.host.toast(hasRemote && !online ? "Committed here. You are offline, so it will need a sync later." : "Committed.");
      return;
    }
    if (!this.status?.ahead) {
      this.host.play("synced");
      return;
    }
    await this.push();
  }

  /** Commits what is staged, or the changed notes when nothing is. Having nothing to commit is not a failure. */
  private async commitChanges(message: string): Promise<boolean> {
    const files = this.status?.files ?? [];
    if (!files.some((f) => f.staged !== "." && f.staged !== "?")) {
      const paths = autoStagePaths(files);
      if (!paths.length) return true;
      if (!(await this.run("Staging", () => git.stage(paths)))) return false;
    }
    if (!(await this.run("Committing", () => git.commit(message)))) return false;
    this.message = null;
    this.host.play("commit");
    return true;
  }

  /** Opens the panel ready to write a commit message. */
  openCommit(): void {
    this.tab = "changes";
    this.open();
    setTimeout(() => this.root?.querySelector<HTMLTextAreaElement>(".commit-box textarea")?.select());
  }

  toggle(anchor: HTMLElement): void {
    if (this.root) this.close();
    else this.open(anchor);
  }

  open(_anchor?: HTMLElement, opts: { historyPath?: string | null } = {}): void {
    if (opts.historyPath !== undefined) {
      this.tab = "history";
      this.historyPath = opts.historyPath || null;
      this.commits = [];
    }
    if (this.tab === "history") void this.loadHistory();
    if (!this.root) {
      const overlay = el("div", "overlay sync-overlay");
      const root = el("section", "sync-sheet");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-label", "Sync and history");
      root.tabIndex = -1;
      overlay.append(root);
      overlay.addEventListener("pointerdown", (e) => {
        if (e.target === overlay) this.close();
      });
      this.returnFocus = document.activeElement;
      document.body.append(overlay);
      this.overlay = overlay;
      this.root = root;
      this.host.onVisible?.(true);
      root.focus({ preventScroll: true });
    }
    this.render();
    void this.refresh();
  }

  close(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    this.overlay = null;
    this.root = null;
    this.host.onVisible?.(false);
    fadeOut(overlay);
    if (this.returnFocus instanceof HTMLElement) this.returnFocus.focus({ preventScroll: true });
  }

  private render(): void {
    keepPlace(this.root!, () => this.draw(this.root!));
  }

  private draw(root: HTMLElement): void {
    const st = this.status;
    root.replaceChildren();
    root.classList.toggle("is-short", st?.isRepo === false);

    const head = el("header", "sync-head");
    const close = el("button", "icon-btn");
    close.setAttribute("aria-label", "Close");
    close.dataset.control = "close";
    close.innerHTML = `<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>`;
    close.onclick = () => this.close();
    head.append(this.work.element, close);
    root.append(head);

    if (!st?.isRepo) {
      root.append(this.explain(new GitError("notARepo", "")));
      return;
    }

    const remote = el("div", "sync-remote");
    remote.append(
      el("span", "sync-remote-name", remoteName(st.remoteUrl)),
      el("span", "sync-branch", st.branch ?? "detached HEAD"),
    );
    if (st.upstream) remote.append(el("span", "sync-upstream", `tracks ${st.upstream}`));
    head.prepend(remote);

    const summary = el("div", "sync-summary");
    const quiet = !st.ahead && !st.behind && !st.files.length && this.state.kind !== "error";
    const unconnected = this.unconnectedLine(st);
    if (unconnected) summary.append(el("div", "sync-uptodate is-unchecked", unconnected));
    else if (quiet) {
      const last = this.host.lastSync();
      summary.append(
        el(
          "div",
          last === null ? "sync-uptodate is-unchecked" : "sync-uptodate",
          last === null ? "No local changes. Not compared with the remote yet." : `Up to date · checked ${relative(last)}`,
        ),
      );
    } else {
      const facts = el("dl", "sync-facts");
      const fact = (k: string, v: string, tone = "") => {
        const d = el("div", `sync-fact ${tone}`);
        d.append(el("dt", "", k), el("dd", "", v));
        facts.append(d);
      };
      fact("Incoming", String(st.behind), st.behind ? "is-incoming" : "");
      fact("To push", String(st.ahead), st.ahead ? "is-outgoing" : "");
      fact("Changed", String(st.files.length), st.files.length ? "is-changed" : "");
      fact("Last checked", relative(this.host.lastSync()));
      summary.append(facts);
    }
    const backup = this.backupLine();
    if (backup) summary.append(backup);

    const actions = this.syncActions(st);
    if (actions) summary.append(actions);
    root.append(summary);

    if (this.state.kind === "error") root.append(this.explain(this.state.error));
    if (st.operation) root.append(this.explain(new GitError("inProgress", `A ${st.operation} is in progress.`)));

    const tabs = el("div", "seg");
    tabs.setAttribute("role", "tablist");
    for (const [id, label] of [
      ["changes", `Changes${st.files.length ? ` ${st.files.length}` : ""}`],
      ["history", "History"],
    ] as const) {
      const t = el("button", `seg-btn${this.tab === id ? " is-on" : ""}`, label);
      t.setAttribute("role", "tab");
      t.dataset.control = `tab:${id}`;
      t.setAttribute("aria-selected", String(this.tab === id));
      t.onclick = () => {
        this.tab = id;
        if (id === "history") {
          this.historyPath = null;
          void this.loadHistory();
        }
        this.render();
      };
      tabs.append(t);
    }
    root.append(tabs);

    const body = el("div", "sync-body");
    body.dataset.scrollKey = `${this.tab}:${this.historyPath}`;
    root.append(body);
    if (this.tab === "changes") this.renderChanges(body, st);
    else this.renderHistory(body);
  }

  /** Why the usual comparison with a remote does not apply here, or null when it does. */
  private unconnectedLine(st: GitStatus): string | null {
    if (st.upstream) return null;
    if (!st.branch) return "Not on a branch, so there is nothing to sync. Check one out in a terminal.";
    if (!st.remoteUrl) return "This vault has no remote, so commits stay on this Mac.";
    return "This branch does not track a remote branch yet. Set one up in a terminal.";
  }

  /** The state itself needs a terminal, so its button sits with the main actions and a notice need not repeat it. */
  private needsTerminal(st: GitStatus | null): boolean {
    if (!st) return false;
    return (st.ahead > 0 && st.behind > 0) || Boolean(st.operation) || (!st.upstream && (Boolean(st.remoteUrl) || !st.branch));
  }

  private syncActions(st: GitStatus): HTMLElement | null {
    if (!st.upstream && st.branch && !st.remoteUrl) return null;
    const actions = el("div", "sync-actions");
    const btn = (label: string, primary: boolean, enabled: boolean, onClick: () => void, hint?: string) => {
      const b = el("button", primary ? "btn btn-primary" : "btn", label);
      b.dataset.control = label.replace(/ \d+$/, "");
      b.disabled = !enabled || this.busy;
      b.onclick = onClick;
      if (hint) b.title = hint;
      actions.append(b);
      return b;
    };
    const blocked = this.needsTerminal(st);
    const terminal = () => {
      if (blocked)
        btn(
          "Open in Terminal",
          true,
          true,
          () => void native.openTerminal(),
          "Resolve it there, where Git can ask you what to do",
        );
    };
    if (!st.upstream) {
      terminal();
      return actions;
    }
    /* Commit & Sync is the main action whenever there is something to commit, so one button leads at a time. */
    const leads = !blocked && !st.files.length;
    btn(
      blocked ? "Check again" : "Sync",
      leads && st.behind > 0,
      true,
      () => void this.sync(),
      blocked ? "Fetch and look again" : "Fetch, then apply incoming commits when that is a fast-forward",
    );
    btn(
      `Push${st.ahead ? ` ${st.ahead}` : ""}`,
      leads && st.ahead > 0 && st.behind === 0,
      st.ahead > 0 && st.behind === 0,
      () => {
        this.startedByPointer = isPointerAction();
        void this.push();
      },
      st.behind ? "Sync first" : undefined,
    );
    terminal();
    return actions;
  }

  /** When the last backup ran and whether it got as far as the remote. Present only once backups are in use. */
  private backupLine(): HTMLElement | null {
    const last = this.host.lastBackup();
    if (!last && !this.host.backupOn()) return null;
    const text = last
      ? `Backed up ${relative(last.at)}, ${last.reached ? "on the remote" : "not on the remote yet"}`
      : "Backup is on. The first one runs within 10 minutes.";
    return el("p", last && !last.reached ? "sync-backup is-waiting" : "sync-backup", text);
  }

  private explain(error: GitError): HTMLElement {
    return gitNotice(error, {
      busy: this.busy,
      remoteUrl: this.status?.remoteUrl ?? null,
      terminalOffered: this.needsTerminal(this.status),
      sync: () => void this.sync(),
      toast: this.host.toast,
    });
  }

  private changeRow(f: FileChange, isStaged: boolean): HTMLElement {
    const code = isStaged ? f.staged : f.unstaged;
    const row = el("div", "change-row");
    const badge = el(
      "span",
      `change-badge is-${code === "?" ? "new" : code === "D" ? "del" : code === "A" ? "new" : "mod"}`,
      code === "?" ? "U" : code,
    );
    badge.title =
      {
        "?": "Untracked",
        M: "Modified",
        A: "Added",
        D: "Deleted",
        R: "Renamed",
        C: "Copied",
        T: "Type changed",
        U: "Conflicted",
      }[code] ?? code;
    const name = el("button", "change-name");
    const base = f.path.split("/").pop()!;
    name.append(
      el("span", "", base.replace(/\.md$/, "")),
      el("span", "change-dir", f.path.slice(0, -base.length).replace(/\/$/, "")),
    );
    name.dataset.control = `open:${isStaged}:${f.path}`;
    name.onclick = () => void this.detail.showWorktreeDiff(f, isStaged);
    const act = el("button", "icon-btn change-act");
    act.setAttribute("aria-label", isStaged ? `Unstage ${base}` : `Stage ${base}`);
    act.dataset.control = `act:${isStaged}:${f.path}`;
    act.innerHTML = isStaged
      ? `<svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg>`
      : `<svg viewBox="0 0 16 16"><path d="M8 4v8M4 8h8"/></svg>`;
    act.onclick = () =>
      void this.run(isStaged ? "Unstaging" : "Staging", () => (isStaged ? git.unstage([f.path]) : git.stage([f.path])));
    row.append(badge, name, act);
    if (f.conflicted) row.classList.add("is-conflicted");
    return row;
  }

  private renderChanges(body: HTMLElement, st: GitStatus): void {
    if (!st.files.length) {
      const empty = el("div", "empty-state");
      const diverged = st.ahead > 0 && st.behind > 0;
      empty.append(
        el("strong", "", diverged ? EXPLAIN.diverged.title : "Nothing to commit"),
        el("p", "", diverged ? EXPLAIN.diverged.body : "Notes you edit appear here, ready to commit."),
      );
      body.append(empty);
      return;
    }
    const staged = st.files.filter((f) => f.staged !== "." && f.staged !== "?");
    const unstaged = st.files.filter((f) => f.unstaged !== ".");
    const group = (label: string, files: FileChange[], isStaged: boolean) => {
      if (!files.length) return;
      const g = el("div", "change-group");
      const h = el("div", "change-head");
      h.append(el("span", "", `${label} · ${files.length}`));
      const all = el("button", "link-btn", isStaged ? "Unstage all" : "Stage all");
      all.dataset.control = `all:${isStaged}`;
      all.onclick = () =>
        void this.run(isStaged ? "Unstaging" : "Staging", () =>
          isStaged ? git.unstage(files.map((f) => f.path)) : git.stage(files.map((f) => f.path)),
        );
      h.append(all);
      g.append(h);
      for (const f of files) g.append(this.changeRow(f, isStaged));
      body.append(g);
    };
    group("Staged", staged, true);
    group("Changes", unstaged, false);

    body.append(
      commitBox({
        message: this.message ?? this.defaultMessage(st),
        hasRemote: Boolean(st.upstream),
        busy: this.busy,
        onInput: (message) => {
          this.message = message;
        },
        commit: (message, share) => void this.commitAndSync(message, share),
      }),
    );
  }

  private defaultMessage(st: GitStatus): string {
    const staged = st.files.filter((f) => f.staged !== "." && f.staged !== "?").map((f) => f.path);
    const paths = staged.length ? staged : autoStagePaths(st.files);
    const notes = paths.filter((path) => path.endsWith(".md"));
    if (paths.length === 1 && notes.length === 1) return `Update ${this.host.title(notes[0])}`;
    return `Update ${paths.length} ${notes.length === paths.length ? "notes" : "files"}`;
  }

  private async push(): Promise<void> {
    const n = this.status?.ahead ?? 0;
    const ok = await this.run(
      "Pushing",
      () => git.push(),
      () => this.host.setLastSync(Date.now()),
    );
    if (ok) {
      this.host.play("pushed");
      this.host.toast(`Pushed ${plural(n, "commit")}`);
    }
  }

  private async loadHistory(): Promise<void> {
    this.history = "loading";
    try {
      this.commits = await git.log(this.historyPath, 80, 0);
      this.history = "loaded";
    } catch (err) {
      this.commits = [];
      this.history = "failed";
      this.host.toast((err as Error).message);
    }
    if (this.root && this.tab === "history") this.render();
  }

  private historyPlaceholder(): HTMLElement {
    if (this.history === "loading") return el("div", "empty-state is-late", "Loading history…");
    const empty = el("div", "empty-state");
    if (this.history === "failed") empty.append(el("strong", "", "History could not be read"));
    else {
      empty.append(
        el("strong", "", "No commits yet"),
        el("p", "", this.historyPath ? "This note has not been committed." : "Commits appear here once you make one."),
      );
    }
    return empty;
  }

  private renderHistory(body: HTMLElement): void {
    if (this.historyPath) {
      const scope = el("div", "history-scope");
      scope.append(el("span", "", "History of "), el("strong", "", this.host.title(this.historyPath)));
      const all = el("button", "link-btn", "Whole vault");
      all.dataset.control = "whole-vault";
      all.onclick = () => {
        this.historyPath = null;
        this.commits = [];
        void this.loadHistory();
        this.render();
      };
      scope.append(all);
      body.append(scope);
    }
    if (!this.commits.length) {
      body.append(this.historyPlaceholder());
      return;
    }
    const list = el("ol", "commit-list");
    for (const c of this.commits) {
      const li = el("li");
      const b = el("button", "commit-row");
      b.dataset.control = `commit:${c.sha}`;
      b.append(el("span", "commit-subject", c.subject || "(no message)"));
      const meta = el("span", "commit-meta");
      meta.append(el("span", "", c.author), el("span", "", relative(c.date)), el("code", "", c.short));
      b.append(meta);
      b.onclick = () => void this.detail.showCommit(c);
      li.append(b);
      list.append(li);
    }
    body.append(list);
  }
}
