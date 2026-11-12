import { timing } from "./list-motion";
import { reducedMotion } from "./media";

/** A sync the pointer started lands on the status dot: it grows back to size and sends out one ring of its colour. */
export function pulseLanded(button: HTMLElement): void {
  const dot = button.querySelector<HTMLElement>(".sync-dot");
  if (!dot || reducedMotion()) return;
  for (const animation of dot.getAnimations({ subtree: true })) if (animation.id === "sync-pulse") animation.cancel();
  dot.animate({ scale: [0.4, 1] }, { ...timing("--t-menu", "--ease-out"), id: "sync-pulse" });
  dot.animate(
    { scale: [1, 2.6], opacity: [0.55, 0] },
    { ...timing("--t-toast", "--ease-out"), id: "sync-pulse", pseudoElement: "::after" },
  );
}
