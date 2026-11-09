import type { Hit } from "../vault/search";

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
  private query = "";
  private hits: Hit[] = [];
  private selected = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: SearchPaneHost,
  ) {
    this.input = root.querySelector("input")!;
    this.results = root.querySelector(".search-results")!;
    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      this.host.clearHighlights();
      this.run();
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));
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

  clear(): void {
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
    this.results.replaceChildren();
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
      if (on) row.scrollIntoView({ block: "nearest" });
    }
  }

  private hint(): HTMLElement {
    const hint = document.createElement("div");
    hint.className = "empty-state is-compact";
    hint.innerHTML = `<p>Searches the titles, headings and text of every note. Words can match anywhere; put a phrase in "quotes" to match it exactly.</p><p><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>↵</kbd> open at the match · <kbd>⌘↵</kbd> new tab</p>`;
    return hint;
  }

  private noResults(): HTMLElement {
    const empty = document.createElement("div");
    empty.className = "empty-state is-compact";
    const strong = document.createElement("strong");
    strong.textContent = `No note contains “${this.query.trim()}”`;
    const p = document.createElement("p");
    p.textContent = "Try fewer words or the start of a word. Note titles are also in the palette (⌘K).";
    empty.append(strong, p);
    return empty;
  }

  private hitRow(hit: Hit, index: number): HTMLElement {
    const row = document.createElement("button");
    row.className = "search-hit";
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
