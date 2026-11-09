export type GraphScope = "vault" | "local";

export type View = { kind: "note"; path: string } | { kind: "graph"; note: string; scope: GraphScope } | { kind: "blank" };

export interface TrailNode {
  id: number;
  view: View;
  parent: number | null;
  scroll: number;
  /** Side branches are folded away, leaving the main line and the way to the current note. */
  collapsed: boolean;
}

export interface SavedTrail {
  nodes: TrailNode[];
  root: number;
  current: number;
  /** Every stop in the order it was made, which is what Back and Forward walk. */
  visits: number[];
  position: number;
}

export interface Placement {
  id: number;
  parent: number | null;
  depth: number;
  row: number;
  /** Children on the map, counted whether or not they are folded away. */
  branches: number;
  collapsed: boolean;
}

const sameView = (a: View, b: View) => (a.kind === "note" && b.kind === "note" ? a.path === b.path : a.kind === b.kind);

function isView(value: unknown): value is View {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "note") return "path" in value && typeof value.path === "string";
  if (value.kind === "graph")
    return (
      "note" in value &&
      typeof value.note === "string" &&
      "scope" in value &&
      (value.scope === "vault" || value.scope === "local")
    );
  return false;
}

function isTrailNode(value: unknown): value is TrailNode {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "number" &&
    "view" in value &&
    isView(value.view) &&
    "parent" in value &&
    (value.parent === null || typeof value.parent === "number") &&
    "scroll" in value &&
    typeof value.scroll === "number"
  );
}

/**
 * The map of where one tab has been. Following a link grows a branch from the
 * current note; going elsewhere starts a new trail, and Back can still return
 * to the old one. A note appears once per trail, so a link to a note already
 * on the map simply moves there. Back and Forward retrace the stops actually
 * made, whatever shape the map has.
 */
export class Trail {
  private nodes = new Map<number, TrailNode>();
  private root: number;
  private cur: number;
  private nextId = 1;
  private visits: number[];
  private position = 0;
  private before: SavedTrail[] = [];
  private after: SavedTrail[] = [];

  constructor(view: View, scroll = 0) {
    this.root = this.cur = this.add(view, null, scroll).id;
    this.visits = [this.cur];
  }

  /** Rebuilds a saved trail, dropping anything no longer valid and everything below it. */
  static restore(value: unknown, exists: (view: View) => boolean): Trail | null {
    if (typeof value !== "object" || value === null) return null;
    if (!("nodes" in value) || !Array.isArray(value.nodes) || !("root" in value) || !("current" in value)) return null;
    const trail = new Trail({ kind: "note", path: "" });
    trail.nodes.clear();
    const saved = new Map<number, TrailNode>();
    for (const node of value.nodes) {
      if (isTrailNode(node) && exists(node.view)) saved.set(node.id, node);
    }
    /* Saved order is not guaranteed to put a parent first, so reachability is decided after every node is known. */
    const reachesRoot = (node: TrailNode): boolean => {
      const seen = new Set<number>();
      for (
        let at: TrailNode | undefined = node;
        at && !seen.has(at.id);
        at = at.parent === null ? undefined : saved.get(at.parent)
      ) {
        seen.add(at.id);
        if (at.parent === null) return at.id === value.root;
      }
      return false;
    };
    for (const node of saved.values()) {
      if (!reachesRoot(node)) continue;
      trail.nodes.set(node.id, {
        id: node.id,
        view: node.view,
        parent: node.parent,
        scroll: node.scroll,
        collapsed: "collapsed" in node && node.collapsed === true,
      });
      trail.nextId = Math.max(trail.nextId, node.id + 1);
    }
    if (typeof value.root !== "number" || !trail.nodes.has(value.root)) return null;
    trail.root = value.root;
    trail.cur = typeof value.current === "number" && trail.nodes.has(value.current) ? value.current : value.root;
    const visits =
      "visits" in value && Array.isArray(value.visits)
        ? value.visits.filter((v): v is number => typeof v === "number" && trail.nodes.has(v))
        : [];
    const position = "position" in value && typeof value.position === "number" ? value.position : -1;
    if (visits[position] === trail.cur) {
      trail.visits = visits;
      trail.position = position;
    } else {
      /* A trail saved without its stops retraces the route to where it was. */
      trail.visits = [...trail.routeToCurrent()].reverse();
      trail.position = trail.visits.length - 1;
    }
    return trail;
  }

  private add(view: View, parent: number | null, scroll = 0): TrailNode {
    const node: TrailNode = { id: this.nextId++, view, parent, scroll, collapsed: false };
    this.nodes.set(node.id, node);
    return node;
  }

  private find(view: View): TrailNode | undefined {
    return [...this.nodes.values()].find((n) => sameView(n.view, view));
  }

  private snapshot(): SavedTrail {
    return {
      nodes: [...this.nodes.values()].map((n) => ({ ...n })),
      root: this.root,
      current: this.cur,
      visits: [...this.visits],
      position: this.position,
    };
  }

  private load(saved: SavedTrail): void {
    this.nodes = new Map(saved.nodes.map((n) => [n.id, { ...n }]));
    this.root = saved.root;
    this.cur = saved.current;
    this.visits = [...saved.visits];
    this.position = saved.position;
    this.nextId = Math.max(...saved.nodes.map((n) => n.id)) + 1;
  }

