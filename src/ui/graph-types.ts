import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

export interface Palette {
  loose: string;
  bright: string;
  edge: string;
  accent: string;
  label: string;
  labelBg: string;
  font: string;
  dark: boolean;
}

export interface Centre {
  x: number;
  y: number;
  r: number;
  top: number;
  bottom: number;
}

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  label: string;
  degree: number;
  group: number;
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
