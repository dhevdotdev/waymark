import type { Simulation } from "d3-force";
import { resolveColor } from "./colors";
import { GraphBloom } from "./graph-bloom";
import { CameraGlide, closeView, fitView, SAFE, type Viewport } from "./graph-camera";
import { drawLabels } from "./graph-labels";
import { settleGraph } from "./graph-layout";
import { arcControls, bezier, groupColor, lightSprite } from "./graph-paint";
import { describeNote, nextIndex, traversalOrder } from "./graph-traversal";
import type { Arrival, Centre, GraphData, GraphGroup, GraphLink, GraphNode, Palette } from "./graph-types";
import { isPointerAction } from "./input-origin";
import { reducedMotion } from "./media";

interface Drag {
  pointerId: number;
  node: GraphNode | null;
  startX: number;
  startY: number;
  moved: boolean;
  /** The view at the press, for panning. */
  vx: number;
  vy: number;
  /** Where on the note it was picked up, so it does not jump to centre on the pointer. */
  grabX: number;
  grabY: number;
}

/** How close on the current note the camera starts when the graph opens. */
const PULL_BACK = 2.6;

export class GraphCanvas {
  readonly canvas = document.createElement("canvas");
  /** Speaks the note the arrow keys land on. */
  readonly announcer = document.createElement("div");
  private ctx = this.canvas.getContext("2d")!;
  private sim: Simulation<GraphNode, GraphLink> | null = null;
  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private inside = new Map<number, GraphLink[]>();
  private between: GraphLink[] = [];
  private groups: GraphGroup[] = [];
  private neighbours = new Map<string, Set<string>>();
  private view: Viewport = { x: 0, y: 0, k: 1 };
  private readonly camera = new CameraGlide();
  private bloom: GraphBloom | null = null;
  private hover: GraphNode | null = null;
  /** The emphasised note came from the arrow keys, so it is drawn still. */
  private keyed = false;
  private spot: number | null = null;
  private drag: Drag | null = null;
  private palette!: Palette;
  private hues = new Map<number, string>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private frame = 0;
  private size = { w: 0, h: 0 };
  private resizeObserver: ResizeObserver;
  private filter = "";
  current: string | null = null;

  constructor(private opts: { onOpen: (id: string, newTab: boolean) => void }) {
    this.canvas.className = "graph-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "application");
    this.canvas.setAttribute("aria-roledescription", "link graph");
    this.canvas.setAttribute(
      "aria-label",
      "Graph of notes and their links, coloured by community. Use the arrow keys to move between notes and Enter to open one.",
    );
    this.announcer.className = "graph-announce";
    this.announcer.setAttribute("aria-live", "polite");
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.bind();
  }

  /** With `keep`, the same graph is being refreshed: the camera, emphasis and any held note stay, and `keep` is the spotlight. */
  setData(data: GraphData, current: string | null, keep?: number | null, arrival: Arrival = {}): void {
    const previous = new Map(this.nodes.map((n) => [n.id, n]));
    const refreshing = keep !== undefined;
    this.current = current;
    this.groups = data.groups;
    this.spot = keep ?? null;
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
    this.layout();
    this.bloom = GraphBloom.on(this.canvas, arrival.bloom ? GraphBloom.from(this.nodes, this.links, current) : null);
    this.carryOver(refreshing);
    if (!refreshing) {
      this.camera.stop();
      /* A canvas just mounted is measured here, before its first resize, so the arrival can start from the fitted view. */
      if (this.size.w) this.fit();
      else this.measure();
      if (arrival.pull) this.closeOn(current, PULL_BACK, false);
    }
    this.draw();
  }

  /**
   * Glides between the view now and one `factor` times closer with the note `id` in the middle: `inward` toward it,
   * otherwise out from it. Without that note it closes on the middle. Under Reduce Motion the view stays where it is.
   */
  closeOn(id: string | null, factor: number, inward: boolean): void {
    if (!this.size.w) return;
    const node = this.nodes.find((d) => d.id === id);
    const near = closeView(this.view, this.size, node, factor);
    const [from, to] = inward ? [this.view, near] : [near, this.view];
    if (!this.camera.start(from, to, "--ease-out")) return;
    this.view = from;
    this.wake();
  }

