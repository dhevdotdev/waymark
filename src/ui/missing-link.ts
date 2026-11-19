/** A link to a note that does not exist yet, which following creates. */
export function missingLink(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".doc a[data-missing]");
}

export function missingTip(link: HTMLElement): string {
  const target = link.dataset.missing ?? "";
  const name = target.replace(/\.md$/i, "").split("/").filter(Boolean).at(-1) ?? target;
  return `Create note “${name.trim()}”`;
}
