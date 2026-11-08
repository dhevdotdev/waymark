import type { VaultIndex } from "../vault/index";
import { dismissOnOutside } from "./overlays";

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

/** Asks which note an ambiguous link means, then calls `choose` with the answer. */
export function chooseAmbiguous(
  anchor: HTMLElement,
  candidates: string[],
  index: VaultIndex,
  choose: (path: string) => void,
): void {
  document.querySelector(".popover.choose")?.remove();
  const pop = document.createElement("div");
  pop.className = "popover choose";
  const label = document.createElement("div");
  label.className = "pop-label";
  label.textContent = `${candidates.length} notes share this name. Open which?`;
  pop.append(label);
  const stopListening = dismissOnOutside([pop], () => pop.remove());
  for (const candidate of candidates) {
    const row = document.createElement("button");
    row.className = "choose-row";
    const name = document.createElement("span");
    name.textContent = index.title(candidate);
    const dir = document.createElement("span");
    dir.className = "choose-dir";
    dir.textContent = candidate.split("/").slice(0, -1).join("/") || "Vault root";
    row.append(name, dir);
    row.onclick = () => {
      stopListening();
      pop.remove();
      choose(candidate);
    };
    pop.append(row);
  }
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(r.left, window.innerWidth - 320)}px`;
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.transformOrigin = "left top";
  pop.querySelector<HTMLElement>(".choose-row")?.focus();
}
