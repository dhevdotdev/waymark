import { type GitStatus, isDesktop } from "../platform";
import type { PrefStore } from "../prefs";
import { type GitHost, GitPanel, type SyncState } from "./git-panel";
import type { ShellElements } from "./shell";
import { describeSync } from "./sync-status";

const REFRESH_DEBOUNCE_MS = 400;
const FOCUS_CHECK_AFTER_MS = 2 * 60_000;

export interface SyncControllerDeps {
  els: Pick<ShellElements, "sync" | "branch">;
  prefs: PrefStore;
  root: string;
  panelHost: Omit<GitHost, "prefs" | "lastSync" | "setLastSync" | "onVisible" | "onStatus">;
  onStatusChanged: () => void;
}

/** Keeps the status bar and the sync panel in step with the repository. Background work only ever fetches. */
export class SyncController {
  readonly panel: GitPanel;
  private backgroundTimer = 0;
  private refreshTimer = 0;

  constructor(private readonly deps: SyncControllerDeps) {
    const { els, prefs, root, panelHost } = deps;
    this.panel = new GitPanel({
      ...panelHost,
      prefs,
      lastSync: () => prefs.value.vaults[root]?.lastSync ?? null,
      setLastSync: (at) =>
        prefs.update((p) => {
          p.vaults[root] ??= { tabs: [], active: 0, lastSync: null };
          p.vaults[root].lastSync = at;
        }),
      onVisible: (open) => els.sync.classList.toggle("is-on", open),
      onStatus: (status, state) => this.render(status, state),
    });
    this.render(null, { kind: "idle" });
  }

  async start(): Promise<void> {
    if (!isDesktop) return;
    await this.panel.refresh();
    if (this.panel.status?.isRepo && this.deps.prefs.value.syncOnLaunch) void this.panel.fetch(true);
    this.scheduleBackground();
    window.addEventListener("focus", this.checkOnFocus);
  }

  scheduleBackground(): void {
    clearInterval(this.backgroundTimer);
    const minutes = this.deps.prefs.value.backgroundMinutes;
    if (!minutes || !isDesktop) return;
    this.backgroundTimer = window.setInterval(() => {
      if (this.panel.status?.isRepo && this.panel.state.kind !== "busy") void this.panel.fetch(true);
    }, minutes * 60_000);
  }

  /** Re-reads Git status soon, coalescing the bursts of events a single Git operation produces. */
  scheduleRefresh(): void {
    if (!isDesktop) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      if (this.panel.state.kind !== "busy") void this.panel.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  /** Coming back to the window is when a stale view of the remote matters most. Fetch only. */
  private readonly checkOnFocus = (): void => {
    const { prefs, root } = this.deps;
    const last = prefs.value.vaults[root]?.lastSync ?? 0;
    if (!prefs.value.backgroundMinutes || Date.now() - last < FOCUS_CHECK_AFTER_MS) return;
    if (this.panel.status?.isRepo && this.panel.state.kind !== "busy") void this.panel.fetch(true);
  };

  dispose(): void {
    window.removeEventListener("focus", this.checkOnFocus);
    clearInterval(this.backgroundTimer);
    clearTimeout(this.refreshTimer);
  }

  private render(status: GitStatus | null, state: SyncState): void {
    const { els, prefs, root, onStatusChanged } = this.deps;
    const branch = isDesktop && status?.isRepo ? status.branch : null;
    els.branch.hidden = !branch;
    els.branch.lastElementChild!.textContent = branch ?? "";
    const summary = describeSync(status, state, { desktop: isDesktop, everSynced: prefs.value.vaults[root]?.lastSync != null });
    els.sync.dataset.tone = summary.tone;
    els.sync.querySelector(".sync-label")!.textContent = summary.text;
    els.sync.dataset.tip = summary.tip;
    onStatusChanged();
  }
}
