/** Motion is for the pointer. This says whether the last action came from it, in code and as `data-input` on the root for CSS. */
type Origin = "pointer" | "keyboard";

let origin: Origin = "pointer";

function setOrigin(next: Origin): void {
  origin = next;
  document.documentElement.dataset.input = next;
}

export const isPointerAction = (): boolean => origin === "pointer";

/** For actions that arrive without a key press of their own, such as a menu bar command. */
export function markKeyboardOrigin(): void {
  setOrigin("keyboard");
}

export function trackInputOrigin(): void {
  setOrigin("pointer");
  window.addEventListener("pointerdown", () => setOrigin("pointer"), { capture: true, passive: true });
  window.addEventListener(
    "keydown",
    (e) => {
      if (!["Meta", "Control", "Alt", "Shift"].includes(e.key)) setOrigin("keyboard");
    },
    { capture: true, passive: true },
  );
}
