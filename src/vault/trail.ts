export type GraphScope = "vault" | "local";

export type View =
  | { kind: "note"; path: string }
  | { kind: "base"; path: string }
  | { kind: "graph"; note: string; scope: GraphScope }
  | { kind: "blank" };

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
  /** How far the stop is stepped in: the main line stays level and each side branch moves one step in. */
  level: number;
  /** Children on the trail, counted whether or not they are folded away. */
  branches: number;
  collapsed: boolean;
  /** Stops out of sight because this one is folded. */
  folded: number;
}

const sameView = (a: View, b: View) =>
  (a.kind === "note" && b.kind === "note") || (a.kind === "base" && b.kind === "base") ? a.path === b.path : a.kind === b.kind;

function isView(value: unknown): value is View {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "note" || value.kind === "base") return "path" in value && typeof value.path === "string";
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

  /** How many stops sit at or below a node. */
  private stopsFrom(id: number): number {
    return this.childrenOf(id).reduce((sum, child) => sum + this.stopsFrom(child.id), 1);
  }

  /**
   * Takes one stop off the trail. Its children move up to take its place, so
   * nothing else is lost, and the first child takes over when the start goes.
   * Removing the stop the tab is on steps the tab back to the one before it.
   */
  remove(id: number): void {
    const node = this.nodes.get(id);
    if (!node || this.nodes.size < 2) return;
    const children = this.childrenOf(id);
    const heir = node.parent === null ? children[0] : undefined;
    if (heir) {
      heir.parent = null;
      this.root = heir.id;
    }
    for (const child of children) if (child !== heir) child.parent = heir ? heir.id : node.parent;
    if (id === this.cur) this.cur = node.parent ?? heir!.id;
    const moved = new Set(children);
    const order = [...this.nodes.values()].flatMap((n) => (n === node ? children : moved.has(n) ? [] : [n]));
    this.nodes = new Map(order.map((n) => [n.id, n]));
    const steps = (visits: number[]) => visits.filter((v) => v !== id).filter((v, i, all) => v !== all[i - 1]);
    const earlier = steps(this.visits.slice(0, this.position + 1));
    if (earlier.at(-1) !== this.cur) earlier.push(this.cur);
    this.visits = steps([...earlier, ...this.visits.slice(this.position + 1)]);
    this.position = earlier.length - 1;
  }

  /** Puts the trail back as it was when `saved` was taken. */
  revert(saved: SavedTrail): void {
    this.load(saved);
  }

  /**
   * The trail as a list, top to bottom. A stop's side branches sit directly
   * under it, stepped in, and the main line carries on level after them.
   * Folding keeps the way to the current note, or the main line when the
   * current note is elsewhere.
   */
  layout(): Placement[] {
    const out: Placement[] = [];
    const onRoute = this.pathToCurrent();
    const place = (node: TrailNode, level: number) => {
      const children = this.childrenOf(node.id);
      const kept = children.find((c) => onRoute.has(c.id)) ?? children[0];
      const shown = node.collapsed ? children.filter((c) => c === kept) : children;
      const folded = children.filter((c) => !shown.includes(c)).reduce((sum, c) => sum + this.stopsFrom(c.id), 0);
      out.push({ id: node.id, parent: node.parent, level, branches: children.length, collapsed: node.collapsed, folded });
      const [main, ...sides] = children.filter((c) => shown.includes(c));
      const mainLine = children[0] === main ? main : undefined;
      for (const side of mainLine ? sides : [main, ...sides]) if (side) place(side, level + 1);
      if (mainLine) place(mainLine, level);
    };
    place(this.nodes.get(this.root)!, 0);
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
