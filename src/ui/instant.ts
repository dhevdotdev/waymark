/**
 * Applies a change that nothing should be seen doing, such as opening a folder to reveal a row.
 * `el` carries `is-instant` for one style pass, so the change is final before anything measures it.
 */
export function instantly(el: HTMLElement, change: () => void): void {
  el.classList.add("is-instant");
  change();
  void el.offsetHeight;
  el.classList.remove("is-instant");
}
