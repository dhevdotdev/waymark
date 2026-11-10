import type { View } from "../vault/trail";
import type { Tab } from "../vault/workspace";
import { icons } from "./icons";
import type { Inspector, RailPane } from "./inspector";
import { toast } from "./overlays";
import type { ShellElements } from "./shell";
import { TrailPanel } from "./trail-panel";

export interface TrailHost {
  tab: () => Tab;
  label: (view: View) => string;
  open: (path: string) => void;
  saveScroll: () => void;
  show: () => void;
  persist: () => void;
  chrome: () => void;
  inspector: () => Inspector;
}

/** A tab's trail: the readout above the note, the list in the panel, and what acting on them does. */
export class TrailActions {
  readonly panel: TrailPanel;
  private readonly readout = document.createElement("button");
  private readonly empty = document.createElement("p");
  private readonly tabButton: HTMLElement;
  private undoLast: (() => void) | null = null;
  private returnTo: { pane: RailPane; railWasHidden: boolean } | null = null;

  constructor(
    private readonly els: ShellElements,
    private readonly host: TrailHost,
  ) {
    this.panel = new TrailPanel({
      select: (id, newTab) => this.select(id, newTab),
      remove: (id) => this.remove(id),
      toggle: (id) => this.toggle(id),
      leave: () => els.scroller.focus({ preventScroll: true }),
    });
    this.readout.type = "button";
    this.readout.className = "trail-readout";
    this.readout.dataset.act = "trail";
    this.readout.dataset.key = "⌘Y";
    this.readout.hidden = true;
    els.trailSlot.append(this.readout);
    this.empty.className = "rail-empty";
    this.empty.textContent = "Follow a link and the notes this tab passes through collect here.";
    els.trailPane.append(this.panel.root, this.empty);
    this.tabButton = els.shell.querySelector<HTMLElement>('[data-rail="trail"]')!;
  }

  /** The panel only sits beside notes, so the graph, a base and a blank tab have nothing to open. */
  get available(): boolean {
    return this.host.tab().trail.current.view.kind === "note";
  }

  render(): void {
    const { trail, id } = this.host.tab();
    const entries = trail.layout().map((placement) => ({
      ...placement,
      label: this.host.label(trail.view(placement.id)!),
    }));
    const current = trail.current.id;
    this.panel.render(id, entries, current, trail.pathToCurrent());
    const many = trail.size > 1;
    this.panel.root.hidden = !many;
    this.empty.hidden = many;
    this.tabButton.textContent = many ? `Trail ${trail.size}` : "Trail";
    this.readout.hidden = !many || !this.available;
    if (this.readout.hidden) return;
    const position = entries.findIndex((entry) => entry.id === current) + 1;
    const forks = entries.reduce((sum, entry) => sum + Math.max(0, entry.branches - 1), 0);
    this.drawReadout(position, trail.size, forks);
  }

  private drawReadout(position: number, total: number, forks: number): void {
    this.readout.replaceChildren();
    const word = document.createElement("span");
    word.className = "trail-word";
    word.textContent = "Trail";
    const place = document.createElement("span");
    place.textContent = `${position} of ${total}`;
    this.readout.append(word, place);
    const sides = forks ? `, ${forks} side ${forks === 1 ? "branch" : "branches"}` : "";
    const tip = `Stop ${position} of ${total}${sides}`;
    this.readout.dataset.tip = tip;
    this.readout.setAttribute("aria-label", `Show the trail. ${tip}`);
    if (!forks) return;
    const fork = document.createElement("span");
    fork.className = "trail-forks";
    fork.innerHTML = icons.branch;
    fork.append(String(forks));
    this.readout.append(fork);
  }

  /** Opens the list and moves to the current stop. Closing puts the panel back exactly as it was. */
  togglePanel(): void {
    if (!this.available) return;
    const inspector = this.host.inspector();
    if (inspector.isShowing && inspector.pane === "trail") {
      const before = this.returnTo ?? { pane: "links" as const, railWasHidden: false };
      this.returnTo = null;
      inspector.setPane(before.pane);
      if (before.railWasHidden) inspector.toggle();
      this.els.scroller.focus({ preventScroll: true });
      return;
    }
    this.returnTo = { pane: inspector.pane, railWasHidden: !inspector.isShowing };
    inspector.setPane("trail");
    if (!inspector.isShowing) inspector.toggle();
    this.panel.focusCurrent();
  }

  /** ⌘Z while the trail has focus brings back the stop just removed. */
  undoFromPanel(): boolean {
    if (!this.undoLast || !this.panel.root.contains(document.activeElement)) return false;
    this.undoLast();
    return true;
  }

  private select(id: number, newTab: boolean): void {
    const { trail } = this.host.tab();
    const view = trail.view(id);
    if (!view) return;
    if (newTab && view.kind === "note") {
      this.host.open(view.path);
      return;
    }
    if (id === trail.current.id) return;
    this.host.saveScroll();
    trail.select(id);
    this.host.show();
  }

  private remove(id: number): void {
    const { trail } = this.host.tab();
    const view = trail.view(id);
    if (!view) return;
    if (id === trail.current.id) {
      toast("This tab is on that note. Move to another stop to remove it.");
      return;
    }
    this.host.saveScroll();
    const saved = trail.save();
    trail.remove(id);
    const left = { size: trail.size, at: trail.current.id };
    this.undoLast = () => {
      this.undoLast = null;
      if (trail.size !== left.size || trail.current.id !== left.at) {
        toast("The trail has changed since then.");
        return;
      }
      trail.revert(saved);
      this.host.chrome();
      this.host.persist();
    };
    this.host.chrome();
    this.host.persist();
    toast(`Removed ${this.host.label(view)}`, { label: "Undo", run: () => this.undoLast?.() });
  }

  private toggle(id: number): void {
    this.host.tab().trail.toggleCollapsed(id);
    this.render();
    this.host.persist();
  }
}
