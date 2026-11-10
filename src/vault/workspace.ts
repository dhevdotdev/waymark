import { Trail, type View } from "./trail";

export interface Tab {
  id: number;
  trail: Trail;
  pinned?: boolean;
}

export interface SavedWorkspace {
  tabs: unknown[];
  active: number;
  /** Which saved tabs are pinned, by position. */
  pinned?: number[];
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
    const pinned = new Set(saved.pinned ?? []);
    this.tabs = saved.tabs.flatMap((value, i): Tab[] => {
      const trail = Trail.restore(value, exists);
      return trail ? [{ id: this.nextId++, trail, pinned: pinned.has(i) }] : [];
    });
    const shown = this.tabs[Math.max(0, Math.min(saved.active, this.tabs.length - 1))];
    /* Saved positions are outside data, and every move relies on pinned tabs coming first. */
    this.tabs = [...this.tabs.filter((tab) => tab.pinned), ...this.tabs.filter((tab) => !tab.pinned)];
    this.activeIndex = Math.max(0, this.tabs.indexOf(shown));
  }

  /** Adds a tab to the right of the active one without switching to it. */
  addBeside(view: View): Tab {
    const tab = this.make(view);
    this.tabs.splice(Math.max(this.activeIndex + 1, this.pinnedCount), 0, tab);
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
    if (this.tabs.length === 1 || !this.tabs[index] || this.tabs[index].pinned) return false;
    this.tabs.splice(index, 1);
    if (this.activeIndex >= this.tabs.length) this.activeIndex = this.tabs.length - 1;
    else if (index < this.activeIndex) this.activeIndex -= 1;
    return true;
  }

  get pinnedCount(): number {
    return this.tabs.filter((tab) => tab.pinned).length;
  }

  /** The first and last place a tab may sit: pinned tabs stay together at the left. */
  bounds(index: number): { low: number; high: number } {
    return this.tabs[index]?.pinned
      ? { low: 0, high: this.pinnedCount - 1 }
      : { low: this.pinnedCount, high: this.tabs.length - 1 };
  }

  /** Moves a tab, staying within the pinned tabs or the others, and keeps the same tab active. Returns where it landed, or null. */
  move(from: number, to: number): number | null {
    const tab = this.tabs[from];
    if (!tab) return null;
    const { low, high } = this.bounds(from);
    const target = Math.max(low, Math.min(to, high));
    if (target === from) return null;
    const active = this.active;
    this.tabs.splice(from, 1);
    this.tabs.splice(target, 0, tab);
    this.activeIndex = this.tabs.indexOf(active);
    return target;
  }

  /** Pins or unpins a tab. Pinned tabs sit together at the left. Returns where it landed. */
  togglePin(index: number): number {
    const tab = this.tabs[index];
    const active = this.active;
    const landing = this.pinnedCount - (tab.pinned ? 1 : 0);
    tab.pinned = !tab.pinned;
    this.tabs.splice(index, 1);
    this.tabs.splice(landing, 0, tab);
    this.activeIndex = this.tabs.indexOf(active);
    return landing;
  }

  /** A note was renamed or moved. */
  replaceNote(from: string, to: string): void {
    for (const tab of this.tabs) tab.trail.replaceNote(from, to);
  }

  /** A note is gone, so a tab showing it goes back to being blank. */
  forgetNote(path: string): void {
    for (const tab of this.tabs) {
      const { view } = tab.trail.current;
      if (view.kind === "note" && view.path === path) tab.trail = new Trail({ kind: "blank" });
    }
  }

  save(): SavedWorkspace {
    /* A blank tab holds nothing worth coming back to, so it is left out. */
    const kept = this.tabs.filter((tab) => !isBlank(tab));
    return {
      tabs: kept.map((t) => t.trail.save()),
      active: this.tabs.slice(0, this.activeIndex).filter((tab) => !isBlank(tab)).length,
      pinned: kept.flatMap((tab, i) => (tab.pinned ? [i] : [])),
    };
  }

  private make(view: View): Tab {
    return { id: this.nextId++, trail: new Trail(view) };
  }
}
