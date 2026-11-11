export const ROW = ".tree-head, .nav-item";

export function isShown(row: Element): boolean {
  if (row.classList.contains("is-naming")) return false;
  for (let body = row.closest(".tree-body"); body; body = body.parentElement?.closest(".tree-body") ?? null) {
    if (!body.parentElement?.classList.contains("is-open")) return false;
  }
  return true;
}

/** Arrow keys for the file list, which is a single Tab stop with one row holding it. */
export function bindTreeKeys(box: HTMLElement): void {
  const shownRows = () => [...box.querySelectorAll<HTMLElement>(ROW)].filter(isShown);
  let stop: HTMLElement | null = null;

  const holdStop = (row: HTMLElement | null) => {
    if (stop && stop !== row) stop.tabIndex = -1;
    stop = row;
    if (row) row.tabIndex = 0;
  };

  let queued = false;
  const settle = () => {
    queued = false;
    for (const row of box.querySelectorAll<HTMLElement>(ROW)) if (row !== stop) row.tabIndex = -1;
    if (stop?.isConnected && isShown(stop)) return;
    holdStop(box.querySelector<HTMLElement>(".nav-item.is-current") ?? shownRows()[0] ?? null);
  };
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(settle);
  }).observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });

  box.addEventListener("focusin", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(ROW);
    if (row && (e.target as HTMLElement).matches(ROW)) holdStop(row);
  });

  /*
   * WebKit on macOS leaves a pressed button unfocused, so without this a click would leave the arrows with no row to
   * move from. A click on empty space hands the keys to the row that holds the Tab stop.
   */
  box.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>(ROW);
    if (row ? !row.matches("button") : target.closest("button, input, textarea, a, [contenteditable]")) return;
    (row ?? stop)?.focus({ preventScroll: true, focusVisible: false });
  });

  const moveTo = (row: HTMLElement | undefined): boolean => {
    if (!row) return false;
    holdStop(row);
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: "nearest" });
    return true;
  };

  const parentHead = (row: HTMLElement) => {
    const own = row.matches(".tree-head") ? row.parentElement : row;
    return own?.parentElement?.closest(".tree-folder")?.querySelector<HTMLElement>(":scope > .tree-head") ?? undefined;
  };

  box.addEventListener("keydown", (e) => {
    const row = e.target as HTMLElement;
    if (!row.matches(ROW) || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const rows = shownRows();
    const at = rows.indexOf(row);
    const open = row.getAttribute("aria-expanded") === "true";
    const actions: Record<string, () => boolean> = {
      ArrowDown: () => moveTo(rows[at + 1]),
      ArrowUp: () => moveTo(rows[at - 1]),
      Home: () => moveTo(rows[0]),
      End: () => moveTo(rows.at(-1)),
      ArrowRight: () => {
        if (!row.matches(".tree-head")) return false;
        if (open) return moveTo(parentHead(rows[at + 1] ?? row) === row ? rows[at + 1] : undefined);
        row.click();
        return true;
      },
      ArrowLeft: () => {
        if (!open) return moveTo(parentHead(row));
        row.click();
        return true;
      },
    };
    const action = actions[e.key];
    if (!action) return;
    e.stopPropagation();
    /* A key with no row to reach keeps its default, so the list still scrolls at its ends. */
    if (action()) e.preventDefault();
  });
  settle();
}
