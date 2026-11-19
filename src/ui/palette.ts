import { fuzzy, highlightMarks } from "./fuzzy";
import { markKeyboardOrigin } from "./input-origin";
import { holdModal } from "./modal-layer";

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  hint?: string;
  group: string;
  keywords?: string;
  danger?: boolean;
  run: (opts: { newTab: boolean }) => void;
}

/**
 * Command palette: one field for notes and commands. Typing `>` limits it to
 * commands. Results update on every keystroke with no debounce; the list is
 * small enough that filtering costs well under a frame.
 */
interface PaletteMatch {
  score: number;
  marks: number[];
}

/** Marks index into the label, so a match on keywords highlights nothing. */
function matchItem(needle: string, item: PaletteItem): PaletteMatch | null {
  const onLabel = fuzzy(needle, item.label);
  if (onLabel) return onLabel;
  const onKeywords = item.keywords ? fuzzy(needle, item.keywords) : null;
  return onKeywords && { score: onKeywords.score, marks: [] };
}

export class Palette {
  private root: HTMLElement | null = null;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private items: PaletteItem[] = [];
  private shown: PaletteItem[] = [];
  private selected = 0;
  private release: ((restoreFocus?: boolean) => void) | null = null;

  constructor(
    private source: (query: string) => PaletteItem[],
    private recent: () => PaletteItem[],
    private readonly look: { placeholder: string; compact?: boolean } = { placeholder: "Go to a note, or type > for commands" },
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(prefill = ""): void {
    if (this.root) {
      this.input.select();
      return;
    }
    const root = document.createElement("div");
    root.className = "overlay palette-overlay";
    root.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="palette-field">
          <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
          <input type="text" spellcheck="false" autocomplete="off" placeholder="${this.look.placeholder}" aria-label="Search notes and commands" role="combobox" aria-expanded="true" aria-controls="palette-list" />
          <kbd>esc</kbd>
        </div>
        <div class="palette-list" id="palette-list" role="listbox"></div>
        ${this.look.compact ? "" : `<div class="palette-foot"><span><kbd>↵</kbd> open</span><span><kbd>⌘↵</kbd> new tab</span><span><kbd>></kbd> commands</span></div>`}
      </div>`;
    this.root = root;
    this.input = root.querySelector("input")!;
    this.list = root.querySelector(".palette-list")!;
    root.addEventListener("pointerdown", (e) => {
      if (e.target === root) this.close();
    });
    this.input.addEventListener("input", () => this.update());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.list.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (row) this.choose(Number(row.dataset.index), e.metaKey);
    });
    let last = { x: -1, y: -1 };
    this.list.addEventListener("pointermove", (e) => {
      if (e.clientX === last.x && e.clientY === last.y) return;
      const moved = last.x !== -1;
      last = { x: e.clientX, y: e.clientY };
      if (!moved) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (row && Number(row.dataset.index) !== this.selected) this.select(Number(row.dataset.index), false);
    });
    document.body.append(root);
    this.release = holdModal(root, { controls: () => [this.input] });
    this.input.value = prefill;
    this.input.focus();
    this.update();
  }

  /** Closes and hands over what was typed, so it can be searched for instead. A command search has nothing to hand over. */
  takeQuery(): string | undefined {
    if (!this.root) return undefined;
    const typed = this.input.value.trim();
    this.close();
    return typed && !typed.startsWith(">") ? typed : undefined;
  }

  /** `restoreFocus` is false when whatever replaces the palette takes focus itself. */
  close(restoreFocus = true): void {
    if (!this.root) return;
    const root = this.root;
    this.root = null;
    root.classList.add("is-leaving");
    setTimeout(() => root.remove(), 200);
    this.release?.(restoreFocus);
    this.release = null;
  }

  private update(): void {
    const q = this.input.value;
    this.items = q.trim() ? this.source(q) : this.recent();
    const commandsOnly = q.startsWith(">");
    this.root?.querySelector<HTMLElement>(".palette-foot span:last-child")?.toggleAttribute("hidden", commandsOnly);
    const needle = commandsOnly ? q.slice(1).trim() : q.trim();
    const scored = this.items
      .filter((i) => (commandsOnly ? i.group === "Commands" : true))
      .map((item) => ({
        item,
        m: needle ? matchItem(needle, item) : { score: 0, marks: [] },
      }))
      .filter((x): x is { item: PaletteItem; m: PaletteMatch } => x.m !== null);
    if (needle) scored.sort((a, b) => b.m.score - a.m.score);
    const top = scored.slice(0, 60);
    this.shown = top.map((x) => x.item);
    this.list.replaceChildren();
    let group = "";
    top.forEach(({ item, m }, i) => {
      if (!needle && item.group !== group) {
        group = item.group;
        const h = document.createElement("div");
        h.className = "palette-group";
        h.textContent = item.group;
        this.list.append(h);
      }
      const row = document.createElement("div");
      row.className = item.danger ? "palette-row is-danger" : "palette-row";
      row.setAttribute("role", "option");
      row.dataset.index = String(i);
      row.id = `palette-opt-${i}`;
      const label = document.createElement("span");
      label.className = "palette-label";
      label.append(highlightMarks(item.label, m.marks));
      row.append(label);
      if (item.detail) {
        const d = document.createElement("span");
        d.className = "palette-detail";
        d.textContent = item.detail;
        row.append(d);
      }
      if (item.hint) {
        const k = document.createElement("kbd");
        k.textContent = item.hint;
        row.append(k);
      }
      this.list.append(row);
    });
    if (!top.length) {
      const empty = document.createElement("div");
      empty.className = "palette-empty";
      empty.textContent = commandsOnly
        ? "No command matches"
        : `No note named like “${needle}”. Press ⌘⇧F to search inside notes.`;
      this.list.append(empty);
    }
    this.select(0, true);
  }

  private select(i: number, scroll: boolean): void {
    this.selected = Math.max(0, Math.min(i, this.shown.length - 1));
    this.input.removeAttribute("aria-activedescendant");
    for (const row of this.list.querySelectorAll<HTMLElement>(".palette-row")) {
      const on = Number(row.dataset.index) === this.selected;
      row.classList.toggle("is-selected", on);
      row.setAttribute("aria-selected", String(on));
      if (on) {
        this.input.setAttribute("aria-activedescendant", row.id);
        if (scroll) row.scrollIntoView({ block: "nearest" });
      }
    }
  }

  /** How many rows fit in the list, so PageUp and PageDown move by what is on screen. */
  private page(): number {
    const row = this.list.querySelector<HTMLElement>(".palette-row");
    return row ? Math.max(1, Math.floor(this.list.clientHeight / row.offsetHeight) - 1) : 1;
  }

  private onKey(e: KeyboardEvent): void {
    const jumps: Record<string, () => number> = {
      PageDown: () => this.selected + this.page(),
      PageUp: () => this.selected - this.page(),
      Home: () => 0,
      End: () => this.shown.length - 1,
    };
    if (e.key in jumps && !e.shiftKey && this.shown.length) {
      e.preventDefault();
      this.select(jumps[e.key](), true);
    } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      this.select(this.selected + 1, true);
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      this.select(this.selected - 1, true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.choose(this.selected, e.metaKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  private choose(i: number, newTab: boolean): void {
    const item = this.shown[i];
    if (!item) return;
    this.close();
    markKeyboardOrigin();
    item.run({ newTab });
  }
}
