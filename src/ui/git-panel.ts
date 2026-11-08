import { type Commit, type FileChange, GitError, type GitStatus, git, native } from "../platform";
import { renderDiff } from "./diff";
import type { Cue } from "./sound";

export interface GitHost {
  onVisible?: (open: boolean) => void;
  play(cue: Cue): void;
  toast(message: string): void;
  openNote(path: string): void;
  lastSync(): number | null;
  setLastSync(at: number): void;
  onStatus(status: GitStatus | null, state: SyncState): void;
  renderNoteAt(markdown: string, path: string, into: HTMLElement): Promise<void>;
  title(path: string): string;
}

export type SyncState = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; error: GitError };

const EXPLAIN: Record<string, { title: string; body: string; terminal?: boolean }> = {
  offline: {
    title: "Offline",
    body: "The remote could not be reached. Your notes are all here and readable; sync again when you are back online.",
  },
  auth: {
    title: "The remote refused access",
    body: "Waymark uses the same credentials as git in Terminal: your SSH agent for SSH remotes and the macOS Keychain for HTTPS.",
  },
  diverged: {
    title: "Histories have diverged",
    body: "This copy and the remote each have commits the other lacks. Waymark never merges or rebases for you. Resolve it in a terminal or your Git client, then sync again.",
    terminal: true,
  },
  localChangesBlock: {
    title: "Local edits are in the way",
    body: "Incoming commits change files you have edited here. Waymark will not overwrite them. Commit your edits first, or resolve it in a terminal.",
    terminal: true,
  },
  rejected: {
    title: "Push was rejected",
    body: "The remote has commits you do not have yet. Sync first; Waymark never force-pushes.",
  },
  inProgress: {
    title: "An operation is unfinished",
    body: "A merge or rebase was started outside Waymark and is not finished. Complete or abort it in a terminal.",
    terminal: true,
  },
  noUpstream: {
    title: "No upstream branch",
    body: "This branch does not track a remote branch. Set one in a terminal with git push -u.",
    terminal: true,
  },
  timeout: { title: "Git took too long", body: "The operation was stopped after waiting. Check your connection and try again." },
  notARepo: {
    title: "Not a Git repository",
    body: "This vault is a plain folder. Waymark reads it normally, but sync and history need Git.",
  },
  other: { title: "Git reported a problem", body: "" },
};

