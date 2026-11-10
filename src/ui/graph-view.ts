import type { VaultStore } from "../vault/store";
import type { GraphScope, View } from "../vault/trail";
import { GraphCanvas } from "./graph";
import { tokenEasing, tokenMs } from "./graph-camera";
import { groupColor } from "./graph-paint";
import type { GraphData } from "./graph-types";
import { icons } from "./icons";
import { isPointerAction } from "./input-origin";
import { MorphArrows } from "./morph-arrows";
import { plural } from "./plural";

export type GraphTabView = Extract<View, { kind: "graph" }>;

const ZOOM_STEP = 1.3;

const TEMPLATE = `
  <div class="graph-stage"></div>
  <div class="graph-toolbar">
    <div class="seg" role="tablist"><button class="seg-btn" data-gmode="local">This note</button><button class="seg-btn" data-gmode="vault">Whole vault</button></div>
    <div class="graph-depth" role="group" aria-label="Link depth"><div class="seg"><button class="seg-btn" data-depth="1">1 step</button><button class="seg-btn" data-depth="2">2 steps</button><button class="seg-btn" data-depth="3">3 steps</button></div></div>
    <span class="graph-stats"></span>
    <div class="graph-filter">${icons.search}<input type="text" placeholder="Highlight notes" aria-label="Highlight notes by name" spellcheck="false" /></div>
    <div class="graph-zoom"><button class="icon-btn" data-gz="out" aria-label="Zoom out">${icons.minus}</button><button class="icon-btn" data-gz="fit" aria-label="Fit to view">${icons.fit}</button><button class="icon-btn" data-gz="in" aria-label="Zoom in">${icons.plus}</button></div>
    <button class="icon-btn graph-leave" data-gleave data-tip="Back to the note" data-key="esc" aria-label="Back to the note"></button>
  </div>
  <div class="graph-foot"><div class="graph-groups"></div></div>`;

export interface GraphViewHost {
  open: (path: string, newTab: boolean) => void;
  /** The graph view of the active tab, if it is showing one. */
  currentView: () => GraphTabView | null;
  setScope: (scope: GraphScope) => void;
  leave: () => void;
}

function graphData(vault: VaultStore, paths: Set<string> | null): GraphData {
  const { index, links, texts } = vault;
  const nodes = (paths ? [...paths] : index.notes).filter((p) => texts.has(p));
  const included = new Set(nodes);
  const edges: GraphData["links"] = [];
  for (const p of nodes) for (const t of links.out.get(p) ?? []) if (included.has(t)) edges.push({ source: p, target: t });
  const { groupOf, communities } = vault.communities();
  return {
    nodes: nodes.map((p) => ({ id: p, label: index.title(p), degree: links.degree(p), group: groupOf.get(p) ?? -1 })),
    links: edges,
    groups: communities
      .map((c) => ({ id: c.id, label: index.title(c.top), size: nodes.filter((p) => groupOf.get(p) === c.id).length }))
      .filter((g) => g.size > 0),
  };
}

/** The graph tab: the canvas with its toolbar and community strip. */
export class GraphView {
  private readonly root = document.createElement("div");
  private readonly canvas: GraphCanvas;
  private readonly strip: HTMLElement;
  private depth = 2;
  private spotlit: number | null = null;
  private shown = "";
  private arrived = false;
  private readonly leaveArrows = new MorphArrows("apart");

  constructor(
    parent: HTMLElement,
    private readonly vault: VaultStore,
    private readonly host: GraphViewHost,
  ) {
    this.root.className = "graph-view";
    this.root.innerHTML = TEMPLATE;
    this.canvas = new GraphCanvas({ onOpen: (id, newTab) => host.open(id, newTab) });
    this.root.querySelector(".graph-stage")!.append(this.canvas.canvas, this.canvas.announcer);
    this.strip = this.root.querySelector<HTMLElement>(".graph-groups")!;
    parent.append(this.root);
    this.root.querySelector(".graph-leave")!.append(this.leaveArrows.svg);
    this.leaveArrows.to("together");
    this.bind();
  }

  /** Takes the keyboard unless `keepFocus`. Only a graph just opened with the pointer fades in; a tab switch, Back or a shortcut shows it at once. */
  arrive(opened: boolean, keepFocus = false): void {
    const take = !keepFocus && (!this.arrived || document.activeElement === document.body);
    if (take) this.canvas.canvas.focus({ preventScroll: true });
    this.arrived = true;
    if (!opened || !isPointerAction()) return;
    this.root.animate({ opacity: [0, 1] }, { duration: tokenMs("--t-exit"), easing: tokenEasing("--ease-out") });
  }

