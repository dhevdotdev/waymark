import { instantly } from "./instant";
import { revealFolded } from "./reading-folds";

/** Text ranges under `root` that contain `needle`, ignoring case. Skips diagram sources and UI chrome. */
export function findRanges(root: Element, needle: string, limit = 2000): Range[] {
  const q = needle.toLowerCase();
  if (!q) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(".diagram-source, .code-bar, .callout-icon, script, style, .katex-mathml")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node && ranges.length < limit; node = walker.nextNode()) {
    const text = (node.textContent ?? "").toLowerCase();
    let at = text.indexOf(q);
    while (at >= 0 && ranges.length < limit) {
      const r = document.createRange();
      r.setStart(node, at);
      r.setEnd(node, at + q.length);
      ranges.push(r);
      at = text.indexOf(q, at + q.length);
    }
  }
  return ranges;
}

const supported = typeof CSS !== "undefined" && "highlights" in CSS;

/*
 * Each name keeps one registered Highlight whose ranges change in place. After the note has scrolled, the macOS
 * system WebKit does not repaint text whose Highlight was replaced in or removed from the registry, so marks from
 * earlier keystrokes stay on screen. Clearing a registered Highlight repaints them.
 */
const registered = new Map<string, Highlight>();

export function paint(name: string, ranges: Range[]): void {
  if (!supported) return;
  let highlight = registered.get(name);
  if (!highlight) {
    highlight = new Highlight();
    registered.set(name, highlight);
    CSS.highlights.set(name, highlight);
  }
  highlight.clear();
  for (const range of ranges) highlight.add(range);
}

/** Unfolds the section and opens the collapsed callout around a match, so it can be seen. */
function reveal(range: Range): void {
  revealFolded(range.startContainer);
  const el = range.startContainer.parentElement;
  const callout = el?.closest<HTMLElement>('.callout[data-fold="closed"]');
  if (!callout) return;
  instantly(callout, () => {
    callout.dataset.fold = "open";
  });
  callout.querySelector(".callout-title")?.setAttribute("aria-expanded", "true");
}

export function scrollToRange(range: Range, scroller: HTMLElement): void {
  reveal(range);
  const rect = range.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  const target = scroller.scrollTop + rect.top - box.top - box.height * 0.35;
  scroller.scrollTo({ top: Math.max(0, target) });
}

/** In-note find bar (⌘F). */
/** Previous, next and close, the same in Read and Edit. */
export const FIND_BUTTONS = `<button class="icon-btn" data-find="prev" aria-label="Previous match"><svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg></button><button class="icon-btn" data-find="next" aria-label="Next match"><svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg></button><button class="icon-btn" data-find="close" aria-label="Close find"><svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>`;

export class FindBar {
  private root: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private count!: HTMLElement;
  private ranges: Range[] = [];
  private index = 0;
  private searched = "";
  private readonly watcher = new MutationObserver(() => this.followView());

  /** `view` names what the scroller shows, such as a tab and note, so find knows when its note has gone. */
  constructor(
    private host: HTMLElement,
    private scroller: HTMLElement,
    private view: () => string,
  ) {}

  private get doc(): Element | null {
    return this.scroller.querySelector(".doc:not(.doc-editing)");
  }

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) {
      this.input.focus();
      this.input.select();
      return;
    }
    const root = document.createElement("div");
    root.className = "findbar";
    root.innerHTML = `<input type="text" spellcheck="false" placeholder="Find in note" aria-label="Find in note" /><span class="findbar-count" aria-live="polite"></span>${FIND_BUTTONS}`;
    this.root = root;
    this.input = root.querySelector("input")!;
    this.count = root.querySelector(".findbar-count")!;
    this.input.addEventListener("input", () => this.run());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    root.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-find]")?.dataset.find;
      if (act === "prev") this.step(-1);
      else if (act === "next") this.step(1);
      else if (act === "close") this.close();
    });
    this.host.append(root);
    paint("search", []);
    this.searched = this.view();
    this.watcher.observe(this.scroller, { childList: true });
    this.input.focus();
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length < 80 && !selection.includes("\n")) {
      this.input.value = selection;
      this.run();
    }
  }

  close(): void {
    this.watcher.disconnect();
    this.root?.remove();
    this.root = null;
    this.ranges = [];
    paint("find", []);
    paint("find-current", []);
  }

  /** The same note drawn again keeps the query. Another note, another tab or the editor in its place ends the search. */
  private followView(): void {
    if (this.view() === this.searched && this.doc) this.run();
    else this.close();
  }

  private run(): void {
    const doc = this.doc;
    this.ranges = doc ? findRanges(doc, this.input.value) : [];
    this.index = 0;
    const box = this.scroller.getBoundingClientRect();
    const firstVisible = this.ranges.findIndex((r) => r.getBoundingClientRect().top >= box.top);
    if (firstVisible > 0) this.index = firstVisible;
    this.show();
  }

  private step(delta: number): void {
    if (!this.ranges.length) return;
    this.index = (this.index + delta + this.ranges.length) % this.ranges.length;
    this.show();
  }

  private show(): void {
    paint("find", this.ranges);
    const current = this.ranges[this.index];
    paint("find-current", current ? [current] : []);
    this.count.textContent = this.input.value
      ? this.ranges.length
        ? `${this.index + 1} of ${this.ranges.length}`
        : "No matches"
      : "";
    this.root?.classList.toggle("is-empty", !!this.input.value && !this.ranges.length);
    if (current) scrollToRange(current, this.scroller);
  }
}
