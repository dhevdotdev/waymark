/** Keys typed within this long of each other spell one search. */
const TYPEAHEAD_RESET_MS = 500;

/**
 * Finds an item by typing its first letters. Repeating one letter cycles through the items that start with it; typing
 * quickly spells a longer prefix. Returns the index to move to, or -1 if nothing matches.
 */
export function createTypeahead(): { find: (key: string, labels: string[], from: number) => number; active: () => boolean } {
  let typed = "";
  let at = Number.NEGATIVE_INFINITY;
  const active = () => performance.now() - at < TYPEAHEAD_RESET_MS;
  const find = (key: string, labels: string[], from: number) => {
    typed = active() ? typed + key.toLowerCase() : key.toLowerCase();
    at = performance.now();
    const repeated = [...typed].every((c) => c === typed[0]);
    const needle = repeated ? typed[0] : typed;
    /* A longer prefix may still describe the current item, so the search starts there; a fresh letter moves on. */
    const start = Math.max(0, repeated ? from + 1 : from);
    for (let i = 0; i < labels.length; i++) {
      const j = (start + i) % labels.length;
      if (labels[j].trim().toLowerCase().startsWith(needle)) return j;
    }
    return -1;
  };
  return { find, active };
}

/** Where an arrow, Home or End moves from `at` in a list of `count`, wrapping at the ends, or null for any other key. */
export function arrowMove(key: string, at: number, count: number, orientation: "vertical" | "both" = "vertical"): number | null {
  const next = key === "ArrowDown" || (orientation === "both" && key === "ArrowRight");
  const previous = key === "ArrowUp" || (orientation === "both" && key === "ArrowLeft");
  if (next) return (at + 1) % count;
  if (previous) return (at <= 0 ? count : at) - 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * The keys of a menu: arrows, Home, End and typeahead move through `items`, and Tab leaves. They work whether or not
 * focus is in the menu, because a press on its padding can drop focus. `label` reads an item's name for typeahead.
 */
export function bindMenuKeys(items: () => HTMLElement[], label: (item: HTMLElement) => string, leave: () => void): () => void {
  const typeahead = createTypeahead();
  const onKey = (e: KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = arrowMove(e.key, at, list.length);
    const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (e.key !== " " || typeahead.active());
    if (e.key === "Tab") {
      e.preventDefault();
      leave();
    } else if (move !== null) {
      e.preventDefault();
      list[move]?.focus();
    } else if (typing) {
      e.preventDefault();
      const found = typeahead.find(e.key, list.map(label), at);
      if (found >= 0) list[found].focus();
    } else if (at < 0 && !e.metaKey && !e.ctrlKey && e.key !== "Escape") {
      e.preventDefault();
    } else {
      return;
    }
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}
