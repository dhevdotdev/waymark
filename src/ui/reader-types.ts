import type { PrefStore, Prefs } from "../prefs";
import type { Highlighter } from "../render/highlight";
import type { Scheme } from "../themes";
import type { VaultStore } from "../vault/store";
import type { Entrance } from "./page-motion";
import type { Sound } from "./sound";

export type Metrics = Record<string, number>;
type Appearance = Prefs["appearance"];

export interface ReaderDeps {
  host: HTMLElement;
  vault: VaultStore;
  root: string;
  name: string;
  prefs: PrefStore;
  sound: Sound;
  highlighter: Highlighter;
  codeThemeReady: Promise<void>;
  metrics: Metrics;
  scheme: () => Scheme;
  setAppearance: (appearance: Appearance) => void;
  setFamily: (id: string) => void;
  openAnotherVault: () => void;
  /** Saves everything, then opens this vault in place of the current one. */
  switchVault: (path: string) => void;
  forgetVault: (path: string) => void;
  closeVault: () => void;
}

export interface OpenOptions {
  anchor?: string;
  newTab?: boolean;
  focus?: boolean;
  find?: string;
  keyboard?: boolean;
  via?: "link" | "jump";
  /** What the pointer clicked to open the note, to carry into its title. */
  from?: HTMLElement;
}

export interface ShowOptions {
  anchor?: string;
  find?: string;
  entrance?: Entrance;
  keepScroll?: boolean;
  /** A graph tab that has just been opened, so a pointer open may fade it in. */
  openingGraph?: boolean;
  quiet?: boolean;
  restoring?: boolean;
  onPainted?: () => void;
}
