import type { OpenRequest } from "./vault/open-request";
import type { FileStat, VaultSettings, VaultSource, WriteOutcome } from "./vault/source";

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
  | "noteConflict"
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

export interface BackupReport {
  outcome: "locked" | "nothing" | "ran";
  committed: boolean;
  pushed: boolean;
  problem: { kind: GitErrorKind; message: string } | null;
  status: GitStatus;
}

export interface CaptureRequest {
  id: number;
  text: string;
}

export type CaptureAnswer = { id: number; saved: string } | { id: number; problem: string };

export interface VaultInfo {
  root: string;
  name: string;
  isGit: boolean;
}

type InvokeBody = Record<string, unknown> | Uint8Array;
type InvokeOptions = { headers: Record<string, string> };
type Invoke = <T>(cmd: string, args?: InvokeBody, options?: InvokeOptions) => Promise<T>;
let invokeImpl: Invoke | null = null;

async function call<T>(cmd: string, args?: InvokeBody, options?: InvokeOptions): Promise<T> {
  if (!isDesktop) throw new GitError("other", "Available in the desktop app");
  invokeImpl ??= (await import("@tauri-apps/api/core")).invoke as Invoke;
  try {
    return await invokeImpl<T>(cmd, args, options);
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
  existingFolders: (paths: string[]) => call<boolean[]>("existing_folders", { paths }),
  reveal: (path?: string) => call<void>("reveal", { path }),
  clipboardText: () => (isDesktop ? call<string>("clipboard_text") : navigator.clipboard.readText()),
  copyText: (text: string) => (isDesktop ? call<void>("clipboard_write", { text }) : navigator.clipboard.writeText(text)),
  setDockIcon: (family: string) => call<void>("set_dock_icon", { family }),
  /** Shows the window, which launch keeps hidden until the page has its theme, painted in the page's colour. */
  showWindow: (paper: [number, number, number]) => call<void>("show_window", { paper }),
  async setWindowColor(color: [number, number, number]): Promise<void> {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setBackgroundColor(color);
  },
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
  menuItems: () => call<{ id: string; keys: string | null; enabled: boolean }[]>("menu_items"),
  setMenuEnabled: (states: Record<string, boolean>) => call<void>("set_menu_enabled", { states }),
  /** Notes handed over by Finder or a waymark:// link since the last call. */
  takeOpenRequests: () => (isDesktop ? call<OpenRequest[]>("take_open_requests") : Promise.resolve([])),
  async onOpenRequests(handler: () => void): Promise<void> {
    if (!isDesktop) return;
    const { listen } = await import("@tauri-apps/api/event");
    await listen("open-requests", handler);
  },
  setCaptureShortcut: (accelerator: string) => call<void>("set_capture_shortcut", { accelerator }),
  closeCapture: (lingerMs: number, returnFocus: boolean) => call<void>("capture_close", { lingerMs, returnFocus }),
  /** The capture window hands its text to the main window, which owns the vault. */
  async onCaptureSave(handler: (request: CaptureRequest) => void): Promise<void> {
    if (!isDesktop) return;
    const { listen } = await import("@tauri-apps/api/event");
    await listen<CaptureRequest>("capture-save", (e) => handler(e.payload));
  },
  async answerCapture(answer: CaptureAnswer): Promise<void> {
    if (!isDesktop) return;
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("capture", "capture-saved", answer);
  },
  async askToCapture(request: CaptureRequest): Promise<void> {
    const { emitTo } = await import("@tauri-apps/api/event");
    await emitTo("main", "capture-save", request);
  },
  async onCaptureEvent(event: "capture-open" | "capture-saved", handler: (payload: unknown) => void): Promise<void> {
    if (!isDesktop) return;
    const { listen } = await import("@tauri-apps/api/event");
    await listen(event, (e) => handler(e.payload));
  },
  async onMenuCommand(handler: (id: string) => void): Promise<void> {
    if (!isDesktop) return;
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>("menu-command", (e) => handler(e.payload));
  },
  async onVaultChanged(handler: (paths: string[]) => void): Promise<void> {
    if (!isDesktop) return;
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ paths: string[] }>("vault-changed", (e) => handler(e.payload.paths));
  },
  /** Runs `save` when the app is about to quit, then lets it finish. */
  async saveBeforeQuit(save: () => Promise<unknown>): Promise<void> {
    if (!isDesktop) return;
    const { listen } = await import("@tauri-apps/api/event");
    await listen("save-before-quit", () => {
      void save()
        .catch(() => {})
        .finally(() => void call<void>("finish_quit"));
    });
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
  backup: (message: string) => call<BackupReport>("git_backup", { message }),
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
    fileStats: (paths) => call<Record<string, FileStat>>("file_stats", { paths }),
    readMany: (paths) => call<(string | null)[]>("read_many", { paths }),
    writeNote: (path, text, expected) => call<WriteOutcome>("write_note", { path, text, expected }),
    renameNote: (from, to) => call<void>("rename_note", { from, to }),
    trashNote: (path) => call<number>("trash_note", { path }),
    untrash: (token) => call<void>("untrash", { token }),
    keepInTrash: (name, text) => call<void>("keep_in_trash", { name, text }),
    renameFolder: (from, to) => call<void>("rename_folder", { from, to }),
    trashFolder: (path) => call<number>("trash_folder", { path }),
    writeAttachment: (path, bytes) => call<void>("write_attachment", bytes, { headers: { "x-path": encodeURIComponent(path) } }),
    settings: () => call<VaultSettings>("vault_settings"),
    assetUrl: (path) => `vault://localhost/${path.split("/").map(encodeURIComponent).join("/")}`,
  };
}
