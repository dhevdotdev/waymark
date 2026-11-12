import { timing } from "./list-motion";

const REWRAP = "panel-rewrap";

/** The blocks of a note on screen before a docked panel changed its measure, and where each one's lines broke. */
export interface HeldLines {
  doc: HTMLElement;
  view: DOMRect;
  box: DOMRect;
  top: number;
  blocks: HTMLElement[];
  prints: string[];
}

let ghost: HTMLElement | undefined;

const inView = (el: Element, view: DOMRect): boolean => {
  const r = el.getBoundingClientRect();
  return r.bottom > view.top && r.top < view.bottom;
};

/**
 * Where a block sits in its note and where each of its lines ends. Two prints match only when the block would look the
 * same in the same place, so a block whose lines break as before, at the same height, needs no crossfade.
 */
function printOf(block: HTMLElement, doc: DOMRect): string {
  const box = block.getBoundingClientRect();
  const ends = new Map<number, number>();
  const range = document.createRange();
  const text = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = text.nextNode(); node; node = text.nextNode()) {
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) {
      const line = Math.round(r.top - box.top);
      ends.set(line, Math.max(ends.get(line) ?? 0, Math.round(r.right - box.left)));
    }
  }
  return `${Math.round(box.top - doc.top)}|${Math.round(box.height)}|${[...ends].join(";")}`;
}

/** Takes note of the lines on screen, read before the column changes. */
export function holdLines(doc: HTMLElement): HeldLines | undefined {
  const scroller = doc.parentElement;
  if (!scroller) return undefined;
  const view = scroller.getBoundingClientRect();
  const box = doc.getBoundingClientRect();
  const blocks = [...doc.children].filter((el): el is HTMLElement => el instanceof HTMLElement && inView(el, view));
  const first = blocks[0];
  if (!first) return undefined;
  const top = first.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(first).marginBlockStart || "0");
  return { doc, view, box, top, blocks, prints: blocks.map((el) => printOf(el, box)) };
}

/** Ends a crossfade still under way, so a second click starts from the note as it now stands. */
export function stopRewrap(doc: HTMLElement): void {
  ghost?.remove();
  ghost = undefined;
  for (const animation of doc.getAnimations({ subtree: true })) if (animation.id === REWRAP) animation.cancel();
}

/** A copy of the held blocks at the width and place they were set, with the ones that did not change left blank. */
function ghostOf(held: HeldLines, settled: ReadonlySet<HTMLElement>, reader: DOMRect): HTMLElement {
  const { view, box, top, blocks } = held;
  const copy = held.doc.cloneNode(false) as HTMLElement;
  copy.classList.remove("doc-enter");
  for (const block of blocks) {
    const clone = block.cloneNode(true) as HTMLElement;
    if (settled.has(block)) clone.style.visibility = "hidden";
    copy.append(clone);
  }
  for (const named of copy.querySelectorAll("[id]")) named.removeAttribute("id");
  Object.assign(copy.style, {
    position: "absolute",
    margin: "0",
    padding: "0",
    insetInlineStart: `${box.left - view.left}px`,
    insetBlockStart: `${top - view.top}px`,
    inlineSize: `${box.width}px`,
  });
  const layer = document.createElement("div");
  layer.className = "rewrap-ghost";
  layer.inert = true;
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    insetInlineStart: `${view.left - reader.left}px`,
    insetBlockStart: `${view.top - reader.top}px`,
    inlineSize: `${view.width}px`,
    blockSize: `${view.height}px`,
  });
  layer.append(copy);
  return layer;
}

/**
 * Crossfades only the blocks the new measure re-set or moved: their old lines fade where they were while the new ones
 * fade in, and both glide on the same path, so their left edges stay together. Blocks whose lines break as before are
 * never touched, so most of the page stays solid and only a ragged right edge changes, once, while everything is
 * already moving.
 */
export function rewrap(held: HeldLines, dx: number, glide: KeyframeAnimationOptions): void {
  const { doc } = held;
  const reader = doc.closest<HTMLElement>(".reader");
  if (!reader || !doc.isConnected) return;
  const box = doc.getBoundingClientRect();
  const settled = new Set(held.blocks.filter((el, i) => el.isConnected && printOf(el, box) === held.prints[i]));
  const view = doc.parentElement?.getBoundingClientRect() ?? held.view;
  const arriving = [...doc.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !settled.has(el) && inView(el, view),
  );
  if (!arriving.length && settled.size === held.blocks.length) return;
  const fade = { ...timing("--t-exit", "--ease-out"), id: REWRAP };
  for (const el of arriving) el.animate({ opacity: [0, 1] }, fade);
  const layer = ghostOf(held, settled, reader.getBoundingClientRect());
  reader.append(layer);
  ghost = layer;
  layer.animate({ translate: ["0 0", `${-dx}px 0`] }, { ...glide, fill: "forwards" });
  const out = layer.animate({ opacity: [1, 0] }, { ...fade, fill: "forwards" });
  const gone = () => {
    layer.remove();
    if (ghost === layer) ghost = undefined;
  };
  out.onfinish = gone;
  out.oncancel = gone;
}
