import { linkMention, type Mention, MentionFinder, mentionLink, mentionNames, namePattern } from "../vault/mentions";
import type { VaultStore } from "../vault/store";
import { icons } from "./icons";
import type { WriteResult } from "./note-writer";
import { plural } from "./plural";

/** More than this and the list stops, saying how many are left, so a common word as a name cannot flood the panel. */
const MOST_SHOWN = 24;

const MESSAGES: Record<Exclude<WriteResult["kind"], "done" | "failed">, string> = {
  refused: "That mention has changed since it was listed, so it was left alone.",
  changed: "That note just changed elsewhere, so it was left alone.",
  busy: "Syncing right now. Try again in a moment.",
};

export interface MentionsHost {
  vault: VaultStore;
  /** The link target that names a note, as Copy link writes it. */
  linkTarget: (path: string) => string;
  open: (path: string, find: string, newTab: boolean) => void;
  write: (path: string, edit: (text: string) => string | null) => Promise<WriteResult>;
  /** Draws the Links pane again after a link was made or taken back. */
  redraw: () => void;
  toast: (message: string, action?: { label: string; run: () => void }) => void;
}

/**
 * Notes that name the current note without linking to it, in the Links pane under the backlinks. Folded until asked
 * for, and only searched while open, so opening a note never waits on a scan of the vault.
 */
export class UnlinkedMentions {
  private open = false;
  private current = "";
  private readonly finder = new MentionFinder();
  private readonly head = document.createElement("button");
  private readonly body = document.createElement("div");

  constructor(private readonly host: MentionsHost) {
    this.head.type = "button";
    this.head.className = "rail-title mentions-toggle";
    this.head.setAttribute("aria-controls", "unlinked-mentions");
    this.head.addEventListener("click", () => {
      this.open = !this.open;
      this.fill();
    });
    this.body.className = "mentions";
    this.body.id = "unlinked-mentions";
    this.body.addEventListener("click", (e) => this.onClick(e));
  }

  /** Puts the section into the pane for `path`. */
  render(box: HTMLElement, path: string): void {
    this.current = path;
    box.append(this.head, this.body);
    this.fill();
  }

  private fill(): void {
    const found = this.open ? this.search() : null;
    const count = found ? [...found.values()].reduce((sum, list) => sum + list.length, 0) : 0;
    this.head.setAttribute("aria-expanded", String(this.open));
    this.head.innerHTML = `<span class="mentions-label"><svg class="rail-section-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></span>`;
    this.head.firstElementChild!.append(found ? `Unlinked mentions · ${count}` : "Unlinked mentions");
    this.body.hidden = !found;
    this.body.replaceChildren();
    if (!found) return;
    if (!count) {
      const none = document.createElement("p");
      none.className = "rail-empty";
      none.textContent = "No other note names this one without linking it.";
      this.body.append(none);
      return;
    }
    let shown = 0;
    const { index } = this.host.vault;
    const byTitle = [...found].sort(([a], [b]) => index.title(a).localeCompare(index.title(b), undefined, { numeric: true }));
    for (const [path, mentions] of byTitle) {
      if (shown >= MOST_SHOWN) break;
      const room = mentions.slice(0, MOST_SHOWN - shown);
      this.body.append(this.noteRow(path), ...room.map((m) => this.mentionRow(path, m)));
      shown += room.length;
    }
    if (count > shown) {
      const more = document.createElement("p");
      more.className = "mentions-more";
      more.textContent = `and ${plural(count - shown, "more mention")}`;
      this.body.append(more);
    }
  }

  private pattern(): RegExp | null {
    const { vault } = this.host;
    const aliases = vault.aliasesIn(this.current).filter((a): a is string => typeof a === "string");
    return namePattern(mentionNames(vault.index.title(this.current), aliases));
  }

  private search(): Map<string, Mention[]> {
    const { vault } = this.host;
    const pattern = this.pattern();
    if (!pattern) return new Map();
    const notes = new Map<string, string>();
    for (const path of vault.index.notes) {
      const text = vault.texts.get(path);
      if (text !== undefined) notes.set(path, text);
    }
    return this.finder.find(notes, pattern, this.current);
  }

  private noteRow(path: string): HTMLElement {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "wikilink-plain rail-link";
    a.dataset.path = path;
    a.dataset.tip = this.host.vault.index.title(path);
    a.innerHTML = icons.note;
    const name = document.createElement("span");
    name.className = "rail-link-name";
    name.textContent = this.host.vault.index.title(path);
    a.append(name);
    return a;
  }

  private mentionRow(path: string, mention: Mention): HTMLElement {
    const row = document.createElement("div");
    row.className = "mention";
    const quote = document.createElement("a");
    quote.href = "#";
    quote.className = "mention-quote";
    quote.dataset.mentionOpen = path;
    quote.dataset.find = mention.text;
    const mark = document.createElement("mark");
    mark.textContent = mention.text;
    quote.append(mention.before, mark, mention.after);
    const link = document.createElement("button");
    link.type = "button";
    link.className = "link-btn mention-link";
    link.textContent = "Link";
    link.dataset.mentionLink = path;
    link.dataset.at = String(mention.at);
    link.dataset.text = mention.text;
    link.setAttribute("aria-label", `Link “${mention.text}” in ${this.host.vault.index.title(path)}`);
    row.append(quote, link);
    return row;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const quote = target.closest<HTMLElement>("[data-mention-open]");
    if (quote) {
      e.preventDefault();
      this.host.open(quote.dataset.mentionOpen!, quote.dataset.find!, e.metaKey);
      return;
    }
    const link = target.closest<HTMLButtonElement>("[data-mention-link]");
    if (link) void this.link(link.dataset.mentionLink!, Number(link.dataset.at), link.dataset.text!);
  }

  /** Writes the link through the normal save path, and offers to take it back. */
  private async link(path: string, at: number, text: string): Promise<void> {
    const pattern = this.pattern();
    if (!pattern) return;
    const target = this.host.linkTarget(this.current);
    const written = mentionLink(text, target);
    const result = await this.host.write(path, (source) => linkMention(source, pattern, at, text, target));
    this.host.redraw();
    if (result.kind !== "done") {
      this.host.toast(result.kind === "failed" ? result.message : MESSAGES[result.kind]);
      return;
    }
    const title = this.host.vault.index.title(path);
    this.host.toast(`Linked in “${title}”`, {
      label: "Undo",
      run: () => void this.unlink(path, at, text, written),
    });
  }

  private async unlink(path: string, at: number, text: string, written: string): Promise<void> {
    const result = await this.host.write(path, (source) =>
      source.slice(at, at + written.length) === written ? source.slice(0, at) + text + source.slice(at + written.length) : null,
    );
    this.host.redraw();
    if (result.kind === "refused") this.host.toast("That note has changed since, so the link stays.");
    else if (result.kind !== "done") this.host.toast(result.kind === "failed" ? result.message : MESSAGES[result.kind]);
  }
}
