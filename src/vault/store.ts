import { type CommunityResult, detectCommunities } from "./communities";
import { loadYaml, parseFrontmatter } from "./frontmatter";
import { excludedBy } from "./ignore-filters";
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
  strictLineBreaks = false;
  readonly texts = new Map<string, string>();
  readonly search = new SearchIndex();
  index: VaultIndex;
  links: LinkGraph;
  private communityCache: CommunityResult | null = null;

  private constructor(
    readonly source: VaultSource,
    files: string[],
    private readonly excluded: (path: string) => boolean,
  ) {
    this.index = new VaultIndex(files, excluded);
    this.links = new LinkGraph(this.index);
  }

  /** What drawing a note needs from this vault. */
  get renderFacts() {
    return { index: this.index, assetUrl: this.source.assetUrl, strictLineBreaks: this.strictLineBreaks };
  }

  static async open(source: VaultSource): Promise<VaultStore> {
    const settings = await source.settings().catch(() => null);
    const store = new VaultStore(source, await source.list(), excludedBy(settings?.ignoreFilters));
    store.strictLineBreaks = settings?.strictLineBreaks ?? false;
    return store;
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
    await loadYaml();
    await this.readInto(this.index.notes.filter((p) => !this.texts.has(p)));
    this.registerAliases(this.index.notes);
    this.relinkAll();
    for (const path of this.index.notes) this.updateSearch(path);
  }

  /** Brings the store up to date after files changed on disk. */
  async applyChanges(paths: string[]): Promise<VaultChange> {
    const files = await this.source.list();
    const fileSet = new Set(files);
    const known = new Set(this.index.allFiles);
    const structural = files.length !== known.size || files.some((f) => !known.has(f));
    if (structural) {
      this.index = new VaultIndex(files, this.excluded);
      this.links = new LinkGraph(this.index);
      for (const path of [...this.texts.keys()]) {
        if (fileSet.has(path)) continue;
        this.texts.delete(path);
        this.search.set(path, "", null);
      }
    }
    const candidates = paths.filter((p) => p.endsWith(".md") && fileSet.has(p) && !this.excluded(p));
    const before = new Map(candidates.map((p) => [p, this.texts.get(p)]));
    await this.readInto(candidates);
    const changed = candidates.filter((p) => this.texts.get(p) !== before.get(p));
    const added = this.index.notes.filter((p) => !this.texts.has(p));
    await this.readInto(added);
    /* Aliases first: whether a link resolves can depend on a note that sorts after it. */
    const aliasesMoved = this.registerAliases(structural ? this.index.notes : changed);
    if (structural || aliasesMoved) this.relinkAll();
    else for (const path of changed) this.links.update(path, this.texts.get(path) ?? null);
    this.communityCache = null;
    for (const path of new Set([...changed, ...added])) this.updateSearch(path);
    return { structural, changed };
  }

  /** Saves a note and, once it is on disk, updates everything derived from it. */
  async save(path: string, text: string, expected: string | null): Promise<WriteOutcome> {
    const outcome = await this.source.writeNote(path, text, expected);
    if (outcome.kind === "saved") {
      this.texts.set(path, text);
      if (this.index.notes.includes(path)) this.applyNote(path);
    }
    return outcome;
  }

  /** Reads one note again and updates what depends on it. Null means it is no longer there. */
  async reread(path: string): Promise<string | null> {
    const text = await this.source.readText(path).catch(() => null);
    if (text !== null && text !== this.texts.get(path)) {
      this.texts.set(path, text);
      if (this.index.notes.includes(path)) this.applyNote(path);
    }
    return text;
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

  /** Updates what depends on one note after its text changed. */
  private applyNote(path: string): void {
    if (this.registerAliases([path])) this.relinkAll();
    else this.links.update(path, this.texts.get(path) ?? null);
    this.communityCache = null;
    this.updateSearch(path);
  }

  private aliasesIn(path: string): string[] {
    const { data } = parseFrontmatter(this.texts.get(path) ?? "");
    const aliases = data.aliases ?? data.alias;
    if (!aliases) return [];
    return Array.isArray(aliases) ? aliases : [aliases];
  }

  private registerAliases(paths: string[]): boolean {
    let changed = false;
    for (const path of paths) if (this.index.setAliases(path, this.aliasesIn(path))) changed = true;
    return changed;
  }

  private relinkAll(): void {
    this.communityCache = null;
    for (const path of this.index.notes) this.links.update(path, this.texts.get(path) ?? null);
  }

  private updateSearch(path: string): void {
    const text = this.texts.get(path) ?? null;
    this.search.set(path, this.index.title(path), text, this.aliasesIn(path));
  }
}
