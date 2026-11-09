import type { RenderedNote } from "../render/note";
import type { VaultStore } from "../vault/store";
import { ancestors } from "../vault/tree";
import { FloatingOutline } from "./floating-outline";
import { icons } from "./icons";
import { LocalGraph } from "./local-graph";
import { NoteHistory, type NoteHistoryHost } from "./note-history";
import type { ShellElements } from "./shell";

export type RailPane = "outline" | "links" | "info";

const SPY_OFFSET = 96;

export interface InspectorHost extends NoteHistoryHost {
  openFromGraph: (path: string, newTab: boolean) => void;
}

/** The right panel: outline, links, note details and the local graph. */
export class Inspector {
  private readonly history: NoteHistory;
  private readonly floating = new FloatingOutline();
  private localGraph: LocalGraph | null = null;
  private spyActive: HTMLElement | null = null;
  private rendered: RenderedNote | null = null;
  private current = "";

  constructor(
    private readonly els: ShellElements,
    private readonly vault: VaultStore,
    private readonly host: InspectorHost,
    pane: RailPane,
  ) {
    this.history = new NoteHistory(host);
    els.reader.append(this.floating.root);
    this.setPane(pane);
  }

  render(path: string, rendered: RenderedNote): void {
    this.current = path;
    this.rendered = rendered;
    this.renderOutline(rendered);
    this.renderLinks();
    this.renderInfo(rendered);
    this.renderLocalGraph();
    this.spyActive = null;
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
    this.spyActive = null;
    this.spy();
    this.refreshHistory();
  }

  /** Called when the Git status changes, so the Info pane stays honest about uncommitted edits. */
  refreshHistory(): void {
    const box = this.els.info.querySelector<HTMLElement>(".rail-history");
    if (box && !this.els.info.hidden) void this.history.render(box);
  }

  refreshTheme(): void {
    this.localGraph?.refreshTheme();
  }

  /** Marks the heading being read and keeps it visible in the outline. */
  spy(): void {
    const { scroller, paneHead, outline, railBody } = this.els;
    paneHead.classList.toggle("is-scrolled", scroller.scrollTop > 2);
    const links = [...outline.querySelectorAll<HTMLAnchorElement>("a[data-target]")];
    if (!links.length) return;
    const line = scroller.getBoundingClientRect().top + SPY_OFFSET;
    let current = links[0];
    for (const link of links) {
      const heading = document.getElementById(link.dataset.target!);
      if (heading && heading.getBoundingClientRect().top <= line) current = link;
    }
    if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4 && scroller.scrollTop > 0) {
      current = links[links.length - 1];
    }
    if (current === this.spyActive) return;
    this.spyActive = current;
    this.floating.setActive(links.indexOf(current));
    for (const link of links) link.classList.toggle("is-active", link === current);
    if (outline.hidden) return;
    const view = railBody.getBoundingClientRect();
    const r = current.getBoundingClientRect();
    if (r.top < view.top) railBody.scrollTop += r.top - view.top - 8;
    else if (r.bottom > view.bottom) railBody.scrollTop += r.bottom - view.bottom + 8;
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

  private renderOutline(rendered: RenderedNote): void {
    const { outline } = this.els;
    const items = rendered.headings.filter((h) => h.level === 2 || h.level === 3);
    this.floating.render(items);
    outline.replaceChildren();
    if (!items.length) {
      outline.append(this.empty("This note has no headings."));
      return;
    }
    const list = document.createElement("nav");
    list.className = "outline";
    for (const heading of items) {
      const a = document.createElement("a");
      a.href = `#${heading.id}`;
      a.className = `l${heading.level}`;
      a.dataset.target = heading.id;
      a.textContent = heading.text.replace(/`/g, "");
      list.append(a);
    }
    outline.append(list);
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
      box.innerHTML = `<div class="rail-title"><span>Graph</span><button class="link-btn" data-act="graph-local">Expand</button></div>`;
      this.localGraph = new LocalGraph((id, newTab) => this.host.openFromGraph(id, newTab));
      box.append(this.localGraph.root);
    }
    box.classList.toggle("is-empty", ids.size === 0);
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
