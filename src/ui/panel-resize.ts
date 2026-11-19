export interface EdgeDrag {
  shell: HTMLElement;
  axis: "x" | "y";
  /** 1 when dragging right or down makes it larger, -1 when the other way does. */
  direction: 1 | -1;
  /** The smallest and largest size it may take right now. */
  range: () => [number, number];
  read: () => number;
  /** Shows a size while dragging, without writing it out. */
  apply: (size: number) => void;
  save: () => void;
}

const STEP = 10;
const BIG_STEP = 50;

/**
 * Drags an edge to resize what it belongs to. The size applies live and is saved once, on release; Escape or a
 * cancelled pointer puts back the size it started at. Focused, the edge is a separator the arrows move, further with
 * Shift, and Home and End take it to its least and most.
 */
export function bindEdgeDrag(handle: HTMLElement, drag: EdgeDrag): void {
  const { shell } = drag;
  const classes = ["is-resizing", ...(drag.axis === "y" ? ["is-resizing-rows"] : [])];
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", drag.axis === "x" ? "vertical" : "horizontal");
  const resize = (size: number) => {
    const [least, most] = drag.range();
    drag.apply(Math.round(Math.min(most, Math.max(least, size))));
    describe();
  };
  const describe = () => {
    const [least, most] = drag.range();
    handle.setAttribute("aria-valuemin", String(least));
    handle.setAttribute("aria-valuemax", String(most));
    handle.setAttribute("aria-valuenow", String(drag.read()));
  };
  handle.addEventListener("focus", describe);

  handle.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    down.preventDefault();
    const start = drag.read();
    const at = (e: PointerEvent) => (drag.axis === "x" ? e.clientX : e.clientY);
    handle.setPointerCapture(down.pointerId);
    shell.classList.add(...classes);
    const move = (e: PointerEvent) => resize(start + (at(e) - at(down)) * drag.direction);
    const end = (kept: boolean) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", drop);
      handle.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("keydown", onKey, true);
      shell.classList.remove(...classes);
      if (kept) drag.save();
      else resize(start);
    };
    const drop = () => end(true);
    const cancel = () => end(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
      if (handle.hasPointerCapture(down.pointerId)) handle.releasePointerCapture(down.pointerId);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", drop);
    handle.addEventListener("pointercancel", cancel);
    handle.addEventListener("lostpointercapture", cancel);
    window.addEventListener("keydown", onKey, true);
  });

  handle.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const along: Record<string, number> = drag.axis === "x" ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
    const [least, most] = drag.range();
    const size =
      e.key in along
        ? drag.read() + along[e.key] * drag.direction * (e.shiftKey ? BIG_STEP : STEP)
        : { Home: least, End: most }[e.key];
    if (size === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    /* A key resizes at once, so the panel's own transitions are held off for this one change. */
    shell.classList.add(...classes);
    resize(size);
    void shell.offsetHeight;
    shell.classList.remove(...classes);
    drag.save();
  });
}
