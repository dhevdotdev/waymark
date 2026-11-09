const NOTE_EXT = /\.md$/i;
const ANY_LINK =
  /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$|`[^`\n]*`|(!?\[\[)((?:[^\]|#\n\\]|\\(?!\|))*)([^\]\n]*\]\])|(\]\()([^)\s]+\.md)(\))/gim;

const fold = (s: string) => s.normalize("NFC").toLowerCase();
const stem = (path: string) => path.replace(NOTE_EXT, "");
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Whether link text names the note at `path` by its file name. A link by alias still works after a rename, so it is left alone. */
function pointsAt(target: string, path: string): boolean {
  const wanted = fold(stem(target.trim().replace(/^\.?\//, "")));
  const note = fold(stem(path));
  if (!wanted.includes("/")) return wanted === fold(baseName(stem(path)));
  return note === wanted || note.endsWith(`/${wanted}`);
}

/**
 * Points every link at a note's new location, leaving headings, aliases and
 * code as they were. A link written with a folder keeps one, and a bare link
 * gains one only if its name would otherwise match several notes.
 */
export function rewriteLinks(text: string, from: string, to: string, nameIsUnique: boolean): string {
  const newTarget = (old: string) => (old.includes("/") || !nameIsUnique ? stem(to) : baseName(stem(to)));
  return text.replace(ANY_LINK, (match, _fence, open, target, rest, mdOpen, mdTarget, mdClose) => {
    if (open !== undefined && pointsAt(target, from)) return `${open}${newTarget(target.trim())}${rest}`;
    if (mdOpen !== undefined) {
      const decoded = decodeURI(mdTarget);
      if (pointsAt(decoded, from)) return `${mdOpen}${encodeURI(`${newTarget(decoded)}.md`)}${mdClose}`;
    }
    return match;
  });
}

/** Why a name cannot be used for a note, or null when it can. These characters would break a link to it. */
export function nameProblem(name: string): string | null {
  if (!name.trim()) return "A note needs a name.";
  if (name.startsWith(".")) return "A name cannot start with a dot.";
  if (/[\\/:#^[\]|]/.test(name)) return "A name cannot contain \\ / : # ^ [ ] or |.";
  return null;
}
