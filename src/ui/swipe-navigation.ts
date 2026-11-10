import { nearest } from "./scrollbars";

const NEEDED = 110;
/** Longer than the gap between momentum events, so a flick stays one gesture. */
const GESTURE_GAP_MS = 180;

/** A two-finger swipe across `area` goes back or forward, once per gesture. */
export function bindSwipeNavigation(area: HTMLElement, go: (step: -1 | 1) => void): void {
  let sideways = 0;
  let upright = 0;
  let last = 0;
  let spent = false;
  area.addEventListener(
    "wheel",
    (e) => {
      const now = performance.now();
      if (now - last > GESTURE_GAP_MS) {
        sideways = 0;
        upright = 0;
        spent = e.ctrlKey || nearest(e.target as Element, "x") !== null;
      }
      last = now;
      if (spent) return;
      sideways += e.deltaX;
      upright += e.deltaY;
      if (Math.abs(sideways) < NEEDED || Math.abs(sideways) < Math.abs(upright) * 2) return;
      spent = true;
      go(sideways < 0 ? -1 : 1);
    },
    { passive: true },
  );
}
