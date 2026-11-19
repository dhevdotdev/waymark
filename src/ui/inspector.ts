import type { PrefStore } from "../prefs";
import type { RenderedNote } from "../render/note";
import { loadYaml } from "../vault/frontmatter";
import type { VaultStore } from "../vault/store";
import { ancestors } from "../vault/tree";
import { FloatingOutline } from "./floating-outline";
import { icons } from "./icons";
import { LocalGraph } from "./local-graph";
import { railFloats } from "./media";
import { MorphArrows } from "./morph-arrows";
import type { NoteEditing } from "./note-editing";
import { NoteHistory, type NoteHistoryHost } from "./note-history";
import { linkTargetOf } from "./note-links";
import { toast } from "./overlays";
import { glidePanel } from "./panel-glide";
import { bindEdgeDrag } from "./panel-resize";
import { PanelSections, type RailSection } from "./panel-sections";
import type { PropertyEditor } from "./property-editor";
import type { ShellElements } from "./shell";
import { UnlinkedMentions } from "./unlinked-mentions";

const MIN_WIDTH = 220;
const MAX_WIDTH = 440;

export type RailPane = "links" | "info";

export interface InspectorHost extends NoteHistoryHost {
  /** Opens a note reached from this one, optionally marking `find` in it. */
  openLinked: (path: string, newTab: boolean, find?: string) => void;
  prefs: PrefStore;
  editing: () => NoteEditing;
}

/** The right panel: links, note details and the local graph. It also owns the heading outline on the reading pane. */
export class Inspector {
  private readonly history: NoteHistory;
  private readonly floating = new FloatingOutline();
  private localGraph: LocalGraph | null = null;
  private rendered: RenderedNote | null = null;
  private current = "";
  private pane: RailPane = "links";
  private readonly expandArrows = new MorphArrows("apart");
  private readonly propertySlot = document.createElement("div");
  private readonly facts = document.createElement("dl");
  private propertyEditor: Promise<PropertyEditor> | null = null;
  private readonly mentions: UnlinkedMentions;
  readonly sections: PanelSections;

  constructor(
    private readonly els: ShellElements,
    private readonly vault: VaultStore,
    private readonly host: InspectorHost,
    pane: RailPane,
    folded: Record<RailSection, boolean>,
  ) {
    this.history = new NoteHistory(host);
    this.mentions = new UnlinkedMentions({
      vault,
      linkTarget: (path) => linkTargetOf(vault.index, path),
      open: (path, find, newTab) => host.openLinked(path, newTab, find),
      write: (path, edit) => host.editing().writer.change(path, edit),
      redraw: () => this.refresh(),
      toast,
    });
    els.reader.append(this.floating.root);
    els.scroller.addEventListener("foldchange", () => this.floating.markFolds());
    const expand = els.shell.querySelector<HTMLElement>(".rail-graph-open")!;
    expand.append(this.expandArrows.svg);
    expand.addEventListener("click", () => this.expandArrows.snap("together"));
    bindEdgeDrag(els.railResize, {
      shell: els.shell,
      axis: "x",
      direction: -1,
      range: () => [MIN_WIDTH, MAX_WIDTH],
      read: () => host.prefs.value.railWidth,
      apply: (width) => {
        els.shell.style.setProperty("--rail-w", `${width}px`);
        host.prefs.value.railWidth = width;
      },
      save: () => host.prefs.update(() => undefined),
    });
    this.sections = new PanelSections(els.shell, host.prefs, folded);
    /* The panel opens and closes from several places, so its buttons read its state rather than each caller setting them. */
    new MutationObserver(() => this.markButtons()).observe(els.shell, { attributes: true, attributeFilter: ["class"] });
    matchMedia("(max-width: 1240px)").addEventListener("change", () => this.markButtons());
    this.setPane(pane);
  }

