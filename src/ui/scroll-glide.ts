import { parseCubicBezier } from "./cubic-bezier";
import { isPointerAction } from "./input-origin";
import { reducedMotion } from "./media";

/** Further than this many screens, the glide starts one screen short, so a long jump is never slower than a short one. */
const FAR_SCREENS = 3;

let running: { frame: number; target: HTMLElement; scroller: HTMLElement } | null = null;

/** Leaves the scroll where the glide has it, and drops the tint waiting for its landing. */
function stopGlide(): void {
  if (!running) return;
  cancelAnimationFrame(running.frame);
  for (const a of running.target.getAnimations()) a.cancel();
  delete running.scroller.dataset.gliding;
  running = null;
}

/** Where `scroller` rests with `target` at its top, honouring the target's `scroll-margin-top`. */
function restingTop(scroller: HTMLElement, target: HTMLElement): number {
  const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
  return Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, top));
}

/**
 * Brings `target` to the top of `scroller`. A pointer click glides there; a key, the palette or Reduce Motion jump at once.
 * The destination is read again on every frame, so an image loading above the heading cannot make the glide miss it.
 * Calls `landed` with how many milliseconds remain until the scroll arrives.
 */
export function glideTo(scroller: HTMLElement, target: HTMLElement, landed: (inMs: number) => void): void {
  stopGlide();
  const style = getComputedStyle(scroller);
  const duration = Number.parseFloat(style.getPropertyValue("--t-modal")) || 0;
  const ease = parseCubicBezier(style.getPropertyValue("--ease-in-out").trim());
  if (!isPointerAction() || reducedMotion() || !duration || !ease) {
    scroller.scrollTop = restingTop(scroller, target);
    landed(0);
    return;
  }
  let from = scroller.scrollTop;
  const to = restingTop(scroller, target);
  if (Math.abs(to - from) > FAR_SCREENS * scroller.clientHeight) {
    from = to - Math.sign(to - from) * scroller.clientHeight;
    scroller.scrollTop = from;
  }
  const start = performance.now();
  const step = (now: number) => {
    if (!target.isConnected) {
      stopGlide();
      return;
    }
    const progress = Math.min(1, (now - start) / duration);
    scroller.scrollTop = from + (restingTop(scroller, target) - from) * ease(progress);
    if (progress < 1) running!.frame = requestAnimationFrame(step);
    else {
      delete scroller.dataset.gliding;
      running = null;
    }
  };
  running = { frame: requestAnimationFrame(step), target, scroller };
  scroller.dataset.gliding = String(duration);
  landed(duration);
}

/** A wheel, trackpad, press on the page or any key takes the scroll back from a glide. */
export function yieldGlideTo(scroller: HTMLElement): void {
  for (const type of ["wheel", "pointerdown"]) scroller.addEventListener(type, stopGlide, { passive: true, capture: true });
  window.addEventListener("keydown", stopGlide, { passive: true, capture: true });
}
