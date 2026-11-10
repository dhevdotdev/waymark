import type { View } from "../vault/trail";
import type { Workspace } from "../vault/workspace";
import { type MenuItem, showContextMenu } from "./context-menu";
import { flashLanded } from "./list-motion";
import { trackPointerDrag } from "./pointer-drag";

interface TabActionsHost {
  strip: HTMLElement;
  workspace: Workspace;
  render: () => void;
  persist: () => void;
  close: (index: number) => void;
  activate: (index: number) => void;
  toast: (message: string) => void;
  saveScroll: () => void;
  show: () => void;
  exists: (view: View) => boolean;
}

function nameOf(view: View): string {
  const path = view.kind === "note" || view.kind === "base" ? view.path : view.kind === "graph" ? view.note : "";
  return path
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "");
}

/** Pinning and reordering tabs, by dragging, from a tab's menu or from the palette. */
export class TabActions {
  constructor(private readonly host: TabActionsHost) {
    host.strip.addEventListener("contextmenu", (e) => this.onMenu(e));
    host.strip.addEventListener("pointerdown", (e) => this.onDown(e));
    host.strip.addEventListener("keydown", (e) => this.onKey(e));
    /* Selecting a tab with the pointer leaves focus where it was, as it does on a toolbar. */
    host.strip.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest(".tab")) e.preventDefault();
    });
  }

  private settled(): void {
    this.host.render();
    this.host.persist();
  }

  togglePin(index = this.host.workspace.activeIndex): void {
    this.host.workspace.togglePin(index);
    this.settled();
  }

  /** Moves a tab one place, or says why it cannot go further. */
  step(delta: number, index = this.host.workspace.activeIndex): void {
    if (this.host.workspace.move(index, index + delta) === null) {
      this.host.toast(delta < 0 ? "This tab is already first." : "This tab is already last.");
    } else {
      this.settled();
    }
  }

  /** Brings the last closed tab back, or says why it cannot. */
  reopen(): void {
    this.host.saveScroll();
    const result = this.host.workspace.reopen(this.host.exists);
    if (result.kind === "opened") this.host.show();
    else if (result.kind === "nothing") this.host.toast("No closed tabs to reopen.");
    else this.host.toast(`${nameOf(result.view)} is no longer in the vault, so its tab can't come back.`);
  }

  /** Arrow keys move along the strip and select as they go, wrapping at the ends. */
  private onKey(e: KeyboardEvent): void {
    if (!(e.target as HTMLElement).closest(".tab") || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const { activeIndex, tabs } = this.host.workspace;
    const last = tabs.length - 1;
    const targets: Record<string, number> = {
      ArrowLeft: activeIndex === 0 ? last : activeIndex - 1,
      ArrowRight: activeIndex === last ? 0 : activeIndex + 1,
      Home: 0,
      End: last,
    };
    const to = targets[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    this.host.activate(to);
    this.host.render();
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
        if (moved === null) return;
        this.settled();
        const tab = strip.querySelector<HTMLElement>(`.tab[data-tab="${moved}"]`);
        if (tab) flashLanded(tab);
      },
    });
  }
}
