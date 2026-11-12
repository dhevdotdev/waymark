import { timing } from "./list-motion";

const REWRAP = "panel-rewrap";
const NOTICEABLE_PX = 0.5;
/* Blocks set in the wide track. A diagram or PDF keeps its proportions as the track changes, so it can scale. */
const SCALES = ".diagram, .embed-pdf";

/** Where a block sat, measured from the text column's left edge and the note's top, and where its lines broke. */
interface Place {
  left: number;
  top: number;
  width: number;
  height: number;
  lines: string;
}

/** The blocks of a note on screen before a docked panel changed the note's tracks, and where each one sat. */
export interface HeldLines {
  doc: HTMLElement;
  view: DOMRect;
  box: DOMRect;
  top: number;
  blocks: HTMLElement[];
  places: Place[];
}

let ghost: HTMLElement | undefined;

const inView = (el: Element, view: DOMRect): boolean => {
  const r = el.getBoundingClientRect();
  return r.bottom > view.top && r.top < view.bottom;
};

const near = (a: number, b: number): boolean => Math.abs(a - b) < NOTICEABLE_PX;

/** Where each line of a block ends, relative to the block, so two prints match only when the lines break alike. */
function linesOf(block: HTMLElement, box: DOMRect): string {
  if (block.matches(SCALES)) return "";
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
  return [...ends].join(";");
}

function placeOf(block: HTMLElement, edge: number, docTop: number): Place {
  const box = block.getBoundingClientRect();
  return { left: box.left - edge, top: box.top - docTop, width: box.width, height: box.height, lines: linesOf(block, box) };
}

/**
 * Takes note of the blocks on screen, read before the column changes. A block still moving from an earlier click is
 * read where it is drawn, so the next motion picks it up from there.
 */
export function holdLines(doc: HTMLElement, edge: number): HeldLines | undefined {
  const scroller = doc.parentElement;
  if (!scroller) return undefined;
  const view = scroller.getBoundingClientRect();
  const box = doc.getBoundingClientRect();
  const blocks = [...doc.children].filter((el): el is HTMLElement => el instanceof HTMLElement && inView(el, view));
  const first = blocks[0];
  if (!first) return undefined;
  const top = first.getBoundingClientRect().top - Number.parseFloat(getComputedStyle(first).marginBlockStart || "0");
  return { doc, view, box, top, blocks, places: blocks.map((el) => placeOf(el, edge, box.top)) };
}

/** Ends a crossfade or reshape still under way, so a second click starts from the note as it now stands. */
export function stopRewrap(doc: HTMLElement): void {
  ghost?.remove();
  ghost = undefined;
  for (const animation of doc.getAnimations({ subtree: true })) if (animation.id === REWRAP) animation.cancel();
}

/**
 * Carries the blocks that kept their lines from where they sat: a diagram or PDF scales from its old box, and a block
 * whose lines break as before but sits higher or lower glides there. Returns every block that needs no crossfade.
 */
function reshape(held: HeldLines, edge: number, glide: KeyframeAnimationOptions): Set<HTMLElement> {
  const carried = new Set<HTMLElement>();
  const docTop = held.doc.getBoundingClientRect().top;
  const options = { ...glide, id: REWRAP };
  held.blocks.forEach((el, i) => {
    if (!el.isConnected) return;
    const was = held.places[i];
    const now = placeOf(el, edge, docTop);
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (el.matches(SCALES)) {
      carried.add(el);
      if (near(was.width, now.width) && near(was.height, now.height) && near(dx, 0) && near(dy, 0)) return;
      const from = `translate(${dx}px, ${dy}px) scale(${was.width / now.width}, ${was.height / now.height})`;
      el.animate({ transformOrigin: ["0 0", "0 0"], transform: [from, "none"] }, options);
      return;
    }
    if (was.lines !== now.lines || !near(was.height, now.height) || !near(dx, 0)) return;
    carried.add(el);
    if (!near(dy, 0)) el.animate({ translate: [`0 ${dy}px`, "0 0"] }, options);
  });
  return carried;
}

/**
 * A copy of the held blocks at the width and place they were set, with the ones that did not change left blank. A
 * diagram's colours are scoped to its svg's id, so svg ids stay on the copy; it sits after the note, so lookups by id
 * still find the original first.
 */
function ghostOf(held: HeldLines, settled: ReadonlySet<HTMLElement>, reader: DOMRect): HTMLElement {
  const { view, box, top, blocks } = held;
  const copy = held.doc.cloneNode(false) as HTMLElement;
  copy.classList.remove("doc-enter");
  for (const block of blocks) {
    const clone = block.cloneNode(true) as HTMLElement;
    if (settled.has(block)) clone.style.visibility = "hidden";
    copy.append(clone);
  }
  for (const named of copy.querySelectorAll("[id]:not(svg, svg *)")) named.removeAttribute("id");
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
 * Re-sets a note whose tracks a docked panel changed, while it glides `dx` to its new place. Blocks that kept their
 * lines travel solid, by scale or by translate, so a diagram grows with the panel and the text below follows it. Only
 * blocks whose lines broke differently crossfade: their old lines fade where they were while the new ones fade in, on
 * the panel's gentle curve so neither copy drops away in a single frame, and both glide on the same path.
 */
export function rewrap(held: HeldLines, dx: number, edge: number, glide: KeyframeAnimationOptions): void {
  const { doc } = held;
  const reader = doc.closest<HTMLElement>(".reader");
  if (!reader || !doc.isConnected) return;
  const settled = reshape(held, edge, glide);
  const view = doc.parentElement?.getBoundingClientRect() ?? held.view;
  const arriving = [...doc.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !settled.has(el) && inView(el, view),
  );
  if (!arriving.length && settled.size === held.blocks.length) return;
  const fade = { ...timing("--t-menu", "--ease-panel"), id: REWRAP };
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
