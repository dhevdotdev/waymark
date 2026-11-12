import { tokenEasing, tokenMs } from "./graph-camera";
import { isPointerAction } from "./input-origin";
import { reducedMotion } from "./media";

let spreads = 0;

/**
 * Repaints the whole window inside a View Transition, the new theme growing as a circle from (`x`, `y`).
 * Under Reduce Motion the new theme fades in instead. Resolves true once the transition's animation has started,
 * and false when the web view has no View Transitions, in which case `apply` has already run.
 */
export async function spreadFrom(x: number, y: number, apply: () => void): Promise<boolean> {
  if (typeof document.startViewTransition !== "function") {
    apply();
    return false;
  }
  const root = document.documentElement;
  const spread = String(++spreads);
  root.dataset.themeSpread = spread;
  const transition = document.startViewTransition(apply);
  /* A newer pick skips this transition and finishes it, but the newer one still needs the marker. */
  void transition.finished.finally(() => {
    if (root.dataset.themeSpread === spread) delete root.dataset.themeSpread;
  });
  try {
    await transition.ready;
  } catch {
    return false;
  }
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const keyframes = reducedMotion()
    ? { opacity: [0, 1] }
    : { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] };
  root.animate(keyframes, {
    duration: tokenMs(reducedMotion() ? "--t-modal" : "--t-toast"),
    easing: tokenEasing("--ease-out"),
    pseudoElement: "::view-transition-new(root)",
  });
  return true;
}

/** A theme picked with the pointer spreads out from the swatch. From the keyboard it changes at once. */
export function spreadTheme(swatch: HTMLElement, apply: () => void): void {
  if (!isPointerAction()) {
    apply();
    return;
  }
  const r = swatch.getBoundingClientRect();
  void spreadFrom(r.left + r.width / 2, r.top + r.height / 2, apply);
}
