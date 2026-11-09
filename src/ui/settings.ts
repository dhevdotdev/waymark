import { isDesktop } from "../platform";
import type { PrefStore, Prefs } from "../prefs";
import { FAMILIES, type Scheme } from "../themes";
import { dismissOnOutside, toast } from "./overlays";
import type { Sound } from "./sound";

type Appearance = Prefs["appearance"];

const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];
const BACKGROUND_MINUTES = 15;

export interface SettingsHost {
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
  const toggle = (label: string, pref: string, checked: boolean) =>
    `<label class="toggle"><span>${label}</span><input type="checkbox" data-pref="${pref}" ${checked ? "checked" : ""}/><i aria-hidden="true"></i></label>`;
  return `
    <div class="pop-section"><div class="pop-label">Theme</div><div class="theme-grid">${swatches}</div></div>
    <div class="pop-section"><div class="pop-label">Appearance</div><div class="seg seg-full">${appearances}</div></div>
    <div class="pop-section pop-toggles">
      ${toggle("Sounds for sync, copy and new tabs", "sound", p.sound)}
      ${
        isDesktop
          ? `${toggle("Check the remote on launch", "syncOnLaunch", p.syncOnLaunch)}
             ${toggle("Check every 15 minutes", "background", Boolean(p.backgroundMinutes))}
             <p class="pop-note">Checks only fetch. Incoming changes apply when you press Sync, and only as a fast-forward.</p>`
          : ""
      }
    </div>`;
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
    pop.remove();
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
    const appearance = target.closest<HTMLElement>("[data-appearance]")?.dataset.appearance as Appearance | undefined;
    if (appearance) {
      host.setAppearance(appearance);
      stopDismissing?.();
      close();
      toggleSettings(anchor, host);
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

export function applySound(prefs: PrefStore, sound: Sound, on: boolean): void {
  prefs.update((p) => {
    p.sound = on;
  });
  sound.muted = !on;
  if (on) sound.play("synced");
  toast(on ? "Sounds on" : "Sounds muted");
}
