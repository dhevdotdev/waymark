import type { PrefStore } from "../prefs";
import type { VaultStore } from "../vault/store";
import { type TaskList, taskLists } from "../vault/tasks";
import { relative } from "./git-panel-parts";
import { icons } from "./icons";
import { plural } from "./plural";

const RECENT_KEPT = 12;
const RECENT_SHOWN = 7;

const ACTIONS: [label: string, act: string, hint: string][] = [
  ["Go to a note", "palette", "⌘K"],
  ["Search inside notes", "search", "⌘⇧F"],
  ["Show the graph", "graph", "⌘G"],
];

type Recent = { path: string; at: number };

/** Preferences are read from disk, so each entry is checked before use. */
function recentNotes(saved: unknown): Recent[] {
  if (!Array.isArray(saved)) return [];
  return saved.filter((e): e is Recent => typeof e?.path === "string" && typeof e?.at === "number");
}

/** Records a note as just opened, for the new-tab page. Kept in preferences, never in the vault. */
export function rememberNote(prefs: PrefStore, root: string, path: string): void {
  prefs.update((p) => {
    p.vaults[root] ??= { tabs: [], active: 0, lastSync: null };
    const earlier = recentNotes(p.vaults[root].recent).filter((entry) => entry.path !== path);
    p.vaults[root].recent = [{ path, at: Date.now() }, ...earlier].slice(0, RECENT_KEPT);
  });
}

/** Keeps a renamed note in the recent list. */
export function renameRecent(prefs: PrefStore, root: string, from: string, to: string): void {
  prefs.update((p) => {
    const vault = p.vaults[root];
    if (vault) vault.recent = recentNotes(vault.recent).map((entry) => (entry.path === from ? { ...entry, path: to } : entry));
  });
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const LISTS_SHOWN = 3;

/** One count per to-do list, and a bar for the note as a whole. */
function taskSummary(lists: TaskList[]): HTMLElement {
  const done = lists.reduce((sum, list) => sum + list.done, 0);
  const total = lists.reduce((sum, list) => sum + list.total, 0);
  const summary = element("span", "start-progress");
  summary.title = `${lists.length} ${lists.length === 1 ? "to-do list" : "to-do lists"}, ${done} of ${total} done`;
  for (const list of lists.slice(0, LISTS_SHOWN)) summary.append(element("span", "start-count", `${list.done}/${list.total}`));
  if (lists.length > LISTS_SHOWN) summary.append(element("span", "start-count", `+${lists.length - LISTS_SHOWN}`));
  const bar = element("span", "start-bar");
  const fill = element("span", "start-fill");
  fill.style.inlineSize = `${Math.round((done / total) * 100)}%`;
  bar.append(fill);
  summary.append(bar);
  return summary;
}

function recentRow(vault: VaultStore, path: string, at: number): HTMLElement {
  const row = element("a", "wikilink-plain start-row");
  row.href = "#";
  row.dataset.path = path;
  row.dataset.tip = vault.index.title(path);
  const title = element("span", "start-title", vault.index.title(path));
  const icon = element("span", "start-icon");
  icon.innerHTML = icons.note;
  row.append(icon, title);
  const lists = taskLists(vault.texts.get(path) ?? "");
  if (lists.length) row.append(taskSummary(lists));
  row.append(element("span", "start-when", relative(at)));
  return row;
}

/** What a new tab shows: where you have just been, and how to go somewhere else. */
export function startPage(vault: VaultStore, prefs: PrefStore, root: string, name: string): HTMLElement {
  const page = element("section", "start-page");
  const head = element("header", "start-head");
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  head.append(
    element("h1", "start-date", date),
    element("span", "start-vault", `${name} · ${plural(vault.index.notes.length, "note")}`),
  );
  page.append(head);

  const actions = element("div", "start-actions");
  for (const [label, act, hint] of ACTIONS) {
    const button = element("button", "start-action");
    button.type = "button";
    button.dataset.act = act;
    const key = element("kbd", "", hint);
    button.append(element("span", "", label), key);
    actions.append(button);
  }
  page.append(actions);

  const recent = recentNotes(prefs.value.vaults[root]?.recent)
    .filter((entry) => vault.index.notes.includes(entry.path))
    .slice(0, RECENT_SHOWN);
  if (recent.length) {
    const list = element("div", "start-list");
    list.append(element("h2", "start-label", "Recently open"));
    for (const { path, at } of recent) list.append(recentRow(vault, path, at));
    page.append(list);
  }
  return page;
}
