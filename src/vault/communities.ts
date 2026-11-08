export interface Community {
  id: number;
  /** The best-connected note in the community. */
  top: string;
  size: number;
}

export interface CommunityResult {
  groupOf: Map<string, number>;
  communities: Community[];
}

/** Communities smaller than this are treated as unclustered, with group -1. */
const MIN_SIZE = 3;

type Adjacency = Map<number, number>[];

/** One round of Louvain local moves. Returns each node's community label. */
function localMoves(adj: Adjacency): number[] {
  const n = adj.length;
  const strength = adj.map((a, i) => {
    let sum = 0;
    for (const [j, w] of a) sum += j === i ? w * 2 : w;
    return sum;
  });
  const total = strength.reduce((a, b) => a + b, 0);
  const label = adj.map((_, i) => i);
  const tot = [...strength];
  if (total === 0) return label;
  for (let pass = 0, moved = true; moved && pass < 24; pass++) {
    moved = false;
    for (let i = 0; i < n; i++) {
      const weights = new Map<number, number>();
      for (const [j, w] of adj[i]) if (j !== i) weights.set(label[j], (weights.get(label[j]) ?? 0) + w);
      const from = label[i];
      tot[from] -= strength[i];
      let best = from;
      let bestGain = (weights.get(from) ?? 0) - (tot[from] * strength[i]) / total;
      for (const [c, w] of [...weights].sort((a, b) => a[0] - b[0])) {
        const gain = w - (tot[c] * strength[i]) / total;
        if (gain > bestGain + 1e-9) {
          bestGain = gain;
          best = c;
        }
      }
      tot[best] += strength[i];
      if (best !== from) {
        label[i] = best;
        moved = true;
      }
    }
  }
  return label;
}

/**
 * Finds groups of notes that link to each other more than to the rest, using
 * the Louvain method. The result depends only on the links and is the same on
 * every run for the same vault.
 */
export function detectCommunities(paths: string[], edges: [string, string][]): CommunityResult {
  const sorted = [...paths].sort();
  const index = new Map(sorted.map((p, i) => [p, i]));
  let adj: Adjacency = sorted.map(() => new Map());
  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    const i = index.get(a), j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    adj[i].set(j, (adj[i].get(j) ?? 0) + 1);
    adj[j].set(i, (adj[j].get(i) ?? 0) + 1);
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  let membership = sorted.map((_, i) => i);
  for (let level = 0; level < 12; level++) {
    const label = localMoves(adj);
    const renumber = new Map<number, number>();
    for (const l of label) if (!renumber.has(l)) renumber.set(l, renumber.size);
    if (renumber.size === adj.length) break;
    membership = membership.map((m) => renumber.get(label[m])!);
    const next: Adjacency = Array.from({ length: renumber.size }, () => new Map());
    adj.forEach((a, i) => {
      const ci = renumber.get(label[i])!;
      for (const [j, w] of a) {
        const cj = renumber.get(label[j])!;
        next[ci].set(cj, (next[ci].get(cj) ?? 0) + (i === j ? w : ci === cj ? w / 2 : w));
      }
    });
    adj = next;
  }

  const members = new Map<number, string[]>();
  sorted.forEach((p, i) => {
    if (!members.has(membership[i])) members.set(membership[i], []);
    members.get(membership[i])!.push(p);
  });
  const large = [...members.values()]
    .filter((m) => m.length >= MIN_SIZE)
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  const groupOf = new Map(sorted.map((p) => [p, -1]));
  const communities = large.map((m, id) => {
    for (const p of m) groupOf.set(p, id);
    const top = [...m].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b))[0];
    return { id, top, size: m.length };
  });
  return { groupOf, communities };
}
