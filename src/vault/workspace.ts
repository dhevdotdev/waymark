import { Trail, type View } from "./trail";

export interface Tab {
  id: number;
  trail: Trail;
}

export interface SavedWorkspace {
  tabs: unknown[];
  active: number;
}

const isBlank = (tab: Tab) => tab.trail.current.view.kind === "blank";

/** The open tabs and which one is showing. Each tab owns a trail of where it has been. */
export class Workspace {
  tabs: Tab[] = [];
  activeIndex = 0;
  private nextId = 1;

  get active(): Tab {
    return this.tabs[this.activeIndex];
  }

  get isEmpty(): boolean {
    return this.tabs.length === 0;
  }

  /** The tab whose current view is the graph, or -1. */
  get graphIndex(): number {
    return this.tabs.findIndex((t) => t.trail.current.view.kind === "graph");
  }

  get blankIndex(): number {
    return this.tabs.findIndex(isBlank);
  }

  startWith(view: View): void {
    this.tabs = [this.make(view)];
    this.activeIndex = 0;
  }

  restore(saved: SavedWorkspace, exists: (view: View) => boolean): void {
    this.tabs = saved.tabs.flatMap((value): Tab[] => {
      const trail = Trail.restore(value, exists);
      return trail ? [{ id: this.nextId++, trail }] : [];
    });
    this.activeIndex = Math.max(0, Math.min(saved.active, this.tabs.length - 1));
  }

  /** Adds a tab to the right of the active one without switching to it. */
  addBeside(view: View): Tab {
    const tab = this.make(view);
    this.tabs.splice(this.activeIndex + 1, 0, tab);
    return tab;
  }

  activate(index: number): boolean {
    if (index === this.activeIndex || !this.tabs[index]) return false;
    this.activeIndex = index;
    return true;
  }

  /** Moves to the tab `step` places away, wrapping at the ends. */
  cycle(step: number): boolean {
    return this.activate((this.activeIndex + step + this.tabs.length) % this.tabs.length);
  }

  /** Closes a tab, keeping the same tab active where it survives. The last tab stays open. */
  close(index: number): boolean {
    if (this.tabs.length === 1 || !this.tabs[index]) return false;
    this.tabs.splice(index, 1);
    if (this.activeIndex >= this.tabs.length) this.activeIndex = this.tabs.length - 1;
    else if (index < this.activeIndex) this.activeIndex -= 1;
    return true;
  }

  /** A blank tab holds nothing worth coming back to, so it is left out. */
  save(): SavedWorkspace {
    const kept = (tab: Tab) => !isBlank(tab);
    return {
      tabs: this.tabs.filter(kept).map((t) => t.trail.save()),
      active: this.tabs.slice(0, this.activeIndex).filter(kept).length,
    };
  }

  private make(view: View): Tab {
    return { id: this.nextId++, trail: new Trail(view) };
  }
}
