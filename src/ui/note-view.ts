import { isDesktop } from "../platform";
import { headingKey } from "../vault/index";
import type { VaultStore } from "../vault/store";
import { ancestors } from "../vault/tree";
import { findRanges, paint, scrollToRange } from "./find";
import { isPointerAction } from "./input-origin";
import { ringMatch } from "./match-ring";
import { reducedMotion } from "./media";
import { type Entrance, PageMotion } from "./page-motion";
import type { ShellElements } from "./shell";
import { watchTableFit } from "./table-fit";
import { watchTableSelection } from "./table-selection";

const WORDS_PER_MINUTE = 230;
const TARGET_HOLD = 0.45;

/** Tints a heading just reached, holding long enough for the eye to land before it clears. `delay` is how long until the scroll arrives. */
export function markTarget(target: HTMLElement, delay = 0): void {
  target.closest(".scroller")?.querySelector(".is-target")?.classList.remove("is-target");
  target.classList.add("is-target");
  if (reducedMotion()) return;
  for (const running of target.getAnimations()) running.cancel();
  const style = getComputedStyle(target);
  const tint = { backgroundColor: "var(--accent-soft)", boxShadow: "0 0 0 6px var(--accent-soft)" };
  const clear = { backgroundColor: "transparent", boxShadow: "0 0 0 6px transparent" };
  target.animate(
    [
      { ...tint, offset: 0 },
      { ...tint, offset: TARGET_HOLD, easing: style.getPropertyValue("--ease-out").trim() },
      { ...clear, offset: 1 },
    ],
    { duration: Number.parseFloat(style.getPropertyValue("--t-toast")), delay, fill: "backwards" },
  );
}

/** The reading column: the rendered note, its header and its backlinks. */
export class NoteView {
  private readonly motion: PageMotion;

  constructor(
    private readonly els: ShellElements,
    private readonly vault: VaultStore,
    private readonly vaultName: string,
    private readonly toast: (message: string) => void,
  ) {
    this.motion = new PageMotion(els.scroller);
    watchTableFit(els.scroller);
    watchTableSelection(els.scroller);
  }

  /** Replaces the column with a rendered note and returns its article element. Call `enter` once it is scrolled to where it opens. */
  mount(path: string, body: DocumentFragment, entrance: Entrance | undefined): HTMLElement {
    const doc = document.createElement("article");
    doc.className = "doc";
    /* A second link followed during the fade must not dip the page again. */
    const midFade = (this.els.scroller.querySelector(":scope > .doc-enter")?.getAnimations().length ?? 0) > 0;
    if (this.motion.leave(entrance) && !midFade) doc.classList.add("doc-enter");
    doc.append(this.heading(path), body);
    this.els.scroller.replaceChildren(doc);
    this.appendBacklinks(doc, path);
    this.showPaneHead(path, `${Math.max(1, Math.round(this.vault.wordCount(path) / WORDS_PER_MINUTE))} min read`);
    return doc;
  }

  enter(doc: HTMLElement): void {
    this.motion.enter(doc);
  }

  showMissing(path: string): void {
    this.showMessage(
      `“${this.vault.index.title(path)}” is no longer in the vault`,
      "It was moved, renamed or deleted outside Waymark. Press ⌘K to find it, or go back with ⌘[.",
    );
  }

  showEmptyVault(): void {
    this.showMessage(
      "No Markdown notes here",
      `Waymark reads .md files. Start one here${isDesktop ? ", or open a different folder" : ""}.`,
    );
    const actions = document.createElement("div");
    actions.className = "empty-actions";
    actions.innerHTML = `<button class="btn btn-primary" data-act="new-note">New note</button>${isDesktop ? `<button class="btn" data-act="open-vault">Open another folder</button>` : ""}`;
    this.els.scroller.querySelector(".empty-state.is-page")?.append(actions);
  }

  scrollToAnchor(anchor: string, quiet = false): void {
    const key = headingKey(anchor.split("#").pop() ?? anchor);
    const target = this.els.scroller.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (!target) {
      if (!quiet && !anchor.startsWith("^")) this.toast(`This note has no heading “${anchor}”. Showing the top instead.`);
      return;
    }
    target.scrollIntoView({ block: "start" });
    if (quiet) return;
    this.els.scroller.querySelector(".is-target")?.classList.remove("is-target");
    if (isPointerAction()) markTarget(target);
  }

  /** Scrolls to the first occurrence of `text` in the note body and marks every occurrence. */
  jumpToText(text: string, settling = false): void {
    const doc = this.els.scroller.querySelector(".doc");
    if (!doc || !text) return;
    const ranges = findRanges(doc, text, 300).filter((r) => !r.startContainer.parentElement?.closest(".doc-head, .backlinks"));
    paint("search", ranges);
    if (!ranges[0]) return;
    scrollToRange(ranges[0], this.els.scroller);
    ringMatch(ranges[0], this.els.reader, this.els.scroller, settling);
  }

  private showMessage(title: string, detail: string): void {
    const box = document.createElement("div");
    box.className = "empty-state is-page";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const p = document.createElement("p");
    p.textContent = detail;
    box.append(strong, p);
    this.els.scroller.replaceChildren(box);
  }

  private heading(path: string): HTMLElement {
    const head = document.createElement("header");
    head.className = "doc-head";
    const title = document.createElement("h1");
    title.className = "doc-title";
    title.textContent = this.vault.index.title(path);
    head.append(title);
    return head;
  }

  /** The note's real location and its reading time. */
  showPaneHead(path: string, meta: string): void {
    const { crumbs, paneMeta } = this.els;
    crumbs.replaceChildren();
    const add = (text: string, folder: string | null) => {
      const crumb = document.createElement(folder === null ? "span" : "button");
      crumb.className = "crumb";
      if (folder !== null) crumb.dataset.crumb = folder;
      crumb.textContent = text;
      crumbs.append(crumb);
    };
    add(this.vaultName, null);
    for (const folder of ancestors(path)) add(folder.slice(folder.lastIndexOf("/") + 1), folder);
    paneMeta.textContent = meta;
  }

  private appendBacklinks(doc: HTMLElement, path: string): void {
    const sources = [...this.vault.links.backlinks(path)].sort((a, b) => a.localeCompare(b));
    if (!sources.length) return;
    const section = document.createElement("section");
    section.className = "backlinks";
    section.id = "backlinks";
    const heading = document.createElement("h2");
    heading.className = "backlinks-title";
    heading.textContent = "Linked from";
    const list = document.createElement("ul");
    for (const source of sources) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.className = "wikilink";
      link.dataset.path = source;
      link.textContent = this.vault.index.title(source);
      item.append(link);
      const context = this.vault.linkContext(source, path);
      if (context) {
        const line = document.createElement("span");
        line.className = "backlink-context";
        line.textContent = context;
        item.append(line);
      }
      list.append(item);
    }
    section.append(heading, list);
    doc.append(section);
  }
}
