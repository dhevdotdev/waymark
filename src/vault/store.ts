import { type CommunityResult, detectCommunities } from "./communities";
import { parseFrontmatter } from "./frontmatter";
import { VaultIndex } from "./index";
import { LinkGraph } from "./links";
import { SearchIndex } from "./search";
import type { VaultSource, WriteOutcome } from "./source";

const READ_CHUNK = 120;

export interface VaultChange {
  /** Files were added or removed, so every index was rebuilt. */
  structural: boolean;
  /** Notes whose text was read again. */
  changed: string[];
}

/**
 * One open vault: its files, note text and everything derived from them.
 * Note text is read once and kept, and every derived index is updated together.
 */
export class VaultStore {
  readonly texts = new Map<string, string>();
  readonly search = new SearchIndex();
  index: VaultIndex;
  links: LinkGraph;
  private communityCache: CommunityResult | null = null;

  private constructor(
    readonly source: VaultSource,
    files: string[],
  ) {
    this.index = new VaultIndex(files);
    this.links = new LinkGraph(this.index);
  }

  static async open(source: VaultSource): Promise<VaultStore> {
    return new VaultStore(source, await source.list());
  }

  /** The note's text, read from disk the first time it is asked for. */
  async read(path: string): Promise<string> {
    const known = this.texts.get(path);
    if (known !== undefined) return known;
    const text = await this.source.readText(path);
    this.texts.set(path, text);
    return text;
  }

  /** Reads every note not yet in memory and builds the link and search indexes. */
  async loadAll(): Promise<void> {
    await this.readInto(this.index.notes.filter((p) => !this.texts.has(p)));
    for (const path of this.index.notes) this.ingest(path);
  }

  /** Brings the store up to date after files changed on disk. */
  async applyChanges(paths: string[]): Promise<VaultChange> {
    const files = await this.source.list();
    const fileSet = new Set(files);
    const known = new Set([...this.index.notes, ...this.index.attachments]);
    const structural = files.length !== known.size || files.some((f) => !known.has(f));
    if (structural) {
      this.index = new VaultIndex(files);
      this.links = new LinkGraph(this.index);
      for (const p of [...this.texts.keys()]) if (!fileSet.has(p)) this.texts.delete(p);
    }
    const candidates = paths.filter((p) => p.endsWith(".md") && fileSet.has(p));
    const before = new Map(candidates.map((p) => [p, this.texts.get(p)]));
    await this.readInto(candidates);
    const changed = candidates.filter((p) => this.texts.get(p) !== before.get(p));
    await this.readInto(this.index.notes.filter((p) => !this.texts.has(p)));
    for (const path of structural ? this.index.notes : changed) this.ingest(path);
    return { structural, changed };
  }

  /** Saves a note and, once it is on disk, updates everything derived from it. */
  async save(path: string, text: string, expected: string | null): Promise<WriteOutcome> {
    const outcome = await this.source.writeNote(path, text, expected);
    if (outcome.kind === "saved") {
      this.texts.set(path, text);
      if (this.index.notes.includes(path)) this.ingest(path);
    }
    return outcome;
  }

  /** Link communities for the whole vault, so a note keeps its colour in every view. */
  communities(): CommunityResult {
    if (!this.communityCache) {
      const edges: [string, string][] = [];
      for (const p of this.index.notes) for (const t of this.links.out.get(p) ?? []) edges.push([p, t]);
      this.communityCache = detectCommunities(this.index.notes, edges);
    }
    return this.communityCache;
  }

  wordCount(path: string): number {
    return (this.texts.get(path) ?? "").split(/\s+/).filter(Boolean).length;
  }

  /** The line in `from` that links to `to`, cleaned for display. */
  linkContext(from: string, to: string): string | null {
    const text = this.texts.get(from);
    if (!text) return null;
    const title = this.index.title(to).toLowerCase();
    for (const line of text.split("\n")) {
      for (const m of line.matchAll(/\[\[([^\]|#]+)/g)) {
        const target = m[1].trim().toLowerCase();
        if (target !== title && !target.endsWith(`/${title}`)) continue;
        const clean = line
          .replace(/!?\[\[([^\]|]*?)(?:\|([^\]]*))?\]\]/g, (_, name: string, alias?: string) => alias || name.split("#")[0])
          .replace(/^\s*(?:[-*+]|\d+\.|>|#+)\s*/, "")
          .replace(/^\[![a-z]+\][+-]?\s*/i, "")
          .replace(/[*_`]/g, "")
          .trim();
        if (clean.toLowerCase() === title || !clean) return null;
        return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
      }
    }
    return null;
  }

  private async readInto(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += READ_CHUNK) {
      const chunk = paths.slice(i, i + READ_CHUNK);
      const contents = await this.source.readMany(chunk);
      chunk.forEach((path, j) => {
        const text = contents[j];
        if (text !== null) this.texts.set(path, text);
      });
    }
  }

  /** Updates every derived index for one note. A note with no text has been removed. */
  private ingest(path: string): void {
    this.communityCache = null;
    const text = this.texts.get(path) ?? null;
    if (text === null) {
      this.links.update(path, null);
      this.search.set(path, "", null);
      return;
    }
    const { data } = parseFrontmatter(text);
    const aliases = data.aliases ?? data.alias;
    const list = aliases ? (Array.isArray(aliases) ? aliases : [aliases]) : [];
    if (list.length) this.index.addAliases(path, list);
    this.links.update(path, text);
    this.search.set(path, this.index.title(path), text, list);
  }
}
