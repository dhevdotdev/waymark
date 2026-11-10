import type { Placement } from "../vault/trail";
import { icons } from "./icons";
import { dismissOnOutside } from "./overlays";

export interface TrailEntry extends Placement {
  label: string;
  isGraph: boolean;
}

const ROW = 32;
const GAP = 26;
const SVG_NS = "http://www.w3.org/2000/svg";

interface Box {
  x: number;
  y: number;
  width: number;
}

/** Draws one tab's trail: notes laid out left to right, with branches stepping down. */
export class TrailMap {
  readonly root = document.createElement("nav");
  private inner = document.createElement("div");
  private scroller = document.createElement("div");
  private seen = new Set<number>();
  private tabId = -1;
  private readonly more = document.createElement("button");
  private active: Box | undefined;
  private stopListening: (() => void) | null = null;

  constructor(
    private on: { select: (id: number, newTab: boolean) => void; remove: (id: number) => void; toggle: (id: number) => void },
  ) {
    this.root.className = "trail";
    this.root.setAttribute("aria-label", "Trail of notes followed in this tab");
    this.scroller.className = "trail-scroll";
    this.inner.className = "trail-inner";
    this.scroller.append(this.inner);
    this.more.type = "button";
    this.more.className = "icon-btn trail-more";
    this.more.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
    this.more.setAttribute("aria-label", "Show the whole trail");
    this.more.setAttribute("aria-expanded", "false");
    this.more.dataset.tip = "Show the whole trail";
    this.more.addEventListener("click", () => this.setOpen(!this.isOpen));
    this.root.append(this.scroller, this.more);
    this.scroller.addEventListener("scroll", () => this.markEnds(), { passive: true });
    this.scroller.addEventListener(
      "wheel",
      (e) => {
        const s = this.scroller;
        if ((this.isOpen && s.scrollHeight > s.clientHeight) || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        s.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    this.root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const remove = target.closest<HTMLElement>("[data-trail-remove]");
      if (remove) {
        this.on.remove(Number(remove.dataset.trailRemove));
        return;
      }
      const fold = target.closest<HTMLElement>("[data-trail-fold]");
      if (fold) {
        this.on.toggle(Number(fold.dataset.trailFold));
        return;
      }
      const node = target.closest<HTMLElement>("[data-trail]");
      if (node) this.on.select(Number(node.dataset.trail), e.metaKey);
    });
  }

  render(tabId: number, entries: TrailEntry[], current: number, onPath: Set<number>): void {
    if (tabId !== this.tabId) {
      this.seen = new Set(entries.map((e) => e.id));
      this.tabId = tabId;
    }
    this.inner.replaceChildren();
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.classList.add("trail-lines");
    svg.setAttribute("aria-hidden", "true");
    this.inner.append(svg);

    const elements = this.buildNodes(entries, current, onPath);
    const box = this.placeNodes(entries, elements, svg);

    for (const entry of entries) {
      if (entry.parent !== null) this.drawBranchLine(svg, box.get(entry.parent)!, box.get(entry.id)!, entry, onPath);
    }
    for (const entry of entries) {
      if (entry.branches >= 2) this.addFold(entry, box.get(entry.id)!);
    }

    this.seen = new Set(entries.map((e) => e.id));
    this.scrollTo(box.get(current));
    this.markEnds();
  }

  private buildNodes(entries: TrailEntry[], current: number, onPath: Set<number>): Map<number, HTMLElement> {
    const elements = new Map<number, HTMLElement>();
    for (const entry of entries) {
      const node = document.createElement("div");
      node.className = "trail-node";
      node.classList.toggle("is-current", entry.id === current);
      node.classList.toggle("is-on-path", onPath.has(entry.id));
      node.classList.toggle("is-new", !this.seen.has(entry.id));
      const name = document.createElement("button");
      name.className = "trail-name";
      name.dataset.trail = String(entry.id);
      name.dataset.tip = entry.label;
      if (entry.id === current) name.setAttribute("aria-current", "page");
      if (entry.isGraph) name.innerHTML = icons.graph;
      const text = document.createElement("span");
      text.textContent = entry.label;
      name.append(text);
      const x = document.createElement("button");
      x.className = "trail-x";
      x.dataset.trailRemove = String(entry.id);
      x.setAttribute("aria-label", `Remove ${entry.label} from the trail`);
      x.innerHTML = icons.close;
      node.append(x, name);
      this.inner.append(node);
      elements.set(entry.id, node);
    }
    return elements;
  }

  /** Positions every node, sizes the canvas to fit and returns each node's box. */
  private placeNodes(entries: TrailEntry[], elements: Map<number, HTMLElement>, svg: SVGSVGElement): Map<number, Box> {
    const box = new Map<number, Box>();
    let width = 0,
      height = 0;
    for (const entry of entries) {
      const el = elements.get(entry.id)!;
      const parent = entry.parent === null ? undefined : box.get(entry.parent);
      const x = parent ? parent.x + parent.width + GAP : 0;
      const y = entry.row * ROW;
      const w = el.offsetWidth;
      const label = el.querySelector<HTMLElement>(".trail-name span")!;
      if (label.scrollWidth <= label.clientWidth) delete el.querySelector<HTMLElement>(".trail-name")!.dataset.tip;
      box.set(entry.id, { x, y, width: w });
      el.style.insetInlineStart = `${x}px`;
      el.style.insetBlockStart = `${y}px`;
      width = Math.max(width, x + w);
      height = Math.max(height, y + ROW);
    }
    this.inner.style.inlineSize = `${width + 4}px`;
    this.inner.style.blockSize = `${height}px`;
    this.more.hidden = height <= ROW;
    svg.setAttribute("width", String(width + 4));
    svg.setAttribute("height", String(height));
    return box;
  }

  private drawBranchLine(svg: SVGSVGElement, from: Box, to: Box, entry: TrailEntry, onPath: Set<number>): void {
    const startX = from.x + from.width + 3;
    const startY = from.y + ROW / 2;
    const endX = to.x - 5;
    const endY = to.y + ROW / 2;
    const trunk = startX + 9;
    const r = 6;
    const d =
      endY === startY
        ? `M${startX} ${startY}H${endX}`
        : `M${startX} ${startY}H${trunk}V${endY - r}Q${trunk} ${endY} ${trunk + r} ${endY}H${endX}`;
    const line = document.createElementNS(SVG_NS, "path");
    line.setAttribute("d", d);
    line.setAttribute("pathLength", "1");
    line.classList.toggle("is-on-path", onPath.has(entry.id));
    line.classList.toggle("is-new", !this.seen.has(entry.id));
    const head = document.createElementNS(SVG_NS, "path");
    head.setAttribute("d", `M${endX - 4} ${endY - 3.5}L${endX} ${endY}L${endX - 4} ${endY + 3.5}`);
    head.classList.toggle("is-on-path", onPath.has(entry.id));
    svg.append(line, head);
  }

  private addFold(entry: TrailEntry, at: Box): void {
    const fold = document.createElement("button");
    fold.className = "trail-fold";
    fold.dataset.trailFold = String(entry.id);
    fold.setAttribute("aria-expanded", String(!entry.collapsed));
    fold.setAttribute(
      "aria-label",
      entry.collapsed ? `Show the branches from ${entry.label}` : `Fold the branches from ${entry.label}`,
    );
    fold.textContent = entry.collapsed ? "+" : "−";
    fold.style.insetInlineStart = `${at.x + at.width + 12 - 7}px`;
    fold.style.insetBlockStart = `${at.y + (entry.collapsed ? ROW / 2 : ROW) - 7}px`;
    this.inner.append(fold);
  }

  private get isOpen(): boolean {
    return this.root.classList.contains("is-open");
  }

  /** One row sits above the note. The whole map opens over it, and closing returns to the row holding the current note. */
  setOpen(open: boolean): void {
    if (open === this.isOpen) return;
    this.root.classList.toggle("is-open", open);
    this.more.setAttribute("aria-expanded", String(open));
    this.stopListening?.();
    this.stopListening = open ? dismissOnOutside([this.root], () => this.setOpen(false)) : null;
    if (!open) this.scrollTo(this.active);
  }

  /** Brings the current node into view. */
  private scrollTo(active: Box | undefined): void {
    this.active = active;
    if (!active) return;
    const s = this.scroller;
    if (active.x < s.scrollLeft) s.scrollLeft = Math.max(0, active.x - 12);
    else if (active.x + active.width > s.scrollLeft + s.clientWidth) s.scrollLeft = active.x + active.width - s.clientWidth + 12;
    if (active.y < s.scrollTop) s.scrollTop = active.y;
    else if (active.y + ROW > s.scrollTop + s.clientHeight) s.scrollTop = active.y + ROW - s.clientHeight;
  }

  /** The map fades only on a side that has more to scroll to. */
  private markEnds(): void {
    const s = this.scroller;
    s.classList.toggle("has-before", s.scrollLeft > 1);
    s.classList.toggle("has-after", s.scrollLeft + s.clientWidth < s.scrollWidth - 1);
  }
}
