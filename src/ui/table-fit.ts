/**
 * Marks tables that fit their column. Only those can keep their header in
 * view, because a table that scrolls sideways is its own scrolling box, and a
 * header sticks to the nearest one.
 */
export function watchTableFit(scroller: HTMLElement): void {
  const watched = new WeakSet<Element>();
  const sizes = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const wrap = target.closest(".table-wrap");
      wrap?.classList.toggle("fits", wrap.scrollWidth <= wrap.clientWidth + 1);
    }
  });
  let frame = 0;
  const find = () => {
    frame = 0;
    for (const wrap of scroller.querySelectorAll(".table-wrap")) {
      if (watched.has(wrap)) continue;
      watched.add(wrap);
      sizes.observe(wrap);
      const table = wrap.querySelector("table");
      if (table) sizes.observe(table);
    }
  };
  new MutationObserver(() => {
    if (!frame) frame = requestAnimationFrame(find);
  }).observe(scroller, { childList: true, subtree: true });
  find();
}
