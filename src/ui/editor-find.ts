import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { FIND_BUTTONS } from "./find";

const COUNT_LIMIT = 999;

type OptionKey = "caseSensitive" | "wholeWord" | "regexp";

const OPTIONS: [key: OptionKey, label: string, tip: string][] = [
  ["caseSensitive", "Aa", "Match case"],
  ["wholeWord", "W", "Whole words"],
  ["regexp", ".*", "Regular expression"],
];

function countLabel(view: EditorView, query: SearchQuery): string {
  if (!query.search) return "";
  if (!query.valid) return "Invalid";
  const selected = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let total = 0;
  let current = 0;
  for (let match = cursor.next(); !match.done && total <= COUNT_LIMIT; match = cursor.next()) {
    total++;
    if (match.value.from === selected.from && match.value.to === selected.to) current = total;
  }
  if (!total) return "No matches";
  if (total > COUNT_LIMIT) return `${COUNT_LIMIT}+`;
  return current ? `${current} of ${total}` : `${total} found`;
}

/** The editor's find bar, built to match the one used while reading. */
export function findPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "findbar cm-search";
  dom.innerHTML = `
    <div class="findbar-row">
      <button class="icon-btn findbar-more" type="button" data-find="more" aria-label="Show replace" aria-expanded="false"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg></button>
      <input class="findbar-field" type="text" spellcheck="false" placeholder="Find in note" aria-label="Find in note" main-field="true" />
      <span class="findbar-count" aria-live="polite"></span>
      ${OPTIONS.map(([key, label, tip]) => `<button class="find-option" type="button" data-option="${key}" data-tip="${tip}" aria-label="${tip}" aria-pressed="false">${label}</button>`).join("")}
      ${FIND_BUTTONS}
    </div>
    <div class="findbar-row is-replace" hidden>
      <input class="findbar-field" type="text" spellcheck="false" placeholder="Replace with" aria-label="Replace with" data-role="replace" />
      <button class="btn btn-small" type="button" data-find="replace">Replace</button>
      <button class="btn btn-small" type="button" data-find="replace-all">All</button>
    </div>`;
  const field = dom.querySelector<HTMLInputElement>("[main-field]")!;
  const replacement = dom.querySelector<HTMLInputElement>('[data-role="replace"]')!;
  const count = dom.querySelector<HTMLElement>(".findbar-count")!;
  const replaceRow = dom.querySelector<HTMLElement>(".is-replace")!;
  const more = dom.querySelector<HTMLElement>(".findbar-more")!;
  let origin = view.state.selection.main.from;

  const current = () => getSearchQuery(view.state);
  const render = () => {
    const query = current();
    count.textContent = countLabel(view, query);
    dom.classList.toggle("is-empty", Boolean(query.search) && count.textContent === "No matches");
    for (const [key] of OPTIONS) {
      dom.querySelector(`[data-option="${key}"]`)!.setAttribute("aria-pressed", String(query[key]));
    }
  };
  const commit = (changes: Partial<Record<OptionKey, boolean>> = {}) => {
    const query = current();
    const next = new SearchQuery({
      search: field.value,
      replace: replacement.value,
      caseSensitive: query.caseSensitive,
      wholeWord: query.wholeWord,
      regexp: query.regexp,
      ...changes,
    });
    view.dispatch({ selection: { anchor: origin }, effects: setSearchQuery.of(next) });
    if (next.valid) move(findNext);
  };
  /** CodeMirror selects the whole field after moving, which would make the next key replace the query. */
  function move(command: (target: EditorView) => boolean): void {
    const [start, end] = [field.selectionStart, field.selectionEnd];
    command(view);
    if (document.activeElement === field) field.setSelectionRange(start, end);
  }
  const close = () => {
    closeSearchPanel(view);
    view.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.target === replacement) replaceNext(view);
      else move(e.shiftKey ? findPrevious : findNext);
    }
  };

  field.addEventListener("input", () => commit());
  replacement.addEventListener("input", () => {
    const query = current();
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ ...query, search: query.search, replace: replacement.value })),
    });
  });
  dom.addEventListener("keydown", onKey);
  dom.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const option = target.closest<HTMLElement>("[data-option]")?.dataset.option as OptionKey | undefined;
    if (option) return commit({ [option]: !current()[option] });
    const act = target.closest<HTMLElement>("[data-find]")?.dataset.find;
    if (act === "prev") move(findPrevious);
    else if (act === "next") move(findNext);
    else if (act === "close") close();
    else if (act === "replace") replaceNext(view);
    else if (act === "replace-all") replaceAll(view);
    else if (act === "more") {
      replaceRow.hidden = !replaceRow.hidden;
      more.classList.toggle("is-open", !replaceRow.hidden);
      more.setAttribute("aria-expanded", String(!replaceRow.hidden));
      if (!replaceRow.hidden) replacement.focus();
    }
  });

  return {
    dom,
    top: true,
    mount() {
      field.value = current().search;
      replacement.value = current().replace;
      render();
      field.select();
    },
    update(update: ViewUpdate) {
      const queryChanged = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSearchQuery)));
      if (update.docChanged) origin = update.changes.mapPos(origin);
      if (queryChanged && document.activeElement !== field) field.value = current().search;
      if (update.docChanged || update.selectionSet || queryChanged) render();
    },
  };
}
