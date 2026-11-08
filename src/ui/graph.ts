import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { resolveColor } from "./colors";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  degree: number;
  group: number;
  /** Where the note starts its entrance. */
  sx?: number;
  sy?: number;
}

export interface GraphGroup {
  id: number;
  label: string;
  size: number;
}

type GraphLink = SimulationLinkDatum<GraphNode> & { source: GraphNode | string; target: GraphNode | string };

export interface GraphData {
  nodes: GraphNode[];
  links: { source: string; target: string }[];
  groups: GraphGroup[];
}

interface Palette {
  loose: string;
  bright: string;
  edge: string;
  accent: string;
  label: string;
  labelBg: string;
  font: string;
  dark: boolean;
}

interface Centre {
  x: number;
  y: number;
  r: number;
  top: number;
  bottom: number;
}

const HUES = ["mauve", "teal", "peach", "blue", "pink", "green", "yellow", "sky", "red", "lavender"];

/** The CSS colour for a link community, so every view of the graph agrees and follows the theme. */
export const groupColor = (group: number): string =>
  group < 0 ? "var(--ink-4)" : `var(--p-${HUES[group % HUES.length]}, var(--accent))`;

const reduceMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.motion === "reduced";

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Finished layouts, so reopening the graph is immediate and notes stay where you left them. */
const layouts = new Map<string, Map<string, [number, number]>>();

function signature(nodes: GraphNode[], links: GraphLink[]): string {
  let hash = 0;
  for (const n of nodes) for (let i = 0; i < n.id.length; i++) hash = (hash * 31 + n.id.charCodeAt(i)) | 0;
  return `${nodes.length}:${links.length}:${hash}`;
}

/** A soft round light in one colour: full at the centre and fading smoothly, with no visible edge. */
function lightSprite(color: string): HTMLCanvasElement {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.2, "rgba(0,0,0,0.62)");
  g.addColorStop(0.45, "rgba(0,0,0,0.24)");
  g.addColorStop(0.72, "rgba(0,0,0,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, size, size);
  return c;
}

/**
 * The vault as a map of link communities. Each community gathers into its own
 * cluster in its own colour, links inside it arc gently, and links between
 * communities run through their centres so they read as threads, not a hairball.
 */
export class GraphCanvas {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private sim: Simulation<GraphNode, GraphLink> | null = null;
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private inside = new Map<number, GraphLink[]>();
  private between: GraphLink[] = [];
  private groups: GraphGroup[] = [];
  private neighbours = new Map<string, Set<string>>();
  private view = { x: 0, y: 0, k: 1 };
  private hover: GraphNode | null = null;
  private spot: number | null = null;
  private drag: { node: GraphNode | null; startX: number; startY: number; moved: boolean; vx: number; vy: number } | null = null;
  private palette!: Palette;
  private hues = new Map<number, string>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private frame = 0;
  private pulseFrame = 0;
  private intro = 1;
  private size = { w: 0, h: 0 };
  private resizeObserver: ResizeObserver;
  private filter = "";
  current: string | null = null;