  refreshTheme(): void {
    this.canvas.refreshTheme();
  }

  destroy(): void {
    this.leaveArrows.stop();
    this.canvas.destroy();
    this.root.remove();
  }

  show(note: string, scope: GraphScope): void {
    const data = graphData(this.vault, scope === "local" ? this.vault.links.neighbourhood(note, this.depth) : null);
    /* The same graph shown again is the vault changing underneath: the reader's place in it stays. */
    const shown = `${note}\0${scope}\0${this.depth}`;
    const refreshing = shown === this.shown;
    this.shown = shown;
    this.spotlit = refreshing && data.groups.some((g) => g.id === this.spotlit) ? this.spotlit : null;
    this.canvas.setData(data, note, refreshing ? this.spotlit : undefined);
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-gmode]"))
      b.classList.toggle("is-on", b.dataset.gmode === scope);
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-depth]"))
      b.classList.toggle("is-on", Number(b.dataset.depth) === this.depth);
    this.root.querySelector<HTMLElement>(".graph-depth")!.hidden = scope !== "local";
    this.root.querySelector(".graph-stats")!.textContent =
      `${plural(data.nodes.length, "note")} · ${plural(data.links.length, "link")}`;
    this.renderChips(data);
  }

  private renderChips(data: GraphData): void {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.ggroup;
    this.strip.replaceChildren();
    for (const group of [...data.groups].sort((a, b) => b.size - a.size)) {
      const chip = document.createElement("button");
      chip.className = group.id === this.spotlit ? "graph-chip is-on" : "graph-chip";
      chip.dataset.ggroup = String(group.id);
      chip.style.setProperty("--h", groupColor(group.id));
      const name = document.createElement("span");
      name.textContent = group.label;
      const count = document.createElement("small");
      count.textContent = String(group.size);
      chip.append(name, count);
      this.strip.append(chip);
      if (focused === chip.dataset.ggroup) chip.focus({ preventScroll: true });
    }
    this.markStripEnds();
  }

  private bind(): void {
    this.root.addEventListener("click", (e) => this.onClick(e.target as HTMLElement));
    this.root
      .querySelector("input")!
      .addEventListener("input", (e) => this.canvas.setFilter((e.target as HTMLInputElement).value));
    this.strip.addEventListener("scroll", () => this.markStripEnds(), { passive: true });
    this.strip.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        this.strip.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
    this.root.addEventListener("pointerover", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-ggroup]");
      if (chip) this.canvas.spotlight(Number(chip.dataset.ggroup));
    });
    this.root.addEventListener("pointerout", (e) => {
      if ((e.target as HTMLElement).closest("[data-ggroup]")) this.canvas.spotlight(this.spotlit);
    });
  }

  private onClick(target: HTMLElement): void {
    if (target.closest("[data-gleave]")) {
      this.host.leave();
      return;
    }
    const view = this.host.currentView();
    if (!view) return;
    const chip = target.closest<HTMLElement>("[data-ggroup]");
    const mode = target.closest<HTMLElement>("[data-gmode]")?.dataset.gmode;
    const depth = target.closest<HTMLElement>("[data-depth]")?.dataset.depth;
    const zoom = target.closest<HTMLElement>("[data-gz]")?.dataset.gz;
    if (chip) {
      this.toggleSpotlight(Number(chip.dataset.ggroup));
    } else if (mode === "local" || mode === "vault") {
      this.host.setScope(mode);
      this.show(view.note, mode);
    } else if (depth) {
      this.depth = Number(depth);
      this.show(view.note, view.scope);
    } else if (zoom === "in") this.canvas.zoomBy(ZOOM_STEP);
    else if (zoom === "out") this.canvas.zoomBy(1 / ZOOM_STEP);
    else if (zoom === "fit") this.canvas.recenter();
  }

  private toggleSpotlight(group: number): void {
    this.spotlit = this.spotlit === group ? null : group;
    this.canvas.spotlight(this.spotlit);
    if (this.spotlit === null) this.canvas.recenter();
    else this.canvas.flyToGroup(group);
    for (const chip of this.root.querySelectorAll<HTMLElement>("[data-ggroup]")) {
      chip.classList.toggle("is-on", Number(chip.dataset.ggroup) === this.spotlit);
    }
  }

  /** The strip fades only on a side that has more to scroll to. */
  private markStripEnds(): void {
    const { strip } = this;
    strip.classList.toggle("has-before", strip.scrollLeft > 1);
    strip.classList.toggle("has-after", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
  }
}
