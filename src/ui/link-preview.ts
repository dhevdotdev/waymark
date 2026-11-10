import { type RenderContext, renderNote } from "../render/note";
import { noteBody } from "../vault/frontmatter";
import type { VaultStore } from "../vault/store";

const OPEN_DELAY_MS = 650;
const CLOSE_DELAY_MS = 250;
const EXCERPT_CHARS = 2000;
const PREVIEW_WIDTH = 472;
const PREVIEW_ROOM = 360;

/** The excerpt that appears when the pointer rests on a link inside a note. */
export class LinkPreview {
  private timer = 0;
  private box: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    private readonly host: { vault: VaultStore; renderContext: () => RenderContext; currentNote: () => string },
  ) {
    root.addEventListener("pointerover", (e) => this.onOver(e));
    root.addEventListener("pointerout", (e) => this.onOut(e));
  }

  hide(): void {
    clearTimeout(this.timer);
    this.box?.remove();
    this.box = null;
  }

  private onOver(e: PointerEvent): void {
    const link = (e.target as HTMLElement).closest<HTMLElement>(".doc a.wikilink[data-path]");
    if (!link || link.closest(".preview")) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.show(link), OPEN_DELAY_MS);
  }

  private onOut(e: PointerEvent): void {
    const link = (e.target as HTMLElement).closest(".doc a.wikilink");
    if (!link || link.contains(e.relatedTarget as Node)) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.box?.matches(":hover")) this.hide();
    }, CLOSE_DELAY_MS);
  }

  private async show(link: HTMLElement): Promise<void> {
    const path = link.dataset.path;
    if (!path || path === this.host.currentNote()) return;
    const text = this.host.vault.texts.get(path);
    if (!text) return;
    const excerpt = noteBody(text)
      .split(/\n(?=## )/)[0]
      .slice(0, EXCERPT_CHARS);
    const rendered = await renderNote(excerpt, path, this.host.renderContext());
    if (!link.matches(":hover")) return;
    this.hide();

    const box = document.createElement("div");
    box.className = "preview";
    const doc = document.createElement("div");
    doc.className = "doc is-preview";
    const title = document.createElement("div");
    title.className = "preview-title";
    title.textContent = this.host.vault.index.title(path);
    doc.append(title, rendered.fragment);
    for (const diagram of doc.querySelectorAll(".diagram")) diagram.remove();
    box.append(doc);
    document.body.append(box);

    const r = link.getBoundingClientRect();
    const below = r.bottom + PREVIEW_ROOM < window.innerHeight;
    box.style.left = `${Math.max(12, Math.min(window.innerWidth - PREVIEW_WIDTH, r.left - 16))}px`;
    if (below) box.style.top = `${r.bottom + 8}px`;
    else box.style.bottom = `${window.innerHeight - r.top + 8}px`;
    box.style.transformOrigin = below ? "left top" : "left bottom";
    box.addEventListener("pointerleave", () => this.hide());
    this.box = box;
  }
}
