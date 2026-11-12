import { isPointerAction } from "./input-origin";
import { holdClassWhile, timing } from "./list-motion";
import { reducedMotion } from "./media";

const NOTICEABLE_PX = 0.5;

/* What a docked panel pushes sideways when its column opens or closes. The outline is left out: its own translate centres it. */
const FOLLOWERS = ".titlebar-lead > *, .tabs, .pane-head > *, .scroller > *";

/**
 * Where an element's reading edge is. The note spans the whole pane and centres its text column, so the column's left
 * edge is what the eye follows: it glides even when the measure changes and the lines re-wrap.
 */
function edgeOf(el: HTMLElement): number {
  const box = el.getBoundingClientRect();
  if (!el.parentElement?.matches(".scroller")) return box.left;
  const tracks = getComputedStyle(el)
    .gridTemplateColumns.replace(/\[[^\]]*\]/g, " ")
    .trim()
    .split(/\s+/)
    .map(Number.parseFloat);
  if (tracks.length < 5 || tracks.some(Number.isNaN)) return box.left + box.width / 2;
  return box.left + tracks[0] + tracks[1];
}

/**
 * Applies a docked panel's open or close at once, then carries what it moved from where it was. Each element travels
 * its own distance, so the pane head stays beside the panel's edge while the centred note moves half as far. A second
 * click picks each one up from where it had got to. Only a pointer gets the motion, and Reduce Motion keeps the
 * panel's own fade without the travel.
 */
export function glidePanel(shell: HTMLElement, change: () => void): void {
  const glide = isPointerAction() && !reducedMotion();
  const followers = [...shell.querySelectorAll<HTMLElement>(FOLLOWERS)].filter((el) => el.offsetParent);
  const was = glide ? followers.map(edgeOf) : [];
  const options = timing("--t-slide", "--ease-in-out");
  /* A key press lands everything at once, so it also ends a glide a click left running. */
  for (const el of followers) for (const animation of el.getAnimations()) if (animation.id === options.id) animation.cancel();
  change();
  if (!glide) return;
  const started: Animation[] = [];
  followers.forEach((el, i) => {
    const dx = was[i] - edgeOf(el);
    if (Math.abs(dx) >= NOTICEABLE_PX) started.push(el.animate({ translate: [`${dx}px 0`, "0 0"] }, options));
  });
  holdClassWhile(shell, "is-gliding", started);
}
