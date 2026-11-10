export interface PanelResize {
  shell: HTMLElement;
  variable: string;
  min: number;
  max: number;
  /** 1 when dragging right widens the panel, -1 when dragging left does. */
  direction: 1 | -1;
  read: () => number;
  /** Holds the width while dragging, without writing it out. */
  hold: (width: number) => void;
  save: () => void;
}

/** Drags a side panel's edge. The width applies live and is saved once, on release. */
export function bindPanelResize(handle: HTMLElement, panel: PanelResize): void {
  const { shell } = panel;
  handle.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    const start = panel.read();
    handle.setPointerCapture(down.pointerId);
    shell.classList.add("no-anim", "is-resizing");
    const move = (e: PointerEvent) => {
      const dragged = start + (e.clientX - down.clientX) * panel.direction;
      const width = Math.round(Math.min(panel.max, Math.max(panel.min, dragged)));
      shell.style.setProperty(panel.variable, `${width}px`);
      panel.hold(width);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      shell.classList.remove("no-anim", "is-resizing");
      panel.save();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  });
}
