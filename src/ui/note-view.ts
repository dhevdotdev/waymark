import { headingKey } from "../vault/index";
import type { VaultStore } from "../vault/store";
import { ancestors } from "../vault/tree";
import { findRanges, paint, scrollToRange } from "./find";
import type { ShellElements } from "./shell";

const WORDS_PER_MINUTE = 230;

/** The reading column: the rendered note, its header and its backlinks. */
export class NoteView {
  constructor(
    private readonly els: ShellElements,
    private readonly vault: VaultStore,
    private readonly vaultName: string,
    private readonly toast: (message: string) => void,
  ) {}

  /** Replaces the column with a rendered note and returns its article element. */
  mount(path: string, body: DocumentFragment, animate: boolean): HTMLElement {
    const doc = document.createElement("article");
    doc.className = "doc";
    if (animate) doc.classList.add("doc-enter");
    doc.append(this.heading(path), body);
    this.els.scroller.replaceChildren(doc);
    this.appendBacklinks(doc, path);
    this.renderPaneHead(path);
    return doc;
  }

  showMissing(path: string): void {
    this.showMessage(
      `“${this.vault.index.title(path)}” is no longer in the vault`,
      "It was moved, renamed or deleted outside Waymark. Press ⌘K to find it, or go back with ⌘[.",
    );
  }

  showBlank(): void {
    this.showMessage("Nothing open", "Press ⌘K to go to a note, or choose one from Files.");
  }

  showEmptyVault(): void {
    this.showMessage(
      "No Markdown notes here",
      "Waymark reads .md files. Open a different folder from the palette: press ⌘K and choose “Open another vault”.",
    );
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
    target.classList.remove("is-target");
    void target.offsetWidth;
    target.classList.add("is-target");
  }

  /** Scrolls to the first occurrence of `text` in the note body and marks every occurrence. */
  jumpToText(text: string): void {
    const doc = this.els.scroller.querySelector(".doc");
    if (!doc || !text) return;
    const ranges = findRanges(doc, text, 300).filter((r) => !r.startContainer.parentElement?.closest(".doc-head, .backlinks"));
    paint("search", ranges);
    if (ranges[0]) scrollToRange(ranges[0], this.els.scroller);
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
  private renderPaneHead(path: string): void {
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
    paneMeta.textContent = `${Math.max(1, Math.round(this.vault.wordCount(path) / WORDS_PER_MINUTE))} min read`;
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
