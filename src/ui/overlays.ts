import { icons } from "./icons";
import { isPointerAction } from "./input-origin";

/** While one of these is open it answers Escape itself, so the window must not act on the key too. */
export const ESCAPE_IS_TAKEN = ".lightbox, .sheet-overlay, .popover, .prompt-overlay, .prop-new, [data-editing-property]";

const TOAST_MS = 2600;
const TOAST_WITH_ACTION_MS = 6000;
/** The same length as `--t-exit`. */
const EXIT_MS = 140;

function exit(element: HTMLElement): void {
  element.classList.add("is-leaving");
  setTimeout(() => element.remove(), EXIT_MS);
}

/** Takes a floating surface away, quicker than it arrived. After a key press it is gone at once. */
export function fadeOut(element: HTMLElement): void {
  if (isPointerAction()) exit(element);
  else element.remove();
}

export function toast(message: string, action?: { label: string; run: () => void }): void {
  const previous = document.querySelector<HTMLElement>(".toast:not(.is-leaving)");
  if (previous) fadeOut(previous);
  const instant = !isPointerAction();
  const el = document.createElement("div");
  el.className = instant ? "toast is-instant" : "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      action.run();
      fadeOut(el);
    });
    el.append(button);
  }
  document.body.append(el);
  setTimeout(() => (instant ? el.remove() : exit(el)), action ? TOAST_WITH_ACTION_MS : TOAST_MS);
}

export function lightbox(content: Element): void {
  const returnFocus = document.activeElement;
  const box = document.createElement("div");
  box.className = "overlay lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Enlarged view");
  const sheet = document.createElement("div");
  sheet.className = "lightbox-sheet";
  if (content instanceof SVGElement) {
    content.removeAttribute("style");
    content.removeAttribute("width");
    content.removeAttribute("height");
  }
  sheet.append(content);
  const closer = document.createElement("button");
  closer.type = "button";
  closer.className = "icon-btn lightbox-close";
  closer.setAttribute("aria-label", "Close");
  closer.innerHTML = icons.close;
  box.append(sheet, closer);
  const close = () => {
    fadeOut(box);
    window.removeEventListener("keydown", onKey, true);
    if (returnFocus instanceof HTMLElement) returnFocus.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      closer.focus();
    }
  };
  /* A press, as on the other sheets, so a drag that starts inside and ends outside closes nothing. */
  box.addEventListener("pointerdown", (e) => {
    if (e.target === box) close();
  });
  closer.addEventListener("click", close);
  window.addEventListener("keydown", onKey, true);
  document.body.append(box);
  closer.focus({ preventScroll: true });
}

/** Calls `close` on Escape or a press outside `inside`. Returns a function that stops listening. */
export function dismissOnOutside(inside: Node[], close: (e: Event) => void): () => void {
  const onEvent = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== "Escape") return;
    if (e instanceof PointerEvent && inside.some((node) => node.contains(e.target as Node))) return;
    stop();
    close(e);
  };
  const stop = () => {
    window.removeEventListener("pointerdown", onEvent, true);
    window.removeEventListener("keydown", onEvent, true);
  };
  window.addEventListener("pointerdown", onEvent, true);
  window.addEventListener("keydown", onEvent, true);
  return stop;
}
