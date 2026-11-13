import { foldable, noteSections, type Section } from "../vault/sections";
import type { FoldStore } from "./fold-store";
import { isPointerAction } from "./input-origin";

/** The chevron and the trailing mark a folded heading shows, shared by Read and Edit. */
export const FOLD_CHEVRON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4"/></svg>`;

interface Fold {
  section: Section;
  heading: HTMLElement;
  /** The blocks after the heading that belong to its section. */
  members: HTMLElement[];
  toggle: HTMLButtonElement;
  folded: boolean;
}

/** The quiet mark after a folded heading's text, which unfolds it when clicked. */
export function foldTail(): HTMLElement {
  const tail = document.createElement("span");
  tail.className = "fold-tail";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "fold-more";
  more.tabIndex = -1;
  more.setAttribute("aria-label", "Unfold section");
  tail.append(more);
  return tail;
}

const HEADING = /^H[1-6]$/;
const controllers = new WeakMap<Element, ReadingFolds>();

/** Unfolds whatever hides `node` in the reading view, and the section a heading owns when `own` is set. */
export function revealFolded(node: Node, own = false): void {
  const el = node instanceof Element ? node : node.parentElement;
  const doc = el?.closest(".doc");
  if (el && doc) controllers.get(doc)?.reveal(el, own);
}

const isHidden = (el: Element) => el.hasAttribute("data-fold-hidden");

/** Folding sections under their headings in the reading view. */
export class ReadingFolds {
  private folds: Fold[] = [];
  private doc: HTMLElement | null = null;
  private path = "";

  constructor(
    private readonly store: FoldStore,
    private readonly scroller: HTMLElement,
  ) {}

  /** Gives each heading with something under it a fold control, folded as it was left. */
  mount(doc: HTMLElement, path: string, text: string): void {
    this.doc = doc;
    this.path = path;
    controllers.set(doc, this);
    const sections = foldable(noteSections(text));
    const saved = new Set(this.store.get(path));
    const byLine = new Map<number, HTMLElement>();
    for (const block of doc.children as HTMLCollectionOf<HTMLElement>)
      if (block.dataset.line) byLine.set(Number(block.dataset.line), block);
    this.folds = [];
    for (const section of sections) {
      const heading = byLine.get(section.line);
      if (!heading || !HEADING.test(heading.tagName)) continue;
      const members: HTMLElement[] = [];
      for (let el = heading.nextElementSibling as HTMLElement | null; el; el = el.nextElementSibling as HTMLElement | null) {
        if (el.matches(".backlinks") || Number(el.dataset.line) >= section.end) break;
        members.push(el);
      }
      if (!members.length) continue;
      const fold: Fold = { section, heading, members, toggle: this.decorate(heading), folded: saved.has(section.key) };
      fold.toggle.addEventListener("click", () => this.flip(fold));
      heading.querySelector(".fold-more")?.addEventListener("click", () => this.flip(fold));
      this.folds.push(fold);
    }
    const known = new Set(sections.map((section) => section.key));
    if ([...saved].some((key) => !known.has(key)))
      this.store.set(
        path,
        [...saved].filter((key) => known.has(key)),
      );
    this.paint();
  }

  /** Folds or unfolds the section being read, or the one whose control has focus. */
  toggleCurrent(): void {
    const focused = document.activeElement?.closest(".fold-toggle");
    const fold = this.folds.find((f) => f.toggle === focused) ?? this.current();
    if (fold) this.keepReading(() => this.set([fold], !fold.folded), fold);
  }

  setAll(folded: boolean): void {
    this.keepReading(() => this.set(this.folds, folded));
  }

  /** Unfolds every section hiding `el`, without motion, so it can be measured and scrolled to at once. */
  reveal(el: Element, own: boolean): void {
    const block = this.blockOf(el);
    if (!block) return;
    const hiding = this.folds.filter((f) => f.folded && (f.members.includes(block) || (own && f.heading === block)));
    if (hiding.length) this.set(hiding, false);
  }

  private decorate(heading: HTMLElement): HTMLButtonElement {
    const anchor = document.createElement("span");
    anchor.className = "fold-anchor";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "fold-toggle";
    toggle.innerHTML = FOLD_CHEVRON;
    anchor.append(toggle);
    heading.prepend(anchor);
    heading.append(foldTail());
    return toggle;
  }

