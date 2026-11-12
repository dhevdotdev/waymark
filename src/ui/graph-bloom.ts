import { parseCubicBezier } from "./cubic-bezier";
import { tokenEasing } from "./graph-camera";
import type { GraphLink, GraphNode } from "./graph-types";
import { isPointerAction } from "./input-origin";
import { reducedMotion } from "./media";

const DURATION_MS = 360;
const RING_STEP_MS = 40;
/** Rings past this leave together, so a sprawling vault blooms no slower than a note's own neighbourhood. */
const MAX_RING = 3;

let bloomedThisSession = false;

/** The first graph opened with the pointer in a session blooms. Later opens, keys and Reduce Motion show it settled. */
export function claimBloom(): boolean {
  if (bloomedThisSession || !isPointerAction() || reducedMotion()) return false;
  bloomedThisSession = true;
  return true;
}

/** How many links away from `origin` each note is. Notes it cannot reach count as one ring past the furthest. */
function rings(nodes: GraphNode[], links: GraphLink[], origin: GraphNode): Map<GraphNode, number> {
  const next = new Map<GraphNode, GraphNode[]>(nodes.map((n) => [n, []]));
  for (const l of links) {
    next.get(l.source as GraphNode)?.push(l.target as GraphNode);
    next.get(l.target as GraphNode)?.push(l.source as GraphNode);
  }
  const ring = new Map([[origin, 0]]);
  let frontier = [origin];
  for (let depth = 1; frontier.length && depth <= MAX_RING; depth++) {
    const found: GraphNode[] = [];
    for (const n of frontier)
      for (const m of next.get(n)!)
        if (!ring.has(m)) {
          ring.set(m, depth);
          found.push(m);
        }
    frontier = found;
  }
  const past = Math.min(MAX_RING, Math.max(...ring.values()) + 1);
  for (const n of nodes) if (!ring.has(n)) ring.set(n, past);
  return ring;
}

/**
 * Every note starts on the current one and travels out to its settled place, each ring of links a step behind the last.
 * The layout stays the truth: `place` moves the nodes only for one draw, and `restore` puts them back.
 */
export class GraphBloom {
  private start = 0;
  private homes: [GraphNode, number, number][] = [];
  private readonly ease = parseCubicBezier(tokenEasing("--ease-out")) ?? ((p: number) => p);

  private constructor(
    private readonly origin: GraphNode,
    private readonly ring: Map<GraphNode, number>,
  ) {}

  /** Marks `canvas` with how long `bloom` runs, as `data-bloom`, while one is running. Returns `bloom`. */
  static on(canvas: HTMLCanvasElement, bloom: GraphBloom | null): GraphBloom | null {
    if (bloom) canvas.dataset.bloom = String(bloom.totalMs);
    else delete canvas.dataset.bloom;
    return bloom;
  }

  static from(nodes: GraphNode[], links: GraphLink[], current: string | null): GraphBloom | null {
    const origin = nodes.find((n) => n.id === current);
    return origin && nodes.length > 1 ? new GraphBloom(origin, rings(nodes, links, origin)) : null;
  }

  /** The whole bloom, last ring included. */
  get totalMs(): number {
    return DURATION_MS + Math.max(...this.ring.values()) * RING_STEP_MS;
  }

  /** Puts each note where the bloom has it at `now`. Returns false once every note is home. The clock starts on the first draw. */
  place(now: number): boolean {
    if (!this.start) this.start = now;
    const elapsed = now - this.start;
    const ox = this.origin.x!;
    const oy = this.origin.y!;
    this.homes = [];
    let moving = false;
    for (const [n, ring] of this.ring) {
      const progress = Math.min(1, Math.max(0, (elapsed - ring * RING_STEP_MS) / DURATION_MS));
      if (progress >= 1) continue;
      moving = true;
      this.homes.push([n, n.x!, n.y!]);
      const t = this.ease(progress);
      n.x = ox + (n.x! - ox) * t;
      n.y = oy + (n.y! - oy) * t;
    }
    return moving;
  }

  restore(): void {
    for (const [n, x, y] of this.homes) {
      n.x = x;
      n.y = y;
    }
    this.homes = [];
  }
}
