/** The sync panel's fixed text and small building blocks. */

import { fadeOut } from "./overlays";

export const EXPLAIN: Record<string, { title: string; body: string; terminal?: boolean; retry?: string }> = {
  offline: {
    title: "Offline",
    body: "The remote could not be reached. Your notes are all here and readable; sync again when you are back online.",
    retry: "Try again",
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
    retry: "Sync now",
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
  noteConflict: {
    title: "A note needs a decision",
    body: "The note you are editing changed elsewhere. Choose what to keep in the bar above it, and the next backup will carry on.",
  },
  timeout: {
    title: "Git took too long",
    body: "Waymark stopped waiting. For a commit, a Git hook or signing prompt may still be running, and it was left alone so nothing is half-written. Otherwise check your connection and try again.",
    retry: "Try again",
  },
  notARepo: {
    title: "Not a Git repository",
    body: "This vault is a plain folder. Waymark reads it normally, but sync and history need Git.",
  },
  other: { title: "Git reported a problem", body: "Git stopped with an error. Its output says what went wrong." },
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
  return dayOf(t);
}

/** A date on its own, written one way everywhere. */
export function dayOf(at: number | string): string {
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The same date with its time, for the one place a commit is looked at closely. */
export function momentOf(at: number | string): string {
  return new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
let activeSheet: { fill: (title: string, subtitle: string, content: HTMLElement) => void; dismiss: () => void } | null = null;

export function closeSheet(): void {
  activeSheet?.dismiss();
}

/** A sheet opened from another sheet changes what the open one shows, so two never overlap. */
export function openSheet(title: string, subtitle: string, content: HTMLElement): void {
  if (activeSheet) {
    activeSheet.fill(title, subtitle, content);
    return;
  }
  const overlay = el("div", "overlay sheet-overlay");
  const sheet = el("div", "sheet");
  sheet.setAttribute("role", "dialog");
  const head = el("header", "sheet-head");
  const titles = el("div", "sheet-titles");
  const heading = el("h2", "sheet-title");
  const sub = el("div", "sheet-sub");
  titles.append(heading, sub);
  const close = el("button", "icon-btn");
  close.setAttribute("aria-label", "Close");
  close.innerHTML = `<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>`;
  head.append(titles, close);
  const body = el("div", "sheet-body");
  sheet.append(head, body);
  overlay.append(sheet);
  const fill = (nextTitle: string, nextSubtitle: string, nextContent: HTMLElement) => {
    sheet.setAttribute("aria-label", nextTitle);
    heading.textContent = nextTitle;
    sub.textContent = nextSubtitle;
    body.replaceChildren(nextContent);
    body.scrollTop = 0;
    close.focus({ preventScroll: true });
  };
  const dismiss = () => {
    activeSheet = null;
    fadeOut(overlay);
    window.removeEventListener("keydown", onKey, true);
  };
  activeSheet = { fill, dismiss };
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
  fill(title, subtitle, content);
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
