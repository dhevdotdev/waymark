import {
  folderOf,
  isAttachmentTarget,
  joinPath,
  localTarget,
  MARKDOWN_DESTINATION,
  MARKDOWN_TITLE,
  type Resolution,
  type VaultIndex,
} from "./index";

const NOTE_EXT = /\.md$/i;
const CODE = String.raw`^ {0,3}(\`\`\`|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))|\`[^\`\n]*\``;
const WIKILINK = String.raw`(!?\[\[)((?:[^\]|#\n\\]|\\(?!\|))*)([^\]\n]*\]\])`;
const MARKDOWN_LINK = String.raw`(\]\()${MARKDOWN_DESTINATION}(${MARKDOWN_TITLE}\))`;
const ANY_LINK = new RegExp(`${CODE}|${WIKILINK}|${MARKDOWN_LINK}`, "gim");

const fold = (s: string) => s.normalize("NFC").toLowerCase();
const stem = (path: string) => path.replace(NOTE_EXT, "");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const same = (a: string, b: string) => fold(stem(a)) === fold(stem(b));

/** Whether link text names the file at `path` by its name or path. A link by alias still works after a move, so it is left alone. */
function pointsAt(target: string, path: string): boolean {
  const wanted = fold(stem(target.trim().replace(/^\.?\//, "")));
  const file = fold(stem(path));
  if (!wanted.includes("/")) return wanted === fold(baseName(stem(path)));
  return file === wanted || file.endsWith(`/${wanted}`);
}

function relativePath(fromFolder: string, to: string): string {
  const from = fromFolder ? fromFolder.split("/") : [];
  const target = to.split("/");
  let shared = 0;
  while (shared < from.length && shared < target.length - 1 && from[shared] === target[shared]) shared++;
  return [...from.slice(shared).map(() => ".."), ...target.slice(shared)].join("/");
}

const encodeDestination = (path: string) =>
  encodeURI(path).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface LinkMoves {
  moved: ReadonlyMap<string, string>;
  /** The file a wikilink means as the vault stands now, or null when it does not mean one for certain. */
  wikilink(target: string): string | null;
  /** The file a Markdown link written in `source` means now, or null when it does not mean one for certain. */
  markdownLink(target: string, source: string): string | null;
  /** Whether no other note will share this one's name once the moves are done. */
  nameIsUnique(to: string): boolean;
}

const found = (resolution: Resolution) => (resolution.kind === "found" ? resolution.path : null);

/** How links in the vault read, for a set of moves that has not happened yet. */
export function linkMoves(index: VaultIndex, moved: ReadonlyMap<string, string>): LinkMoves {
  const counts = new Map<string, number>();
  for (const note of index.notes) {
    const name = fold(baseName(stem(moved.get(note) ?? note)));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return {
    moved,
    wikilink: (target) => found(index.resolve(target, !isAttachmentTarget(index, target))),
    markdownLink: (target, source) => found(index.resolveFrom(target, source, !isAttachmentTarget(index, target))),
    nameIsUnique: (to) => (counts.get(fold(baseName(stem(to)))) ?? 0) <= 1,
  };
}

/**
 * Points every link in the note at `source` at where its target will be,
 * leaving headings, aliases and code as they were. A link written with a
 * folder keeps one, and a bare link gains one only if its name would otherwise
 * match several notes. A Markdown link relative to its note stays relative.
 */
export function rewriteLinks(text: string, source: string, moves: LinkMoves): string {
  const sourceAfter = moves.moved.get(source) ?? source;
  const byName = (written: string, to: string) =>
    written.includes("/") || !moves.nameIsUnique(to) ? stem(to) : baseName(stem(to));

  const wikilink = (open: string, target: string, rest: string, match: string): string => {
    const written = target.trim();
    const file = moves.wikilink(written);
    const to = file ? moves.moved.get(file) : undefined;
    return file && to && pointsAt(written, file) ? `${open}${byName(written, to)}${rest}` : match;
  };

  const markdownLink = (open: string, destination: string, close: string, match: string): string => {
    const local = localTarget(destination);
    const file = local?.path ? moves.markdownLink(local.path, source) : null;
    if (!local || !file) return match;
    const to = moves.moved.get(file) ?? file;
    if (to === file && sourceAfter === source) return match;
    const joined = joinPath(folderOf(source), local.path);
    const relative = joined !== null && same(joined, file);
    if (!relative && !pointsAt(local.path, file)) return match;
    const moved = relative ? relativePath(folderOf(sourceAfter), to) : byName(local.path, to);
    const dotted = local.path.startsWith("./") && !moved.startsWith("..") ? `./${moved}` : moved;
    const next =
      NOTE_EXT.test(to) && !NOTE_EXT.test(local.path) ? stem(dotted) : NOTE_EXT.test(to) ? `${stem(dotted)}.md` : dotted;
    if (next === local.path) return match;
    const written = destination.startsWith("<") ? `<${next}${local.fragment}>` : `${encodeDestination(next)}${local.fragment}`;
    return `${open}${written}${close}`;
  };

  return text.replace(ANY_LINK, (match, _fence, open, target, rest, mdOpen, destination, mdClose) => {
    if (open !== undefined) return wikilink(open, target, rest, match);
    return mdOpen !== undefined ? markdownLink(mdOpen, destination, mdClose, match) : match;
  });
}

/** Why a name cannot be used for a note or folder, or null when it can. These characters would break a link to it. */
export function nameProblem(name: string): string | null {
  if (!name.trim()) return "A name is needed.";
  if (name.startsWith(".")) return "A name cannot start with a dot.";
  if (/[\\/:#^[\]|]/.test(name)) return "A name cannot contain \\ / : # ^ [ ] or |.";
  return null;
}
