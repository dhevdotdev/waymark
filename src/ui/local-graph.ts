import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { resolveColor } from "./colors";
import { groupColor } from "./graph";

export interface Neighbour {
  id: string;
  label: string;
  outgoing: boolean;
  incoming: boolean;
  group: number;
}

interface Node extends SimulationNodeDatum, Partial<Neighbour> {
  id: string;
  center?: boolean;
}

type Link = SimulationLinkDatum<Node> & { source: Node | string; target: Node | string; between: boolean };

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The current note's neighbourhood as small lobes: linked notes gather by link
 * community, the note's own community closest, others further out at uneven
 * distances, and each keeps the colour it has in the full graph. Names live in
 * the caption below the canvas; arrow keys move through the notes.
 */
export class LocalGraph {
  readonly root = document.createElement("div");
  private canvas = document.createElement("canvas");
  private caption = document.createElement("div");
  private ctx = this.canvas.getContext("2d")!;
  private nodes: Node[] = [];
  private links: Link[] = [];
  private order: Node[] = [];
  private hover: Node | null = null;
  private size = { w: 0, h: 0 };
  private view = { x: 0, y: 0, k: 1 };
  private summary = "";
  private frame = 0;
  private previous = new Map<string, { x: number; y: number }>();
  private colors!: Record<"dot" | "rule" | "accent" | "paper" | "ink", string>;
  private hues = new Map<number, string>();
  private centreGroup = -1;

  constructor(private onOpen: (id: string, newTab: boolean) => void) {
    this.root.className = "local-graph";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-roledescription", "link graph");
    this.caption.className = "local-graph-caption";
    this.caption.setAttribute("aria-live", "polite");
    this.root.append(this.canvas, this.caption);
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.canvas.addEventListener("pointermove", (e) => this.setHover(this.pick(e)));
    this.canvas.addEventListener("pointerleave", () => {
      if (document.activeElement !== this.canvas) this.setHover(null);
    });
    this.canvas.addEventListener("blur", () => this.setHover(null));
    this.canvas.addEventListener("click", (e) => {
      const hit = this.pick(e);
      if (hit && !hit.center) this.onOpen(hit.id, e.metaKey);
    });
    this.canvas.addEventListener("keydown", (e) => this.onKey(e));
  }

  set(between: [string, string][], neighbours: Neighbour[], centreGroup: number): void {
    this.centreGroup = centreGroup;
    cancelAnimationFrame(this.frame);
    for (const n of this.nodes) this.previous.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    const centre: Node = { id: "\u0000centre", center: true, fx: 0, fy: 0, x: 0, y: 0 };
    const others: Node[] = neighbours.map((n, i) => {
      const prev = this.previous.get(n.id);
      const a = (i / Math.max(1, neighbours.length)) * Math.PI * 2;
      return { ...n, x: prev?.x ?? Math.cos(a) * 40, y: prev?.y ?? Math.sin(a) * 40 };
    });
    this.nodes = [centre, ...others];
    const ids = new Set(others.map((n) => n.id));
    this.links = [
      ...others.map((n) => ({ source: centre.id, target: n.id, between: false })),
      ...between.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => ({ source: a, target: b, between: true })),
    ];
    this.order = [];

