import { type CaptureRequest, desktopVaultSource, isDesktop, native } from "../platform";
import { PrefStore, type Prefs } from "../prefs";
import { Highlighter } from "../render/highlight";
import { applyTheme, FAMILIES, findFamily, type Scheme } from "../themes";
import { noteNamed, type OpenRequest, vaultHolding } from "../vault/open-request";
import type { VaultSource } from "../vault/source";
import { VaultStore } from "../vault/store";
import { bindAppMenu } from "./app-menu";
import { saveCapture } from "./capture-save";
import { startCaptureShortcut } from "./capture-shortcut";
import { resolveColor } from "./colors";
import { toast } from "./overlays";
import { type Metrics, Reader } from "./reader";
import { Sound } from "./sound";
import { showWelcome } from "./welcome";

const MAX_RECENT_VAULTS = 8;

const paperColour = () => resolveColor("var(--paper)").match(/\d+/g)!.map(Number).slice(0, 3) as [number, number, number];

/** Everything that outlives one vault: preferences, theme, and which vault is open. */
export class App {
  readonly metrics: Metrics = {};
  readonly sound = new Sound(false);
  reader: Reader | null = null;

  private readonly prefs = new PrefStore();
  private readonly highlighter = new Highlighter();
  private codeFamily = "";
  private root: string | null = null;
  private requests: Promise<void> = Promise.resolve();

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
    if (isDesktop) native.showWindow(paperColour()).catch((error: unknown) => console.warn("Window not shown", error));
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    window.addEventListener("keydown", (e) => this.reader?.handleKey(e), true);
    window.addEventListener("beforeunload", () => {
      this.reader?.spots.record();
      this.reader?.persist();
      void this.prefs.flush();
    });
    if (isDesktop) await native.onVaultChanged((paths) => void this.reader?.onVaultChanged(paths));
    await native.onMenuCommand((id) => this.reader?.commands.runFromMenu(id));
    await native.saveBeforeQuit(async () => {
      this.reader?.spots.record();
      await this.reader?.editing.close();
      this.reader?.persist();
      await this.prefs.flush();
    });

    if (isDesktop && !this.prefs.ephemeral) {
      void startCaptureShortcut(this.prefs.value.captureShortcut);
      await native.onCaptureSave((request) => void this.answerCapture(request));
    }
    const early = override ? [] : await native.takeOpenRequests().catch(() => []);
    const first = this.vaultAsked(early) ?? this.prefs.value.lastVault;
    if (devSource) await this.loadVault(devSource, "dev", "Vault", initial);
    else if (override) await this.openVault(override);
    else if (first) await this.openVault(first).catch((err: Error) => this.welcome(err.message));
    else this.welcome();
    this.metrics.startMs = performance.now() - t0;
    if (override) return;
    this.handleRequests(early);
    await native.onOpenRequests(() => {
      void native.takeOpenRequests().then((requests) => this.handleRequests(requests));
    });
  }

  /** At a cold start, the vault a handed-over file is in opens first, so the last vault is not shown on the way. */
  private vaultAsked(requests: OpenRequest[]): string | undefined {
    for (const request of requests) {
      if (request.kind === "file") return vaultHolding(request.path, this.prefs.value.recentVaults)?.root;
    }
    return undefined;
  }

  /** One at a time, in the order they came, so two quick links cannot race to switch vaults. */
  private handleRequests(requests: OpenRequest[]): void {
    for (const request of requests) {
      this.requests = this.requests.then(() => this.openRequested(request)).catch((err: Error) => this.tell(err.message));
    }
  }

  /** A request from outside only navigates. A file outside every known vault is refused, never opened in another one. */
  private async openRequested(request: OpenRequest): Promise<void> {
    if (request.kind === "refused") return this.tell(request.reason);
    let path = request.path;
    if (request.kind === "file") {
      const known = [...(this.root ? [this.root] : []), ...this.prefs.value.recentVaults];
      const held = vaultHolding(request.path, known);
      if (!held) {
        const name = request.path.slice(request.path.lastIndexOf("/") + 1);
        return this.tell(`“${name}” is not in a vault Waymark knows, so it was not opened. Open its vault first.`);
      }
      if (held.root !== this.root) await this.openVault(held.root);
      /* Leaving the vault was refused, because an edit could not be saved, and that refusal has been shown. */
      if (held.root !== this.root) return;
      path = held.path;
    }
    if (!this.reader) return this.tell("Open a vault first, then follow the link again.");
    const found = noteNamed(this.reader.vault.index, path);
    if (found.kind === "refused") return this.tell(found.reason);
    await this.reader.open(found.path, { anchor: request.heading ?? undefined });
  }

  /** Saves what the capture window sends into the open vault, and tells it where the note went or why it did not. */
  private async answerCapture({ id, text }: CaptureRequest): Promise<void> {
    const reader = this.reader;
    if (!text.trim()) return native.answerCapture({ id, problem: "There is nothing to save." });
    if (!reader) return native.answerCapture({ id, problem: "Open a vault in Waymark first. Nothing was saved." });
    try {
      const host = { vault: reader.vault, notePath: reader.notePath, refresh: (paths: string[]) => reader.onVaultChanged(paths) };
      await native.answerCapture({ id, saved: await saveCapture(host, text) });
    } catch (error) {
      await native.answerCapture({ id, problem: error instanceof Error ? error.message : "The note could not be saved." });
    }
  }

  private tell(message: string): void {
    if (this.reader) toast(message);
    else this.welcome(message);
  }

  async openVault(path: string): Promise<void> {
    if (!(await this.leaveVault())) return;
    const info = await native.openVault(path);
    this.prefs.update((p) => {
      p.lastVault = info.root;
      p.recentVaults = [info.root, ...p.recentVaults.filter((r) => r !== info.root)].slice(0, MAX_RECENT_VAULTS);
    });
    await this.loadVault(desktopVaultSource(), info.root, info.name);
    this.root = info.root;
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
    this.root = null;
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
      switchVault: (path) => void this.openVault(path).catch((err: Error) => toast(err.message)),
      forgetVault: (path) =>
        this.prefs.update((p) => {
          p.recentVaults = p.recentVaults.filter((r) => r !== path);
        }),
      closeVault: async () => {
        if (!(await this.leaveVault())) return;
        this.prefs.update((p) => {
          p.lastVault = null;
        });
        this.welcome();
      },
    });
    if (isDesktop) void bindAppMenu(this.reader);
    await this.reader.start(t0, initial);
  }

  /** Saves the note being edited and where everything was, so another vault or the welcome page can take over. */
  private async leaveVault(): Promise<boolean> {
    const reader = this.reader;
    if (!reader) return true;
    reader.spots.record();
    if (!(await reader.editing.close())) return false;
    reader.persist();
    await this.prefs.flush();
    return true;
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
    native.setWindowColor(paperColour()).catch((error: unknown) => console.warn("Window colour not set", error));
  }

  private async syncCodeTheme(): Promise<void> {
    const family = findFamily(this.prefs.value.family);
    await this.highlighter.setThemes(family.light.code, family.dark.code);
  }
}
