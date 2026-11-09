import type { VaultSource } from "./vault/source";

export const isDesktop = "__TAURI_INTERNALS__" in window;

export type GitErrorKind =
  | "offline"
  | "auth"
  | "diverged"
  | "localChangesBlock"
  | "rejected"
  | "notARepo"
  | "noUpstream"
  | "inProgress"
  | "timeout"
  | "other";

export class GitError extends Error {
  constructor(
    readonly kind: GitErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface FileChange {
  path: string;
  origPath: string | null;
  staged: string;
  unstaged: string;
  conflicted: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
  operation: string | null;
}

export interface Commit {
  sha: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  path: string | null;
}

export interface VaultInfo {
  root: string;
  name: string;
  isGit: boolean;
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeImpl: Invoke | null = null;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) throw new GitError("other", "Available in the desktop app");
  invokeImpl ??= (await import("@tauri-apps/api/core")).invoke as Invoke;
  try {
    return await invokeImpl<T>(cmd, args);
  } catch (err) {
    if (err && typeof err === "object" && "kind" in err) {
      const e = err as { kind: GitErrorKind; message: string };
      throw new GitError(e.kind, e.message);
    }
    throw new GitError("other", String(err));
  }
}

export const native = {
  openVault: (path: string) => call<VaultInfo>("open_vault", { path }),
  reveal: (path?: string) => call<void>("reveal", { path }),
  setDockIcon: (family: string) => call<void>("set_dock_icon", { family }),
  openTerminal: () => call<void>("open_terminal"),
  readPrefs: () => call<Record<string, unknown>>("read_prefs"),
  writePrefs: (prefs: unknown) => call<void>("write_prefs", { prefs }),
  async pickFolder(title: string): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ directory: true, multiple: false, title });
    return typeof result === "string" ? result : null;
  },
  async openExternal(url: string): Promise<void> {
    if (!isDesktop) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  },
  async onVaultChanged(handler: (paths: string[]) => void): Promise<void> {
    if (!isDesktop) return;
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ paths: string[] }>("vault-changed", (e) => handler(e.payload.paths));
  },
  async onCloneProgress(handler: (line: string) => void): Promise<() => void> {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("clone-progress", (e) => handler(e.payload));
  },
};

export const git = {
  status: () => call<GitStatus>("git_status"),
  fetch: () => call<GitStatus>("git_fetch"),
  fastForward: () => call<GitStatus>("git_fast_forward"),
  push: () => call<GitStatus>("git_push"),
  stage: (paths: string[]) => call<GitStatus>("git_stage", { paths }),
  unstage: (paths: string[]) => call<GitStatus>("git_unstage", { paths }),
  commit: (message: string) => call<GitStatus>("git_commit", { message }),
  diff: (path: string, staged: boolean, untracked: boolean) => call<string>("git_diff", { path, staged, untracked }),
  log: (path: string | null, limit = 50, skip = 0) => call<Commit[]>("git_log", { path, limit, skip }),
  show: (sha: string, path: string | null) => call<string>("git_show", { sha, path }),
  fileAt: (sha: string, path: string) => call<string>("git_file_at", { sha, path }),
  diffRevs: (from: string, to: string, path: string) => call<string>("git_diff_revs", { from, to, path }),
  storeCredential: (url: string, username: string, secret: string) =>
    call<void>("git_store_credential", { url, username, secret }),
  clone: (url: string, dest: string) => call<void>("git_clone", { url, dest }),
};

export function desktopVaultSource(): VaultSource {
  return {
    list: () => call<string[]>("list_files"),
    readText: (path) => call<string>("read_text", { path }),
    readMany: (paths) => call<(string | null)[]>("read_many", { paths }),
    assetUrl: (path) => `vault://localhost/${path.split("/").map(encodeURIComponent).join("/")}`,
  };
}
