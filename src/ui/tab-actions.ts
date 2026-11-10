import type { Workspace } from "../vault/workspace";
import { type MenuItem, showContextMenu } from "./context-menu";
import { trackPointerDrag } from "./pointer-drag";

interface TabActionsHost {
  strip: HTMLElement;
  workspace: Workspace;
  render: () => void;
  persist: () => void;
  close: (index: number) => void;
  toast: (message: string) => void;
}

/** Pinning and reordering tabs, by dragging, from a tab's menu or from the palette. */
export class TabActions {
  constructor(private readonly host: TabActionsHost) {
    host.strip.addEventListener("contextmenu", (e) => this.onMenu(e));
    host.strip.addEventListener("pointerdown", (e) => this.onDown(e));
  }

  private landed(index: number): void {
    this.host.render();
    this.host.persist();
    const tab = this.host.strip.querySelector<HTMLElement>(`.tab[data-tab="${index}"]`);
    tab?.classList.add("is-landed");
    tab?.addEventListener("animationend", () => tab.classList.remove("is-landed"), { once: true });
  }

  togglePin(index = this.host.workspace.activeIndex): void {
    this.landed(this.host.workspace.togglePin(index));
  }

  /** Moves a tab one place, or says why it cannot go further. */
  step(delta: number, index = this.host.workspace.activeIndex): void {
    const landed = this.host.workspace.move(index, index + delta);
    if (landed === null) this.host.toast(delta < 0 ? "This tab is already first." : "This tab is already last.");
    else this.landed(landed);
  }

  private onMenu(e: MouseEvent): void {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!tab) return;
    e.preventDefault();
    const index = Number(tab.dataset.tab);
    const { workspace } = this.host;
    const pinned = !!workspace.tabs[index].pinned;
    const { low, high } = workspace.bounds(index);
    const items: MenuItem[] = [
      { label: pinned ? "Unpin tab" : "Pin tab", run: () => this.togglePin(index) },
      { label: "Move left", startsGroup: true, blocked: index <= low ? "Already first" : null, run: () => this.step(-1, index) },
      { label: "Move right", blocked: index >= high ? "Already last" : null, run: () => this.step(1, index) },
      ...(pinned ? [] : [{ label: "Close tab", startsGroup: true, run: () => this.host.close(index) }]),
    ];
    showContextMenu(e.clientX, e.clientY, items);
  }

  private onDown(down: PointerEvent): void {
    const tab = (down.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!tab || down.button !== 0 || (down.target as HTMLElement).closest("[data-tab-close]")) return;
    this.track(Number(tab.dataset.tab), down);
  }

  /** The place the dragged tab would take, kept within the pinned tabs or the others. */
  private target(from: number, x: number): number {
    const { workspace, strip } = this.host;
    const boxes = [...strip.querySelectorAll<HTMLElement>(".tab")].map((tab) => tab.getBoundingClientRect());
    const found = boxes.findIndex((box) => x < box.left + box.width / 2);
    const boundary = found < 0 ? boxes.length : found;
    const to = boundary > from ? boundary - 1 : boundary;
    const [low, high] = workspace.tabs[from].pinned
      ? [0, workspace.pinnedCount - 1]
      : [workspace.pinnedCount, workspace.tabs.length - 1];
    return Math.max(low, Math.min(to, high));
  }

  /** The guide lives outside the strip, because switching to the dragged tab redraws the strip. */
  private place(line: HTMLElement, from: number, to: number): void {
    const { strip } = this.host;
    const box = [...strip.querySelectorAll<HTMLElement>(".tab")][to]?.getBoundingClientRect();
    if (!box) return;
    line.style.transform = `translate(${(to > from ? box.right : box.left) - 1}px, ${box.top + 4}px)`;
    line.style.blockSize = `${box.height - 8}px`;
    line.hidden = to === from;
    strip.querySelector(`.tab[data-tab="${from}"]`)?.classList.add("is-dragging");
  }

  private track(from: number, down: PointerEvent): void {
    const { strip, workspace } = this.host;
    let line: HTMLElement | null = null;
    let to = from;
    trackPointerDrag(down, {
      start: () => {
        line = document.createElement("div");
        line.className = "tab-drop";
        document.body.append(line);
      },
      move: (e) => {
        to = this.target(from, e.clientX);
        if (line) this.place(line, from, to);
      },
      finish: () => {
        line?.remove();
        strip.querySelector(".tab.is-dragging")?.classList.remove("is-dragging");
      },
      drop: () => {
        const moved = to === from ? null : workspace.move(from, to);
        if (moved !== null) this.landed(moved);
      },
    });
  }
}