  /** Re-points what refers to a note at the new copy of that note, and lets go of anything that has gone. */
  private carryOver(refreshing: boolean): void {
    const fresh = (old: GraphNode | null) => (old && refreshing ? (this.nodes.find((n) => n.id === old.id) ?? null) : null);
    this.hover = fresh(this.hover);
    if (!this.hover) this.setKeyed(null);
    if (this.drag?.node) {
      this.drag.node = fresh(this.drag.node);
      if (!this.drag.node) this.drag = null;
    }
  }

  /** Lights one community and dims the rest; null restores the whole graph. */
  spotlight(group: number | null): void {
    this.spot = group;
    this.dropUnreachableFocus();
    this.draw();
  }

  /** Moves the view to frame one community. */
  flyToGroup(group: number): void {
    const c = this.centres().get(group);
    if (!c || !this.size.w) return;
    const k = Math.min(3, Math.max(this.view.k * 0.8, (Math.min(this.size.w, this.size.h) * 0.4) / Math.max(40, c.r)));
    this.moveCamera({ k, x: this.size.w / 2 - c.x * k, y: this.size.h / 2 - c.y * k });
  }

  setFilter(text: string): void {
    this.filter = text.trim().toLowerCase();
    this.dropUnreachableFocus();
    this.draw();
  }

  refreshTheme(): void {
    this.readPalette();
    this.draw();
  }

  destroy(): void {
    this.sim?.stop();
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
  }

  /** Places communities relative to each other first, then settles each note around its community. */
  private layout(): void {
    this.sim?.stop();
    this.sim = settleGraph(this.nodes, this.links, (d) => this.radius(d));
    this.inside.clear();
    this.between = [];
    for (const l of this.links) {
      const a = (l.source as GraphNode).group;
      const b = (l.target as GraphNode).group;
      if (a === b && a >= 0) {
        if (!this.inside.has(a)) this.inside.set(a, []);
        this.inside.get(a)!.push(l);
      } else this.between.push(l);
    }
  }

  /** Glides for the pointer. A key, a menu command or Reduce Motion puts the view straight there. */
  private moveCamera(to: Viewport): void {
    if (isPointerAction() && this.camera.start(this.view, to)) {
      this.wake();
      return;
    }
    this.camera.stop();
    this.view = to;
    this.draw();
  }

  private get settling(): boolean {
    return !!this.sim && this.sim.alpha() > this.sim.alphaMin();
  }

  /** One frame loop serves the camera, the settling layout and the hover pulses. */
  private wake(): void {
    if (!this.frame) this.frame = requestAnimationFrame((now) => this.step(now));
  }

  private step(now: number): void {
    this.frame = 0;
    const view = this.camera.advance(now);
    if (view) this.view = view;
    if (this.settling) this.sim!.tick();
    this.draw();
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

  private fit(): void {
    if (!this.nodes.length || !this.size.w) return;
    this.view = fitView(this.nodes, this.size);
  }

  /** Matches the canvas to its box, fitting the view the first time. Returns false when there is no box or it has not changed. */
  private measure(): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [Math.round(rect.width * dpr), Math.round(rect.height * dpr)];
    if (!w || !h || (this.size.w && w === this.canvas.width && h === this.canvas.height)) return false;
    const first = !this.size.w;
    this.size = { w: rect.width, h: rect.height };
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (first) this.fit();
    return true;
  }

