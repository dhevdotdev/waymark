import { icons } from "./icons";
import { nearest } from "./scrollbars";

const NEEDED = 110;
/** Sideways travel ignored before the cue shows, so a vertical scroll's drift draws nothing. */
const SLACK = 12;
/** Longer than the gap between momentum events, so a flick stays one gesture. */
const GESTURE_GAP_MS = 180;
/** Long enough to see the filled cue before it fades over the next note. */
const COMMITTED_HOLD_MS = 160;

type Step = -1 | 1;

export interface SwipeTarget {
  can: (step: Step) => boolean;
  go: (step: Step) => void;
}

/** The arrow at the edge of the note area that tracks a swipe and fills when letting go would navigate. */
class SwipeCue {
  readonly el = document.createElement("div");
  private hold = 0;

  constructor(host: HTMLElement) {
    this.el.className = "swipe-cue";
    this.el.setAttribute("aria-hidden", "true");
    host.append(this.el);
  }

  track(step: Step, progress: number): void {
    clearTimeout(this.hold);
    const side = step < 0 ? "back" : "forward";
    if (this.el.dataset.side !== side) {
      this.el.dataset.side = side;
      this.el.innerHTML = icons[side];
    }
    this.el.style.setProperty("--swipe", progress.toFixed(3));
    this.el.classList.add("is-on");
    this.el.classList.toggle("is-ready", progress >= 1);
  }

  /** Slides back to the edge it came from. */
  cancel(): void {
    clearTimeout(this.hold);
    this.el.style.setProperty("--swipe", "0");
    this.el.classList.remove("is-on", "is-ready");
  }

  /** Stays where it is, filled, and fades. */
  commit(): void {
    this.el.classList.add("is-ready");
    clearTimeout(this.hold);
    this.hold = window.setTimeout(() => this.el.classList.remove("is-on"), COMMITTED_HOLD_MS);
  }
}

/** A two-finger swipe across `area` goes back or forward, once per gesture, with a cue drawn beside it. */
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
      if (!spent) cue.cancel();
    }, GESTURE_GAP_MS);
  };
  area.addEventListener(
    "wheel",
    (e) => {
      if (between) {
        between = false;
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
      cue.commit();
      target.go(step);
    },
    { passive: true },
  );
}
