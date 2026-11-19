import { fillDestination, linkDestination, outsideLink, placeUnderLink } from "./link-tooltip";
import { missingLink, missingTip } from "./missing-link";

const SHOW_DELAY_MS = 550;
const WARM_MS = 800;

const TIP_ID = "tooltip";

const targetOf = (el: Element): HTMLElement | null => el.closest<HTMLElement>("[data-tip]") ?? outsideLink(el) ?? missingLink(el);

/** A row or tab names itself in full unless its label is cut short, so only a cut label gets a tooltip. */
function worthShowing(target: HTMLElement): boolean {
  if (target.closest(".tab.is-active")) return false;
  const label = target.querySelector<HTMLElement>(
    ":scope > :is(.nav-text, .rail-link-name, .tree-name, .start-title, .trail-name, .tab-title)",
  );
  return !label || label.scrollWidth > label.clientWidth;
}

/** Points the target at what its tooltip adds: all of it, or only the shortcut when the tip repeats the target's name. */
function describe(target: HTMLElement, tip: HTMLElement): void {
  const name = (target.getAttribute("aria-label") ?? target.textContent ?? "").trim();
  const adds = name !== "" && name === target.dataset.tip?.trim() ? tip.querySelector("kbd") : tip;
  if (!adds) return;
  adds.id = TIP_ID;
  const ids = target.getAttribute("aria-describedby")?.split(" ") ?? [];
  target.setAttribute("aria-describedby", [...ids, TIP_ID].join(" "));
}

function undescribe(target: HTMLElement): void {
  const ids = (target.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && id !== TIP_ID);
  if (ids.length) target.setAttribute("aria-describedby", ids.join(" "));
  else target.removeAttribute("aria-describedby");
}

/** Shows `data-tip` labels and where outside links go. A tooltip opened soon after another skips the delay. */
export function bindTooltips(root: HTMLElement): void {
  let tip: HTMLElement | null = null;
  let timer = 0;
  let warmUntil = 0;
  let pressed: HTMLElement | null = null;
  let current: HTMLElement | null = null;

  const hide = () => {
    clearTimeout(timer);
    if (tip && current) undescribe(current);
    tip?.remove();
    tip = null;
    current = null;
  };

  const show = (target: HTMLElement, pointerY: number | null) => {
    if (document.querySelector(".context-menu:not(.is-leaving)") || !target.isConnected) return;
    tip = document.createElement("div");
    tip.className = `tooltip${pointerY === null || performance.now() < warmUntil ? " is-instant" : ""}`;
    tip.setAttribute("role", "tooltip");
    const destination = target.dataset.tip === undefined ? linkDestination(target) : null;
    if (destination) {
      document.body.append(tip);
      fillDestination(tip, destination);
      placeUnderLink(tip, target, pointerY);
      return;
    }
    tip.textContent = target.dataset.tip ?? (target.dataset.missing === undefined ? "" : missingTip(target));
    if (target.dataset.key) {
      const kbd = document.createElement("kbd");
      kbd.textContent = target.dataset.key;
      tip.append(kbd);
    }
    document.body.append(tip);
    describe(target, tip);
    const r = target.getBoundingClientRect();
    const width = tip.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2));
    tip.style.left = `${left}px`;
    const above = target.dataset.tipSide === "above" || r.bottom + 40 > window.innerHeight;
    tip.style.top = `${above ? r.top - tip.offsetHeight - 6 : r.bottom + 6}px`;
    tip.style.transformOrigin = `${r.left + r.width / 2 - left}px ${above ? "bottom" : "top"}`;
  };

  const arrive = (target: HTMLElement, pointerY: number | null) => {
    hide();
    current = target;
    if (performance.now() < warmUntil) show(target, pointerY);
    else timer = window.setTimeout(() => show(target, pointerY), SHOW_DELAY_MS);
  };

  const leave = () => {
    if (tip) warmUntil = performance.now() + WARM_MS;
    hide();
  };

  root.addEventListener("pointerover", (e) => {
    const target = targetOf(e.target as HTMLElement);
    if (!target || target === pressed || target === current || !worthShowing(target)) return;
    arrive(target, e.clientY);
  });

  root.addEventListener("pointerout", (e) => {
    const from = targetOf(e.target as HTMLElement);
    if (from && !from.contains(e.relatedTarget as Node)) {
      if (from === pressed) pressed = null;
      leave();
    }
  });

  root.addEventListener("pointerdown", (e) => {
    pressed = targetOf(e.target as HTMLElement);
    hide();
  });

  root.addEventListener("focusin", (e) => {
    const target = e.target instanceof HTMLElement && e.target.matches(":focus-visible") ? targetOf(e.target) : null;
    if (target && target === e.target && target !== current && worthShowing(target)) arrive(target, null);
  });
  root.addEventListener("focusout", (e) => {
    if (e.target instanceof HTMLElement && e.target === current) leave();
  });

  document.addEventListener("scroll", hide, { capture: true, passive: true });
  document.addEventListener("keydown", hide, { capture: true, passive: true });
}
