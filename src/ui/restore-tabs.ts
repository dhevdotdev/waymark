import type { VaultIndex } from "../vault/index";
import type { View } from "../vault/trail";
import type { Workspace } from "../vault/workspace";

interface SavedTabs {
  tabs: unknown[];
  active?: number;
  pinned?: number[];
}

/** Whether what a saved or closed tab shows is still in the vault. */
export function viewExists(index: VaultIndex, view: View): boolean {
  if (view.kind === "base") return index.bases.includes(view.path);
  return view.kind !== "blank" && index.notes.includes(view.kind === "note" ? view.path : view.note);
}

/** Opens the note asked for, otherwise the tabs saved last time, otherwise a sensible first note. */
export function restoreTabs(workspace: Workspace, index: VaultIndex, saved: SavedTabs | undefined, initial?: string): void {
  const wanted = initial ? index.resolve(initial) : null;
  if (wanted?.kind === "found") {
    workspace.startWith({ kind: "note", path: wanted.path });
  } else if (saved?.tabs?.length) {
    workspace.restore({ tabs: saved.tabs, active: saved.active ?? 0, pinned: saved.pinned }, (view) => viewExists(index, view));
  }
  if (workspace.isEmpty) {
    const fallback = index.notes.find((p) => /^(readme|index|home)\.md$/i.test(p)) ?? index.notes[0];
    if (fallback) workspace.startWith({ kind: "note", path: fallback });
  }
}
