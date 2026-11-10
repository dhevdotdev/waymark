import type { RenderedNote } from "../render/note";
import type { VaultStore } from "../vault/store";
import { ancestors } from "../vault/tree";
import { FloatingOutline } from "./floating-outline";
import { icons } from "./icons";
import { LocalGraph } from "./local-graph";
import { railFloats } from "./media";
import { NoteHistory, type NoteHistoryHost } from "./note-history";
import { bindPanelResize } from "./panel-resize";
import type { ShellElements } from "./shell";

const MIN_WIDTH = 220;
const MAX_WIDTH = 440;

export type RailPane = "links" | "info";
export type RailSection = "trail" | "graph";

export interface InspectorHost extends NoteHistoryHost {
  openFromGraph: (path: string, newTab: boolean) => void;
  railToggled: (open: boolean) => void;
  railWidth: () => number;
  holdRailWidth: (width: number) => void;
  saveRailWidth: () => void;
  sectionFolded: (section: RailSection, folded: boolean) => void;
}

/** The right panel: links, note details and the local graph. It also owns the heading outline on the reading pane. */
export class Inspector {
  private readonly history: NoteHistory;
  private readonly floating = new FloatingOutline();
  private localGraph: LocalGraph | null = null;
  private rendered: RenderedNote | null = null;
  private current = "";
  private readonly vacant: Record<RailSection, boolean> = { trail: true, graph: true };

  constructor(
    private readonly els: ShellElements,
    private readonly vault: VaultStore,
    private readonly host: InspectorHost,
    pane: RailPane,
    private readonly folded: Record<RailSection, boolean>,
  ) {
    this.history = new NoteHistory(host);
    els.reader.append(this.floating.root);
    bindPanelResize(els.railResize, {
      shell: els.shell,
      variable: "--rail-w",
      min: MIN_WIDTH,
      max: MAX_WIDTH,
      direction: -1,
      read: () => host.railWidth(),
      hold: (width) => host.holdRailWidth(width),
      save: () => host.saveRailWidth(),
    });
    this.setPane(pane);
    this.drawSection("trail");
    this.drawSection("graph");
  }

  render(path: string, rendered: RenderedNote): void {
    this.current = path;
    this.rendered = rendered;
    this.floating.render(rendered.headings.filter((h) => h.level === 2 || h.level === 3));
    this.renderLinks();
    this.renderInfo(rendered);
    this.renderLocalGraph();
    this.spy();
  }

  /** Re-draws everything that depends on the vault's links and files. */
  refresh(): void {
    if (this.rendered) this.render(this.current, this.rendered);
  }

  setPane(pane: RailPane): void {
    const { shell, railBody } = this.els;
    for (const button of shell.querySelectorAll<HTMLElement>("[data-rail]")) {
      const on = button.dataset.rail === pane;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-selected", String(on));
    }
    for (const el of shell.querySelectorAll<HTMLElement>("[data-pane]")) el.hidden = el.dataset.pane !== pane;
    railBody.scrollTop = 0;
    this.refreshHistory();
  }

  isOpen(section: RailSection): boolean {
    return !this.folded[section] && !this.vacant[section];
  }

  toggleSection(section: RailSection): void {
    this.setFolded(section, !this.folded[section]);
  }

  setFolded(section: RailSection, folded: boolean): void {
    this.folded[section] = folded;
    this.drawSection(section);
    this.host.sectionFolded(section, folded);
  }

  /** A section with nothing to show is not drawn at all, and its room goes to the links. */
  setEmpty(section: RailSection, empty: boolean): void {
    if (this.vacant[section] === empty) return;
    this.vacant[section] = empty;
    this.drawSection(section);
  }

  private drawSection(section: RailSection): void {
    const el = this.els.shell.querySelector<HTMLElement>(`[data-section="${section}"]`)!;
    const open = this.isOpen(section);
    el.classList.toggle("is-folded", !open);
    el.classList.toggle("is-vacant", this.vacant[section]);
    el.querySelector("[data-fold-section]")!.setAttribute("aria-expanded", String(open));
  }

  get isShowing(): boolean {
    const { shell } = this.els;
    return railFloats() ? shell.classList.contains("rail-peek") : !shell.classList.contains("rail-closed");
  }

  /** A narrow window slides the panel over the note, so that state is not one to remember. */
  toggle(): void {
    const { shell } = this.els;
    if (railFloats()) {
      shell.classList.toggle("rail-peek");
      return;
    }
    const closed = shell.classList.toggle("rail-closed");
    this.host.railToggled(!closed);
  }

