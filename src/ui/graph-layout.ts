import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphLink, GraphNode } from "./graph";

const NODE_TICKS = 220;
const GROUP_TICKS = 240;
const DENSE_NODES = 120;
const MAX_CACHED_LAYOUTS = 12;

/** Finished layouts, so reopening the graph is immediate and notes stay where you left them. */
const layouts = new Map<string, Map<string, [number, number]>>();

function signature(nodes: GraphNode[], links: GraphLink[]): string {
  let hash = 0;
  for (const n of nodes) for (let i = 0; i < n.id.length; i++) hash = (hash * 31 + n.id.charCodeAt(i)) | 0;
  return `${nodes.length}:${links.length}:${hash}`;
}

/** Places whole communities first, by how strongly they link to each other. */
function placeGroups(nodes: GraphNode[], links: GraphLink[]): Map<number, { x: number; y: number }> {
  type Meta = SimulationNodeDatum & { id: number; r: number };
  const counts = new Map<number, number>();
  for (const n of nodes) if (n.group >= 0) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
  const metas: Meta[] = [...counts].map(([id, size]) => ({ id, r: 16 * Math.sqrt(size) }));
  const present = new Set(metas.map((m) => m.id));
  const weight = new Map<string, { source: number; target: number; w: number }>();
  const group = new Map(nodes.map((n) => [n.id, n.group]));
  for (const l of links) {
    const a = group.get(l.source as string)!;
    const b = group.get(l.target as string)!;
    if (a === b || !present.has(a) || !present.has(b)) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const edge = weight.get(key) ?? { source: Math.min(a, b), target: Math.max(a, b), w: 0 };
    edge.w++;
    weight.set(key, edge);
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
  for (let i = 0; i < GROUP_TICKS; i++) sim.tick();
  return new Map(metas.map((m) => [m.id, { x: m.x!, y: m.y! }]));
}

const sameGroup = (l: GraphLink) => (l.source as GraphNode).group === (l.target as GraphNode).group;

/** Settles notes around their community's place and returns the stopped simulation, ready for dragging. */
export function settleGraph(
  nodes: GraphNode[],
  links: GraphLink[],
  radius: (node: GraphNode) => number,
): Simulation<GraphNode, GraphLink> {
  const anchors = placeGroups(nodes, links);
  const dense = nodes.length > DENSE_NODES;
  const sim = forceSimulation<GraphNode, GraphLink>(nodes)
    .force(
      "link",
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((l) => (sameGroup(l) ? (dense ? 24 : 42) : dense ? 120 : 90))
        .strength((l) => (sameGroup(l) && (l.source as GraphNode).group >= 0 ? 0.32 : 0.012)),
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
      forceCollide<GraphNode>((d) => radius(d) + 2.5),
    )
    .alphaDecay(0.028)
    .stop();

  const key = signature(nodes, links);
  const known = layouts.get(key);
  if (known) {
    for (const d of nodes) [d.x, d.y] = known.get(d.id) ?? [0, 0];
  } else {
    for (let i = 0; i < NODE_TICKS; i++) sim.tick();
    layouts.set(key, new Map(nodes.map((d) => [d.id, [d.x!, d.y!]])));
    if (layouts.size > MAX_CACHED_LAYOUTS) layouts.delete(layouts.keys().next().value!);
  }
  sim.alpha(0);
  return sim;
}
