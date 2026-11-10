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

/** Drags an edge to resize what it belongs to. The size applies live and is saved once, on release. */
export function bindEdgeDrag(handle: HTMLElement, drag: EdgeDrag): void {
  const { shell } = drag;
  const classes = ["is-resizing", ...(drag.axis === "y" ? ["is-resizing-rows"] : [])];
  handle.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    const start = drag.read();
    const at = (e: PointerEvent) => (drag.axis === "x" ? e.clientX : e.clientY);
    handle.setPointerCapture(down.pointerId);
    shell.classList.add(...classes);
    const move = (e: PointerEvent) => {
      const [least, most] = drag.range();
      drag.apply(Math.round(Math.min(most, Math.max(least, start + (at(e) - at(down)) * drag.direction))));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      shell.classList.remove(...classes);
      drag.save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  });
}
