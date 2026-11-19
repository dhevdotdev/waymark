import { isPointerAction } from "./input-origin";

/** Surfaces that stay usable over a modal layer: they never take focus from it, and a toast's Undo must still work. */
const PERSISTENT = ".toast, .tooltip, .scrollbar";
const FOCUSABLE =
  "a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

const stack: HTMLElement[] = [];

/** The control a pointer last pressed. A Mac never focuses a clicked button, so a layer it opens returns focus to this. */
let pressed: HTMLElement | null = null;
window.addEventListener(
  "pointerdown",
  (e) => {
    pressed = e.target instanceof Element ? e.target.closest<HTMLElement>(FOCUSABLE) : null;
  },
  true,
);
const madeInert = new Set<HTMLElement>();

/** Makes every top-level surface except the topmost layer inert, so a layer opened over another shuts that one too. */
function applyInert(): void {
  for (const el of madeInert) el.inert = false;
  madeInert.clear();
  const top = stack.at(-1);
  if (!top) return;
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement) || child.contains(top) || child.inert || child.matches(PERSISTENT)) continue;
    child.inert = true;
    madeInert.add(child);
  }
}

/** Moves Tab and Shift+Tab around `controls`, wrapping at the ends, from wherever focus is. */
function holdTab(e: KeyboardEvent, controls: HTMLElement[]): void {
  e.preventDefault();
  e.stopPropagation();
  if (!controls.length) return;
  const at = controls.indexOf(document.activeElement as HTMLElement);
  const step = e.shiftKey ? -1 : 1;
  const from = at < 0 && e.shiftKey ? 0 : at;
  controls[(from + step + controls.length) % controls.length].focus();
}

/** Moves focus into a surface that just opened. Opened with the pointer, it takes the keys without drawing a ring. */
export function takeFocus(el: HTMLElement | null): void {
  el?.focus({ preventScroll: true, focusVisible: !isPointerAction() });
}

/**
 * Gives focus back to `opener`, or to the control that replaced it under the same `data-control`, when focus would
 * otherwise be lost: it is still inside `layer`, which is leaving, or
 * nowhere. Focus that has already gone somewhere else stays there.
 */
export function returnFocus(opener: Element | null, layer: Element): void {
  const now = document.activeElement;
  if (now && now !== document.body && !layer.contains(now)) return;
  const control = opener instanceof HTMLElement ? opener.dataset.control : undefined;
  const target =
    opener instanceof HTMLElement && !opener.isConnected && control
      ? document.querySelector<HTMLElement>(`[data-control="${CSS.escape(control)}"]`)
      : opener;
  if (target instanceof HTMLElement && target.isConnected && !target.closest("[inert], .is-leaving"))
    target.focus({ preventScroll: true });
}

/**
 * Holds the page behind `layer`, a child of the body, while it is open: everything else is inert, Tab stays within
 * `controls`, Escape calls `escape`, and the element that had focus gets it back when the hold ends. Layers nest, and
 * only the topmost answers Tab and Escape. Returns the function that ends the hold, which is safe to call more than once.
 */
export function holdModal(
  layer: HTMLElement,
  options: { controls?: () => HTMLElement[]; escape?: () => void } = {},
): (restoreFocus?: boolean) => void {
  const opener = isPointerAction() && pressed?.isConnected ? pressed : document.activeElement;
  const within = options.controls ?? (() => [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)]);
  const onKey = (e: KeyboardEvent) => {
    if (stack.at(-1) !== layer) return;
    if (e.key === "Tab") holdTab(e, within());
    else if (e.key === "Escape" && options.escape) {
      e.stopPropagation();
      options.escape();
    }
  };
  stack.push(layer);
  applyInert();
  window.addEventListener("keydown", onKey, true);
  let held = true;
  return (restoreFocus = true) => {
    if (!held) return;
    held = false;
    window.removeEventListener("keydown", onKey, true);
    stack.splice(stack.indexOf(layer), 1);
    applyInert();
    if (restoreFocus) returnFocus(opener, layer);
  };
}
