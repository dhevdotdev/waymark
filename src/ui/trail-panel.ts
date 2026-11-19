import type { Placement } from "../vault/trail";
import { icons } from "./icons";
import { isPointerAction } from "./input-origin";
import { arrive, glide, type Place, placesOf, timing } from "./list-motion";
import { reducedMotion } from "./media";

export interface TrailEntry extends Placement {
  label: string;
}

export interface TrailPanelActions {
  select: (id: number, newTab: boolean) => void;
  remove: (id: number) => void;
  toggle: (id: number) => void;
  leave: () => void;
}

const ROW = 28;
const STEP = 14;
const FIRST_COLUMN = 15;
const DEEPEST_STEP = 3;
const CHEVRON_CLEARANCE = 9;
const ELBOW = 5;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Each row's place among the rows that share its parent, as [position, count], from the rows' levels in order. */
export function siblingPlaces(levels: readonly number[]): [number, number][] {
  const groups: number[][] = [];
  const open: number[] = [];
  const placed = levels.map((level, i) => {
    open.length = Math.min(open.length, level + 1);
    open[level] ??= groups.push([]) - 1;
    const group = groups[open[level]];
    group.push(i);
    return { group, position: group.length };
  });
  return placed.map(({ group, position }) => [position, group.length]);
}

const columnOf = (level: number) => FIRST_COLUMN + Math.min(level, DEEPEST_STEP) * STEP;
const middleOf = (index: number) => index * ROW + ROW / 2;
const levelOf = (row: HTMLElement | undefined) => Number(row?.getAttribute("aria-level") ?? 0);

/** One tab's trail as a list: the current stop marked, side branches stepped in under the stop they left from. */
export class TrailPanel {
  readonly root = document.createElement("div");
  private readonly lines = document.createElementNS(SVG_NS, "svg");
  private readonly marker = document.createElement("div");
  private readonly rows = new Map<number, HTMLElement>();
  private tabId = -1;
  private current = -1;

