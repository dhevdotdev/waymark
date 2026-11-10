import { native } from "../platform";
import type { Reader } from "./reader";

type States = Record<string, boolean>;

/** Keeps the menu bar honest: an item that cannot run now is greyed out. */
export async function bindAppMenu(reader: Reader): Promise<void> {
  const items = await native.menuItems();
  const { workspace, commands } = reader;
  const extra: Record<string, () => boolean> = {
    back: () => workspace.active.trail.canBack,
    forward: () => workspace.active.trail.canForward,
    "reopen-tab": () => workspace.hasClosed,
    "close-tab": () => workspace.tabs.length > 1 && !workspace.active.pinned,
    "next-tab": () => workspace.tabs.length > 1,
    "previous-tab": () => workspace.tabs.length > 1,
  };
  let shown: States = {};
  const update = () => {
    if (workspace.isEmpty) return;
    const next: States = {};
    for (const { id } of items) next[id] = commands.canRun(id) && (extra[id]?.() ?? true);
    const changed = Object.fromEntries(Object.entries(next).filter(([id, on]) => shown[id] !== on));
    shown = next;
    if (Object.keys(changed).length) void native.setMenuEnabled(changed);
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  }).observe(reader.els.tabs, { childList: true, subtree: true, characterData: true, attributes: true });
  update();
}
