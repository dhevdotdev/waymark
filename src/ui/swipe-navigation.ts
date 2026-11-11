import { nearest } from "./scrollbars";
import { type Step, SwipeCue } from "./swipe-cue";

const NEEDED = 110;
/** Sideways travel ignored before the cue shows, so a vertical scroll's drift draws nothing. */
const SLACK = 12;
/** Longer than the gap between momentum events, so a flick stays one gesture. */
const GESTURE_GAP_MS = 180;
/** Fallback for a window whose frames are paused, so the step is never lost. */
const UNPAINTED_MS = 100;

export interface SwipeTarget {
  can: (step: Step) => boolean;
  go: (step: Step) => void;
}

/**
 * Runs `act` once the current frame has been painted. Opening the next note can hold the main
 * thread for a long frame; yielding one frame first lets the filled cue and its exit reach the
 * compositor, which keeps them moving while the note renders.
 */
function afterPaint(act: () => void): void {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    act();
  };
  requestAnimationFrame(() => setTimeout(once, 0));
  setTimeout(once, UNPAINTED_MS);
}

/** A two-finger swipe across `area` goes back or forward, once per gesture, with a cue drawn beside it. `data-gesture` on `area` marks a swipe that has not ended yet. */
export function bindSwipeNavigation(area: HTMLElement, target: SwipeTarget): void {
  const cue = new SwipeCue(area.parentElement ?? area);
  let sideways = 0;
  let upright = 0;
  let between = true;
  let spent = false;
  let ended = 0;
  /** Ends the gesture once the wheel has been quiet for the gap, counting only time the page was free to hear it. */
  const listen = () => {
    const armed = performance.now();
    ended = window.setTimeout(() => {
      // A timer this late means the page was busy, often opening the note just stepped to, and the momentum queued behind it is still this swipe.
      if (performance.now() - armed > GESTURE_GAP_MS * 2) {
        listen();
        return;
      }
      between = true;
      delete area.dataset.gesture;
      if (!spent) cue.cancel();
    }, GESTURE_GAP_MS);
  };
  area.addEventListener(
    "wheel",
    (e) => {
      if (between) {
        between = false;
        area.dataset.gesture = "open";
        sideways = 0;
        upright = 0;
        spent = e.ctrlKey || nearest(e.target as Element, "x") !== null;
      }
      clearTimeout(ended);
      listen();
      if (spent) return;
      sideways += e.deltaX;
      upright += e.deltaY;
      const step: Step = sideways < 0 ? -1 : 1;
      const across = Math.abs(sideways);
      if (across < SLACK || across < Math.abs(upright) * 2 || !target.can(step)) {
        cue.cancel();
        return;
      }
      cue.track(step, Math.min(1, (across - SLACK) / (NEEDED - SLACK)));
      if (across < NEEDED) return;
      spent = true;
      cue.commit(step);
      afterPaint(() => target.go(step));
    },
    { passive: true },
  );
}
