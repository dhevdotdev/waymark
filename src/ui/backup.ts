import { type BackupReport, GitError, git } from "../platform";
import type { PrefStore } from "../prefs";
import type { GitPanel } from "./git-panel";
import { EXPLAIN } from "./git-panel-parts";
import type { Cue } from "./sound";

const MINUTE_MS = 60_000;
/** A lock older than an hour of skipped runs is no longer another process at work. */
const LOCKED_RUNS_BEFORE_TELLING = 6;

function backupMessage(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `vault backup: ${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export interface BackupDeps {
  prefs: PrefStore;
  root: string;
  panel: GitPanel;
  flushEdits: () => Promise<boolean>;
  toast: (message: string) => void;
  play: (cue: Cue) => void;
}

/** Commits and pushes on a schedule, once the user has turned it on. A routine run is silent. */
export class Backup {
  private timer = 0;
  private running: Promise<void> | null = null;
  private lockedRuns = 0;
  private reported = "";

  constructor(private readonly deps: BackupDeps) {}

  /** Resolves once no backup is under way, so a manual sync never races one. */
  finished(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  schedule(): void {
    clearInterval(this.timer);
    const minutes = this.deps.prefs.value.backupMinutes;
    if (minutes) this.timer = window.setInterval(() => void this.run(), minutes * MINUTE_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
  }

  /** One run. A run already under way, or a manual Git action, means this tick is skipped. */
  run(): Promise<void> {
    const { prefs, panel } = this.deps;
    if (this.running || !prefs.value.backupMinutes || panel.state.kind === "busy" || !panel.status?.isRepo) {
      return Promise.resolve();
    }
    this.running = this.attempt().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async attempt(): Promise<void> {
    const { flushEdits, panel } = this.deps;
    if (!(await flushEdits())) {
      this.tell(new GitError("noteConflict", "A note being edited is waiting for a choice, so the backup did not run."));
      return;
    }
    let result: BackupReport;
    try {
      result = await git.backup(backupMessage(new Date()));
    } catch (error) {
      this.tell(error instanceof GitError ? error : new GitError("other", String(error)));
      return;
    }
    panel.status = result.status;
    if (result.outcome === "locked") {
      this.lockedRuns += 1;
      if (this.lockedRuns >= LOCKED_RUNS_BEFORE_TELLING) {
        this.tell(new GitError("other", "Git's index.lock file has been in place for an hour, so backups are not running."));
      } else {
        panel.backupFinished(null);
      }
      return;
    }
    this.lockedRuns = 0;
    this.remember(result);
    if (result.problem) this.tell(new GitError(result.problem.kind, result.problem.message));
    else this.clear();
  }

  private remember(result: BackupReport): void {
    const { prefs, root } = this.deps;
    const reached = !result.problem && result.status.ahead === 0 && Boolean(result.status.upstream);
    prefs.update((p) => {
      p.vaults[root] ??= { tabs: [], active: 0, lastSync: null };
      p.vaults[root].lastBackup = { at: Date.now(), reached };
      if (reached) p.vaults[root].lastSync = Date.now();
    });
  }

  private clear(): void {
    this.reported = "";
    this.deps.panel.backupFinished(null);
  }

  /** Shows a problem in the sync indicator and panel. It is announced once, until the problem changes. */
  private tell(error: GitError): void {
    const { panel, toast, play } = this.deps;
    panel.backupFinished(error);
    const key = `${error.kind}:${error.message.split("\n")[0]}`;
    if (key === this.reported) return;
    this.reported = key;
    if (error.kind === "offline") return;
    play("problem");
    toast(`Backup stopped: ${EXPLAIN[error.kind]?.title ?? "Git reported a problem"}. Open Sync for details.`);
  }
}