  render(path: string, rendered: RenderedNote): void {
    this.current = path;
    this.rendered = rendered;
    this.expandArrows.to("apart");
    this.floating.render(rendered.headings.filter((h) => h.level === 2 || h.level === 3));
    this.renderLinks();
    this.renderInfo();
    void this.refreshProperties();
    this.renderLocalGraph();
    this.spy();
  }

  /** Re-draws everything that depends on the vault's links and files. */
  refresh(): void {
    if (this.rendered) this.render(this.current, this.rendered);
  }

  setPane(pane: RailPane): void {
    const { shell, railBody } = this.els;
    this.pane = pane;
    for (const el of shell.querySelectorAll<HTMLElement>("[data-pane]")) el.hidden = el.dataset.pane !== pane;
    railBody.scrollTop = 0;
    this.markButtons();
    this.refreshHistory();
  }

  /** Links and Info are the panel's tabs: one opens the panel on its pane, closes it if already showing, or switches to it. */
  choose(pane: RailPane): void {
    if (this.isShowing && pane === this.pane) {
      this.toggle();
      return;
    }
    if (pane !== this.pane) {
      this.setPane(pane);
      this.host.prefs.update((p) => {
        p.railPane = pane;
      });
    }
    if (!this.isShowing) this.toggle();
  }

  private markButtons(): void {
    const showing = this.isShowing;
    for (const button of this.els.shell.querySelectorAll<HTMLElement>("[data-rail]")) {
      const on = showing && button.dataset.rail === this.pane;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-pressed", String(on));
    }
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
    const closed = !shell.classList.contains("rail-closed");
    glidePanel(shell, !closed, () => shell.classList.toggle("rail-closed", closed));
    this.host.prefs.update((p) => {
      p.rail = !closed;
    });
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
    if (!from.length && !to.length) box.append(this.empty("No links to or from this note."));
    group("Linked from", from, true);
    this.mentions.render(box, this.current);
    group("Links to", to, false);
    const total = new Set([...from, ...to]).size;
    const button = shell.querySelector<HTMLElement>('[data-rail="links"]')!;
    button.querySelector(".icon-count")!.textContent = total ? String(total) : "";
    button.setAttribute("aria-label", total ? `Links, ${total}` : "Links");
  }

  /** The note's properties, read again from its current text. The editing code loads when first needed. */
  async refreshProperties(): Promise<void> {
    const path = this.current;
    if (!path) return;
    this.propertyEditor ??= Promise.all([import("./property-editor"), loadYaml()]).then(([{ PropertyEditor }]) => {
      const { editing } = this.host;
      const editor = new PropertyEditor({
        write: (at, edit) => editing().writer.change(at, edit),
        text: (at) => editing().noteText(at),
        linesMoved: () => void editing().refreshReading(),
        openRaw: (_, line) => void editing().openAtLine(line),
        toast,
      });
      this.propertySlot.append(editor.root);
      return editor;
    });
    /* The note can be renamed or deleted while this is on its way. The next render shows the new state. */
    const text = await this.host
      .editing()
      .noteText(path)
      .catch(() => null);
    const editor = await this.propertyEditor;
    if (text !== null && path === this.current) editor.show(path, text);
  }

  /** Folder and length, then the properties and the history. The pane is built once, so redrawing a note never takes focus out of it. */
  private renderInfo(): void {
    const { info: box } = this.els;
    if (!this.facts.isConnected) {
      this.facts.className = "props";
      const history = document.createElement("div");
      history.className = "rail-history";
      box.replaceChildren(this.facts, this.title("Properties"), this.propertySlot, history);
    }
    const fact = (key: string, value: string) => {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    };
    this.facts.replaceChildren(
      ...fact("Folder", ancestors(this.current).at(-1) ?? "Vault root"),
      ...fact("Words", this.vault.wordCount(this.current).toLocaleString()),
    );
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
      this.localGraph = new LocalGraph((id, newTab) => this.host.openLinked(id, newTab));
      box.append(this.localGraph.root);
    }
    this.sections.setEmpty("graph", ids.size === 0);
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