  constructor(private opts: { onOpen: (id: string, newTab: boolean) => void }) {
    this.canvas.className = "graph-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Graph of notes and their links, coloured by community");
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.bind();
  }

  setData(data: GraphData, current: string | null): void {
    const previous = new Map(this.nodes.map((n) => [n.id, n]));
    this.current = current;
    this.groups = data.groups;
    this.spot = null;
    this.hover = null;
    this.nodes = data.nodes.map((n) => ({ ...n, x: previous.get(n.id)?.x, y: previous.get(n.id)?.y }));
    const ids = new Set(this.nodes.map((n) => n.id));
    this.links = data.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
    this.neighbours.clear();
    for (const l of data.links) {
      if (!this.neighbours.has(l.source)) this.neighbours.set(l.source, new Set());
      if (!this.neighbours.has(l.target)) this.neighbours.set(l.target, new Set());
      this.neighbours.get(l.source)!.add(l.target);
      this.neighbours.get(l.target)!.add(l.source);
    }
    this.readPalette();
    this.layout(previous);
    this.fit();
    this.playIntro();
  }

  /** Lights one community and dims the rest; null restores the whole graph. */
  spotlight(group: number | null): void {
    this.spot = group;
    this.draw();
  }

  /** Moves the view to frame one community. */
  flyToGroup(group: number): void {
    const c = this.centres().get(group);
    if (!c || !this.size.w) return;
    const k = Math.min(3, Math.max(this.view.k * 0.8, (Math.min(this.size.w, this.size.h) * 0.4) / Math.max(40, c.r)));
    this.animateView({ k, x: this.size.w / 2 - c.x * k, y: this.size.h / 2 - c.y * k });
  }

  setFilter(text: string): void {
    this.filter = text.trim().toLowerCase();
    this.draw();
  }

  refreshTheme(): void {
    this.readPalette();
    this.draw();
  }

  destroy(): void {
    this.sim?.stop();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.pulseFrame);
    this.resizeObserver.disconnect();
  }

  /** Places communities relative to each other first, then settles each note around its community. */
  private layout(previous: Map<string, GraphNode>): void {
    this.sim?.stop();
    const anchors = this.placeGroups();
    const n = this.nodes.length;
    const dense = n > 120;
    const sim = forceSimulation<GraphNode, GraphLink>(this.nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLink>(this.links)
          .id((d) => d.id)
          .distance((l) =>
            (l.source as GraphNode).group === (l.target as GraphNode).group ? (dense ? 24 : 42) : dense ? 120 : 90,
          )
          .strength((l) =>
            (l.source as GraphNode).group === (l.target as GraphNode).group && (l.source as GraphNode).group >= 0 ? 0.32 : 0.012,
          ),
      )
      .force(
        "charge",
        forceManyBody<GraphNode>()
          .strength(dense ? -30 : -110)
          .distanceMax(dense ? 200 : 320),
      )
      .force(
        "x",
        forceX<GraphNode>((d) => anchors.get(d.group)?.x ?? 0).strength((d) => (d.group < 0 ? 0.02 : 0.11)),
      )
      .force(
        "y",
        forceY<GraphNode>((d) => anchors.get(d.group)?.y ?? 0).strength((d) => (d.group < 0 ? 0.02 : 0.11)),
      )
      .force(
        "collide",
        forceCollide<GraphNode>((d) => this.radius(d) + 2.5),
      )
      .alphaDecay(0.028)
      .stop();
    this.sim = sim;
    this.inside.clear();
    this.between = [];
    for (const l of this.links) {
      const a = (l.source as GraphNode).group,
        b = (l.target as GraphNode).group;
      if (a === b && a >= 0) {
        if (!this.inside.has(a)) this.inside.set(a, []);
        this.inside.get(a)!.push(l);
      } else this.between.push(l);
    }
    const key = signature(this.nodes, this.links);
    const known = layouts.get(key);
    if (known) {
      for (const d of this.nodes) [d.x, d.y] = known.get(d.id) ?? [0, 0];
      sim.alpha(0);
    } else {
      for (let i = 0; i < 220; i++) sim.tick();
      layouts.set(key, new Map(this.nodes.map((d) => [d.id, [d.x!, d.y!]])));
      if (layouts.size > 12) layouts.delete(layouts.keys().next().value!);
      sim.alpha(0);
    }
    const centres = this.centres(false);
    for (const d of this.nodes) {
      const old = previous.get(d.id);
      const c = centres.get(d.group);
      d.sx = old?.x ?? c?.x ?? d.x! * 0.4;
      d.sy = old?.y ?? c?.y ?? d.y! * 0.4;
    }
  }

  private placeGroups(): Map<number, { x: number; y: number }> {
    type Meta = SimulationNodeDatum & { id: number; r: number };
    const counts = new Map<number, number>();
    for (const n of this.nodes) if (n.group >= 0) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    const metas: Meta[] = [...counts].map(([id, size]) => ({ id, r: 16 * Math.sqrt(size) }));
    const present = new Set(metas.map((m) => m.id));
    const weight = new Map<string, { source: number; target: number; w: number }>();
    const group = new Map(this.nodes.map((n) => [n.id, n.group]));
    for (const l of this.links) {
      const a = group.get(l.source as string)!,
        b = group.get(l.target as string)!;
      if (a === b || !present.has(a) || !present.has(b)) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const e = weight.get(key) ?? { source: Math.min(a, b), target: Math.max(a, b), w: 0 };
      e.w++;
      weight.set(key, e);
    }
    const sim = forceSimulation<Meta>(metas)
      .force(
        "link",
        forceLink<Meta, { source: number | Meta; target: number | Meta; w: number }>([...weight.values()])
          .id((d) => d.id)
          .distance((l) => 60 + 90 / Math.sqrt(l.w))
          .strength(0.25),
      )
      .force("charge", forceManyBody<Meta>().strength(-260))
      .force("x", forceX<Meta>(0).strength(0.04))
      .force("y", forceY<Meta>(0).strength(0.17))
      .force(
        "collide",
        forceCollide<Meta>((d) => d.r * 1.15),
      )
      .stop();
    for (let i = 0; i < 240; i++) sim.tick();
    return new Map(metas.map((m) => [m.id, { x: m.x!, y: m.y! }]));
  }

  private playIntro(): void {
    cancelAnimationFrame(this.frame);
    if (reduceMotion() || !this.nodes.length) {
      this.intro = 1;
      this.draw();
      return;
    }
    this.intro = 0;
    const start = performance.now();
    const loop = (now: number) => {
      this.intro = easeOut(clamp01((now - start) / 620));
      this.draw();
      if (this.intro < 1) this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  private animateView(to: { x: number; y: number; k: number }): void {
    cancelAnimationFrame(this.frame);
    this.intro = 1;
    if (reduceMotion()) {
      this.view = to;
      this.draw();
      return;
    }
    const from = { ...this.view };
    const start = performance.now();
    const loop = (now: number) => {
      const t = easeOut(clamp01((now - start) / 420));
      this.view = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, k: from.k + (to.k - from.k) * t };
      this.draw();
      if (t < 1) this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** Dot radius in graph units: log of the note's links, capped so hubs stay modest. */
  private radius(d: GraphNode): number {
    return 1.9 + Math.min(3.4, Math.log2(1 + d.degree) * 0.62);
  }

  /** On-screen dots grow only gently when zooming in. */
  private drawRadius(d: GraphNode): number {
    const k = this.view.k;
    return this.radius(d) * (k > 1 ? k ** -0.65 : 1);
  }

  private fitView(): { x: number; y: number; k: number } {
    const xs = this.nodes.map((n) => n.x!).sort((a, b) => a - b);
    const ys = this.nodes.map((n) => n.y!).sort((a, b) => a - b);
    const cut = this.nodes.length > 40 ? Math.floor(this.nodes.length * 0.01) : 0;
    const minX = xs[cut],
      maxX = xs[xs.length - 1 - cut],
      minY = ys[cut],
      maxY = ys[ys.length - 1 - cut];
    const top = 72,
      bottom = 64,
      side = 56;
    const k = Math.max(
      0.15,
      Math.min((this.size.w - side * 2) / Math.max(1, maxX - minX), (this.size.h - top - bottom) / Math.max(1, maxY - minY), 2.4),
    );
    return {
      k,
      x: this.size.w / 2 - ((minX + maxX) / 2) * k,
      y: top + (this.size.h - top - bottom) / 2 - ((minY + maxY) / 2) * k,
    };
  }

  private fit(): void {
    if (!this.nodes.length || !this.size.w) return;
    this.view = this.fitView();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const first = !this.size.w;
    this.size = { w: rect.width, h: rect.height };
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (first) this.fit();
    this.draw();
  }

  private readPalette(): void {
    const v = (expr: string) => resolveColor(expr);
    this.palette = {
      loose: v("var(--ink-4)"),
      bright: v("var(--ink)"),
      edge: v("var(--ink-3)"),
      accent: v("var(--accent)"),
      label: v("var(--ink-2)"),
      labelBg: v("var(--paper)"),
      font: getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim(),
      dark: document.documentElement.dataset.scheme === "dark",
    };
    this.hues.clear();
    this.sprites.clear();
    for (const g of this.groups) this.hues.set(g.id, v(groupColor(g.id)));
  }

  private hue(group: number): string {
    return this.hues.get(group) ?? this.palette.loose;
  }

  private sprite(color: string): HTMLCanvasElement {
    let s = this.sprites.get(color);
    if (!s) {
      s = lightSprite(color);
      this.sprites.set(color, s);
    }
    return s;
  }

  private matches(n: GraphNode): boolean {
    return !this.filter || n.label.toLowerCase().includes(this.filter);
  }

  private px(n: GraphNode): number {
    return this.intro >= 1 ? n.x! : n.sx! + (n.x! - n.sx!) * this.intro;
  }

  private py(n: GraphNode): number {
    return this.intro >= 1 ? n.y! : n.sy! + (n.y! - n.sy!) * this.intro;
  }

  private centres(animated = true): Map<number, Centre> {
    const sum = new Map<number, { x: number; y: number; n: number; list: GraphNode[] }>();
    const X = (d: GraphNode) => (animated ? this.px(d) : d.x!);
    const Y = (d: GraphNode) => (animated ? this.py(d) : d.y!);
    for (const d of this.nodes) {
      if (d.group < 0) continue;
      const s = sum.get(d.group) ?? { x: 0, y: 0, n: 0, list: [] };
      s.x += X(d);
      s.y += Y(d);
      s.n++;
      s.list.push(d);
      sum.set(d.group, s);
    }
    const out = new Map<number, Centre>();
    for (const [g, s] of sum) {
      const x = s.x / s.n,
        y = s.y / s.n;
      let mean = 0,
        top = Infinity,
        bottom = -Infinity;
      for (const d of s.list) {
        mean += Math.hypot(X(d) - x, Y(d) - y);
        top = Math.min(top, Y(d));
        bottom = Math.max(bottom, Y(d));
      }
      out.set(g, { x, y, r: (mean / s.n) * 2.1 + 26, top, bottom });
    }
    return out;
  }

  /** Control points. Links between communities bend through both centres, which gathers them into threads. */
  private curve(l: GraphLink, centres: Map<number, Centre>): [number, number, number, number, number, number, number, number] {
    const s = l.source as GraphNode,
      t = l.target as GraphNode;
    const sx = this.px(s),
      sy = this.py(s),
      tx = this.px(t),
      ty = this.py(t);
    const a = centres.get(s.group),
      b = centres.get(t.group);
    if (s.group !== t.group && a && b) {
      return [sx, sy, sx + (a.x - sx) * 0.62, sy + (a.y - sy) * 0.62, tx + (b.x - tx) * 0.62, ty + (b.y - ty) * 0.62, tx, ty];
    }
    const dx = tx - sx,
      dy = ty - sy;
    return [
      sx,
      sy,
      sx + dx / 3 - dy * 0.1,
      sy + dy / 3 + dx * 0.1,
      sx + (dx * 2) / 3 - dy * 0.1,
      sy + (dy * 2) / 3 + dx * 0.1,
      tx,
      ty,
    ];
  }

  private draw(): void {
    const { ctx, palette: p } = this;
    if (!this.size.w || !p) return;
    const k = this.view.k;
    ctx.clearRect(0, 0, this.size.w, this.size.h);
    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(k, k);

    const focus = this.hover;
    const near = focus ? (this.neighbours.get(focus.id) ?? new Set<string>()) : null;
    const lit = (n: GraphNode) =>
      this.matches(n) && (this.spot === null || n.group === this.spot) && (!near || n === focus || near.has(n.id));
    const dimmed = !!focus || this.spot !== null || !!this.filter;
    const centres = this.centres();
    const light = p.dark ? "lighter" : "source-over";
    const fade = this.intro;

    const stroke = (list: GraphLink[]) => {
      ctx.beginPath();
      for (const l of list) {
        const [ax, ay, bx, by, cx, cy, dx, dy] = this.curve(l, centres);
        ctx.moveTo(ax, ay);
        ctx.bezierCurveTo(bx, by, cx, cy, dx, dy);
      }
      ctx.stroke();
    };
    ctx.lineCap = "round";
    ctx.lineWidth = 0.8 / Math.max(k, 0.6);
    ctx.strokeStyle = p.edge;
    ctx.globalAlpha = (p.dark ? 0.1 : 0.16) * (dimmed ? 0.3 : 1) * fade;
    stroke(this.between);
    for (const [g, list] of this.inside) {
      ctx.strokeStyle = this.hue(g);
      ctx.globalAlpha = (p.dark ? 0.32 : 0.34) * (dimmed && this.spot !== g ? 0.18 : 1) * fade;
      stroke(list);
    }

    if (focus) {
      const hot = this.links.filter((l) => l.source === focus || l.target === focus);
      ctx.lineWidth = 1.3 / Math.max(k, 0.6);
      ctx.globalAlpha = 0.85;
      for (const l of hot) {
        const other = l.source === focus ? (l.target as GraphNode) : (l.source as GraphNode);
        ctx.strokeStyle = other.group >= 0 ? this.hue(other.group) : p.accent;
        stroke([l]);
      }
      if (!reduceMotion()) {
        const now = performance.now();
        ctx.globalCompositeOperation = light;
        ctx.globalAlpha = 0.8;
        hot.slice(0, 48).forEach((l, i) => {
          const [ax, ay, bx, by, cx, cy, dx, dy] = this.curve(l, centres);
          const t = (now / 1500 + i * 0.137) % 1;
          const u = 1 - t;
          const x = u * u * u * ax + 3 * u * u * t * bx + 3 * u * t * t * cx + t * t * t * dx;
          const y = u * u * u * ay + 3 * u * u * t * by + 3 * u * t * t * cy + t * t * t * dy;
          const R = 4.5 / Math.max(k, 0.7);
          ctx.drawImage(this.sprite(p.bright), x - R, y - R, R * 2, R * 2);
        });
      }
    }

    const degrees = this.nodes.map((n) => n.degree).sort((a, b) => b - a);
    const hub = Math.max(3, degrees[Math.floor(degrees.length * 0.06)] ?? Infinity);
    ctx.globalCompositeOperation = light;
    for (const n of this.nodes) {
      const special = n.id === this.current || n === focus;
      if (!special && n.degree < hub) continue;
      if (!lit(n)) continue;
      const R = this.drawRadius(n) * (special ? 6 : 4.5);
      ctx.globalAlpha = (special ? (p.dark ? 0.75 : 0.5) : p.dark ? 0.4 : 0.26) * fade;
      ctx.drawImage(this.sprite(special ? p.accent : this.hue(n.group)), this.px(n) - R, this.py(n) - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    for (const n of this.nodes) {
      const special = n.id === this.current || n === focus;
      ctx.globalAlpha = (lit(n) ? 1 : 0.13) * (0.4 + 0.6 * fade);
      ctx.beginPath();
      ctx.arc(this.px(n), this.py(n), this.drawRadius(n) + (special ? 1 / Math.max(k, 1) : 0), 0, Math.PI * 2);
      ctx.fillStyle = special ? p.bright : this.hue(n.group);
      ctx.fill();
    }

    if (fade >= 1) this.drawLabels(lit, near, centres);
    ctx.restore();
    ctx.globalAlpha = 1;

    cancelAnimationFrame(this.pulseFrame);
    if (focus && !reduceMotion()) this.pulseFrame = requestAnimationFrame(() => this.draw());
  }

  private drawLabels(lit: (n: GraphNode) => boolean, near: Set<string> | null, centres: Map<number, Centre>): void {
    const { ctx, palette: p } = this;
    const k = this.view.k;
    const focus = this.hover;
    type Box = [number, number, number, number];
    const placed: Box[] = [];
    const pad = 2 / k;
    const hits = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";

    const halo = (text: string, x: number, y: number, color: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.5 / k;
      ctx.strokeStyle = p.labelBg;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };

    const fontPx = 11 / k;
    const dots = this.nodes.map((n) => {
      const r = this.drawRadius(n);
      return { n, box: [n.x! - r, n.y! - r, n.x! + r, n.y! + r] as Box };
    });
    const labelNote = (n: GraphNode, forced: boolean, alpha: number) => {
      const label = n.label.length > 42 ? `${n.label.slice(0, 40)}…` : n.label;
      const w = ctx.measureText(label).width;
      const r = this.drawRadius(n);
      const gap = 3 / k;
      const spots: [number, number][] = [
        [n.x!, n.y! + r + gap],
        [n.x!, n.y! - r - gap - fontPx],
        [n.x! + r + gap + w / 2, n.y! - fontPx / 2],
        [n.x! - r - gap - w / 2, n.y! - fontPx / 2],
      ];
      const boxAt = (x: number, y: number): Box => [x - w / 2 - pad, y - pad, x + w / 2 + pad, y + fontPx + pad];
      const free = (box: Box) => !placed.some((b) => hits(box, b)) && !dots.some((d) => d.n !== n && hits(box, d.box));
      const spot = spots.find(([x, y]) => free(boxAt(x, y))) ?? (forced ? spots[0] : null);
      if (!spot) return;
      placed.push(boxAt(spot[0], spot[1]));
      halo(label, spot[0], spot[1], forced ? p.bright : p.label, alpha);
    };
    ctx.font = `500 ${fontPx}px ${p.font}`;
    const openNote = this.nodes.find((n) => n.id === this.current);
    if (openNote && lit(openNote) && openNote !== focus) labelNote(openNote, true, 1);

    /* Zoomed out, each community is named just outside its cluster; zooming in hands over to individual notes. */
    const groupAlpha = focus || this.filter ? 0 : this.spot !== null ? 1 : clamp01((1.5 - k) / 0.4);
    if (groupAlpha > 0) {
      const size = 12.5 / k;
      ctx.font = `600 ${size}px ${p.font}`;
      for (const g of this.groups) {
        const c = centres.get(g.id);
        if (!c || g.size < 5 || (this.spot !== null && this.spot !== g.id)) continue;
        const text = g.label.length > 30 ? `${g.label.slice(0, 28)}…` : g.label;
        const w = ctx.measureText(text).width;
        const gap = 8 / k;
        const choices = [c.top - gap - size, c.bottom + gap];
        const boxFor = (y: number): Box => [c.x - w / 2 - pad, y - pad, c.x + w / 2 + pad, y + size + pad];
        const y = choices.find((v) => !placed.some((b) => hits(boxFor(v), b)));
        if (y === undefined) continue;
        placed.push(boxFor(y));
        halo(text, c.x, y, this.hue(g.id), groupAlpha);
      }
    }

    ctx.font = `500 ${fontPx}px ${p.font}`;
    const reveal = (n: GraphNode) => clamp01((k - (2.1 - Math.min(1, n.degree / 22) * 0.6)) / 0.3);
    const candidates = this.nodes.filter((n) => {
      if (!lit(n)) return false;
      if (n === openNote && n !== focus) return false;
      if (n === focus || near?.has(n.id) || (this.filter && this.matches(n))) return true;
      return reveal(n) > 0;
    });
    const rank = (n: GraphNode) => (n === focus ? 1e6 : 0) + n.degree;
    candidates.sort((a, b) => rank(b) - rank(a));
    for (const n of candidates) labelNote(n, n === focus, n === focus || near?.has(n.id) || this.filter ? 1 : reveal(n) * 0.9);
  }

  private toWorld(clientX: number, clientY: number): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [(clientX - rect.left - this.view.x) / this.view.k, (clientY - rect.top - this.view.y) / this.view.k];
  }

  private pick(clientX: number, clientY: number): GraphNode | null {
    const [x, y] = this.toWorld(clientX, clientY);
    let best: GraphNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x! - x, n.y! - y);
      if (d < this.drawRadius(n) + 6 / this.view.k && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  private bind(): void {
    const c = this.canvas;
    c.addEventListener("pointermove", (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.startX,
          dy = e.clientY - this.drag.startY;
        if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
        if (this.drag.node) {
          const [x, y] = this.toWorld(e.clientX, e.clientY);
          this.drag.node.fx = x;
          this.drag.node.fy = y;
          if (!reduceMotion()) this.kick(0.25);
          else {
            this.drag.node.x = x;
            this.drag.node.y = y;
          }
        } else {
          this.view.x = this.drag.vx + dx;
          this.view.y = this.drag.vy + dy;
        }
        this.draw();
        return;
      }
      const hit = this.pick(e.clientX, e.clientY);
      if (hit !== this.hover) {
        this.hover = hit;
        c.style.cursor = hit ? "pointer" : "grab";
        this.draw();
      }
    });
    c.addEventListener("pointerleave", () => {
      if (!this.drag && this.hover) {
        this.hover = null;
        this.draw();
      }
    });
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      c.setPointerCapture(e.pointerId);
      cancelAnimationFrame(this.frame);
      this.intro = 1;
      const node = this.pick(e.clientX, e.clientY);
      this.drag = { node, startX: e.clientX, startY: e.clientY, moved: false, vx: this.view.x, vy: this.view.y };
      if (!node) c.style.cursor = "grabbing";
    });
    c.addEventListener("pointerup", (e) => {
      const d = this.drag;
      this.drag = null;
      c.style.cursor = this.hover ? "pointer" : "grab";
      if (!d?.node) return;
      d.node.fx = null;
      d.node.fy = null;
      if (!d.moved) this.opts.onOpen(d.node.id, e.metaKey);
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        cancelAnimationFrame(this.frame);
        this.intro = 1;
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left,
          my = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0022));
        const k = Math.min(6, Math.max(0.12, this.view.k * factor));
        this.view.x = mx - ((mx - this.view.x) * k) / this.view.k;
        this.view.y = my - ((my - this.view.y) * k) / this.view.k;
        this.view.k = k;
        this.draw();
      },
      { passive: false },
    );
  }

  private kick(alpha: number): void {
    if (!this.sim) return;
    this.sim.alpha(Math.max(this.sim.alpha(), alpha));
    cancelAnimationFrame(this.frame);
    const loop = () => {
      this.sim!.tick();
      this.draw();
      if (this.sim!.alpha() > this.sim!.alphaMin()) this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  zoomBy(factor: number): void {
    const k = Math.min(6, Math.max(0.12, this.view.k * factor));
    const mx = this.size.w / 2,
      my = this.size.h / 2;
    this.animateView({ k, x: mx - ((mx - this.view.x) * k) / this.view.k, y: my - ((my - this.view.y) * k) / this.view.k });
  }

  recenter(): void {
    if (this.nodes.length && this.size.w) this.animateView(this.fitView());
  }
}