  private blockOf(el: Element): HTMLElement | null {
    let block: Element | null = el;
    while (block && block.parentElement !== this.doc) block = block.parentElement;
    return block as HTMLElement | null;
  }

  /** The innermost section that holds the block at the top of the view, below the room a heading keeps above it. */
  private current(): Fold | undefined {
    const line = this.scroller.getBoundingClientRect().top + this.room() + 1;
    const blocks = [...(this.doc?.children ?? [])].filter((el) => !isHidden(el) && !el.matches(".doc-head, .backlinks"));
    const block = blocks.find((el) => el.getBoundingClientRect().bottom > line) ?? blocks.at(-1);
    return block && this.folds.findLast((f) => f.heading === block || f.members.includes(block as HTMLElement));
  }

  /** A click on a control: the heading under the pointer stays exactly where it is. */
  private flip(fold: Fold): void {
    const before = fold.heading.getBoundingClientRect().top;
    const shown = this.set([fold], !fold.folded);
    this.hold(fold.heading, before);
    if (!isPointerAction()) return;
    const style = getComputedStyle(fold.heading);
    for (const el of shown)
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: Number.parseFloat(style.getPropertyValue("--t-menu")),
        easing: style.getPropertyValue("--ease-out").trim(),
      });
  }

  /**
   * Keeps the reader's place through a change from the keyboard or palette. A block still on screen stays at its
   * height, and a block folded away is replaced by the heading that hid it, at the top of the view.
   */
  private keepReading(change: () => void, fold?: Fold): void {
    const top = this.scroller.getBoundingClientRect().top;
    const blocks = [...(this.doc?.children ?? [])].filter((el) => !isHidden(el)) as HTMLElement[];
    const block = blocks.find((el) => el.getBoundingClientRect().bottom > top);
    const before = block?.getBoundingClientRect().top ?? 0;
    change();
    if (!block) return;
    if (!isHidden(block) && !(fold && fold.heading.getBoundingClientRect().top < top)) {
      this.hold(block, before);
      return;
    }
    let heading: Element | null = block;
    while (heading && isHidden(heading)) heading = heading.previousElementSibling;
    if (heading instanceof HTMLElement) this.hold(heading, top + this.room());
  }

  /** The room a heading reached by a link keeps above it, which a heading brought to the top keeps too. */
  private room(): number {
    const heading = this.folds.find((f) => f.heading.tagName !== "H1")?.heading;
    return heading ? Number.parseFloat(getComputedStyle(heading).scrollMarginTop) || 0 : 0;
  }

  /** Scrolls so `el` sits at `top`, holding room under the note when it became too short to scroll that far. */
  private hold(el: HTMLElement, top: number): void {
    const { scroller, doc } = this;
    if (!doc) return;
    doc.style.removeProperty("min-block-size");
    const shift = el.getBoundingClientRect().top - top;
    scroller.scrollTop += shift;
    const short = el.getBoundingClientRect().top - top;
    if (short < 1) return;
    doc.style.minBlockSize = `${doc.offsetHeight + short}px`;
    scroller.scrollTop += short;
  }

  /** Changes folds and returns the blocks that came into view. */
  private set(folds: Fold[], folded: boolean): HTMLElement[] {
    const wasHidden = new Set(this.folds.flatMap((f) => (f.folded ? f.members : [])));
    for (const fold of folds) fold.folded = folded;
    this.store.set(
      this.path,
      this.folds.filter((f) => f.folded).map((f) => f.section.key),
    );
    this.paint();
    return [...wasHidden].filter((el) => !isHidden(el));
  }

  private paint(): void {
    const hidden = new Set(this.folds.flatMap((f) => (f.folded ? f.members : [])));
    for (const fold of this.folds) {
      fold.heading.toggleAttribute("data-folded", fold.folded);
      fold.toggle.setAttribute("aria-expanded", String(!fold.folded));
      fold.toggle.setAttribute("aria-label", fold.folded ? "Unfold section" : "Fold section");
      for (const el of fold.members) {
        if (hidden.has(el) === isHidden(el)) continue;
        for (const running of el.getAnimations()) running.cancel();
        el.toggleAttribute("data-fold-hidden", hidden.has(el));
      }
    }
    this.scroller.dispatchEvent(new Event("foldchange"));
  }
}
