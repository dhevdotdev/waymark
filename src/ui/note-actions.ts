import type { VaultIndex } from "../vault/index";
import { bindMenuKeys } from "./menu-keys";
import { returnFocus, takeFocus } from "./modal-layer";
import { dismissOnOutside, fadeOut } from "./overlays";

const COPIED_MS = 1400;

export async function copyCode(button: HTMLButtonElement, onCopied: () => void): Promise<void> {
  const code = button.closest(".code")!.querySelector("pre")!.textContent ?? "";
  const label = button.querySelector("span")!;
  try {
    await navigator.clipboard.writeText(code);
    label.textContent = "Copied";
    onCopied();
  } catch {
    label.textContent = "Copy failed";
  }
  button.classList.add("is-done");
  setTimeout(() => {
    label.textContent = "Copy";
    button.classList.remove("is-done");
  }, COPIED_MS);
}

export function toggleCallout(title: HTMLElement): void {
  const callout = title.closest<HTMLElement>(".callout")!;
  const open = callout.dataset.fold !== "open";
  callout.dataset.fold = open ? "open" : "closed";
  title.setAttribute("aria-expanded", String(open));
}

let closeOpen: (() => void) | null = null;

/** Asks which note an ambiguous link means, then calls `choose` with the answer. */
export function chooseAmbiguous(
  anchor: HTMLElement,
  candidates: string[],
  index: VaultIndex,
  choose: (path: string) => void,
): void {
  closeOpen?.();
  document.querySelector(".popover.choose")?.remove();
  const pop = document.createElement("div");
  pop.className = "popover choose";
  pop.setAttribute("role", "menu");
  const label = document.createElement("div");
  label.className = "pop-label";
  label.id = "choose-label";
  label.textContent = `${candidates.length} notes share this name. Open which?`;
  pop.setAttribute("aria-labelledby", label.id);
  pop.append(label);
  const close = () => {
    closeOpen = null;
    stopKeys();
    stopListening();
    returnFocus(anchor, pop);
    fadeOut(pop);
  };
  closeOpen = close;
  const stopListening = dismissOnOutside([pop], close);
  const stopKeys = bindMenuKeys(
    () => [...pop.querySelectorAll<HTMLElement>(".choose-row")],
    (row) => row.firstElementChild?.textContent ?? "",
    close,
  );
  for (const candidate of candidates) {
    const row = document.createElement("button");
    row.className = "choose-row";
    row.setAttribute("role", "menuitem");
    const name = document.createElement("span");
    name.textContent = index.title(candidate);
    const dir = document.createElement("span");
    dir.className = "choose-dir";
    dir.textContent = candidate.split("/").slice(0, -1).join("/") || "Vault root";
    row.append(name, dir);
    row.onclick = () => {
      close();
      choose(candidate);
    };
    pop.append(row);
  }
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, window.innerWidth - 320)}px`;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.transformOrigin = "left top";
  takeFocus(pop.querySelector<HTMLElement>(".choose-row"));
}
