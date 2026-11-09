import type { FileChange, GitErrorKind, GitStatus } from "../platform";
import type { SyncState } from "./git-panel";

type SyncTone = "ok" | "off" | "busy" | "warn" | "incoming" | "outgoing" | "changed";

export interface SyncSummary {
  tone: SyncTone;
  text: string;
  tip: string;
}

const ERROR_LABELS: Partial<Record<GitErrorKind, string>> = {
  offline: "Offline",
  auth: "Sign-in needed",
  diverged: "Diverged",
  localChangesBlock: "Blocked",
  rejected: "Push rejected",
  timeout: "Timed out",
};

/** What the status bar says about the vault's relationship with its remote. The first matching state wins. */
export function describeSync(
  status: GitStatus | null,
  state: SyncState,
  context: { desktop: boolean; everSynced: boolean },
): SyncSummary {
  if (!context.desktop) return { tone: "off", text: "Preview", tip: "Git sync runs in the desktop app" };
  if (state.kind === "busy") return { tone: "busy", text: state.label, tip: state.label };
  if (!status?.isRepo) return { tone: "off", text: "Local", tip: "This vault is not a Git repository" };
  if (state.kind === "error") {
    const { kind, message } = state.error;
    return { tone: kind === "offline" ? "off" : "warn", text: ERROR_LABELS[kind] ?? "Sync problem", tip: message.split("\n")[0] };
  }
  const { ahead, behind, files, operation, upstream } = status;
  if (operation) return { tone: "warn", text: `${operation} in progress`, tip: "Finish it in a terminal" };
  if (ahead && behind) return { tone: "warn", text: "Diverged", tip: `${ahead} local and ${behind} remote commits` };
  if (behind) return { tone: "incoming", text: `${behind} incoming`, tip: "Press Sync to apply" };
  if (ahead) return { tone: "outgoing", text: `${ahead} to push`, tip: "Committed here, not yet pushed" };
  if (files.length) return { tone: "changed", text: `${files.length} changed`, tip: "Saved here, not committed yet" };
  if (!upstream) return { tone: "off", text: "No remote", tip: "This branch does not track a remote branch" };
  if (!context.everSynced) return { tone: "off", text: "Not checked", tip: "Press Sync to compare with the remote" };
  return { tone: "ok", text: "Synced", tip: "Up to date with the remote" };
}

const NOTE_OR_MEDIA = /\.(md|png|jpe?g|gif|webp|avif|svg|pdf)$/i;

/**
 * What Commit & Sync takes when nothing is staged: the notes and their files.
 * Obsidian's settings, other hidden files and stray untracked files stay out
 * unless the user stages them.
 */
export function autoStagePaths(files: FileChange[]): string[] {
  return files
    .filter((f) => !f.path.split("/").some((part) => part.startsWith(".")))
    .filter((f) => f.unstaged !== "?" || NOTE_OR_MEDIA.test(f.path))
    .map((f) => f.path);
}
