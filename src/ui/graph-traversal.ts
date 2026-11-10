import { plural } from "./plural";

interface Placed {
  group: number;
  x?: number;
  y?: number;
}

/**
 * The order arrow keys walk the notes: communities largest first, as the chips list them,
 * loose notes last, and each community clockwise around its centre so the focus moves to
 * something nearby instead of jumping across the cluster.
 */
export function traversalOrder<T extends Placed>(nodes: T[]): T[] {
  const groups = new Map<number, T[]>();
  for (const n of nodes) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  const ordered = [...groups].sort(([a, listA], [b, listB]) => {
    if (a < 0 || b < 0) return b - a;
    return listB.length - listA.length || a - b;
  });
  return ordered.flatMap(([, list]) => {
    const cx = list.reduce((sum, n) => sum + n.x!, 0) / list.length;
    const cy = list.reduce((sum, n) => sum + n.y!, 0) / list.length;
    return [...list].sort((a, b) => Math.atan2(a.y! - cy, a.x! - cx) - Math.atan2(b.y! - cy, b.x! - cx));
  });
}

/** Where the arrow keys go next. The first press starts from the open note. */
export function nextIndex<T extends { id: string }>(list: T[], from: T | null, current: string | null, step: number): number {
  const at = from ? list.indexOf(from) : -1;
  if (at >= 0) return (at + step + list.length) % list.length;
  const open = list.findIndex((n) => n.id === current);
  return open >= 0 ? open : step > 0 ? 0 : list.length - 1;
}

/** What a screen reader hears for a focused note. */
export function describeNote(
  node: { label: string; degree: number; group: number },
  groups: { id: number; label: string }[],
  isOpen: boolean,
  position: string,
): string {
  const group = groups.find((g) => g.id === node.group);
  return [
    node.label,
    isOpen ? "the open note" : null,
    group ? `in the community of ${group.label}` : "in no community",
    plural(node.degree, "link"),
    position,
  ]
    .filter(Boolean)
    .join(", ");
}
