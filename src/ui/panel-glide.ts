import { isPointerAction } from "./input-origin";
import { holdClassWhile, timing } from "./list-motion";
import { reducedMotion } from "./media";
import { holdLines, rewrap, stopRewrap } from "./panel-rewrap";

const NOTICEABLE_PX = 0.5;

/* What a docked panel pushes sideways when its column opens or closes. The outline is left out: its own translate centres it. */
const FOLLOWERS = ".titlebar-lead > *, .tabs, .pane-head > *, .scroller > *";

interface Reading {
  edge: number;
  measure: number;
}

/**
 * Where an element's reading edge is, and how wide its lines are set. The note spans the whole pane and centres its
 * text column, so the column's left edge is what the eye follows.
 */
function readingOf(el: HTMLElement): Reading {
  const box = el.getBoundingClientRect();
  if (!el.parentElement?.matches(".scroller")) return { edge: box.left, measure: box.width };
  const tracks = getComputedStyle(el)
    .gridTemplateColumns.replace(/\[[^\]]*\]/g, " ")
    .trim()
    .split(/\s+/)
    .map(Number.parseFloat);
  if (tracks.length < 5 || tracks.some(Number.isNaN)) return { edge: box.left + box.width / 2, measure: box.width };
  return { edge: box.left + tracks[0] + tracks[1], measure: tracks[2] };
}

/**
 * Applies a docked panel's open or close at once, then carries what it moved from where it was, on the panel's own
 * curve. Each element travels its own distance, so the pane head stays beside the panel's edge while the centred note
 * moves half as far. When the window is too narrow for the note's full measure, its lines re-set once, at the start,
 * under a quick crossfade in panel-rewrap.ts, and never while travelling. A second click picks each element up from
 * where it had got to. Only a pointer gets the motion, and Reduce Motion keeps the panel's own fade without the travel.
 */
export function glidePanel(shell: HTMLElement, opening: boolean, change: () => void): void {
  const glide = isPointerAction() && !reducedMotion();
  const followers = [...shell.querySelectorAll<HTMLElement>(FOLLOWERS)].filter((el) => el.offsetParent);
  const was = glide ? followers.map(readingOf) : [];
  const doc = followers.find((el) => el.matches(".scroller > .doc"));
  if (doc) stopRewrap(doc);
  const held = glide && doc ? holdLines(doc) : undefined;
  const options = timing(opening ? "--t-panel-open" : "--t-panel-close", "--ease-panel");
  /* A key press lands everything at once, so it also ends a glide a click left running. */
  for (const el of followers) for (const animation of el.getAnimations()) if (animation.id === options.id) animation.cancel();
  change();
  if (!glide) return;
  const started: Animation[] = [];
  followers.forEach((el, i) => {
    const now = readingOf(el);
    const dx = was[i].edge - now.edge;
    if (Math.abs(dx) >= NOTICEABLE_PX) started.push(el.animate({ translate: [`${dx}px 0`, "0 0"] }, options));
    if (el === doc && held && Math.abs(was[i].measure - now.measure) >= NOTICEABLE_PX) rewrap(held, dx, options);
  });
  holdClassWhile(shell, "is-gliding", started);
}
