import { isPointerAction } from "./input-origin";
import { holdClassWhile, timing } from "./list-motion";
import { reducedMotion } from "./media";
import { holdLines, rewrap, stopRewrap } from "./panel-rewrap";

const NOTICEABLE_PX = 0.5;

/* What a docked panel pushes sideways when its column opens or closes. */
const FOLLOWERS = ".titlebar-lead > *, .tabs, .pane-head > *, .scroller > *, .floating-outline";

interface Reading {
  edge: number;
  /** The widths the element's content is set to. For the note, its wide and text tracks. */
  tracks: string;
}

/**
 * Where an element's reading edge is, and how wide its lines are set. The note spans the whole pane and centres its
 * text column, so the column's left edge is what the eye follows.
 */
function readingOf(el: HTMLElement): Reading {
  const box = el.getBoundingClientRect();
  if (!el.parentElement?.matches(".scroller")) return { edge: box.left, tracks: box.width.toFixed(1) };
  const tracks = getComputedStyle(el)
    .gridTemplateColumns.replace(/\[[^\]]*\]/g, " ")
    .trim()
    .split(/\s+/)
    .map(Number.parseFloat);
  if (tracks.length < 5 || tracks.some(Number.isNaN)) return { edge: box.left + box.width / 2, tracks: box.width.toFixed(1) };
  return {
    edge: box.left + tracks[0] + tracks[1],
    tracks: tracks
      .slice(1, 4)
      .map((t) => t.toFixed(1))
      .join(),
  };
}

/** An element its own translate already places, such as the vertically centred outline, travels by transform instead. */
const travel = (el: HTMLElement, dx: number): Keyframe[] | PropertyIndexedKeyframes =>
  getComputedStyle(el).translate === "none"
    ? { translate: [`${dx}px 0`, "0 0"] }
    : { transform: [`translateX(${dx}px)`, "none"] };

/**
 * Applies a docked panel's open or close at once, then carries what it moved from where it was, on the panel's own
 * curve. Each element travels its own distance, so the pane head stays beside the panel's edge while the centred note
 * moves half as far, and the outline keeps to the panel's edge. When the note's tracks change, panel-rewrap.ts re-sets
 * it once, at the start: diagrams scale with the panel, and only lines that break differently crossfade, never while
 * travelling. A second click picks each element up from
 * where it had got to. Only a pointer gets the motion, and Reduce Motion keeps the panel's own fade without the travel.
 */
export function glidePanel(shell: HTMLElement, opening: boolean, change: () => void): void {
  const glide = isPointerAction() && !reducedMotion();
  const followers = [...shell.querySelectorAll<HTMLElement>(FOLLOWERS)].filter((el) => el.offsetParent);
  const was = glide ? followers.map(readingOf) : [];
  const docAt = followers.findIndex((el) => el.matches(".scroller > .doc"));
  const doc = followers[docAt];
  const held = glide && doc ? holdLines(doc, was[docAt].edge) : undefined;
  if (doc) stopRewrap(doc);
  const options = timing(opening ? "--t-panel-open" : "--t-panel-close", "--ease-panel");
  /* A key press lands everything at once, so it also ends a glide a click left running. */
  for (const el of followers) for (const animation of el.getAnimations()) if (animation.id === options.id) animation.cancel();
  change();
  if (!glide) return;
  const started: Animation[] = [];
  followers.forEach((el, i) => {
    const now = readingOf(el);
    const dx = was[i].edge - now.edge;
    /* Blocks are measured at rest, before the note starts to travel. */
    if (el === doc && held && was[i].tracks !== now.tracks) rewrap(held, dx, now.edge, options);
    if (Math.abs(dx) >= NOTICEABLE_PX) started.push(el.animate(travel(el, dx), options));
  });
  holdClassWhile(shell, "is-gliding", started);
}
