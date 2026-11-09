import { native } from "../platform";
import { ancestors } from "../vault/tree";
import { type Command, labelOf } from "./commands";
import { toast } from "./overlays";
import type { PaletteItem } from "./palette";
import type { Reader } from "./reader";
import { applySound } from "./settings";

const TEXT_SCALE_STEP = 0.0625;
const TEXT_SCALE_MIN = 0.8125;
const TEXT_SCALE_MAX = 1.375;
const RECENT_NOTES = 10;
const RECENT_COMMANDS = 5;

function scaleText(step: -1 | 0 | 1): void {
  const root = document.documentElement;
  const now = Number(root.style.getPropertyValue("--text-scale") || 1);
  const next = step === 0 ? 1 : Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, now + step * TEXT_SCALE_STEP));
  root.style.setProperty("--text-scale", String(next));
  toast(`Text size ${Math.round(next * 100)}%`);
}

/** Every command in the app. The palette, the keyboard and `data-act` buttons all run from this one table. */
export function readerCommands(r: Reader): Command[] {
  const { deps } = r;
  const { prefs } = deps;
  const dark = () => deps.scheme() === "dark";
  const toggleAppearance = () => deps.setAppearance(dark() ? "light" : "dark");
  const tabNumbers: Command[] = Array.from({ length: 9 }, (_, i) => ({
    id: `tab-${i + 1}`,
    keys: [`mod+${i + 1}`],
    run: () => r.switchTab(i === 8 ? r.workspace.tabs.length - 1 : Math.min(i, r.workspace.tabs.length - 1)),
  }));

  return [
    { id: "palette", keys: ["mod+k", "mod+o", "mod+p"], inField: true, run: () => r.palette.open() },
    { id: "new-tab", keys: ["mod+t"], inField: true, run: () => r.newTab() },
    {
      id: "edit",
      label: () => (r.editing.isOpen ? "Back to reading" : "Edit this note"),
      keys: ["mod+e"],
      hint: "⌘E",
      keywords: "write change",
      inField: true,
      needsNote: true,
      run: () => void r.editing.toggle(),
    },
    { id: "new-note", label: "New note", keys: ["mod+n"], hint: "⌘N", inField: true, run: () => void r.files.newNote() },
    { id: "new-folder", label: "New folder", run: () => void r.files.newFolder() },
    { id: "collapse-folders", label: "Collapse all folders", run: () => r.sidebar.tree.collapseAll() },
    {
      id: "rename-note",
      label: "Rename this note",
      keywords: "title",
      keys: ["f2"],
      hint: "F2",
      inField: true,
      needsNote: true,
      run: () => void r.files.startRename(r.current),
    },
    { id: "move-note", label: "Move this note", keywords: "folder", needsNote: true, run: () => r.files.promptMove(r.current) },
    {
      id: "delete-note",
      label: "Move this note to the Trash",
      keywords: "delete remove",
      needsNote: true,
      run: () => void r.files.remove(r.current),
    },
    { id: "mode-edit", needsNote: true, run: () => void r.editing.open() },
    { id: "mode-read", needsNote: true, run: () => (r.editing.isOpen ? void r.editing.finish() : undefined) },
    { id: "save-note", keys: ["mod+s"], inField: true, run: () => void r.editing.flush() },
    { id: "undo-task", keys: ["mod+z"], run: () => void r.editing.undoTask() },
    {
      id: "files",
      label: "Show files",
      keys: ["mod+shift+e"],
      hint: "⌘⇧E",
      keywords: "folders tree sidebar",
      inField: true,
      run: () => r.sidebar.showFiles(),
    },
    {
      id: "search",
      label: "Search inside notes",
      keys: ["mod+shift+f"],
      hint: "⌘⇧F",
      keywords: "find full text",
      inField: true,
      run: (origin) => r.sidebar.showSearch(origin === "key" ? window.getSelection()?.toString().trim() || undefined : undefined),
    },
    {
      id: "graph",
      label: "Show graph of the vault",
      keys: ["mod+g"],
      hint: "⌘G",
      inField: true,
      when: () => !r.workspace.isEmpty,
      run: (origin) => (origin === "palette" ? r.openGraph("vault") : r.toggleGraph()),
    },
    {
      id: "graph-local",
      label: "Show graph around this note",
      keys: ["mod+shift+g"],
      hint: "⌘⇧G",
      keywords: "local links",
      inField: true,
      needsNote: true,
      run: () => r.openGraph("local"),
    },
    {
      id: "find",
      label: "Find in this note",
      keys: ["mod+f"],
      hint: "⌘F",
      inField: true,
      needsNote: true,
      run: () => {
        if (!r.editing.find()) r.find.open();
      },
    },
    {
      id: "sidebar",
      label: "Toggle sidebar",
      keys: ["mod+\\"],
      hint: "⌘\\",
      run: (origin) => (origin === "key" ? r.sidebar.toggleInstantly() : r.sidebar.toggle()),
    },
    {
      id: "rail",
      label: "Toggle inspector",
      keys: ["mod+alt+\\"],
      hint: "⌥⌘\\",
      keywords: "linked notes properties",
      run: () => r.toggleRail(),
    },
    {
      id: "settings",
      label: "Change theme…",
      keys: ["mod+,"],
      hint: "⌘,",
      keywords: "appearance colour",
      inField: true,
      run: () => r.openSettings(),
    },
    {
      id: "appearance",
      label: () => (dark() ? "Use light appearance" : "Use dark appearance"),
      keys: ["mod+shift+l"],
      hint: "⌘⇧L",
      inField: true,
      run: toggleAppearance,
    },
    {
      id: "sound",
      label: () => (prefs.value.sound ? "Mute sounds" : "Turn sounds on"),
      keywords: "audio mute",
      run: () => applySound(prefs, deps.sound, !prefs.value.sound),
    },
    {
      id: "typing-sounds",
      label: () => (prefs.value.typingSounds ? "Turn off typing sounds" : "Turn on typing sounds"),
      keywords: "mechanical keyboard click audio",
      run: () =>
        prefs.update((p) => {
          p.typingSounds = !p.typingSounds;
        }),
    },
    { id: "text-bigger", label: "Make text larger", keys: ["mod+=", "mod+shift+="], hint: "⌘+", run: () => scaleText(1) },
    { id: "text-smaller", label: "Make text smaller", keys: ["mod+-"], hint: "⌘−", run: () => scaleText(-1) },
    { id: "text-reset", label: "Reset text size", keys: ["mod+0"], hint: "⌘0", run: () => scaleText(0) },
    {
      id: "sync",
      label: "Sync now",
      keys: ["mod+shift+s"],
      hint: "⌘⇧S",
      keywords: "git pull fetch update",
      inField: true,
      desktop: true,
      run: () => void r.sync.panel.sync(),
    },
    {
      id: "commit-sync",
      label: "Commit and sync",
      keys: ["mod+alt+s"],
      hint: "⌥⌘S",
      keywords: "git save push pull",
      inField: true,
      desktop: true,
      run: () => r.sync.panel.openCommit(),
    },
    {
      id: "sync-panel",
      label: "Show changes and sync",
      keys: ["mod+shift+y"],
      hint: "⌘⇧Y",
      keywords: "git status commit push",
      inField: true,
      desktop: true,
      run: (origin) => r.openSyncPanel(origin === "click" ? "click" : "other"),
    },
    {
      id: "history",
      label: "Show history of this note",
      keys: ["mod+shift+h"],
      hint: "⌘⇧H",
      keywords: "git log revisions",
      inField: true,
      desktop: true,
      needsNote: true,
      run: () => r.sync.panel.open(undefined, { historyPath: r.current }),
    },
    {
      id: "vault-history",
      label: "Show history of the vault",
      keywords: "git log",
      desktop: true,
      run: () => r.sync.panel.open(undefined, { historyPath: null }),
    },
    { id: "reveal", label: "Reveal note in Finder", desktop: true, needsNote: true, run: () => void native.reveal(r.current) },
    { id: "terminal", label: "Open vault in Terminal", desktop: true, run: () => void native.openTerminal() },
    { id: "open-vault", label: "Open another vault…", desktop: true, run: () => deps.openAnotherVault() },
    { id: "close-vault", label: "Close vault", desktop: true, run: () => deps.closeVault() },
    {
      id: "push",
      label: () => {
        const ahead = r.sync.panel.status?.ahead ?? 0;
        return `Push ${ahead} commit${ahead === 1 ? "" : "s"}`;
      },
      desktop: true,
      when: () => {
        const status = r.sync.panel.status;
        return Boolean(status?.ahead && !status.behind);
      },
      run: () => r.sync.panel.open(),
    },
    { id: "back", keys: ["mod+["], needsNote: true, run: () => void r.go(-1) },
    { id: "forward", keys: ["mod+]"], needsNote: true, run: () => void r.go(1) },
    { id: "previous-tab", keys: ["mod+shift+[", "ctrl+shift+tab"], needsNote: true, inField: true, run: () => r.cycleTab(-1) },
    { id: "next-tab", keys: ["mod+shift+]", "ctrl+tab"], needsNote: true, inField: true, run: () => r.cycleTab(1) },
    { id: "close-tab", keys: ["mod+w"], needsNote: true, run: () => r.closeTab(r.workspace.activeIndex) },
    ...tabNumbers,
  ];
}

