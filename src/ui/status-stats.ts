import type { VaultStore } from "../vault/store";
import type { EditorStats } from "./editor-view";

const WORDS_PER_MINUTE = 230;
const count = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** The word count at the end of the status bar: for the note being read, or the position while editing. */
export class StatusStats {
  private readingPath = "";

  constructor(
    private readonly el: HTMLElement,
    private readonly vault: VaultStore,
    private readonly reading: () => Element | null,
  ) {
    document.addEventListener("selectionchange", () => this.showReading());
  }

  read(path: string): void {
    this.readingPath = path;
    this.showReading();
  }

  hide(): void {
    this.readingPath = "";
    this.el.hidden = true;
  }

  editing({ line, column, words, selected }: EditorStats): void {
    this.readingPath = "";
    this.el.hidden = false;
    const position = selected
      ? `${selected.toLocaleString()} of ${words.toLocaleString()} words`
      : `${words.toLocaleString()} words`;
    this.el.textContent = `Ln ${line}, Col ${column} · ${position} · ${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min`;
  }

  private showReading(): void {
    if (!this.readingPath) return;
    const total = this.vault.wordCount(this.readingPath);
    const selection = getSelection();
    const within = selection && !selection.isCollapsed && this.reading()?.contains(selection.anchorNode);
    const selected = within ? count(selection.toString()) : 0;
    this.el.hidden = false;
    this.el.textContent = selected
      ? `${selected.toLocaleString()} of ${total.toLocaleString()} words`
      : `${total.toLocaleString()} words`;
  }
}