  private visit(id: number): void {
    this.cur = id;
    if (this.visits[this.position] === id) return;
    this.visits.splice(this.position + 1);
    this.visits.push(id);
    this.position = this.visits.length - 1;
  }

  private startFresh(view: View, scroll = 0): void {
    this.nodes = new Map();
    this.root = this.cur = this.add(view, null, scroll).id;
    this.visits = [this.cur];
    this.position = 0;
  }

  get current(): TrailNode {
    return this.nodes.get(this.cur)!;
  }

  get size(): number {
    return this.nodes.size;
  }

  get canBack(): boolean {
    return this.position > 0 || this.before.length > 0;
  }

  get canForward(): boolean {
    return this.position < this.visits.length - 1 || this.after.length > 0;
  }

  /** Every view on the trail, newest first. */
  views(): View[] {
    return [...this.nodes.values()].reverse().map((n) => n.view);
  }

  /** A blank tab is only a place to start from, so the first view replaces it and leaves nothing to go back to. */
  private fillBlank(view: View): boolean {
    if (this.current.view.kind !== "blank") return false;
    this.startFresh(view);
    return true;
  }

  /** Follows a link from the current note. */
  follow(view: View): void {
    if (this.fillBlank(view)) return;
    const existing = this.find(view);
    this.visit(existing ? existing.id : this.add(view, this.cur).id);
    this.after = [];
  }

  /** Goes somewhere not linked from here: on this trail if it is already there, otherwise a new one. */
  jump(view: View): void {
    if (this.fillBlank(view)) return;
    const existing = this.find(view);
    if (existing) {
      this.visit(existing.id);
      return;
    }
    this.before.push(this.snapshot());
    this.startFresh(view);
    this.after = [];
  }

  select(id: number): void {
    if (this.nodes.has(id)) this.visit(id);
  }

  setCurrentView(view: View): void {
    this.current.view = view;
  }

  /** Follows a note to its new path, everywhere this tab remembers it. */
  replaceNote(from: string, to: string): void {
    const move = (node: TrailNode) => {
      if (node.view.kind === "note" && node.view.path === from) node.view = { kind: "note", path: to };
    };
    this.nodes.forEach(move);
    for (const saved of [...this.before, ...this.after]) saved.nodes.forEach(move);
  }

  back(): boolean {
    if (this.position > 0) {
      this.cur = this.visits[--this.position];
      return true;
    }
    const previous = this.before.pop();
    if (!previous) return false;
    this.after.push(this.snapshot());
    this.load(previous);
    return true;
  }

  forward(): boolean {
    if (this.position < this.visits.length - 1) {
      this.cur = this.visits[++this.position];
      return true;
    }
    const next = this.after.pop();
    if (!next) return false;
    this.before.push(this.snapshot());
    this.load(next);
    return true;
  }

  private childrenOf(id: number): TrailNode[] {
    return [...this.nodes.values()].filter((n) => n.parent === id);
  }

  toggleCollapsed(id: number): void {
    const node = this.nodes.get(id);
    if (node) node.collapsed = !node.collapsed;
  }

  /** Removes a note and everything reachable only through it. Removing the start resets the map to where the tab is now. */
  remove(id: number): void {
    if (id === this.root) {
      this.clear();
      return;
    }
    const node = this.nodes.get(id);
    if (!node) return;
    const doomed = new Set<number>();
    const collect = (n: number) => {
      doomed.add(n);
      this.childrenOf(n).forEach((c) => {
        collect(c.id);
      });
    };
    collect(id);
    const alive = (n: number) => !doomed.has(n);
    const earlier = this.visits.slice(0, this.position + 1).filter(alive);
    const later = this.visits.slice(this.position + 1).filter(alive);
    if (doomed.has(this.cur)) {
      this.cur = node.parent!;
      if (earlier.at(-1) !== this.cur) earlier.push(this.cur);
    }
    this.visits = [...earlier, ...later].filter((v, i, all) => v !== all[i - 1]);
    this.position = earlier.filter((v, i, all) => v !== all[i - 1]).length - 1;
    for (const n of doomed) this.nodes.delete(n);
  }

  /** Forgets the map and keeps only where the tab is now. */
  clear(): void {
    const { view, scroll } = this.current;
    this.startFresh(view, scroll);
  }

  /** Grid positions: the first child continues its parent's row, later children open new rows below. */
  layout(): Placement[] {
    const out: Placement[] = [];
    let lastRow = 0;
    const onRoute = this.pathToCurrent();
    const place = (node: TrailNode, depth: number, row: number) => {
      const children = this.childrenOf(node.id);
      out.push({ id: node.id, parent: node.parent, depth, row, branches: children.length, collapsed: node.collapsed });
      const shown = node.collapsed ? children.filter((c, i) => i === 0 || onRoute.has(c.id)) : children;
      shown.forEach((child, i) => {
        place(child, depth + 1, i === 0 ? row : ++lastRow);
      });
    };
    place(this.nodes.get(this.root)!, 0, 0);
    return out;
  }

  private routeToCurrent(): number[] {
    const route: number[] = [];
    for (let n: TrailNode | undefined = this.current; n; n = n.parent === null ? undefined : this.nodes.get(n.parent))
      route.push(n.id);
    return route;
  }

  /** Ids from the start of the trail to the current note. */
  pathToCurrent(): Set<number> {
    return new Set(this.routeToCurrent());
  }

  view(id: number): View | undefined {
    return this.nodes.get(id)?.view;
  }

  save(): SavedTrail {
    return this.snapshot();
  }
}