function commandItem(command: Command): PaletteItem {
  return {
    id: command.id,
    label: labelOf(command) ?? command.id,
    hint: command.hint,
    keywords: command.keywords,
    group: "Commands",
    run: () => command.run("palette"),
  };
}

function noteItem(r: Reader, path: string, group: string): PaletteItem {
  return {
    id: path,
    label: r.vault.index.title(path),
    detail: ancestors(path).at(-1),
    group,
    keywords: path,
    run: ({ newTab }) => void r.open(path, { newTab, focus: true, keyboard: true }),
  };
}

export function paletteItems(r: Reader, query: string): PaletteItem[] {
  const commands = r.commands.listed().map(commandItem);
  if (query.startsWith(">")) return commands;
  return [...r.vault.index.notes.map((p) => noteItem(r, p, "Notes")), ...commands];
}

/** Notes visited in any open tab, then the commands used most. */
export function paletteRecent(r: Reader): PaletteItem[] {
  const seen = new Set(r.onBlank ? [] : [r.current]);
  const items: PaletteItem[] = [];
  for (const tab of r.workspace.tabs) {
    for (const view of tab.trail.views()) {
      if (view.kind !== "note" || seen.has(view.path)) continue;
      seen.add(view.path);
      items.push(noteItem(r, view.path, "Recent"));
    }
  }
  return [...items.slice(0, RECENT_NOTES), ...r.commands.listed().slice(0, RECENT_COMMANDS).map(commandItem)];
}
