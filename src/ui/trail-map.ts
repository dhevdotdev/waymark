import type { CrossLink, Placement } from "../vault/trail";
import { icons } from "./icons";

export interface TrailEntry extends Placement {
  label: string;
  isGraph: boolean;
}

const ROW = 32;
const GAP = 26;
/** Room above the first row for a link that arcs back along it. */
const ARC_ROOM = 14;
const SVG_NS = "http://www.w3.org/2000/svg";

interface Box {
  x: number;
  y: number;
  width: number;
}

function stroke(svg: SVGSVGElement, d: string, extra: string[], touching: boolean): void {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.classList.add(...extra);
  path.classList.toggle("is-near", touching);
  svg.append(path);
}

function drawCrossLink(svg: SVGSVGElement, from: Box, to: Box, isReturn: boolean, touching: boolean): void {
  if (isReturn) {
    /* A link straight back to the note before it: the existing line simply points both ways. */
    const x = to.x + to.width + 8,
      y = to.y + ROW / 2;
    stroke(svg, `M${x + 4} ${y - 3.5}L${x} ${y}L${x + 4} ${y + 3.5}`, ["is-cross"], touching);
    return;
  }
  const fx = from.x + from.width / 2,
    tx = to.x + to.width / 2;
  const inset = 3;
  if (from.y === to.y) {
    const y = from.y + inset;
    stroke(svg, `M${fx} ${y}C${fx} ${y - 16} ${tx} ${y - 16} ${tx} ${y}`, ["is-cross", "is-arc"], touching);
    stroke(svg, `M${tx - 3.5} ${y - 4}L${tx} ${y}L${tx + 3.5} ${y - 4}`, ["is-cross"], touching);
  } else {
    const down = to.y > from.y;
    const y1 = down ? from.y + ROW - inset : from.y + inset;
    const y2 = down ? to.y + inset : to.y + ROW - inset;
    const bend = (y2 - y1) / 2;
    stroke(svg, `M${fx} ${y1}C${fx} ${y1 + bend} ${tx} ${y2 - bend} ${tx} ${y2}`, ["is-cross", "is-arc"], touching);
    const dir = down ? -4 : 4;
    stroke(svg, `M${tx - 3.5} ${y2 + dir}L${tx} ${y2}L${tx + 3.5} ${y2 + dir}`, ["is-cross"], touching);
  }
}

/** Draws one tab's trail: notes laid out left to right, with branches stepping down. */
export class TrailMap {
  readonly root = document.createElement("nav");
  private inner = document.createElement("div");
  private scroller = document.createElement("div");
  private seen = new Set<number>();
  private tabId = -1;

  constructor(
    private on: { select: (id: number, newTab: boolean) => void; remove: (id: number) => void; toggle: (id: number) => void },
  ) {
    this.root.className = "trail";
    this.root.setAttribute("aria-label", "Trail of notes followed in this tab");
    this.scroller.className = "trail-scroll";
    this.inner.className = "trail-inner";
    this.scroller.append(this.inner);
    this.root.append(this.scroller);
    this.scroller.addEventListener("scroll", () => this.markEnds(), { passive: true });
    this.scroller.addEventListener(
      "wheel",
      (e) => {
        const s = this.scroller;
        if (s.scrollHeight > s.clientHeight || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
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

  render(tabId: number, entries: TrailEntry[], current: number, onPath: Set<number>, cross: CrossLink[]): void {
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
    const byId = new Map(entries.map((e) => [e.id, e]));
    const isReturn = (l: CrossLink) => byId.get(l.from)?.parent === l.to;
    const top = cross.some((l) => !isReturn(l) && byId.get(l.from)?.row === byId.get(l.to)?.row && byId.get(l.from)?.row === 0)
      ? ARC_ROOM
      : 0;
    const box = this.placeNodes(entries, elements, top, svg);

    for (const entry of entries) {
      if (entry.parent !== null) this.drawBranchLine(svg, box.get(entry.parent)!, box.get(entry.id)!, entry, onPath);
    }
    for (const entry of entries) {
      if (entry.branches >= 2) this.addFold(entry, box.get(entry.id)!);
    }
    for (const link of cross) {
      const from = box.get(link.from);
      const to = box.get(link.to);
      if (from && to) drawCrossLink(svg, from, to, isReturn(link), link.from === current || link.to === current);
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
  private placeNodes(
    entries: TrailEntry[],
    elements: Map<number, HTMLElement>,
    top: number,
    svg: SVGSVGElement,
  ): Map<number, Box> {
    const box = new Map<number, Box>();
    let width = 0,
      height = 0;
    for (const entry of entries) {
      const el = elements.get(entry.id)!;
      const parent = entry.parent === null ? undefined : box.get(entry.parent);
      const x = parent ? parent.x + parent.width + GAP : 0;
      const y = top + entry.row * ROW;
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

  /** Brings the current node into view. */
  private scrollTo(active: Box | undefined): void {
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
