import type { PrefStore } from "../prefs";
import { instantly } from "./instant";
import { bindEdgeDrag } from "./panel-resize";

export type RailSection = "trail" | "graph";

const SECTIONS: RailSection[] = ["trail", "graph"];
const HEAD = 31;
const FOLDED = 30;
const TRAIL_ROW = 28;
const TRAIL_PAD = 8;
const LINKS_LEAST = 80;
const GRAPH_MOST = 420;
const LEAST: Record<RailSection, number> = { trail: HEAD + 2 * TRAIL_ROW + TRAIL_PAD, graph: 130 };
const WORTH_DRAGGING = 14;

const between = (least: number, value: number, most: number) => Math.min(most, Math.max(least, value));

/**
 * The trail and graph sections under Links or Info: which are open, and how tall
 * each is. Heights are worked out here, so a dragged height never squeezes the
 * links below their minimum, whatever the window does afterwards.
 */
export class PanelSections {
  private readonly vacant: Record<RailSection, boolean> = { trail: true, graph: true };
  private readonly sizes: Record<RailSection, number> = { trail: 0, graph: 0 };
  private readonly inner: HTMLElement;
  private trailRows = 0;
  private spare = 0;

  constructor(
    private readonly shell: HTMLElement,
    private readonly prefs: PrefStore,
    private readonly folded: Record<RailSection, boolean>,
  ) {
    this.inner = shell.querySelector<HTMLElement>(".rail-inner")!;
    for (const section of SECTIONS) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "rail-section-resize";
      handle.setAttribute("aria-label", section === "trail" ? "Trail height" : "Graph height");
      this.el(section).prepend(handle);
      bindEdgeDrag(handle, {
        shell,
        axis: "y",
        direction: -1,
        range: () => this.range(section),
        read: () => this.sizes[section],
        apply: (size) => {
          this.setStored(section, size);
          this.fit();
        },
        save: () => prefs.update(() => undefined),
      });
    }
    new ResizeObserver(() => instantly(this.inner, () => this.fit())).observe(this.inner);
    this.draw();
  }

  private el(section: RailSection): HTMLElement {
    return this.shell.querySelector<HTMLElement>(`[data-section="${section}"]`)!;
  }

  private setStored(section: RailSection, size: number): void {
    if (section === "trail") this.prefs.value.trailHeight = size;
    else this.prefs.value.graphHeight = size;
  }

  private stored(section: RailSection): number {
    return section === "trail" ? this.prefs.value.trailHeight : this.prefs.value.graphHeight;
  }

  isOpen(section: RailSection): boolean {
    return !this.folded[section] && !this.vacant[section];
  }

  toggle(section: RailSection): void {
    this.setFolded(section, !this.folded[section]);
  }

  /** The one change here that moves: a fold, when the pointer asked for it. */
  setFolded(section: RailSection, folded: boolean): void {
    this.folded[section] = folded;
    this.draw();
    this.prefs.update((p) => {
      if (section === "trail") p.trailFolded = folded;
      else p.graphFolded = folded;
    });
  }

  /** A section with nothing to show is not drawn at all, and its room goes to the links. */
  setEmpty(section: RailSection, empty: boolean): void {
    if (this.vacant[section] === empty) return;
    this.vacant[section] = empty;
    instantly(this.inner, () => this.draw());
  }

  /** The trail section is as tall as its stops, up to the height it has been given. */
  setTrailRows(rows: number): void {
    if (rows === this.trailRows) return;
    this.trailRows = rows;
    instantly(this.inner, () => this.fit());
  }

  private draw(): void {
    for (const section of SECTIONS) {
      const el = this.el(section);
      const open = this.isOpen(section);
      el.classList.toggle("is-folded", !open);
      el.classList.toggle("is-vacant", this.vacant[section]);
      el.querySelector("[data-fold-section]")!.setAttribute("aria-expanded", String(open));
    }
    this.fit();
  }

  /** The tallest a section has any use for. */
  private natural(section: RailSection): number {
    return section === "trail" ? HEAD + this.trailRows * TRAIL_ROW + TRAIL_PAD : GRAPH_MOST;
  }

  private chosen(section: RailSection): number {
    const automatic =
      section === "trail" ? between(120, window.innerHeight * 0.29, 270) : between(130, window.innerHeight * 0.22, 200);
    return Math.max(LEAST[section], Math.min(this.stored(section) || automatic, this.natural(section)));
  }

  /** Height the open sections may share, after the panel's own spacing and the least the links need. */
  private budget(): number {
    const style = getComputedStyle(this.inner);
    const gap = Number.parseFloat(style.rowGap) || 0;
    let taken = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) + LINKS_LEAST;
    for (const section of SECTIONS) {
      if (this.vacant[section]) continue;
      taken += gap + (this.folded[section] ? FOLDED : 0);
    }
    return this.inner.clientHeight - taken;
  }

  private fit(): void {
    const open = SECTIONS.filter((section) => this.isOpen(section));
    for (const section of open) this.sizes[section] = this.chosen(section);
    let over = open.reduce((sum, section) => sum + this.sizes[section], 0) - this.budget();
    for (const section of open.toReversed()) {
      const cut = between(0, over, this.sizes[section] - LEAST[section]);
      this.sizes[section] -= cut;
      over -= cut;
    }
    this.spare = Math.max(0, -over);
    for (const section of SECTIONS) {
      const el = this.el(section);
      const isOpen = open.includes(section);
      if (isOpen) el.style.setProperty("--section-h", `${this.sizes[section]}px`);
      const [least, most] = this.range(section);
      el.querySelector<HTMLElement>(".rail-section-resize")!.hidden = !isOpen || most - least < WORTH_DRAGGING;
    }
  }

  private range(section: RailSection): [number, number] {
    const most = Math.min(this.natural(section), this.sizes[section] + this.spare);
    return [Math.min(LEAST[section], most), most];
  }
}
