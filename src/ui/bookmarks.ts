import type { PrefStore } from "../prefs";
import type { VaultIndex } from "../vault/index";
import { showContextMenu } from "./context-menu";
import { icons } from "./icons";

export interface Bookmark {
  path: string;
  heading?: string;
}

export interface BookmarksHost {
  prefs: PrefStore;
  root: string;
  index: () => VaultIndex;
  text: (path: string) => string | undefined;
  open: (path: string, newTab: boolean, anchor?: string) => void;
  toast: (message: string) => void;
  current: () => string;
}

const isBookmark = (value: unknown): value is Bookmark => {
  const entry = value as Bookmark | null;
  return typeof entry?.path === "string" && (entry.heading === undefined || typeof entry.heading === "string");
};
const same = (a: Bookmark, b: Bookmark) => a.path === b.path && (a.heading ?? "") === (b.heading ?? "");
const treeIcon = (svg: string) => svg.replace("<svg", '<svg class="tree-icon"');
const CHEVRON = `<svg class="tree-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`;
const headingOf = (line: string) => /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];

/** A saved list of notes and headings, kept per vault in the app's preferences and shown above the folders. */
export class Bookmarks {
  readonly element = document.createElement("div");
  private readonly head = document.createElement("button");
  private readonly inner = document.createElement("div");
  private readonly body = document.createElement("div");

  constructor(private readonly host: BookmarksHost) {
    this.element.className = "tree-folder bookmarks";
    this.head.className = "tree-head";
    this.head.dataset.bookmarksHead = "";
    this.head.innerHTML = `${CHEVRON}${treeIcon(icons.bookmark)}<span class="tree-name">Bookmarks</span><span class="tree-count"></span>`;
    this.inner.className = "tree-inner";
    this.body.className = "tree-body";
    this.body.append(this.inner);
    this.element.addEventListener("click", (e) => this.onClick(e));
    this.element.addEventListener("contextmenu", (e) => this.onMenu(e));
  }

  get list(): Bookmark[] {
    const saved = this.host.prefs.value.vaults[this.host.root]?.bookmarks;
    return Array.isArray(saved) ? saved.filter(isBookmark) : [];
  }

  at(index: number): Bookmark | undefined {
    return this.list[index];
  }

  has(bookmark: Bookmark): boolean {
    return this.list.some((b) => same(b, bookmark));
  }

  isMissing(bookmark: Bookmark): boolean {
    return !this.host.index().notes.includes(bookmark.path);
  }

  label(bookmark: Bookmark): string {
    const title = bookmark.path.slice(bookmark.path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    return bookmark.heading ? `${title} › ${bookmark.heading}` : title;
  }

  toggle(bookmark: Bookmark): void {
    const on = !this.has(bookmark);
    this.write(on ? [...this.list, bookmark] : this.list.filter((b) => !same(b, bookmark)));
    this.host.toast(on ? `Bookmarked ${this.label(bookmark)}` : `Removed the bookmark for ${this.label(bookmark)}`);
  }

  remove(bookmark: Bookmark): void {
    this.write(this.list.filter((b) => !same(b, bookmark)));
  }

  noteMoved(from: string, to: string): void {
    if (!this.list.some((b) => b.path === from)) return;
    this.write(this.list.map((b) => (b.path === from ? { ...b, path: to } : b)));
  }

  /** Opens exactly the saved path. A note that has gone is reported, never replaced by one with a similar name. */
  open(bookmark: Bookmark, newTab = false): void {
    if (this.isMissing(bookmark)) {
      this.host.toast(`${this.label(bookmark)} is no longer in the vault.`);
      return;
    }
    const { heading } = bookmark;
    const known = heading && (this.host.text(bookmark.path) ?? "").split("\n").some((line) => headingOf(line) === heading);
    if (heading && !known) this.host.toast("That heading is no longer in this note, so it opened at the top.");
    this.host.open(bookmark.path, newTab, known ? heading : undefined);
  }

  render(): void {
    const list = this.list;
    this.element.hidden = list.length === 0;
    if (!list.length) {
      this.element.replaceChildren();
      return;
    }
    if (this.head.parentElement !== this.element) this.element.replaceChildren(this.head, this.body);
    const closed = this.host.prefs.value.vaults[this.host.root]?.bookmarksClosed === true;
    this.element.classList.toggle("is-open", !closed);
    this.head.setAttribute("aria-expanded", String(!closed));
    this.head.querySelector(".tree-count")!.textContent = list.length.toLocaleString();
    this.drawRows(list);
  }

  /** The rows are rebuilt on every note change, so a row holding focus hands it to its replacement. */
  private drawRows(list: Bookmark[]): void {
    const focused = this.inner.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.bookmark
      : undefined;
    this.inner.replaceChildren(...list.map((bookmark, i) => this.row(bookmark, i)));
    if (focused !== undefined)
      this.inner.querySelector<HTMLElement>(`[data-bookmark="${focused}"]`)?.focus({ preventScroll: true });
  }

  private row(bookmark: Bookmark, index: number): HTMLElement {
    const label = this.label(bookmark);
    const missing = this.isMissing(bookmark);
    const row = document.createElement("button");
    row.className = `nav-item is-bookmark${missing ? " is-missing" : ""}`;
    row.style.setProperty("--d", "1");
    row.dataset.bookmark = String(index);
    row.dataset.tip = missing ? `${label} is no longer in the vault` : label;
    row.classList.toggle("is-current", !bookmark.heading && bookmark.path === this.host.current());
    row.innerHTML = treeIcon(icons.bookmark);
    const text = document.createElement("span");
    text.className = "nav-text";
    text.textContent = label;
    row.append(text);
    return row;
  }

  private onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest("[data-bookmarks-head]")) {
      const { prefs, root } = this.host;
      prefs.update((p) => {
        p.vaults[root] ??= { tabs: [], active: 0, lastSync: null };
        p.vaults[root].bookmarksClosed = p.vaults[root].bookmarksClosed !== true;
      });
      this.render();
      return;
    }
    const row = target.closest<HTMLElement>("[data-bookmark]");
    const bookmark = row ? this.at(Number(row.dataset.bookmark)) : undefined;
    if (bookmark) this.open(bookmark, event.metaKey);
  }

  private onMenu(event: MouseEvent): void {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-bookmark]");
    const bookmark = row ? this.at(Number(row.dataset.bookmark)) : undefined;
    if (!bookmark) return;
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, [
      { label: "Open in new tab", run: () => this.open(bookmark, true) },
      { label: "Remove bookmark", startsGroup: true, run: () => this.remove(bookmark) },
    ]);
  }

  private write(list: Bookmark[]): void {
    const { prefs, root } = this.host;
    prefs.update((p) => {
      p.vaults[root] ??= { tabs: [], active: 0, lastSync: null };
      p.vaults[root].bookmarks = list;
    });
    this.render();
  }
}

/** The heading the reader is in now, for bookmarking it. */
export function currentHeading(scroller: HTMLElement): string | null {
  const edge = scroller.getBoundingClientRect().top + 12;
  const headings = [
    ...scroller.querySelectorAll<HTMLElement>(".doc :is(h2, h3, h4, h5, h6), .cm-content :is(.cm-h1, .cm-h2, .cm-h3, .cm-h4)"),
  ];
  const passed = headings.filter((h) => h.getBoundingClientRect().top <= edge).at(-1) ?? headings[0];
  return passed?.textContent?.replace(/^#+\s*/, "").trim() || null;
}
