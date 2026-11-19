import type { Hit } from "../vault/search";
import { parseSearchQuery, usesFilters } from "../vault/search-query";

const MAX_HITS = 60;

export interface SearchPaneHost {
  search: (query: string, limit: number) => Hit[];
  open: (hit: Hit, newTab: boolean) => void;
  close: () => void;
  clearHighlights: () => void;
  recordSearchMs: (ms: number) => void;
}

/** Full-text search in the sidebar. The query survives leaving and returning to the pane. */
export class SearchPane {
  private readonly input: HTMLInputElement;
  private readonly results: HTMLElement;
  private readonly clearButton: HTMLElement;
  private query = "";
  private hits: Hit[] = [];
  private selected = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: SearchPaneHost,
  ) {
    this.input = root.querySelector("input")!;
    this.results = root.querySelector(".search-results")!;
    this.clearButton = root.querySelector('[data-act="search-clear"]')!;
    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      this.host.clearHighlights();
      this.run();
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    /* The field keeps focus while a result is chosen, so the highlight it points at stays the one in use. */
    this.results.addEventListener("mousedown", (e) => e.preventDefault());
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-controls", this.results.id);
    this.input.setAttribute("aria-autocomplete", "list");
    this.run();
  }

  focus(prefill?: string): void {
    if (prefill) {
      this.input.value = prefill;
      this.query = prefill;
    }
    this.run();
    this.input.focus();
    this.input.select();
  }

  /** The X empties the field, and with nothing left to empty it returns to Files: the pane covers the button that opened it. */
  clear(): void {
    if (!this.input.value) {
      this.host.close();
      return;
    }
    this.input.value = "";
    this.query = "";
    this.host.clearHighlights();
    this.run();
    this.input.focus();
  }

  openHit(index: number, newTab: boolean): void {
    const hit = this.hits[index];
    if (!hit) return;
    this.select(index);
    this.host.open(hit, newTab);
  }

  run(): void {
    const t0 = performance.now();
    this.hits = this.host.search(this.query, MAX_HITS);
    this.host.recordSearchMs(performance.now() - t0);
    this.selected = 0;
    const label = this.query ? "Clear search" : "Back to files";
    this.clearButton.setAttribute("aria-label", label);
    this.clearButton.dataset.tip = label;
    this.results.replaceChildren();
    this.input.removeAttribute("aria-activedescendant");
    this.input.setAttribute("aria-expanded", String(this.hits.length > 0 && !!this.query.trim()));
    if (!this.query.trim()) {
      this.results.append(this.hint());
      return;
    }
    if (!this.hits.length) {
      this.results.append(this.noResults());
      return;
    }
    const count = document.createElement("div");
    count.className = "search-count";
    count.textContent = `${this.hits.length === MAX_HITS ? `${MAX_HITS}+` : this.hits.length} note${this.hits.length === 1 ? "" : "s"}`;
    this.results.append(count, ...this.hits.map((hit, i) => this.hitRow(hit, i)));
    this.select(0);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown") this.select(this.selected + 1);
    else if (e.key === "ArrowUp") this.select(this.selected - 1);
    else if (e.key === "PageDown") this.select(this.pageFrom(1));
    else if (e.key === "PageUp") this.select(this.pageFrom(-1));
    else if (e.key === "Enter") this.openHit(this.selected, e.metaKey);
    else if (e.key === "Escape") {
      e.stopPropagation();
      this.host.close();
    } else return;
    e.preventDefault();
  }

  private select(index: number): void {
    if (!this.hits.length) return;
    this.selected = Math.max(0, Math.min(index, this.hits.length - 1));
    for (const row of this.root.querySelectorAll<HTMLElement>(".search-hit")) {
      const on = Number(row.dataset.hit) === this.selected;
      row.classList.toggle("is-selected", on);
      row.setAttribute("aria-selected", String(on));
      if (!on) continue;
      row.scrollIntoView({ block: "nearest" });
      this.input.setAttribute("aria-activedescendant", row.id);
    }
  }

  /** The result a page away: the furthest one that would share the view with the one selected now. */
  private pageFrom(direction: 1 | -1): number {
    const rows = [...this.results.querySelectorAll<HTMLElement>(".search-hit")];
    const from = rows[this.selected]?.getBoundingClientRect();
    if (!from) return this.selected;
    const reach = this.results.clientHeight;
    let to = this.selected;
    for (let i = this.selected + direction; rows[i]; i += direction) {
      const r = rows[i].getBoundingClientRect();
      if ((direction > 0 ? r.bottom - from.top : from.bottom - r.top) > reach) break;
      to = i;
    }
    return to === this.selected ? this.selected + direction : to;
  }

  private hint(): HTMLElement {
    const hint = document.createElement("div");
    hint.className = "empty-state is-compact";
    hint.innerHTML = `<p>Searches the titles, headings and text of every note. Words can match anywhere; put a phrase in "quotes" to match it exactly. <code>path:Folder</code> keeps to one place and <code>-word</code> leaves a word out.</p><p><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>↵</kbd> open at the match · <kbd>⌘↵</kbd> new tab</p>`;
    return hint;
  }

  private noResults(): HTMLElement {
    const empty = document.createElement("div");
    empty.className = "empty-state is-compact";
    const strong = document.createElement("strong");
    const narrowed = usesFilters(parseSearchQuery(this.query));
    strong.textContent = narrowed ? `No note matches “${this.query.trim()}”` : `No note contains “${this.query.trim()}”`;
    const p = document.createElement("p");
    p.textContent = narrowed
      ? "Try removing a filter. path: matches part of a note's folder or name."
      : "Try fewer words or the start of a word. Note titles are also in the palette (⌘K).";
    empty.append(strong, p);
    return empty;
  }

  private hitRow(hit: Hit, index: number): HTMLElement {
    const row = document.createElement("button");
    row.className = "search-hit";
    row.id = `search-hit-${index}`;
    row.tabIndex = -1;
    row.dataset.hit = String(index);
    row.setAttribute("role", "option");
    const title = document.createElement("span");
    title.className = "search-hit-title";
    title.textContent = hit.title;
    row.append(title);
    if (hit.snippet) {
      if (hit.snippet.heading) {
        const heading = document.createElement("span");
        heading.className = "search-hit-heading";
        heading.textContent = hit.snippet.heading;
        row.append(heading);
      }
      const snippet = document.createElement("span");
      snippet.className = "search-hit-snippet";
      const mark = document.createElement("mark");
      mark.textContent = hit.snippet.match;
      snippet.append(hit.snippet.before, mark, hit.snippet.after);
      row.append(snippet);
    }
    return row;
  }
}