  /** Called when the Git status changes, so the Info pane stays honest about uncommitted edits. */
  refreshHistory(): void {
    const box = this.els.info.querySelector<HTMLElement>(".rail-history");
    if (box && !this.els.info.hidden) void this.history.render(box);
  }

  refreshTheme(): void {
    this.localGraph?.refreshTheme();
  }

  /** Keeps the outline on the heading being read. */
  spy(): void {
    const { scroller, paneHead } = this.els;
    paneHead.classList.toggle("is-scrolled", scroller.scrollTop > 2);
    this.floating.spy(scroller);
  }

  private empty(text: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "rail-empty";
    p.textContent = text;
    return p;
  }

  private title(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "rail-title";
    el.textContent = text;
    return el;
  }

  private renderLinks(): void {
    const { links: box, shell } = this.els;
    const { links, index } = this.vault;
    const byName = (a: string, b: string) => a.localeCompare(b);
    const from = [...links.backlinks(this.current)].sort(byName);
    const to = [...(links.out.get(this.current) ?? [])].sort(byName);
    box.replaceChildren();

    const group = (label: string, paths: string[], withContext: boolean) => {
      if (!paths.length) return;
      box.append(this.title(`${label} · ${paths.length}`));
      for (const path of paths) {
        const a = document.createElement("a");
        a.href = "#";
        a.className = "wikilink-plain rail-link";
        a.dataset.path = path;
        a.dataset.tip = index.title(path);
        a.innerHTML = icons.note;
        const name = document.createElement("span");
        name.className = "rail-link-name";
        name.textContent = index.title(path);
        a.append(name);
        const context = withContext ? this.vault.linkContext(path, this.current) : null;
        if (context) {
          const line = document.createElement("span");
          line.className = "rail-link-context";
          line.textContent = context;
          a.append(line);
        }
        box.append(a);
      }
    };
    group("Linked from", from, true);
    group("Links to", to, false);
    if (!from.length && !to.length) box.append(this.empty("No links to or from this note."));
    const total = new Set([...from, ...to]).size;
    shell.querySelector('[data-rail="links"]')!.textContent = total ? `Links ${total}` : "Links";
  }

  /** Folder, length and every frontmatter property, shown as written and without meaning attached to any key. */
  private renderInfo(rendered: RenderedNote): void {
    const { info: box } = this.els;
    box.replaceChildren();
    const addRow = (target: HTMLElement, key: string, value: string | string[]) => {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      if (Array.isArray(value)) {
        for (const item of value) {
          const chip = document.createElement("span");
          chip.className = "prop-chip";
          chip.textContent = item;
          dd.append(chip);
        }
      } else dd.textContent = value;
      target.append(dt, dd);
    };
    const facts = document.createElement("dl");
    facts.className = "props";
    addRow(facts, "Folder", ancestors(this.current).at(-1) ?? "Vault root");
    addRow(facts, "Words", this.vault.wordCount(this.current).toLocaleString());
    box.append(facts);

    const properties = Object.entries(rendered.frontmatter).filter(([, value]) => value.length > 0);
    if (properties.length) {
      const own = document.createElement("dl");
      own.className = "props";
      for (const [key, value] of properties) addRow(own, key, value);
      box.append(this.title("Properties"), own);
    }

    const history = document.createElement("div");
    history.className = "rail-history";
    box.append(history);
    this.history.reset();
    this.refreshHistory();
  }

  private renderLocalGraph(): void {
    const { railGraph: box } = this.els;
    const { links, index } = this.vault;
    const out = links.out.get(this.current) ?? new Set<string>();
    const incoming = links.in.get(this.current) ?? new Set<string>();
    const ids = new Set([...out, ...incoming]);
    if (!this.localGraph) {
      this.localGraph = new LocalGraph((id, newTab) => this.host.openFromGraph(id, newTab));
      box.append(this.localGraph.root);
    }
    this.setEmpty("graph", ids.size === 0);
    const edges: [string, string][] = [];
    for (const a of ids) for (const b of links.out.get(a) ?? []) if (ids.has(b) && a !== b) edges.push([a, b]);
    const { groupOf } = this.vault.communities();
    this.localGraph.set(
      edges,
      [...ids].map((id) => ({
        id,
        label: index.title(id),
        outgoing: out.has(id),
        incoming: incoming.has(id),
        group: groupOf.get(id) ?? -1,
      })),
      groupOf.get(this.current) ?? -1,
    );
  }
}
