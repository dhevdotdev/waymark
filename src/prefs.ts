import { isDesktop, native } from "./platform";

export interface VaultState {
  /** One saved trail per tab. Read through Trail.restore, which validates it. */
  tabs: unknown[];
  active: number;
  lastSync: number | null;
  openFolders?: string[];
}

export interface Prefs {
  lastVault: string | null;
  recentVaults: string[];
  vaults: Record<string, VaultState>;
  family: string;
  appearance: "system" | "light" | "dark";
  sound: boolean;
  syncOnLaunch: boolean;
  backgroundMinutes: number;
  sidebar: boolean;
  rail: boolean;
  railPane: "outline" | "links" | "info";
  sidebarWidth: number;
}

const DEFAULTS: Prefs = {
  lastVault: null,
  recentVaults: [],
  vaults: {},
  family: "catppuccin",
  appearance: "system",
  sound: true,
  syncOnLaunch: false,
  backgroundMinutes: 0,
  sidebar: true,
  rail: true,
  railPane: "outline",
  sidebarWidth: 268,
};

const LOCAL_KEY = "folio.prefs";

/** Preferences live in Application Support (desktop) or browser storage (dev), never in the vault. */
export class PrefStore {
  value: Prefs = structuredClone(DEFAULTS);
  /** Self-tests run with throwaway preferences so they never touch the user's. */
  ephemeral = false;
  private timer = 0;

  async load(): Promise<void> {
    if (this.ephemeral) return;
    let raw: Partial<Prefs> = {};
    try {
      raw = isDesktop ? ((await native.readPrefs()) as Partial<Prefs>) : JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}");
    } catch {
      raw = {};
    }
    this.value = { ...structuredClone(DEFAULTS), ...raw };
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
