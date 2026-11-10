const TAKES_DROPS = ".cm-editor, input, textarea";

/** A file or link dropped outside the editor does nothing, rather than the web view loading it over the app. */
export function guardDrops(): void {
  const refuse = (e: DragEvent) => {
    if (e.target instanceof Element && e.target.closest(TAKES_DROPS)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  };
  window.addEventListener("dragover", refuse);
  window.addEventListener("drop", refuse);
}
