import { parseFrontmatter } from "./frontmatter";
import { isAttachmentTarget, localTarget, MARKDOWN_DESTINATION, MARKDOWN_TITLE, type Resolution, type VaultIndex } from "./index";

const CODE = /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$|`[^`\n]*`/gm;
const WIKILINK = /!?\[\[([^\]|#\n]*)(?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
/* No lookbehind: the system WebKit runs that form without its JIT, which took seconds across a vault. Images fall out as attachments. */
const MARKDOWN_LINK = new RegExp(String.raw`\]\(${MARKDOWN_DESTINATION}${MARKDOWN_TITLE}\)`, "g");

/** Outgoing and incoming note links, rebuilt per note as files change. */
export class LinkGraph {
  readonly out = new Map<string, Set<string>>();
  readonly in = new Map<string, Set<string>>();

  constructor(private index: VaultIndex) {}

  update(path: string, text: string | null): void {
    for (const target of this.out.get(path) ?? []) this.in.get(target)?.delete(path);
    this.out.delete(path);
    if (text === null) return;
    const targets = new Set<string>();
    const add = (res: Resolution) => {
      if (res.kind === "found" && res.path !== path) targets.add(res.path);
    };
    const prose = text.replace(CODE, "");
    for (const m of prose.matchAll(WIKILINK)) {
      const name = m[1].trim();
      if (name && !isAttachmentTarget(this.index, name)) add(this.index.resolve(name, true));
    }
    for (const m of prose.matchAll(MARKDOWN_LINK)) {
      const local = localTarget(m[1]);
      if (local?.path && !isAttachmentTarget(this.index, local.path)) add(this.index.resolveFrom(local.path, path));
    }
    this.out.set(path, targets);
    for (const t of targets) {
      if (!this.in.has(t)) this.in.set(t, new Set());
      this.in.get(t)!.add(path);
    }
  }

  backlinks(path: string): string[] {
    return [...(this.in.get(path) ?? [])].sort();
  }

  degree(path: string): number {
    return (this.out.get(path)?.size ?? 0) + (this.in.get(path)?.size ?? 0);
  }

  /** Notes within `depth` links of `path`, in either direction. */
  neighbourhood(path: string, depth: number): Set<string> {
    const seen = new Set([path]);
    let frontier = [path];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const p of frontier) {
        for (const n of [...(this.out.get(p) ?? []), ...(this.in.get(p) ?? [])]) {
          if (!seen.has(n)) {
            seen.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return seen;
  }
}

/** Visible text of a note, for search: no frontmatter, comments, link syntax or Markdown markers. */
export function plainText(markdown: string): string {
  return parseFrontmatter(markdown)
    .body.replace(/%%[\s\S]*?%%/g, "")
    .replace(/!?\[\[([^\]|]*?)(?:\|([^\]]*))?\]\]/g, (_, t, a) => a || t.replace(/#/g, " "))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^>\s*\[![^\]]*\][+-]?/gm, "")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~=`]{1,3}/g, "");
}
