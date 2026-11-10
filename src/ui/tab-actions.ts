import type { Workspace } from "../vault/workspace";
import { type MenuItem, showContextMenu } from "./context-menu";

const DRAG_START_PX = 5;

interface TabActionsHost {
  strip: HTMLElement;
  workspace: Workspace;
  render: () => void;
  persist: () => void;
  close: (index: number) => void;
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
  step(delta: number, toast: (message: string) => void, index = this.host.workspace.activeIndex): void {
    const landed = this.host.workspace.move(index, index + delta);
    if (landed === null) toast(delta < 0 ? "This tab is already first." : "This tab is already last.");
    else this.landed(landed);
  }

  private onMenu(e: MouseEvent): void {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (!tab) return;
    e.preventDefault();
    const index = Number(tab.dataset.tab);
    const { workspace } = this.host;
    const pinned = !!workspace.tabs[index].pinned;
    const low = pinned ? 0 : workspace.pinnedCount;
    const high = pinned ? workspace.pinnedCount - 1 : workspace.tabs.length - 1;
    const move = (delta: number) => () => {
      const landed = workspace.move(index, index + delta);
      if (landed !== null) this.landed(landed);
    };
    const items: MenuItem[] = [
      { label: pinned ? "Unpin tab" : "Pin tab", run: () => this.togglePin(index) },
      { label: "Move left", startsGroup: true, blocked: index <= low ? "Already first" : null, run: move(-1) },
      { label: "Move right", blocked: index >= high ? "Already last" : null, run: move(1) },
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
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
      line?.remove();
      strip.querySelector(".tab.is-dragging")?.classList.remove("is-dragging");
    };
    const onMove = (e: PointerEvent) => {
      if (!line) {
        if (Math.abs(e.clientX - down.clientX) < DRAG_START_PX) return;
        line = document.createElement("div");
        line.className = "tab-drop";
        document.body.append(line);
      }
      to = this.target(from, e.clientX);
      this.place(line, from, to);
    };
    const onUp = () => {
      const dragged = line !== null;
      finish();
      if (!dragged) return;
      window.addEventListener("click", (e) => e.stopPropagation(), { capture: true, once: true });
      const landed = to === from ? null : workspace.move(from, to);
      if (landed !== null) this.landed(landed);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  }
}