export function relative(at: number | string | null): string {
  if (at === null) return "never";
  const t = typeof at === "string" ? Date.parse(at) : at;
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * The sync panel: remote, branch, pending changes and history. Every write
 * (stage, commit, push, update) is an explicit button press.
 */
export class GitPanel {
  status: GitStatus | null = null;
  state: SyncState = { kind: "idle" };
  private root: HTMLElement | null = null;
  private tab: "changes" | "history" = "changes";
  private historyPath: string | null = null;
  private commits: Commit[] = [];
  private busy = false;

  constructor(private host: GitHost) {}

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
    this.host.onStatus(this.status, this.state);
    if (this.root) this.render();
    try {
      const now = await op();
      this.status = now;
      this.state = { kind: "idle" };
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
      this.host.onStatus(this.status, this.state);
      if (this.root) this.render();
    }
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
    const fetched = await this.fetch(true);
    if (!fetched || !this.status) return;
    const st = this.status;
    if (st.behind > 0 && st.ahead === 0) {
      const ok = await this.run(`Updating ${st.behind} commit${st.behind === 1 ? "" : "s"}`, () => git.fastForward());
      if (ok) {
        this.host.play("incoming");
        this.host.toast(`Updated with ${st.behind} incoming commit${st.behind === 1 ? "" : "s"}`);
      }
      return;
    }
    if (st.behind > 0 && st.ahead > 0) {
      this.state = {
        kind: "error",
        error: new GitError("diverged", `This copy has ${st.ahead} and the remote has ${st.behind} commits the other lacks.`),
      };
      this.host.play("problem");
      this.host.onStatus(this.status, this.state);
      if (this.root) this.render();
      return;
    }
    this.host.play("synced");
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
    if (!this.root) {
      const root = el("aside", "drawer git-drawer");
      root.setAttribute("aria-label", "Sync and history");
      document.querySelector(".reader")!.append(root);
      this.root = root;
      this.host.onVisible?.(true);
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          this.close();
        }
      });
    }
    this.render();
    void this.refresh();
    if (this.tab === "history") void this.loadHistory();
  }

  close(): void {
    const root = this.root;
    if (!root) return;
    this.root = null;
    this.host.onVisible?.(false);
    root.classList.add("is-leaving");
    root.addEventListener("animationend", () => root.remove(), { once: true });
    setTimeout(() => root.remove(), 260);
  }

  private render(): void {
    const root = this.root!;
    const st = this.status;
    root.replaceChildren();

    const head = el("header", "drawer-head");
    const title = el("div", "drawer-title");
    title.append(el("span", "", "Sync"));
    const close = el("button", "icon-btn");
    close.setAttribute("aria-label", "Close");
    close.innerHTML = `<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>`;
    close.onclick = () => this.close();
    head.append(title, close);
    root.append(head);

    if (!st?.isRepo) {
      root.append(this.explain(new GitError("notARepo", "")));
      return;
    }

    const summary = el("div", "sync-summary");
    const remote = el("div", "sync-remote");
    remote.append(
      el("span", "sync-remote-name", remoteName(st.remoteUrl)),
      el("span", "sync-branch", st.branch ?? "detached HEAD"),
    );
    if (st.upstream) remote.append(el("span", "sync-upstream", `tracks ${st.upstream}`));
    summary.append(remote);

    const quiet = !st.ahead && !st.behind && !st.files.length && this.state.kind !== "error";
    if (quiet) {
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

    const actions = el("div", "sync-actions");
    const btn = (label: string, primary: boolean, enabled: boolean, onClick: () => void, hint?: string) => {
      const b = el("button", primary ? "btn btn-primary" : "btn", label);
      b.disabled = !enabled || this.busy;
      b.onclick = onClick;
      if (hint) b.title = hint;
      actions.append(b);
      return b;
    };
    btn("Sync", true, true, () => void this.sync(), "Fetch, then apply incoming commits when that is a fast-forward");
    btn(
      `Push${st.ahead ? ` ${st.ahead}` : ""}`,
      false,
      st.ahead > 0 && st.behind === 0,
      () => void this.push(),
      st.behind ? "Sync first" : undefined,
    );
    summary.append(actions);
    if (this.state.kind === "busy") {
      const busy = el("div", "sync-busy");
      busy.append(el("span", "spinner"), el("span", "", `${this.state.label}…`));
      summary.append(busy);
    }
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

    const body = el("div", "drawer-body");
    root.append(body);
    if (this.tab === "changes") this.renderChanges(body, st);
    else this.renderHistory(body);
  }

  private explain(error: GitError): HTMLElement {
    const info = EXPLAIN[error.kind] ?? EXPLAIN.other;
    const box = el("div", `notice is-${error.kind === "offline" || error.kind === "notARepo" ? "quiet" : "warn"}`);
    box.setAttribute("role", "status");
    box.append(el("strong", "", info.title));
    if (info.body) box.append(el("p", "", info.body));
    if (error.message && error.kind !== "notARepo") {
      const details = el("details", "notice-details");
      details.append(el("summary", "", "Git output"), el("pre", "", error.message));
      box.append(details);
    }
    const row = el("div", "notice-actions");
    if (info.terminal || error.kind === "other") {
      const b = el("button", "btn btn-small", "Open in Terminal");
      b.onclick = () => void native.openTerminal();
      row.append(b);
    }
    if (error.kind === "auth" && this.status?.remoteUrl?.startsWith("https://")) {
      const b = el("button", "btn btn-small", "Save credentials in Keychain");
      b.onclick = () => box.replaceWith(this.credentialForm());
      row.append(b);
    }
    if (row.childElementCount) box.append(row);
    return box;
  }

  private credentialForm(): HTMLElement {
    const form = el("form", "notice cred-form");
    form.innerHTML = `<strong>HTTPS credentials</strong><p>Stored by git’s credential helper in your macOS Keychain. Waymark does not keep a copy. For most hosts the password is a personal access token.</p>`;
    const user = el("input");
    user.placeholder = "Username";
    user.autocomplete = "username";
    const secret = el("input");
    secret.type = "password";
    secret.placeholder = "Password or token";
    secret.autocomplete = "current-password";
    const save = el("button", "btn btn-primary btn-small", "Save and sync");
    save.type = "submit";
    form.append(user, secret, save);
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (!user.value || !secret.value || !this.status?.remoteUrl) return;
      try {
        await git.storeCredential(this.status.remoteUrl, user.value, secret.value);
        secret.value = "";
        await this.sync();
      } catch (err) {
        this.host.toast((err as Error).message);
      }
    };
    setTimeout(() => user.focus());
    return form;
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
    name.onclick = () => void this.showWorktreeDiff(f, isStaged);
    const act = el("button", "icon-btn change-act");
    act.setAttribute("aria-label", isStaged ? `Unstage ${base}` : `Stage ${base}`);
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
      empty.append(
        el("strong", "", "Nothing to commit"),
        el("p", "", "Edits made in Obsidian or any other editor appear here for review."),
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

    const box = el("form", "commit-box");
    const msg = el("textarea");
    msg.placeholder = staged.length ? "Describe what changed" : "Stage changes to commit them";
    msg.rows = 3;
    msg.disabled = !staged.length;
    const commit = el(
      "button",
      "btn btn-primary",
      staged.length ? `Commit ${staged.length} file${staged.length === 1 ? "" : "s"}` : "Commit",
    );
    commit.type = "submit";
    commit.disabled = !staged.length;
    box.append(msg, commit);
    const doCommit = async () => {
      if (!msg.value.trim()) {
        msg.focus();
        return;
      }
      const ok = await this.run("Committing", () => git.commit(msg.value));
      if (ok) {
        this.host.play("commit");
        this.host.toast("Committed. Push when you are ready.");
      }
    };
    box.onsubmit = (e) => {
      e.preventDefault();
      void doCommit();
    };
    msg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.metaKey) {
        e.preventDefault();
        void doCommit();
      }
    });
    body.append(box);
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
      this.host.toast(`Pushed ${n} commit${n === 1 ? "" : "s"}`);
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      this.commits = await git.log(this.historyPath, 80, 0);
    } catch (err) {
      this.commits = [];
      this.host.toast((err as Error).message);
    }
    if (this.root && this.tab === "history") this.render();
  }

  private renderHistory(body: HTMLElement): void {
    if (this.historyPath) {
      const scope = el("div", "history-scope");
      scope.append(el("span", "", "History of "), el("strong", "", this.host.title(this.historyPath)));
      const all = el("button", "link-btn", "Whole vault");
      all.onclick = () => {
        this.historyPath = null;
        this.commits = [];
        this.render();
        void this.loadHistory();
      };
      scope.append(all);
      body.append(scope);
    }
    if (!this.commits.length) {
      body.append(el("div", "empty-state", "Loading history…"));
      return;
    }
    const list = el("ol", "commit-list");
    for (const c of this.commits) {
      const li = el("li");
      const b = el("button", "commit-row");
      b.append(el("span", "commit-subject", c.subject || "(no message)"));
      const meta = el("span", "commit-meta");
      meta.append(el("span", "", c.author), el("span", "", relative(c.date)), el("code", "", c.short));
      b.append(meta);
      b.onclick = () => void this.showCommit(c);
      li.append(b);
      list.append(li);
    }
    body.append(list);
  }

  async showWorktreeDiff(f: FileChange, staged: boolean): Promise<void> {
    try {
      const text = await git.diff(f.path, staged, f.unstaged === "?" && !staged);
      openSheet(`${f.path}`, staged ? "Staged changes" : f.unstaged === "?" ? "New file" : "Unstaged changes", renderDiff(text));
    } catch (err) {
      this.host.toast((err as Error).message);
    }
  }

  /** Shows one commit: limited to a note's changes when `notePath` is given, with a way to read or compare that version. */
  async showCommit(c: Commit, notePath: string | null = this.historyPath): Promise<void> {
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
          openSheet(this.host.title(path), `As of ${new Date(c.date).toLocaleString()} · ${c.short} · read-only`, doc);
        };
        const cmp = el("button", "btn btn-small", "Compare with current");
        cmp.onclick = async () => {
          const head = this.status?.head;
          if (!head) return;
          const d = await git.diffRevs(c.sha, head, path);
          openSheet(
            this.host.title(path),
            `${c.short} → current`,
            renderDiff(d, { emptyMessage: "Identical to the current version." }),
          );
        };
        bar.append(read, cmp);
        content.append(bar);
      }
      content.append(renderDiff(text, { emptyMessage: "This commit changed no file contents." }));
      openSheet(c.subject || c.short, `${c.author} · ${new Date(c.date).toLocaleString()} · ${c.short}`, content);
    } catch (err) {
      this.host.toast((err as Error).message);
    }
  }
}

function remoteName(url: string | null): string {
  if (!url) return "No remote";
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? m[1] : url;
}

/** A large read-only sheet for diffs and past revisions. Escape or a click outside closes it. */
let closeActiveSheet: (() => void) | null = null;

function openSheet(title: string, subtitle: string, content: HTMLElement): void {
  closeActiveSheet?.();
  const overlay = el("div", "overlay sheet-overlay");
  const sheet = el("div", "sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", title);
  const head = el("header", "sheet-head");
  const titles = el("div");
  titles.append(el("h2", "sheet-title", title), el("div", "sheet-sub", subtitle));
  const close = el("button", "icon-btn");
  close.setAttribute("aria-label", "Close");
  close.innerHTML = `<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>`;
  head.append(titles, close);
  const body = el("div", "sheet-body");
  body.append(content);
  sheet.append(head, body);
  overlay.append(sheet);
  const dismiss = () => {
    closeActiveSheet = null;
    overlay.classList.add("is-leaving");
    setTimeout(() => overlay.remove(), 180);
    window.removeEventListener("keydown", onKey, true);
  };
  closeActiveSheet = dismiss;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    }
  };
  close.onclick = dismiss;
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) dismiss();
  });
  window.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  close.focus({ preventScroll: true });
}
