import { glidePanel } from "./panel-glide";

const ZEN = "is-zen";
/** Layers that own Escape while they are open. Zen is the outermost, so it waits for them. */
const OWNS_ESCAPE = ".palette-overlay:not(.is-leaving), .context-menu:not(.is-leaving)";

/** A click glides the note back beside its panels, as opening a panel does. Keys land it at once. */
function leaveZen(shell: HTMLElement): boolean {
  if (!shell.classList.contains(ZEN)) return false;
  glidePanel(shell, true, () => shell.classList.remove(ZEN));
  return true;
}

/**
 * Zen mode hides the app around the note. It only adds a class, so every panel keeps its own open or closed state and
 * leaving brings back exactly what was there. It is never saved, so a launch always shows the whole window.
 */
export class Zen {
  constructor(
    private readonly shell: HTMLElement,
    private readonly note: HTMLElement,
  ) {}

  get isOn(): boolean {
    return this.shell.classList.contains(ZEN);
  }

  toggle(): void {
    if (!this.leave()) this.enter();
  }

  enter(): void {
    const { shell } = this;
    shell.classList.remove("sidebar-peek", "rail-peek");
    if (document.activeElement?.closest(".sidebar, .rail, .titlebar, .pane-head, .statusbar")) {
      (document.activeElement as HTMLElement).blur();
      this.note.focus({ preventScroll: true });
    }
    shell.classList.add(ZEN);
  }

  /** Returns whether zen was on. */
  leave(): boolean {
    return leaveZen(this.shell);
  }
}

/** Escape leaves zen only when nothing else is waiting for it and no text field has the key. */
export function escapeZen(shell: HTMLElement, inField: boolean): boolean {
  return !inField && !document.querySelector(OWNS_ESCAPE) && leaveZen(shell);
}
