import { instantly } from "./instant";

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

export function paint(name: string, ranges: Range[]): void {
  if (!supported) return;
  if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  else CSS.highlights.delete(name);
}

/** Opens a collapsed callout so a match inside it can be seen. */
function reveal(range: Range): void {
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

  constructor(
    private host: HTMLElement,
    private doc: () => Element | null,
    private scroller: HTMLElement,
  ) {}

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
    this.input.focus();
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length < 80 && !selection.includes("\n")) {
      this.input.value = selection;
      this.run();
    }
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.ranges = [];
    paint("find", []);
    paint("find-current", []);
  }

  /** Re-applies the query after the note re-renders. */
  refresh(): void {
    if (this.root) this.run();
  }

  private run(): void {
    const doc = this.doc();
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
