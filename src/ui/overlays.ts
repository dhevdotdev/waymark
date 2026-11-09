const TOAST_MS = 2600;
const TOAST_EXIT_MS = 220;
const LIGHTBOX_EXIT_MS = 150;

export function toast(message: string): void {
  document.querySelector(".toast:not(.is-leaving)")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), TOAST_EXIT_MS);
  }, TOAST_MS);
}

export function lightbox(content: Element): void {
  const box = document.createElement("div");
  box.className = "overlay lightbox";
  const sheet = document.createElement("div");
  sheet.className = "lightbox-sheet";
  if (content instanceof SVGElement) {
    content.removeAttribute("style");
    content.removeAttribute("width");
    content.removeAttribute("height");
  }
  sheet.append(content);
  box.append(sheet);
  const close = () => {
    box.classList.add("is-leaving");
    setTimeout(() => box.remove(), LIGHTBOX_EXIT_MS);
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  box.addEventListener("click", close);
  window.addEventListener("keydown", onKey, true);
  document.body.append(box);
}

/** Calls `close` on Escape or a press outside `inside`. Returns a function that stops listening. */
export function dismissOnOutside(inside: Node[], close: () => void): () => void {
  const onEvent = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== "Escape") return;
    if (e instanceof PointerEvent && inside.some((node) => node.contains(e.target as Node))) return;
    stop();
    close();
  };
  const stop = () => {
    window.removeEventListener("pointerdown", onEvent, true);
    window.removeEventListener("keydown", onEvent, true);
  };
  window.addEventListener("pointerdown", onEvent, true);
  window.addEventListener("keydown", onEvent, true);
  return stop;
}

const FADE_OUT_MS = 140;

/** Removes a floating surface after a short fade. Leaving is quicker than arriving. */
export function fadeOut(element: HTMLElement): void {
  element.classList.add("is-leaving");
  setTimeout(() => element.remove(), FADE_OUT_MS);
}
