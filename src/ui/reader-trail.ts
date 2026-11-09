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
}

/** The map of where a tab has been, and what clicking on it does. */
export class TrailActions {
  readonly map: TrailMap;

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
    if (trail.size < 2) return;
    const entries = trail.layout().map((placement) => {
      const view = trail.view(placement.id)!;
      return { ...placement, label: this.host.label(view), isGraph: view.kind === "graph" };
    });
    this.map.render(id, entries, trail.current.id, trail.pathToCurrent());
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
