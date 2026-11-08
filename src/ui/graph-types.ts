import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

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

export type GraphLink = SimulationLinkDatum<GraphNode> & { source: GraphNode | string; target: GraphNode | string };

export interface GraphData {
  nodes: GraphNode[];
  links: { source: string; target: string }[];
  groups: GraphGroup[];
}
