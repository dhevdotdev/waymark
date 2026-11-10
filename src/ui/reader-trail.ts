import type { View } from "../vault/trail";
import type { Tab } from "../vault/workspace";
import { TrailMap } from "./trail-map";

export interface TrailHost {
  tab: () => Tab;
  label: (view: View) => string;
  open: (path: string) => void;
  saveScroll: () => void;
  show: () => void;
  persist: () => void;
  scroller: HTMLElement;
}

/** The map of where a tab has been, and what clicking on it does. */
export class TrailActions {
  readonly map: TrailMap;
  private roomFor = "";

  constructor(private readonly host: TrailHost) {
    this.map = new TrailMap({
      select: (id, newTab) => this.select(id, newTab),
      remove: (id) => this.remove(id),
      toggle: (id) => this.toggle(id),
    });
  }

  render(): void {
    const { trail, id } = this.host.tab();
    this.map.root.hidden = trail.size < 2;
    if (trail.size < 2) {
      this.reserveRoom();
      return;
    }
    const entries = trail.layout().map((placement) => {
      const view = trail.view(placement.id)!;
      return { ...placement, label: this.host.label(view), isGraph: view.kind === "graph" };
    });
    this.map.render(id, entries, trail.current.id, trail.pathToCurrent());
    this.reserveRoom();
  }

  /** A note starts below the map. Folding or removing a stop leaves the note where it is, and the next note fits the map again. */
  private reserveRoom(): void {
    const { id, trail } = this.host.tab();
    const key = `${id}:${trail.current.id}`;
    if (key === this.roomFor) return;
    this.roomFor = key;
    this.host.scroller.style.setProperty("--trail-room", `${this.map.root.hidden ? 0 : this.map.root.offsetHeight}px`);
  }

  private select(id: number, newTab: boolean): void {
    const { trail } = this.host.tab();
    const view = trail.view(id);
    if (!view) return;
    if (newTab && view.kind === "note") {
      this.host.open(view.path);
      return;
    }
    this.host.saveScroll();
    trail.select(id);
    this.host.show();
  }

  private remove(id: number): void {
    this.host.saveScroll();
    const { trail } = this.host.tab();
    const before = trail.current.view;
    trail.remove(id);
    if (trail.current.view !== before) this.host.show();
    else {
      this.render();
      this.host.persist();
    }
  }

  private toggle(id: number): void {
    this.host.tab().trail.toggleCollapsed(id);
    this.render();
    this.host.persist();
  }
}