  private resize(): void {
    if (this.measure()) this.draw();
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

  private centres(): Map<number, Centre> {
    const sum = new Map<number, { x: number; y: number; n: number; list: GraphNode[] }>();
    for (const d of this.nodes) {
      if (d.group < 0) continue;
      const s = sum.get(d.group) ?? { x: 0, y: 0, n: 0, list: [] };
      s.x += d.x!;
      s.y += d.y!;
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
        mean += Math.hypot(d.x! - x, d.y! - y);
        top = Math.min(top, d.y!);
        bottom = Math.max(bottom, d.y!);
      }
      out.set(g, { x, y, r: (mean / s.n) * 2.1 + 26, top, bottom });
    }
    return out;
  }

  /** Control points. Links between communities bend through both centres, which gathers them into threads. */
  private curve(l: GraphLink, centres: Map<number, Centre>): [number, number, number, number, number, number, number, number] {
    const s = l.source as GraphNode,
      t = l.target as GraphNode;
    const sx = s.x!,
      sy = s.y!,
      tx = t.x!,
      ty = t.y!;
    const a = centres.get(s.group),
      b = centres.get(t.group);
    if (s.group !== t.group && a && b)
      return [sx, sy, sx + (a.x - sx) * 0.62, sy + (a.y - sy) * 0.62, tx + (b.x - tx) * 0.62, ty + (b.y - ty) * 0.62, tx, ty];
    return arcControls(sx, sy, tx, ty);
  }

  private draw(): void {
    const { ctx, palette: p } = this;
    if (!this.size.w || !p) return;
    const blooming = this.bloom?.place(performance.now()) ?? false;
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

    this.drawEdges(k, dimmed, centres);
    if (focus) this.drawFocusEdges(focus, k, centres, light);
    this.drawGlows(lit, focus, light);
    this.drawDots(lit, focus, k);

    drawLabels(ctx, {
      palette: p,
      k,
      nodes: this.nodes,
      groups: this.groups,
      centres,
      focus,
      near,
      current: this.current,
      filtering: !!this.filter,
      spot: this.spot,
      lit,
      matches: (n) => this.matches(n),
      radius: (n) => this.drawRadius(n),
    });
    ctx.restore();
    ctx.globalAlpha = 1;
    this.bloom?.restore();
    if (this.bloom && !blooming) this.bloom = GraphBloom.on(this.canvas, null);

    if (blooming || this.camera.destination || this.settling || this.pulsing) this.wake();
  }

  private get pulsing(): boolean {
    return !!this.hover && !this.keyed && !reducedMotion();
  }

  private strokeLinks(list: GraphLink[], centres: Map<number, Centre>): void {
    const { ctx } = this;
    ctx.beginPath();
    for (const l of list) {
      const [ax, ay, bx, by, cx, cy, dx, dy] = this.curve(l, centres);
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(bx, by, cx, cy, dx, dy);
    }
    ctx.stroke();
  }

  private drawEdges(k: number, dimmed: boolean, centres: Map<number, Centre>): void {
    const { ctx, palette: p } = this;
    ctx.lineCap = "round";
    ctx.lineWidth = 0.8 / Math.max(k, 0.6);
    ctx.strokeStyle = p.edge;
    ctx.globalAlpha = (p.dark ? 0.1 : 0.16) * (dimmed ? 0.3 : 1);
    this.strokeLinks(this.between, centres);
    for (const [g, list] of this.inside) {
      ctx.strokeStyle = this.hue(g);
      ctx.globalAlpha = (p.dark ? 0.32 : 0.34) * (dimmed && this.spot !== g ? 0.18 : 1);
      this.strokeLinks(list, centres);
    }
  }

