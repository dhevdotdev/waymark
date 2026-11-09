import type { PrefStore } from "../prefs";
import { unifiedDiff } from "../vault/line-diff";
import { diffWithPrefs } from "./diff";
import { el, openSheet } from "./git-panel-parts";

export interface ConflictCompare {
  title: string;
  path: string;
  disk: string;
  mine: string;
  prefs: PrefStore;
  keepBoth: () => void;
  keepMine: () => void;
  useOther: () => void;
}

/** A read-only look at both sides of a conflict, with the same choices as the bar above the note. */
export function showConflictCompare(options: ConflictCompare): void {
  const { title, path, disk, mine, prefs, keepBoth, keepMine, useOther } = options;
  const content = el("div");
  const bar = el("div", "sheet-actions");
  const choice = (label: string, tip: string, run: () => void, primary = false) => {
    const button = el("button", primary ? "btn btn-primary btn-small" : "btn btn-small", label);
    button.dataset.tip = tip;
    button.onclick = run;
    return button;
  };
  bar.append(
    choice("Keep both", "Saves yours as a copy and shows the other version", keepBoth, true),
    choice("Keep mine", "The other version goes to the Trash", keepMine),
    choice("Use other version", "Your version goes to the Trash", useOther),
  );
  const key = el("p", "compare-key");
  key.append(el("span", "is-del", "Only in the other version"), el("span", "is-add", "Only in yours"));
  content.append(bar, key, diffWithPrefs(prefs, unifiedDiff(path, disk, mine), "The two versions are identical."));
  openSheet(title, "Your version and the one now on disk", content);
}
