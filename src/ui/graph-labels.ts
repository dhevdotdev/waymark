import type { Centre, GraphGroup, GraphNode, Palette } from "./graph-types";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface LabelScene {
  palette: Palette;
  k: number;
  nodes: GraphNode[];
  groups: GraphGroup[];
  centres: Map<number, Centre>;
  focus: GraphNode | null;
  near: Set<string> | null;
  current: string | null;
  filtering: boolean;
  spot: number | null;
  lit: (n: GraphNode) => boolean;
  matches: (n: GraphNode) => boolean;
  radius: (n: GraphNode) => number;
}

/** Community names when zoomed out, note names when zoomed in, placed greedily by importance so none overlap. */
export function drawLabels(ctx: CanvasRenderingContext2D, scene: LabelScene): void {
  const { palette: p, k, nodes, groups, centres, focus, near, filtering, spot, lit, matches, radius } = scene;
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
  const dots = nodes.map((n) => {
    const r = radius(n);
    return { n, box: [n.x! - r, n.y! - r, n.x! + r, n.y! + r] as Box };
  });
  const labelNote = (n: GraphNode, forced: boolean, alpha: number) => {
    const label = n.label.length > 42 ? `${n.label.slice(0, 40)}…` : n.label;
    const w = ctx.measureText(label).width;
    const r = radius(n);
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
    halo(label, spot[0], spot[1], forced && (!focus || n === focus) ? p.bright : p.label, alpha);
  };
  ctx.font = `500 ${fontPx}px ${p.font}`;
  const openNote = nodes.find((n) => n.id === scene.current);
  if (openNote && lit(openNote) && openNote !== focus) labelNote(openNote, true, 1);

  /* Zoomed out, each community is named just outside its cluster; zooming in hands over to individual notes. */
  const groupAlpha = focus || filtering ? 0 : spot !== null ? 1 : clamp01((2.2 - k) / 0.4);
  if (groupAlpha > 0) {
    const size = 12.5 / k;
    const view = ctx.getTransform();
    const edgeLeft = -view.e / view.a;
    const edgeRight = (ctx.canvas.width - view.e) / view.a;
    ctx.font = `600 ${size}px ${p.font}`;
    for (const g of groups) {
      const c = centres.get(g.id);
      if (!c || g.size < 5 || (spot !== null && spot !== g.id)) continue;
      const text = g.label.length > 30 ? `${g.label.slice(0, 28)}…` : g.label;
      const w = ctx.measureText(text).width;
      const gap = 8 / k;
      const choices = [c.top - gap - size, c.bottom + gap];
      const x = Math.min(Math.max(c.x, edgeLeft + w / 2 + pad), edgeRight - w / 2 - pad);
      const boxFor = (y: number): Box => [x - w / 2 - pad, y - pad, x + w / 2 + pad, y + size + pad];
      const y = choices.find((v) => !placed.some((b) => hits(boxFor(v), b)));
      if (y === undefined) continue;
      placed.push(boxFor(y));
      halo(text, x, y, p.label, groupAlpha);
    }
  }

  ctx.font = `500 ${fontPx}px ${p.font}`;
  const reveal = (n: GraphNode) => clamp01((k - (2.1 - Math.min(1, n.degree / 22) * 0.6)) / 0.3);
  const candidates = nodes.filter((n) => {
    if (!lit(n)) return false;
    if (n === openNote && n !== focus) return false;
    if (n === focus || near?.has(n.id) || (filtering && matches(n))) return true;
    return reveal(n) > 0;
  });
  const rank = (n: GraphNode) => (n === focus ? 1e6 : 0) + n.degree;
  candidates.sort((a, b) => rank(b) - rank(a));
  for (const n of candidates) labelNote(n, n === focus, n === focus || near?.has(n.id) || filtering ? 1 : reveal(n) * 0.9);
}
