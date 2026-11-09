import { desktopVaultSource, isDesktop, native } from "../platform";
import { PrefStore, type Prefs } from "../prefs";
import { Highlighter } from "../render/highlight";
import { applyTheme, FAMILIES, findFamily, type Scheme } from "../themes";
import type { VaultSource } from "../vault/source";
import { VaultStore } from "../vault/store";
import { resolveColor } from "./colors";
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

  async start(devSource?: VaultSource, initial?: string, override?: string, keepPrefs = false): Promise<void> {
    const t0 = performance.now();
    this.prefs.ephemeral = override !== undefined && !keepPrefs;
    await this.prefs.load();
    this.sound.muted = !this.prefs.value.sound;
    window.addEventListener("keydown", (e) => this.soundKey(e, true), true);
    window.addEventListener("keyup", (e) => this.soundKey(e, false), true);
    window.addEventListener("blur", () => this.sound.keys.forgetHeld());
    if (this.prefs.value.keySound !== "off") void this.sound.keys.load(this.prefs.value.keySound);
    this.applyTheme();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    window.addEventListener("keydown", (e) => this.reader?.handleKey(e), true);
    window.addEventListener("beforeunload", () => {
      this.reader?.spots.record();
      this.reader?.persist();
      void this.prefs.flush();
    });
    if (isDesktop) await native.onVaultChanged((paths) => void this.reader?.onVaultChanged(paths));
    await native.saveBeforeQuit(async () => {
      this.reader?.spots.record();
      await this.reader?.editing.close();
      this.reader?.persist();
      await this.prefs.flush();
    });

    if (devSource) await this.loadVault(devSource, "dev", "Vault", initial);
    else if (override) await this.openVault(override);
    else if (this.prefs.value.lastVault)
      await this.openVault(this.prefs.value.lastVault).catch((err: Error) => this.welcome(err.message));
    else this.welcome();
    this.metrics.startMs = performance.now() - t0;
  }

  async openVault(path: string): Promise<void> {
    await this.reader?.editing.close();
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
    this.closeReader();
    this.host.replaceChildren();
    const vault = await VaultStore.open(source);
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
      closeVault: async () => {
        await this.reader?.editing.close();
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
    if (path) await this.openVault(path).catch((err: Error) => this.welcome(err.message));
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
  get themeFamilies(): string[] {
    return FAMILIES.map((family) => family.id);
  }

  private applyTheme(): void {
    const family = findFamily(this.prefs.value.family);
    const root = document.documentElement;
    root.classList.add("is-recolouring");
    applyTheme(family, this.scheme());
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("is-recolouring")));
    this.matchWindowToPage();
    this.reader?.refreshTheme();
    if (family.id === this.codeFamily) return;
    const first = this.codeFamily === "";
    this.codeFamily = family.id;
    if (isDesktop) native.setDockIcon(family.id).catch((error: unknown) => console.warn("Dock icon not changed", error));
    void this.syncCodeTheme().then(() => {
      if (first) return;
      this.reader?.rerender();
      this.reader?.editing.redrawCode();
    });
  }

  private soundKey(e: KeyboardEvent, pressed: boolean): void {
    const { keySound, keyVolume } = this.prefs.value;
    if (keySound === "off" || !e.code) return;
    const { keys } = this.sound;
    keys.use(keySound, keyVolume);
    if (!pressed) keys.release(e.code);
    else if ((e.target as Element).closest?.(".doc-editing")) keys.press(e.code, e.repeat);
  }

  /** The window shows its own colour in newly exposed space while it grows, before the page has resized. */
  private matchWindowToPage(): void {
    if (!isDesktop) return;
    const [red, green, blue] = resolveColor("var(--paper)").match(/\d+/g)!.map(Number);
    native.setWindowColor([red, green, blue]).catch((error: unknown) => console.warn("Window colour not set", error));
  }

  private async syncCodeTheme(): Promise<void> {
    const family = findFamily(this.prefs.value.family);
    await this.highlighter.setThemes(family.light.code, family.dark.code);
  }
}