  private drawFocusEdges(focus: GraphNode, k: number, centres: Map<number, Centre>, light: GlobalCompositeOperation): void {
    const { ctx, palette: p } = this;
    const hot = this.links.filter((l) => l.source === focus || l.target === focus);
    ctx.lineWidth = 1.3 / Math.max(k, 0.6);
    ctx.globalAlpha = 0.85;
    for (const l of hot) {
      const other = l.source === focus ? (l.target as GraphNode) : (l.source as GraphNode);
      ctx.strokeStyle = other.group >= 0 ? this.hue(other.group) : p.accent;
      this.strokeLinks([l], centres);
    }
    if (!this.pulsing) return;
    const now = performance.now();
    ctx.globalCompositeOperation = light;
    ctx.globalAlpha = 0.8;
    hot.slice(0, 48).forEach((l, i) => {
      const [ax, ay, bx, by, cx, cy, dx, dy] = this.curve(l, centres);
      const t = (now / 1500 + i * 0.137) % 1;
      const u = 1 - t;
      const x = bezier(ax, bx, cx, dx, t, u);
      const y = bezier(ay, by, cy, dy, t, u);
      const R = 4.5 / Math.max(k, 0.7);
      ctx.drawImage(this.sprite(p.bright), x - R, y - R, R * 2, R * 2);
    });
  }

  private drawGlows(lit: (n: GraphNode) => boolean, focus: GraphNode | null, light: GlobalCompositeOperation): void {
    const { ctx, palette: p } = this;
    const degrees = this.nodes.map((n) => n.degree).sort((a, b) => b - a);
    const hub = Math.max(3, degrees[Math.floor(degrees.length * 0.06)] ?? Infinity);
    ctx.globalCompositeOperation = light;
    for (const n of this.nodes) {
      const special = n.id === this.current || n === focus;
      if (!special && n.degree < hub) continue;
      if (!lit(n)) continue;
      const R = this.drawRadius(n) * (special ? 6 : 4.5);
      ctx.globalAlpha = special ? (p.dark ? 0.75 : 0.5) : p.dark ? 0.4 : 0.26;
      ctx.drawImage(this.sprite(special ? p.accent : this.hue(n.group)), n.x! - R, n.y! - R, R * 2, R * 2);
    }
  }

