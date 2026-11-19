import { arrowMove } from "./menu-keys";

/** The attributes of one option in a single-choice group: checked or not, and the group's one Tab stop if checked. */
export const radioAttrs = (checked: boolean): string => `role="radio" aria-checked="${checked}" tabindex="${checked ? 0 : -1}"`;

/** Marks `chosen` as the checked option of its group, which also gives it the group's Tab stop. */
export function checkRadio(group: Element, chosen: (option: HTMLElement) => boolean): void {
  for (const option of group.querySelectorAll<HTMLElement>('[role="radio"]')) {
    const on = chosen(option);
    option.classList.toggle("is-on", on);
    option.setAttribute("aria-checked", String(on));
    option.tabIndex = on ? 0 : -1;
  }
}

/**
 * Arrows, Home and End inside any `[role="radiogroup"]` under `root` move to an option and choose it, as radio buttons
 * do. Choosing is a click, so pointer and keys run the same code.
 */
export function bindRadioKeys(root: HTMLElement): void {
  root.addEventListener("keydown", (e) => {
    const group = (e.target as HTMLElement).closest<HTMLElement>('[role="radiogroup"]');
    if (!group || e.metaKey || e.ctrlKey || e.altKey || group.getAttribute("aria-disabled") === "true") return;
    const options = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
    const move = arrowMove(e.key, options.indexOf(e.target as HTMLElement), options.length, "both");
    if (move === null) return;
    e.preventDefault();
    options[move].focus();
    options[move].click();
  });
}
