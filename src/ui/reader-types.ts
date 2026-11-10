import type { PrefStore, Prefs } from "../prefs";
import type { Highlighter } from "../render/highlight";
import type { Scheme } from "../themes";
import type { VaultStore } from "../vault/store";
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
  closeVault: () => void;
}

export interface OpenOptions {
  anchor?: string;
  newTab?: boolean;
  focus?: boolean;
  find?: string;
  keyboard?: boolean;
  via?: "link" | "jump";
}

export interface ShowOptions {
  anchor?: string;
  find?: string;
  followed?: boolean;
  keepScroll?: boolean;
  /** A graph tab that has just been opened, so a pointer open may fade it in. */
  openingGraph?: boolean;
  quiet?: boolean;
  restoring?: boolean;
  onPainted?: () => void;
}