  private drawDots(lit: (n: GraphNode) => boolean, focus: GraphNode | null, k: number): void {
    const { ctx, palette: p } = this;
    ctx.globalCompositeOperation = "source-over";
    for (const n of this.nodes) {
      const special = focus ? n === focus : n.id === this.current;
      ctx.globalAlpha = lit(n) ? 1 : 0.13;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, this.drawRadius(n) + (special ? 1 / Math.max(k, 1) : 0), 0, Math.PI * 2);
      ctx.fillStyle = special ? p.bright : this.hue(n.group);
      ctx.fill();
    }
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
    c.addEventListener("pointermove", (e) => this.onPointerMove(e));
    c.addEventListener("pointerleave", () => {
      if (!this.drag && !this.keyed) this.setHover(null);
    });
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    c.addEventListener("pointerup", (e) => this.release(e, true));
    c.addEventListener("pointercancel", (e) => this.release(e, false));
    c.addEventListener("lostpointercapture", (e) => this.release(e, false));
    c.addEventListener("keydown", (e) => this.onKey(e));
    c.addEventListener("blur", () => {
      if (this.keyed) this.setHover(null);
    });
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.camera.stop();
        this.bloom = GraphBloom.on(this.canvas, null);
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

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.drag) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.camera.stop();
    this.bloom = GraphBloom.on(this.canvas, null);
    this.sim?.alpha(0);
    const node = this.pick(e.clientX, e.clientY);
    const [x, y] = this.toWorld(e.clientX, e.clientY);
    this.drag = {
      pointerId: e.pointerId,
      node,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      vx: this.view.x,
      vy: this.view.y,
      grabX: node ? node.x! - x : 0,
      grabY: node ? node.y! - y : 0,
    };
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
    } else this.canvas.style.cursor = "grabbing";
    if (this.keyed) this.setHover(node);
  }

  private onPointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      this.setHover(this.pick(e.clientX, e.clientY));
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX,
      dy = e.clientY - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.node) this.holdNode(drag, drag.node, e);
    else {
      this.view.x = drag.vx + dx;
      this.view.y = drag.vy + dy;
    }
    this.draw();
  }

  /** The held note is placed here and drawn in this same event. The simulation only moves its neighbours. */
  private holdNode(drag: Drag, node: GraphNode, e: PointerEvent): void {
    const [x, y] = this.toWorld(e.clientX, e.clientY);
    node.x = node.fx = x + drag.grabX;
    node.y = node.fy = y + drag.grabY;
    if (drag.moved) this.canvas.style.cursor = "grabbing";
    if (!reducedMotion()) this.kick(0.25);
  }

  /** Ends the gesture. Only a real release can open the note; a cancelled one simply lets go. */
  private release(e: PointerEvent, released: boolean): void {
    const drag = this.drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this.drag = null;
    if (drag.node) {
      drag.node.fx = null;
      drag.node.fy = null;
    }
    if (!released) this.setHover(null);
    this.canvas.style.cursor = this.hover ? "pointer" : "grab";
    if (released && drag.node && !drag.moved) this.opts.onOpen(drag.node.id, e.metaKey);
  }

  private setHover(node: GraphNode | null): void {
    const wasKeyed = this.keyed;
    this.setKeyed(null);
    if (node === this.hover && !wasKeyed) return;
    this.hover = node;
    this.canvas.style.cursor = node ? "pointer" : "grab";
    this.draw();
  }

  private setKeyed(node: GraphNode | null, position = ""): void {
    this.keyed = !!node;
    this.announcer.textContent = node ? describeNote(node, this.groups, node.id === this.current, position) : "";
  }

  /** The notes the arrow keys can reach: those the highlight and the spotlight leave lit. */
  private reachable(): GraphNode[] {
    return this.nodes.filter((n) => this.matches(n) && (this.spot === null || n.group === this.spot));
  }

  private dropUnreachableFocus(): void {
    if (this.keyed && this.hover && !this.reachable().includes(this.hover)) this.setHover(null);
  }

  private onKey(e: KeyboardEvent): void {
    if (this.drag) return;
    if (e.key === "Enter" && this.hover) {
      e.preventDefault();
      e.stopPropagation();
      this.opts.onOpen(this.hover.id, e.metaKey);
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 0, End: 0 }[e.key];
    if (step === undefined || e.metaKey || e.altKey || e.ctrlKey) return;
    const list = traversalOrder(this.reachable());
    if (!list.length) return;
    e.preventDefault();
    const end = e.key === "Home" ? 0 : list.length - 1;
    this.focusNode(list, step ? nextIndex(list, this.hover, this.current, step) : end);
  }

  private focusNode(list: GraphNode[], index: number): void {
    const node = list[index];
    this.hover = node;
    this.setKeyed(node, `${(index + 1).toLocaleString()} of ${list.length.toLocaleString()}`);
    this.camera.stop();
    this.reveal(node);
    this.draw();
  }

  /** Brings a note hidden by the edges or the toolbars to the middle at once. */
  private reveal(node: GraphNode): void {
    const x = this.view.x + node.x! * this.view.k;
    const y = this.view.y + node.y! * this.view.k;
    const { w, h } = this.size;
    if (x >= SAFE.side && x <= w - SAFE.side && y >= SAFE.top && y <= h - SAFE.bottom) return;
    this.view.x = w / 2 - node.x! * this.view.k;
    this.view.y = SAFE.top + (h - SAFE.top - SAFE.bottom) / 2 - node.y! * this.view.k;
  }

  private kick(alpha: number): void {
    if (!this.sim) return;
    this.sim.alpha(Math.max(this.sim.alpha(), alpha));
    this.wake();
  }

  /** Quick presses add up, so each one builds on where the camera is going. */
  zoomBy(factor: number): void {
    const from = this.camera.destination ?? this.view;
    const k = Math.min(6, Math.max(0.12, from.k * factor));
    const mx = this.size.w / 2,
      my = this.size.h / 2;
    this.moveCamera({ k, x: mx - ((mx - from.x) * k) / from.k, y: my - ((my - from.y) * k) / from.k });
  }

  recenter(): void {
    if (this.nodes.length && this.size.w) this.moveCamera(fitView(this.nodes, this.size));
  }
}
