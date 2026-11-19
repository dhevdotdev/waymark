/**
 * Makes an item its group's Tab stop, or takes it out of the Tab order. A button stop keeps no tabindex, because on a
 * Mac plain Tab passes over buttons and Option-Tab reaches them, and an explicit tabindex would change that.
 */
export function setStop(item: HTMLElement, on: boolean): void {
  if (!on) item.tabIndex = -1;
  else if (item instanceof HTMLButtonElement) item.removeAttribute("tabindex");
  else item.tabIndex = 0;
}

function holdStop(items: readonly HTMLElement[], stop: HTMLElement): void {
  for (const item of items) setStop(item, item === stop);
}

export interface RovingOptions {
  /** The group's items, in order, read when a key is pressed. */
  items: () => HTMLElement[];
  /** Runs for the item an arrow lands on, as a tab list or a radio group selects as it moves. */
  select?: (item: HTMLElement) => void;
}

/**
 * One Tab stop for a row of controls. Left and Right move between them and wrap at the ends, Home and End reach the
 * ends, and focusing an item by any route makes it the stop.
 */
export function bindRoving(group: HTMLElement, options: RovingOptions): void {
  group.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const items = options.items();
    const at = items.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    const to = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: items.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    const item = items[(to + items.length) % items.length];
    holdStop(items, item);
    item.focus();
    options.select?.(item);
  });
  group.addEventListener("focusin", (e) => {
    const items = options.items();
    if (items.includes(e.target as HTMLElement)) holdStop(items, e.target as HTMLElement);
  });
}
