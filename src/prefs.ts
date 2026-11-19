import { isDesktop, native } from "./platform";
import { FAMILIES } from "./themes";

interface VaultState {
  /** One saved trail per tab. Read through Trail.restore, which validates it. */
  tabs: unknown[];
  active: number;
  lastSync: number | null;
  openFolders?: string[];
  /** Notes opened lately, newest first, for the new-tab page. */
  recent?: { path: string; at: number }[];
  /** Where reading stopped in each note. Read through ReadingSpots, which validates it. */
  spots?: Record<string, { line: number; offset: number; at: number } | undefined>;
  /** Folded headings in each note, by heading key. Read through FoldStore, which validates them. */
  folds?: Record<string, unknown>;
  /** Saved notes and headings. Read through Bookmarks, which validates them. */
  bookmarks?: unknown[];
  bookmarksClosed?: boolean;
  /** When the last backup ran, and whether everything had reached the remote afterwards. */
  lastBackup?: { at: number; reached: boolean };
}

export type SwitchProfile = "linear" | "tactile" | "clicky";
export type KeyVolume = "soft" | "medium" | "loud";

export interface Prefs {
  lastVault: string | null;
  recentVaults: string[];
  vaults: Record<string, VaultState>;
  family: string;
  appearance: "system" | "light" | "dark";
  sound: boolean;
  syncOnLaunch: boolean;
  backgroundMinutes: number;
  /** Minutes between automatic commits and pushes. Zero is off, which is the default. */
  backupMinutes: number;
  /** Set once the remote-check defaults have been applied, so turning a check off afterwards sticks. */
  remoteChecksApplied: boolean;
  sidebar: boolean;
  rail: boolean;
  railPane: "links" | "info";
  trailFolded: boolean;
  graphFolded: boolean;
  sidebarWidth: number;
  railWidth: number;
  /** Heights dragged for the panel's sections. Zero leaves a section to size itself. */
  trailHeight: number;
  graphHeight: number;
  /** How notes are ordered within a folder. Kept with the app's preferences, never in the vault. */
  fileSort: "name" | "modified";
  diffWrap: boolean;
  keySound: SwitchProfile | "off";
  keyVolume: KeyVolume;
  /** The global shortcut for quick capture, as Tauri writes it. Empty turns capture off. */
  captureShortcut: string;
}

const DEFAULTS: Prefs = {
  lastVault: null,
  recentVaults: [],
  vaults: {},
  family: "ember",
  appearance: "system",
  sound: true,
  syncOnLaunch: true,
  backgroundMinutes: 15,
  backupMinutes: 0,
  remoteChecksApplied: true,
  sidebar: true,
  rail: true,
  railPane: "links",
  trailFolded: false,
  graphFolded: false,
  sidebarWidth: 268,
  railWidth: 256,
  trailHeight: 0,
  graphHeight: 0,
  fileSort: "name",
  diffWrap: true,
  keySound: "tactile",
  keyVolume: "medium",
  captureShortcut: "Control+Alt+Space",
};

const LOCAL_KEY = "waymark.prefs";

/** Every preference that is one of a fixed set. A saved value outside its set takes the default. */
const CHOICES: { [K in keyof Prefs]?: readonly Prefs[K][] } = {
  family: FAMILIES.map((f) => f.id),
  appearance: ["system", "light", "dark"],
  railPane: ["links", "info"],
  fileSort: ["name", "modified"],
  keySound: ["off", "linear", "tactile", "clicky"],
  keyVolume: ["soft", "medium", "loud"],
};

/** Read from disk or browser storage, so each key is checked and falls back to its own default. */
function parsePrefs(raw: unknown): Prefs {
  const prefs = structuredClone(DEFAULTS);
  if (typeof raw !== "object" || raw === null) return prefs;
  const saved = raw as Record<string, unknown>;
  const target = prefs as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Prefs)[]) {
    const value = saved[key];
    const fallback = DEFAULTS[key];
    const sameShape =
      key === "lastVault"
        ? value === null || typeof value === "string"
        : Array.isArray(fallback)
          ? Array.isArray(value)
          : typeof value === typeof fallback && value !== null;
    const choices = CHOICES[key] as readonly unknown[] | undefined;
    if (sameShape && (!choices || choices.includes(value))) target[key] = value;
  }
  if (saved.remoteChecksApplied !== true) {
    prefs.syncOnLaunch = DEFAULTS.syncOnLaunch;
    prefs.backgroundMinutes = DEFAULTS.backgroundMinutes;
  }
  return prefs;
}

/** Preferences live in Application Support (desktop) or browser storage (dev), never in the vault. */
export class PrefStore {
  value: Prefs = structuredClone(DEFAULTS);
  /** Self-tests run with throwaway preferences so they never touch the user's. */
  ephemeral = false;
  private timer = 0;

  async load(): Promise<void> {
    if (this.ephemeral) {
      this.value.syncOnLaunch = false;
      this.value.backgroundMinutes = 0;
      return;
    }
    let raw: unknown = {};
    try {
      raw = isDesktop ? await native.readPrefs() : JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
    } catch {
      raw = {};
    }
    this.value = parsePrefs(raw);
  }

  update(change: (p: Prefs) => void): void {
    change(this.value);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.ephemeral) return;
    try {
      if (isDesktop) await native.writePrefs(this.value);
      else localStorage.setItem(LOCAL_KEY, JSON.stringify(this.value));
    } catch {
      /* Losing a preference write must never interrupt reading. */
    }
  }
}