  constructor(private readonly on: TrailPanelActions) {
    this.root.className = "trail";
    this.root.setAttribute("role", "tree");
    this.root.setAttribute("aria-label", "Notes followed in this tab");
    this.lines.classList.add("trail-lines");
    this.lines.setAttribute("aria-hidden", "true");
    this.marker.className = "trail-here";
    this.root.append(this.marker, this.lines);
    this.root.addEventListener("click", (e) => this.onClick(e));
    this.root.addEventListener("keydown", (e) => this.onKey(e));
    this.root.addEventListener("focusin", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".trail-row");
      if (row) this.makeTabStop(row);
    });
  }

  render(tabId: number, entries: TrailEntry[], current: number, onPath: Set<number>): void {
    const sameTab = tabId === this.tabId;
    if (!sameTab) {
      for (const row of this.rows.values()) row.remove();
      this.rows.clear();
      this.tabId = tabId;
    }
    const was = placesOf(this.rows, this.root);
    const focused = this.focusedIndex();
    const movedOn = !sameTab || current !== this.current;
    const shape = entries.map((e) => e.id).join();
    const reshaped =
      sameTab && shape !== [...this.root.querySelectorAll<HTMLElement>(".trail-row")].map((r) => r.dataset.trail).join();
    this.current = current;

    this.placeRows(entries, current, onPath);
    this.drawLines(entries, onPath);
    this.marker.classList.toggle("is-instant", !sameTab);
    this.marker.style.transform = `translateY(${
      Math.max(
        0,
        entries.findIndex((e) => e.id === current),
      ) * ROW
    }px)`;
    this.restoreFocus(focused, entries);
    if (!this.root.querySelector('.trail-row[tabindex="0"]')) this.makeTabStop(this.rows.get(current));
    if (movedOn) this.reveal();
    if (reshaped && isPointerAction()) this.settle(entries, was);
  }

  /** Keeps every row's element, so its colours and chevron transition, and moves only the ones out of place. */
  private placeRows(entries: TrailEntry[], current: number, onPath: Set<number>): void {
    const wanted = new Set(entries.map((e) => e.id));
    for (const [id, row] of this.rows) {
      if (wanted.has(id)) continue;
      row.remove();
      this.rows.delete(id);
    }
    let next = this.lines.nextElementSibling;
    const places = siblingPlaces(entries.map((e) => e.level));
    for (const [i, entry] of entries.entries()) {
      const row = this.rows.get(entry.id) ?? this.createRow(entry.id);
      this.updateRow(row, entry, current, onPath);
      row.setAttribute("aria-posinset", String(places[i][0]));
      row.setAttribute("aria-setsize", String(places[i][1]));
      if (row === next) next = next.nextElementSibling;
      else this.root.insertBefore(row, next);
    }
  }

  private createRow(id: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "trail-row";
    row.setAttribute("role", "treeitem");
    row.tabIndex = -1;
    row.dataset.trail = String(id);
    const dot = document.createElement("i");
    dot.className = "trail-dot";
    const fold = document.createElement("button");
    fold.type = "button";
    fold.className = "trail-fold";
    fold.tabIndex = -1;
    fold.dataset.trailFold = String(id);
    fold.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>`;
    const name = document.createElement("span");
    name.className = "trail-name";
    const count = document.createElement("span");
    count.className = "trail-count";
    const x = document.createElement("button");
    x.type = "button";
    x.className = "trail-x";
    x.tabIndex = -1;
    x.dataset.trailRemove = String(id);
    x.innerHTML = icons.close;
    row.append(dot, fold, name, count, x);
    this.rows.set(id, row);
    return row;
  }

  private updateRow(row: HTMLElement, entry: TrailEntry, current: number, onPath: Set<number>): void {
    const isCurrent = entry.id === current;
    const canFold = entry.branches >= 2;
    row.style.setProperty("--x", `${columnOf(entry.level)}px`);
    row.classList.toggle("is-current", isCurrent);
    row.classList.toggle("is-on-path", onPath.has(entry.id));
    row.setAttribute("aria-level", String(entry.level + 1));
    row.dataset.tip = entry.label;
    if (isCurrent) row.setAttribute("aria-current", "page");
    else row.removeAttribute("aria-current");
    if (canFold) row.setAttribute("aria-expanded", String(!entry.collapsed));
    else row.removeAttribute("aria-expanded");
    row.querySelector<HTMLElement>(".trail-name")!.textContent = entry.label;
    row.querySelector<HTMLElement>(".trail-dot")!.hidden = canFold;
    row.querySelector<HTMLElement>(".trail-count")!.textContent = entry.folded ? `+${entry.folded}` : "";
    const fold = row.querySelector<HTMLElement>(".trail-fold")!;
    fold.hidden = !canFold;
    fold.classList.toggle("is-folded", entry.collapsed);
    fold.setAttribute("aria-label", `${entry.collapsed ? "Show" : "Fold"} the branches from ${entry.label}`);
    const x = row.querySelector<HTMLElement>(".trail-x")!;
    x.setAttribute("aria-label", `Remove ${entry.label} from the trail`);
  }

  private drawLines(entries: TrailEntry[], onPath: Set<number>): void {
    const index = new Map(entries.map((e, i) => [e.id, i]));
    const byId = new Map(entries.map((e) => [e.id, e]));
    const height = entries.length * ROW;
    this.lines.setAttribute("width", String(columnOf(DEEPEST_STEP) + STEP));
    this.lines.setAttribute("height", String(height));
    const paths = entries
      .filter((e) => e.parent !== null && byId.has(e.parent))
      .sort((a, b) => Number(onPath.has(a.id)) - Number(onPath.has(b.id)))
      .map((entry) => {
        const parent = byId.get(entry.parent!)!;
        const fromX = columnOf(parent.level);
        const toX = columnOf(entry.level);
        const fromY = middleOf(index.get(parent.id)!) + (parent.branches >= 2 ? CHEVRON_CLEARANCE : 0);
        const toY = middleOf(index.get(entry.id)!);
        const line = document.createElementNS(SVG_NS, "path");
        const clear = entry.branches >= 2 ? CHEVRON_CLEARANCE : 0;
        line.setAttribute(
          "d",
          fromX === toX
            ? `M${fromX} ${fromY}V${toY - clear}`
            : `M${fromX} ${fromY}V${toY - ELBOW}Q${fromX} ${toY} ${fromX + ELBOW} ${toY}H${toX - clear}`,
        );
        line.classList.toggle("is-on-path", onPath.has(entry.id));
        return line;
      });
    this.lines.replaceChildren(...paths);
  }

  /** Rows glide from where they were. The lines cannot, so they fade back in at their new places. */
  private settle(entries: TrailEntry[], was: Map<number, Place>): void {
    const fade = timing("--t-press", "--ease-out");
    for (const entry of entries) if (!was.has(entry.id)) arrive(this.rows.get(entry.id)!, fade);
    if (!reducedMotion()) glide(this.rows, was, this.root, timing("--t-press", "--ease-in-out"));
    for (const animation of this.lines.getAnimations()) animation.cancel();
    this.lines.animate({ opacity: [0, 1] }, fade);
  }

  /** Scrolls the panel just enough to show the current stop. */
  reveal(): void {
    const row = this.rows.get(this.current);
    const body = this.root.closest<HTMLElement>(".rail-trail");
    if (!row || !body || !row.offsetParent) return;
    const room = ROW / 2;
    const bounds = body.getBoundingClientRect();
    const place = row.getBoundingClientRect();
    if (place.top < bounds.top + room) body.scrollTop -= bounds.top + room - place.top;
    else if (place.bottom > bounds.bottom - room) body.scrollTop += place.bottom - bounds.bottom + room;
  }

  focusCurrent(): void {
    this.rows.get(this.current)?.focus({ preventScroll: true });
    this.reveal();
  }

  private makeTabStop(row: HTMLElement | undefined): void {
    if (!row) return;
    for (const other of this.rows.values()) other.tabIndex = other === row ? 0 : -1;
  }

  private ordered(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>(".trail-row")];
  }

  private focusedIndex(): number {
    const row = document.activeElement?.closest<HTMLElement>(".trail-row");
    return row && this.root.contains(row) ? this.ordered().indexOf(row) : -1;
  }

  /** A removed row hands focus to the row now in its place. */
  private restoreFocus(index: number, entries: TrailEntry[]): void {
    if (index < 0 || this.focusedIndex() >= 0) return;
    const entry = entries[Math.min(index, entries.length - 1)];
    if (entry) this.rows.get(entry.id)?.focus({ preventScroll: false });
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const remove = target.closest<HTMLElement>("[data-trail-remove]");
    if (remove) {
      this.on.remove(Number(remove.dataset.trailRemove));
      return;
    }
    const fold = target.closest<HTMLElement>("[data-trail-fold]");
    if (fold) {
      this.on.toggle(Number(fold.dataset.trailFold));
      return;
    }
    const row = target.closest<HTMLElement>(".trail-row");
    if (row) this.on.select(Number(row.dataset.trail), e.metaKey);
  }

  private onKey(e: KeyboardEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".trail-row");
    if (!row) return;
    const id = Number(row.dataset.trail);
    const rows = this.ordered();
    const at = rows.indexOf(row);
    const expanded = row.getAttribute("aria-expanded");
    const moveTo = (i: number) => {
      if (i >= 0) rows[Math.min(i, rows.length - 1)].focus();
    };
    const actions: Record<string, () => void> = {
      ArrowDown: () => moveTo(at + 1),
      ArrowUp: () => moveTo(at - 1),
      Home: () => moveTo(0),
      End: () => moveTo(rows.length - 1),
      ArrowRight: () => {
        if (expanded === "false") this.on.toggle(id);
        else if (expanded === "true" && levelOf(rows[at + 1]) > levelOf(row)) moveTo(at + 1);
      },
      ArrowLeft: () => {
        if (expanded === "true") this.on.toggle(id);
        else moveTo(rows.findLastIndex((r, i) => i < at && levelOf(r) < levelOf(row)));
      },
      Enter: () => this.on.select(id, e.metaKey),
      Delete: () => this.on.remove(id),
      Backspace: () => this.on.remove(id),
    };
    if (e.key === "Escape") {
      this.on.leave();
      return;
    }
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  }
}
