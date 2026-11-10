const DRAG_START_PX = 4;

export interface PointerDragHandlers {
  /** The pointer has travelled far enough to count as a drag. */
  start: (e: PointerEvent) => void;
  move: (e: PointerEvent) => void;
  /** Runs once, whether the drag ended, was cancelled or never started. */
  finish: () => void;
  /** Runs after `finish`, only for a drag that was released. */
  drop: () => void;
}

/** Follows one pointer from its press until release. Escape or a cancelled pointer ends it without a drop, and the click a finished drag would cause never reaches the page. */
export function trackPointerDrag(down: PointerEvent, handlers: PointerDragHandlers): void {
  let dragging = false;
  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("lostpointercapture", onCancel);
    window.removeEventListener("keydown", onKey, true);
    handlers.finish();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < DRAG_START_PX) return;
      dragging = true;
      handlers.start(e);
    }
    handlers.move(e);
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === down.pointerId) stop();
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    stop();
    if (!dragging) return;
    const swallow = (e: Event) => e.stopPropagation();
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true));
    handlers.drop();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    stop();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("lostpointercapture", onCancel);
  window.addEventListener("keydown", onKey, true);
}
