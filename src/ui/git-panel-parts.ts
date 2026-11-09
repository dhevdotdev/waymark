/** The sync panel's fixed text and small building blocks. */

export const EXPLAIN: Record<string, { title: string; body: string; terminal?: boolean }> = {
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
    body: "Incoming commits change notes you have edited here. Waymark will not overwrite either side and has committed nothing. Resolve it in a terminal, then sync again.",
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
  timeout: {
    title: "Git took too long",
    body: "Waymark stopped waiting. For a commit, a Git hook or signing prompt may still be running, and it was left alone so nothing is half-written. Otherwise check your connection and try again.",
  },
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

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function remoteName(url: string | null): string {
  if (!url) return "No remote";
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  return m ? m[1] : url;
}

/** A large read-only sheet for diffs and past revisions. Escape or a click outside closes it. */
let closeActiveSheet: (() => void) | null = null;

export function openSheet(title: string, subtitle: string, content: HTMLElement): void {
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

const SLOW_WORK_MS = 350;

/** Says work is happening, but only once it has taken long enough to notice. Its space is reserved, so nothing moves. */
export class WorkIndicator {
  readonly element = el("div", "sync-activity");
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.element.setAttribute("aria-live", "polite");
    this.element.append(el("span", "spinner"), el("span"));
  }

  start(label: string, onSlow: () => void): void {
    this.element.lastElementChild!.textContent = `${label}…`;
    this.timer = setTimeout(() => {
      this.element.classList.add("is-on");
      onSlow();
    }, SLOW_WORK_MS);
  }

  stop(): void {
    clearTimeout(this.timer);
    this.element.classList.remove("is-on");
  }
}
