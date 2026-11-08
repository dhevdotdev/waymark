import { desktopVaultSource, isDesktop, native } from "../platform";
import { PrefStore, type Prefs } from "../prefs";
import { Highlighter } from "../render/highlight";
import { applyTheme, findFamily, type Scheme } from "../themes";
import type { VaultSource } from "../vault/source";
import { VaultStore } from "../vault/store";
import { toast } from "./overlays";
import { type Metrics, Reader } from "./reader";
import { Sound } from "./sound";
import { showWelcome } from "./welcome";

const MAX_RECENT_VAULTS = 8;

/** Everything that outlives one vault: preferences, theme, and which vault is open. */
export class App {
  readonly metrics: Metrics = {};
  readonly sound = new Sound(false);
  reader: Reader | null = null;

  private readonly prefs = new PrefStore();
  private readonly highlighter = new Highlighter();
  private codeFamily = "";

  constructor(private readonly host: HTMLElement) {}

  get vault(): VaultStore {
    return this.requireReader().vault;
  }

  open(path: string): Promise<void> {
    return this.requireReader().open(path);
  }

  async start(devSource?: VaultSource, initial?: string, override?: string): Promise<void> {
    const t0 = performance.now();
    this.prefs.ephemeral = override !== undefined;
    await this.prefs.load();
    this.sound.muted = !this.prefs.value.sound;
    this.applyTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    window.addEventListener("keydown", (e) => this.reader?.handleKey(e), true);
    window.addEventListener("beforeunload", () => {
      this.reader?.persist();
      void this.prefs.flush();
    });
    if (isDesktop) await native.onVaultChanged((paths) => void this.reader?.onVaultChanged(paths));

    if (devSource) await this.loadVault(devSource, "dev", "Vault", initial);
    else if (override) await this.openVault(override);
    else if (this.prefs.value.lastVault)
      await this.openVault(this.prefs.value.lastVault).catch((err: Error) => this.welcome(err.message));
    else this.welcome();
    this.metrics.startMs = performance.now() - t0;
  }

  async openVault(path: string): Promise<void> {
    const info = await native.openVault(path);
    this.prefs.update((p) => {
      p.lastVault = info.root;
      p.recentVaults = [info.root, ...p.recentVaults.filter((r) => r !== info.root)].slice(0, MAX_RECENT_VAULTS);
    });
    await this.loadVault(desktopVaultSource(), info.root, info.name);
  }

  setAppearance = (appearance: Prefs["appearance"]): void => {
    this.prefs.update((p) => {
      p.appearance = appearance;
    });
    this.applyTheme();
  };

  private requireReader(): Reader {
    if (!this.reader) throw new Error("No vault is open");
    return this.reader;
  }

  private welcome(error?: string): void {
    this.closeReader();
    showWelcome(
      this.host,
      this.prefs.value.recentVaults,
      (path) => {
        void this.openVault(path).catch((err: Error) => this.welcome(err.message));
      },
      error,
    );
  }

  private closeReader(): void {
    this.reader?.dispose();
    this.reader = null;
  }

  private async loadVault(source: VaultSource, root: string, name: string, initial?: string): Promise<void> {
    const t0 = performance.now();
    const vault = await VaultStore.open(source);
    this.closeReader();
    this.reader = new Reader({
      host: this.host,
      vault,
      root,
      name,
      prefs: this.prefs,
      sound: this.sound,
      highlighter: this.highlighter,
      codeThemeReady: this.highlighter.init().then(() => this.syncCodeTheme()),
      metrics: this.metrics,
      scheme: () => this.scheme(),
      setAppearance: this.setAppearance,
      setFamily: (id) => {
        this.prefs.update((p) => {
          p.family = id;
        });
        this.applyTheme();
      },
      openAnotherVault: () => void this.pickVault(),
      closeVault: () => {
        this.reader?.persist();
        this.prefs.update((p) => {
          p.lastVault = null;
        });
        this.welcome();
      },
    });
    await this.reader.start(t0, initial);
  }

  private async pickVault(): Promise<void> {
    const path = await native.pickFolder("Open a vault");
    if (path) await this.openVault(path).catch((err: Error) => toast(err.message));
  }

  private scheme(): Scheme {
    const { appearance } = this.prefs.value;
    if (appearance !== "system") return appearance;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /**
   * Appearance changes repaint through CSS alone: code carries both variants'
   * colours, diagrams are bound to theme variables, and canvases re-read their
   * palette. Only a new theme family re-highlights code, keeping scroll.
   */
  private applyTheme(): void {
    const family = findFamily(this.prefs.value.family);
    applyTheme(family, this.scheme());
    this.reader?.refreshTheme();
    if (family.id === this.codeFamily) return;
    const first = this.codeFamily === "";
    this.codeFamily = family.id;
    void this.syncCodeTheme().then(() => {
      if (!first) this.reader?.rerender();
    });
  }

  private async syncCodeTheme(): Promise<void> {
    const family = findFamily(this.prefs.value.family);
    await this.highlighter.setThemes(family.light.code, family.dark.code);
  }
}
