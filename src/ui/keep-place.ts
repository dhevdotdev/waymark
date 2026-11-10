/**
 * Runs a rebuild of everything inside `root`, then puts focus and scroll back.
 * A control is found again by its `data-control`, and a scroller by its
 * `data-scroll-key`, so a different view still starts at its top. When the
 * focused control has gone, `root` holds focus so the keyboard stays in the sheet.
 */
export function keepPlace(root: HTMLElement, rebuild: () => void): void {
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && active !== root && root.contains(active) ? active : null;
  const control = focused?.dataset.control;
  const caret =
    focused instanceof HTMLTextAreaElement
      ? { start: focused.selectionStart, end: focused.selectionEnd, top: focused.scrollTop }
      : null;
  const scrollerNow = root.querySelector<HTMLElement>("[data-scroll-key]");
  const scroll = scrollerNow && { key: scrollerNow.dataset.scrollKey, top: scrollerNow.scrollTop };

  rebuild();

  const scroller = root.querySelector<HTMLElement>("[data-scroll-key]");
  if (scroller && scroll && scroller.dataset.scrollKey === scroll.key) scroller.scrollTop = scroll.top;
  if (!focused) return;
  const target = control ? root.querySelector<HTMLElement>(`[data-control="${CSS.escape(control)}"]`) : null;
  if (!target || target.matches(":disabled")) {
    root.focus({ preventScroll: true });
    return;
  }
  target.focus({ preventScroll: true });
  if (caret && target instanceof HTMLTextAreaElement) {
    target.setSelectionRange(caret.start, caret.end);
    target.scrollTop = caret.top;
  }
}
