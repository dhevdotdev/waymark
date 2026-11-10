function overlaps(range: Range, cell: Element): boolean {
  const contents = document.createRange();
  contents.selectNodeContents(cell);
  return (
    range.compareBoundaryPoints(Range.START_TO_END, contents) > 0 && range.compareBoundaryPoints(Range.END_TO_START, contents) < 0
  );
}

function cellsSpanned(scroller: HTMLElement): Set<Element> {
  const cells = new Set<Element>();
  const selection = getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return cells;
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const within = common instanceof Element ? common : common.parentElement;
  if (within?.closest("td, th")) return cells;
  for (const table of scroller.querySelectorAll(".doc:not(.doc-editing) table")) {
    if (!range.intersectsNode(table)) continue;
    for (const cell of table.querySelectorAll("td, th")) if (overlaps(range, cell)) cells.add(cell);
  }
  return cells;
}

/**
 * A selection running across cells fills each one whole. Left to itself the
 * browser boxes every cell's text separately, with gaps between the boxes.
 */
export function watchTableSelection(scroller: HTMLElement): void {
  let spanned = new Set<Element>();
  document.addEventListener("selectionchange", () => {
    const next = cellsSpanned(scroller);
    for (const cell of spanned) if (!next.has(cell)) cell.classList.remove("is-spanned");
    for (const cell of next) cell.classList.add("is-spanned");
    spanned = next;
  });
}
