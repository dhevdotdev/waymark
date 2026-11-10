import { isDesktop, native } from "../platform";
import { type BaseFile, type BaseRow, cellValue, columnLabel, parseBase, rowsFor } from "../vault/base-file";
import { loadYaml, parseFrontmatter } from "../vault/frontmatter";
import type { VaultStore } from "../vault/store";
import { plural } from "./plural";

export interface BaseViewHost {
  vault: VaultStore;
  scroller: HTMLElement;
  open: (path: string, newTab: boolean) => void;
}

const FILE_TIME = new Set(["file.mtime", "file.ctime"]);

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function display(row: BaseRow, property: string, vault: VaultStore): string {
  if (property === "file.name") return vault.index.title(row.path);
  const value = cellValue(row, property);
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (FILE_TIME.has(property))
    return new Date(Number(value)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return String(value);
}

/** A saved view of notes, read from a `.base` file and shown as a table. The file itself is never written. */
export class BaseView {
  private readonly chosen = new Map<string, number>();

  constructor(private readonly host: BaseViewHost) {}

  /** Rebuilds the view. `stale` is checked after each wait so an older render never lands on a newer tab. */
  async show(path: string, scrollTop: number, stale: () => boolean): Promise<void> {
    await loadYaml();
    const { vault } = this.host;
    const text = await vault.source.readText(path).catch(() => null);
    if (stale()) return;
    const doc = element("article", "doc is-base");
    const head = element("header", "doc-head");
    head.append(element("h1", "doc-title", vault.index.title(path)));
    doc.append(head);
    if (text === null) {
      doc.append(this.notice("This view is no longer in the vault."));
      return this.mount(doc, scrollTop);
    }
    const parsed = parseBase(text);
    if (!parsed.ok) {
      doc.append(this.notice(parsed.error, path));
      return this.mount(doc, scrollTop);
    }
    const { base } = parsed;
    const rows = await this.rows();
    if (stale()) return;
    this.fill(doc, path, base, rows, stale, scrollTop);
    this.mount(doc, scrollTop);
  }

  private mount(doc: HTMLElement, scrollTop: number): void {
    this.host.scroller.replaceChildren(doc);
    this.host.scroller.scrollTop = scrollTop;
  }

  private fill(doc: HTMLElement, path: string, base: BaseFile, rows: BaseRow[], stale: () => boolean, scrollTop: number): void {
    if (base.problem) {
      doc.append(this.notice(base.problem, path));
      return;
    }
    if (!base.views.length) {
      doc.append(this.notice("This file does not define a view."));
      return;
    }
    const index = Math.min(this.chosen.get(path) ?? 0, base.views.length - 1);
    if (base.views.length > 1) {
      const switcher = element("div", "seg base-views");
      base.views.forEach((view, i) => {
        const button = element("button", `seg-btn${i === index ? " is-on" : ""}`, view.name);
        button.type = "button";
        button.setAttribute("aria-pressed", String(i === index));
        button.onclick = () => {
          this.chosen.set(path, i);
          void this.show(path, scrollTop, stale);
        };
        switcher.append(button);
      });
      doc.append(switcher);
    }
    const view = base.views[index];
    if (view.problem) {
      doc.append(this.notice(view.problem, path));
      return;
    }
    const shown = rowsFor(base, view, rows);
    doc.append(
      element(
        "p",
        "base-count",
        `${plural(shown.length, "note")}${view.limit !== null && shown.length === view.limit ? ", limited by this view" : ""}`,
      ),
    );
    if (!shown.length) {
      doc.append(this.notice("No notes match this view."));
      return;
    }
    doc.append(this.table(base, view.columns, shown));
  }

  private table(base: BaseFile, columns: string[], rows: BaseRow[]): HTMLElement {
    const table = element("table", "");
    const headRow = element("tr", "");
    for (const column of columns) headRow.append(element("th", "", columnLabel(base, column)));
    const thead = element("thead", "");
    thead.append(headRow);
    const tbody = element("tbody", "");
    for (const row of rows) {
      const tr = element("tr", "base-row");
      columns.forEach((column, i) => {
        const td = element("td", "");
        const text = display(row, column, this.host.vault);
        if (column === "file.name" || (i === 0 && !columns.includes("file.name"))) {
          const link = element("button", "base-link", text || this.host.vault.index.title(row.path));
          link.type = "button";
          td.append(link);
        } else {
          td.textContent = text;
        }
        tr.append(td);
      });
      tr.addEventListener("click", (e) => this.host.open(row.path, e.metaKey));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const wrap = element("div", "table-wrap");
    wrap.append(table);
    return wrap;
  }

  private notice(message: string, path?: string): HTMLElement {
    const box = element("div", "notice is-quiet base-notice");
    box.setAttribute("role", "status");
    box.append(element("p", "", message));
    if (path && isDesktop) {
      const reveal = element("button", "btn btn-small", "Reveal the file in Finder");
      reveal.onclick = () => void native.reveal(path);
      box.append(reveal);
    }
    return box;
  }

  private async rows(): Promise<BaseRow[]> {
    const { vault } = this.host;
    const notes = vault.index.notes;
    const stats = await vault.source.fileStats(notes);
    return notes.map((path) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      const stat = stats[path] ?? { mtime: 0, ctime: 0, size: 0 };
      return {
        path,
        note: parseFrontmatter(vault.texts.get(path) ?? "").data,
        file: {
          name,
          basename: name.replace(/\.md$/i, ""),
          path,
          folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
          ext: name.slice(name.lastIndexOf(".") + 1),
          ...stat,
        },
      };
    });
  }
}
