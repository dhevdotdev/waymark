import { arrive, fadeAway, glide, holdClassWhile, type Place, placesOf, timing, tokenPx } from "./list-motion";
import { reducedMotion } from "./media";

const ROW = ".tree-head[data-folder], .tree-head[data-bookmarks-head], .nav-item[data-path], .nav-item[data-bookmark]";

export interface TreeBefore {
  known: Set<string>;
  rows: Map<string, HTMLElement>;
  places: Map<string, Place>;
}

function keyOf(row: HTMLElement): string {
  if (row.dataset.folder !== undefined) return `folder:${row.dataset.folder}`;
  if (row.dataset.path !== undefined) return `note:${row.dataset.path}`;
  return row.dataset.bookmark === undefined ? "bookmarks" : `bookmark:${row.textContent}`;
}

const rowsIn = (box: HTMLElement) => new Map([...box.querySelectorAll<HTMLElement>(ROW)].map((row) => [keyOf(row), row]));

/** Rows near the view: one screen either side, so a row sliding in from the edge has somewhere to come from. */
function rowsNearView(box: HTMLElement): Map<string, HTMLElement> {
  const view = box.getBoundingClientRect();
  return new Map(
    [...rowsIn(box)].filter(([, row]) => {
      if (row.closest(".tree-body")?.closest(".tree-folder:not(.is-open)")) return false;
      const { top, bottom } = row.getBoundingClientRect();
      return bottom > view.top - view.height && top < view.bottom + view.height;
    }),
  );
}

export function captureTree(box: HTMLElement): TreeBefore {
  const rows = rowsNearView(box);
  return { known: new Set(rowsIn(box).keys()), rows, places: placesOf(rows, box) };
}

function ghostRow(tree: HTMLElement, box: HTMLElement, row: HTMLElement, place: Place): void {
  const origin = tree.getBoundingClientRect();
  const frame = box.getBoundingClientRect();
  const ghost = row.cloneNode(true) as HTMLElement;
  ghost.classList.add("tree-ghost");
  ghost.inert = true;
  ghost.setAttribute("aria-hidden", "true");
  for (const name of Object.keys(ghost.dataset)) delete ghost.dataset[name];
  ghost.style.insetInlineStart = `${place.left - (origin.left - frame.left + box.scrollLeft)}px`;
  ghost.style.insetBlockStart = `${place.top - (origin.top - frame.top + box.scrollTop)}px`;
  ghost.style.inlineSize = `${place.width}px`;
  ghost.style.blockSize = `${place.height}px`;
  tree.append(ghost);
  fadeAway(ghost, timing("--t-exit", "--ease-out"));
}

/** After a pointer edit: new rows arrive, removed rows fade where they were, and the rows between close up. */
export function settleTree(box: HTMLElement, before: TreeBefore): void {
  const tree = box.querySelector<HTMLElement>(".tree");
  if (!tree) return;
  const now = rowsNearView(box);
  const entering = timing("--t-menu", "--ease-in-out");
  const rise = tokenPx("--rise");
  for (const [key, row] of now) if (!before.known.has(key)) arrive(row, entering, rise);
  if (reducedMotion()) return;
  const all = rowsIn(box);
  for (const [key, row] of before.rows) {
    if (!all.has(key)) ghostRow(tree, box, row, before.places.get(key)!);
  }
  holdClassWhile(tree, "is-settling", glide(now, before.places, box, timing("--t-menu", "--ease-in-out")));
}
