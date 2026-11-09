import { isDesktop } from "../platform";
import type { PrefStore, Prefs } from "../prefs";
import { FAMILIES, type Scheme } from "../themes";
import { dismissOnOutside, fadeOut, toast } from "./overlays";
import type { Sound } from "./sound";

type Appearance = Prefs["appearance"];

const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];
const BACKGROUND_MINUTES = 15;

export interface SettingsHost {
  /** Plays a few keys on the chosen switch. */
  previewKeys: () => void;
  prefs: PrefStore;
  scheme: () => Scheme;
  setFamily: (id: string) => void;
  setAppearance: (appearance: Appearance) => void;
  setSound: (on: boolean) => void;
  rescheduleBackground: () => void;
}

function template(p: Prefs, scheme: Scheme): string {
  const swatches = FAMILIES.map((f) => {
    const v = f[scheme];
    return `<button class="theme-swatch${f.id === p.family ? " is-on" : ""}" data-family="${f.id}" aria-pressed="${f.id === p.family}">
      <span class="swatch" style="--s-bg:${v.p.mantle};--s-paper:${v.paper};--s-ink:${v.p.text};--s-accent:${v.accent};--s-2:${v.p.green};--s-3:${v.p.peach}"><i></i><b></b><em></em></span>
      <span class="swatch-label">${f.label}<small>${v.label}</small></span></button>`;
  }).join("");
  const appearances = APPEARANCES.map(
    (a) =>
      `<button class="seg-btn${p.appearance === a ? " is-on" : ""}" data-appearance="${a}">${a === "system" ? "Match system" : a[0].toUpperCase() + a.slice(1)}</button>`,
  ).join("");
  const choices = (name: string, options: readonly (readonly [string, string])[], current: string) =>
    options
      .map(
        ([value, label]) =>
          `<button class="seg-btn${value === current ? " is-on" : ""}" data-${name}="${value}">${label}</button>`,
      )
      .join("");
  const toggle = (label: string, pref: string, checked: boolean) =>
    `<label class="toggle"><span>${label}</span><input type="checkbox" data-pref="${pref}" ${checked ? "checked" : ""}/><i aria-hidden="true"></i></label>`;
  return `
    <div class="pop-section"><div class="pop-label">Theme</div><div class="theme-grid">${swatches}</div></div>
    <div class="pop-section"><div class="pop-label">Appearance</div><div class="seg seg-full">${appearances}</div></div>
    <div class="pop-section">
      <div class="pop-label">Typing sounds</div>
      <div class="seg seg-full">${choices("keysound", KEY_SOUNDS, p.keySound)}</div>
      <div class="seg seg-full key-volume${p.keySound === "off" ? " is-off" : ""}">${choices("keyvolume", KEY_VOLUMES, p.keyVolume)}</div>
    </div>
    <div class="pop-section pop-toggles">
      ${toggle("Sounds", "sound", p.sound)}
      ${
        isDesktop
          ? `${toggle("Check the remote on launch", "syncOnLaunch", p.syncOnLaunch)}
             ${toggle("Check every 15 minutes", "background", Boolean(p.backgroundMinutes))}
             <p class="pop-note">Checks only fetch. Incoming changes apply when you press Sync, and only as a fast-forward.</p>`
          : ""
      }
    </div>`;
}

const KEY_SOUNDS = [
  ["off", "Off"],
  ["linear", "Linear"],
  ["tactile", "Tactile"],
  ["clicky", "Clicky"],
] as const;
const KEY_VOLUMES = [
  ["soft", "Soft"],
  ["medium", "Medium"],
  ["loud", "Loud"],
] as const;

function markChoice(pop: HTMLElement, name: "keysound" | "keyvolume", value: string): void {
  for (const button of pop.querySelectorAll<HTMLElement>(`[data-${name}]`))
    button.classList.toggle("is-on", button.dataset[name] === value);
}

let stopDismissing: (() => void) | null = null;

/** Opens the appearance popover above `anchor`, or closes it if it is already open. */
export function toggleSettings(anchor: HTMLElement, host: SettingsHost): void {
  const existing = document.querySelector(".popover.settings");
  if (existing) {
    stopDismissing?.();
    existing.remove();
    anchor.classList.remove("is-on");
    return;
  }
  anchor.classList.add("is-on");
  const pop = document.createElement("div");
  pop.className = "popover settings";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Appearance and sync");
  pop.innerHTML = template(host.prefs.value, host.scheme());
  document.body.append(pop);

  const r = anchor.getBoundingClientRect();
  pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
  pop.style.right = `${Math.max(8, window.innerWidth - r.right - 4)}px`;
  pop.style.transformOrigin = `calc(100% - ${r.width / 2 + 4}px) bottom`;

  const close = () => {
    fadeOut(pop);
    anchor.classList.remove("is-on");
  };
  stopDismissing = dismissOnOutside([pop, anchor], close);

  pop.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const family = target.closest<HTMLElement>("[data-family]")?.dataset.family;
    if (family) {
      host.setFamily(family);
      for (const b of pop.querySelectorAll<HTMLElement>("[data-family]")) {
        b.classList.toggle("is-on", b.dataset.family === family);
        b.setAttribute("aria-pressed", String(b.dataset.family === family));
      }
    }
    const keySound = target.closest<HTMLElement>("[data-keysound]")?.dataset.keysound as Prefs["keySound"] | undefined;
    const keyVolume = target.closest<HTMLElement>("[data-keyvolume]")?.dataset.keyvolume as Prefs["keyVolume"] | undefined;
    if (keySound || keyVolume) {
      host.prefs.update((p) => {
        p.keySound = keySound ?? p.keySound;
        p.keyVolume = keyVolume ?? p.keyVolume;
      });
      markChoice(pop, "keysound", host.prefs.value.keySound);
      markChoice(pop, "keyvolume", host.prefs.value.keyVolume);
      pop.querySelector(".key-volume")?.classList.toggle("is-off", host.prefs.value.keySound === "off");
      host.previewKeys();
    }
    const appearance = target.closest<HTMLElement>("[data-appearance]")?.dataset.appearance as Appearance | undefined;
    if (appearance) {
      host.setAppearance(appearance);
      pop.innerHTML = template(host.prefs.value, host.scheme());
      pop.querySelector<HTMLElement>(`[data-appearance="${appearance}"]`)?.focus();
    }
  });

  pop.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.pref === "sound") host.setSound(input.checked);
    if (input.dataset.pref === "syncOnLaunch") {
      host.prefs.update((p) => {
        p.syncOnLaunch = input.checked;
      });
    }
    if (input.dataset.pref === "background") {
      host.prefs.update((p) => {
        p.backgroundMinutes = input.checked ? BACKGROUND_MINUTES : 0;
      });
      host.rescheduleBackground();
    }
  });

  pop.querySelector<HTMLElement>(".theme-swatch.is-on")?.focus({ preventScroll: true });
}

/** Plays a few keys on the chosen switch, unless typing sounds are off. */
export function previewKeys(prefs: PrefStore, sound: Sound): void {
  const { keySound, keyVolume } = prefs.value;
  if (keySound !== "off") void sound.keys.preview(keySound, keyVolume);
}

export function applySound(prefs: PrefStore, sound: Sound, on: boolean): void {
  prefs.update((p) => {
    p.sound = on;
  });
  sound.muted = !on;
  if (on) sound.play("synced");
  toast(on ? "Sounds on" : "Sounds muted");
}