    const inc = neighbours.filter((n) => n.incoming).length;
    this.summary = neighbours.length ? `${neighbours.length} connected · ${inc} backlink${inc === 1 ? "" : "s"}` : "";
    this.canvas.setAttribute(
      "aria-label",
      `Linked notes, ${this.summary}. Use the arrow keys to move between them and Enter to open one.`,
    );
    this.hover = null;
    this.readColors();
    this.simulate();
    this.renderCaption();
  }

  refreshTheme(): void {
    this.readColors();
    this.draw();
  }

  /** Each community gets its own direction and distance, so the shape comes out lopsided and particular to the note. */
  private lobes(): Map<number, { x: number; y: number }> {
    const sizes = new Map<number, number>();
    for (const d of this.nodes) if (!d.center) sizes.set(d.group!, (sizes.get(d.group!) ?? 0) + 1);
    const order = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const anchors = new Map<number, { x: number; y: number }>();
    let step = 0;
    for (const [group, size] of order) {
      if (group === this.centreGroup && group >= 0) {
        anchors.set(group, { x: 0, y: 0 });
        continue;
      }
      const angle = 0.9 + step * 2.39996;
      const reach = 62 + (step % 3) * 16 + Math.min(18, size * 2);
      anchors.set(group, { x: Math.cos(angle) * reach * 1.3, y: Math.sin(angle) * reach * 0.8 });
      step++;
    }
    return anchors;
  }

  private simulate(): void {
    const anchors = this.lobes();
    /* Notes that also link to the note's other neighbours sit close; loosely tied ones drift out, which breaks any ring. */
    const ties = new Map<string, number>();
    for (const l of this.links) {
      if (!l.between) continue;
      for (const end of [l.source, l.target]) {
        const id = typeof end === "string" ? end : end.id;
        ties.set(id, (ties.get(id) ?? 0) + 1);
      }
    }
    const reachOf = (id: string) => 26 + 58 / (1 + (ties.get(id) ?? 0) * 0.7);
    const sim = forceSimulation<Node, Link>(this.nodes)
      .force(
        "link",
        forceLink<Node, Link>(this.links)
          .id((d) => d.id)
          .distance((l) => (l.between ? 24 : reachOf(typeof l.target === "string" ? l.target : l.target.id)))
          .strength((l) => (l.between ? 0.2 : 0.42)),
      )
      .force("charge", forceManyBody<Node>().strength(-46).distanceMax(150))
      .force(
        "x",
        forceX<Node>((d) => anchors.get(d.group ?? -2)?.x ?? 0).strength((d) =>
          d.center || d.group === this.centreGroup ? 0 : 0.2,
        ),
      )
      .force(
        "y",
        forceY<Node>((d) => anchors.get(d.group ?? -2)?.y ?? 0).strength((d) =>
          d.center || d.group === this.centreGroup ? 0 : 0.2,
        ),
      )
      .force("collide", forceCollide<Node>(10))
      .stop();
    /* Keyboard order follows the angle around the centre once the layout settles. */
    const settle = () => {
      this.order = this.nodes.filter((d) => !d.center).sort((a, b) => Math.atan2(a.y!, a.x!) - Math.atan2(b.y!, b.x!));
      this.fit();
      this.draw();
    };
    if (reduceMotion()) {
      for (let i = 0; i < 220; i++) sim.tick();
      settle();
      return;
    }
    /* Most of the settling happens off screen; the last stretch plays, so a note change reads as the graph rearranging. */
    for (let i = 0; i < 150; i++) sim.tick();
    this.fit();
    let frames = 0;
    const loop = () => {
      sim.tick();
      this.fit();
      this.draw();
      if (++frames < 40 && sim.alpha() > sim.alphaMin()) this.frame = requestAnimationFrame(loop);
      else settle();
    };
    settle();
    this.frame = requestAnimationFrame(loop);
  }

  /** Fits the whole neighbourhood to the canvas, centred on its bounding box. */
  private fit(): void {
    const { w, h } = this.size;
    if (!w || !this.nodes.length) return;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const d of this.nodes) {
      minX = Math.min(minX, d.x!);
      maxX = Math.max(maxX, d.x!);
      minY = Math.min(minY, d.y!);
      maxY = Math.max(maxY, d.y!);
    }
    const pad = 16;
    this.view.k = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY), 2.2);
    this.view.x = w / 2 - ((minX + maxX) / 2) * this.view.k;
    this.view.y = h / 2 - ((minY + maxY) / 2) * this.view.k;
  }

  private readColors(): void {
    this.colors = {
      dot: resolveColor("var(--ink-4)"),
      rule: resolveColor("var(--rule-strong)"),
      accent: resolveColor("var(--accent)"),
      paper: resolveColor("var(--paper)"),
      ink: resolveColor("var(--ink)"),
    };
    this.hues.clear();
    for (const d of this.nodes)
      if (!d.center && !this.hues.has(d.group!)) this.hues.set(d.group!, resolveColor(groupColor(d.group!)));
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.size = { w: r.width, h: r.height };
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fit();
    this.draw();
  }

  private sx(d: Node): number {
    return this.view.x + d.x! * this.view.k;
  }

  private sy(d: Node): number {
    return this.view.y + d.y! * this.view.k;
  }

  private draw(): void {
    const { ctx, colors: c } = this;
    const { w, h } = this.size;
    if (!w || !c) return;
    ctx.clearRect(0, 0, w, h);
    const hot = this.hover && !this.hover.center ? this.hover : null;

    for (const l of this.links) {
      const s = l.source as Node,
        t = l.target as Node;
      if (typeof s === "string" || typeof t === "string") continue;
      const lit = !!hot && (s === hot || t === hot);
      const outer = s.center ? t : s;
      ctx.globalAlpha = lit ? 0.9 : hot ? 0.07 : l.between ? 0.28 : 0.42;
      ctx.strokeStyle = lit ? c.ink : l.between ? c.rule : (this.hues.get(outer.group!) ?? c.rule);
      ctx.lineWidth = lit ? 1.3 : 1;
      const ax = this.sx(s),
        ay = this.sy(s),
        bx = this.sx(t),
        by = this.sy(t);
      const dx = bx - ax,
        dy = by - ay;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(ax + dx / 2 - dy * 0.12, ay + dy / 2 + dx * 0.12, bx, by);
      ctx.stroke();
    }

    for (const d of this.nodes) {
      if (d.center) continue;
      const on = d === hot;
      ctx.globalAlpha = hot && !on ? 0.4 : 1;
      ctx.beginPath();
      ctx.arc(this.sx(d), this.sy(d), on ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = on ? c.ink : (this.hues.get(d.group!) ?? c.dot);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.arc(this.view.x, this.view.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  private pick(e: MouseEvent): Node | null {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top;
    let best: Node | null = null;
    let bestD = 12;
    for (const d of this.nodes) {
      if (d.center) continue;
      const dist = Math.hypot(this.sx(d) - x, this.sy(d) - y);
      if (dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    return best;
  }

  private onKey(e: KeyboardEvent): void {
    const list = this.order.length ? this.order : this.nodes.filter((d) => !d.center);
    if (!list.length) return;
    const i = this.hover ? list.indexOf(this.hover) : -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      this.setHover(list[(i + 1) % list.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      this.setHover(list[(i - 1 + list.length) % list.length]);
    } else if (e.key === "Enter" && this.hover) {
      e.preventDefault();
      this.onOpen(this.hover.id, e.metaKey);
    }
  }

  private setHover(d: Node | null): void {
    if (d === this.hover) return;
    this.hover = d;
    this.canvas.style.cursor = d ? "pointer" : "default";
    this.draw();
    this.renderCaption();
  }

  private renderCaption(): void {
    this.caption.replaceChildren();
    const d = this.hover;
    if (!d) {
      this.caption.textContent = this.summary;
      this.caption.classList.remove("is-hover");
      return;
    }
    const name = document.createElement("span");
    name.className = "local-graph-name";
    name.textContent = d.label ?? "";
    const kind = document.createElement("span");
    kind.className = "local-graph-kind";
    kind.textContent = d.outgoing && d.incoming ? "both ways" : d.outgoing ? "linked from here" : "links here";
    this.caption.append(name, kind);
    this.caption.classList.add("is-hover");
  }
}
