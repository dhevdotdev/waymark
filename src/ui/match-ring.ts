import { isPointerAction } from "./input-origin";
import { timing } from "./list-motion";
import { reducedMotion } from "./media";

const RING_MOTION = "match-ring";
const HOLD_MS = 400;
/* The pointer's entry and hold together, so a key press holds the ring as long. */
const KEY_HOLD_MS = 640;
/* How far out the ring starts before it closes onto the match. */
const REACH_PX = 10;

interface Live {
  range: Range;
  rings: HTMLElement[];
  stop: () => void;
}

let live: Live | null = null;

function clear(): void {
  live?.stop();
  live = null;
}

const rectsOf = (range: Range): DOMRect[] => [...range.getClientRects()].filter((r) => r.width > 0);

function place(rings: HTMLElement[], range: Range, frame: HTMLElement): void {
  const rects = rectsOf(range);
  if (rects.length !== rings.length) return;
  const box = frame.getBoundingClientRect();
  rings.forEach((ring, i) => {
    const r = rects[i];
    ring.style.insetInlineStart = `${r.left - box.left - 2}px`;
    ring.style.insetBlockStart = `${r.top - box.top - 1}px`;
    ring.style.inlineSize = `${r.width + 4}px`;
    ring.style.blockSize = `${r.height + 2}px`;
  });
}

function play(ring: HTMLElement): Animation {
  /* A key press gets the ring at rest, and it goes without a fade. */
  if (!isPointerAction()) return ring.animate({ opacity: [1, 1] }, { duration: KEY_HOLD_MS, id: RING_MOTION });
  const still = reducedMotion();
  const enter = still ? timing("--t-exit", "--ease-out") : timing("--t-slide", "--ease-out");
  const sx = 1 + (2 * REACH_PX) / ring.offsetWidth;
  const sy = 1 + (2 * REACH_PX) / ring.offsetHeight;
  ring.animate(still ? { opacity: [0, 1] } : { opacity: [0, 1], scale: [`${sx} ${sy}`, "1 1"] }, {
    ...enter,
    id: RING_MOTION,
    fill: "backwards",
  });
  return ring.animate(
    { opacity: [1, 0] },
    { ...timing("--t-toast", "--ease-out"), delay: Number(enter.duration) + HOLD_MS, fill: "forwards", id: RING_MOTION },
  );
}

/**
 * Rings the match a search jump landed on, so the eye finds it among the other marks. The ring follows the match
 * while it lasts, through scrolling and the note settling. Called again for the same match, it keeps its ring.
 * Called while the note settles, it only follows a ring that is still there.
 */
export function ringMatch(range: Range, frame: HTMLElement, scroller: HTMLElement, settling = false): void {
  if (live && live.range.startContainer === range.startContainer && live.range.startOffset === range.startOffset) {
    live.range = range;
    return;
  }
  /* The note settling re-finds the match; a ring that already left stays gone. */
  if (settling) return;
  clear();
  const count = rectsOf(range).length;
  if (!count) return;
  const rings = Array.from({ length: count }, () => {
    const ring = document.createElement("div");
    ring.className = "match-ring";
    ring.setAttribute("aria-hidden", "true");
    frame.append(ring);
    return ring;
  });
  const current: Live = { range, rings, stop: () => {} };
  place(rings, range, frame);
  let frameId = 0;
  const follow = () => {
    place(rings, current.range, frame);
    frameId = requestAnimationFrame(follow);
  };
  frameId = requestAnimationFrame(follow);
  /* Another note in the scroller takes the match with it. */
  const gone = new MutationObserver(() => clear());
  gone.observe(scroller, { childList: true });
  current.stop = () => {
    cancelAnimationFrame(frameId);
    gone.disconnect();
    for (const ring of rings) ring.remove();
  };
  live = current;
  void Promise.allSettled(rings.map(play).map((a) => a.finished)).then(() => {
    if (live === current) clear();
  });
}
