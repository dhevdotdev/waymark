import { frontmatterParts } from "./frontmatter";
import { headingKey } from "./index";

/** A heading and the lines it owns, up to the next heading of the same or a higher level. */
export interface Section {
  /** 0-based line of the heading, the first line of a setext heading. */
  line: number;
  /** The heading's last line, which is the underline of a setext heading. */
  headEnd: number;
  level: number;
  text: string;
  /** The heading's words and which occurrence of them it is, so a fold outlives edits elsewhere in the note. */
  key: string;
  /** The line the next section of the same or a higher level starts on, or the line count. */
  end: number;
  /** The last line with text in the section, or -1 when nothing but blank lines sits under the heading. */
  last: number;
}

const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const QUOTE = /^ {0,3}>/;
const QUOTE_MARK = /^ {0,3}> ?/;
/** Lines that start a block of their own, so they never continue a paragraph into a setext heading. */
const OTHER_BLOCK = /^ {0,3}(?:\||<)/;

const blank = (line: string) => line.trim() === "";
const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].replace(/\t/g, "    ").length;
const startsBlock = (line: string) =>
  ATX.test(line) || FENCE.test(line) || BREAK.test(line) || LIST.test(line) || QUOTE.test(line);
const isText = (inner: string) => !blank(inner) && !startsBlock(inner);

function atxText(rest: string): string {
  return rest
    .trim()
    .replace(/(?:^|[ \t]+)#+[ \t]*$/, "")
    .trim();
}

interface Found {
  line: number;
  headEnd: number;
  level: number;
  text: string;
}

/** A list item or quote whose lines belong to it, headings and all, rather than to the note's top level. */
interface Container {
  /** The column a list item's content starts at, or null for a quote, which only `>` lines continue. */
  column: number | null;
  /** The last line was paragraph text, which a lazy line may continue. */
  text: boolean;
}

/** Whether a line still belongs to the open list item or quote. */
function continues(container: Container, line: string): boolean {
  if (container.column === null ? QUOTE.test(line) : indentOf(line) >= container.column) return true;
  return container.text && !startsBlock(line);
}

/** What a container line holds once its own marker is set aside. */
const inside = (container: Container, line: string) =>
  container.column === null ? line.replace(QUOTE_MARK, "") : line.trimStart();

function opens(line: string): Container | null {
  if (QUOTE.test(line)) return { column: null, text: isText(line.replace(QUOTE_MARK, "")) };
  const item = LIST.exec(line);
  return item ? { column: item[0].length, text: isText(line.slice(item[0].length)) } : null;
}

interface Fence {
  char: string;
  size: number;
}

/** The fence a line opens. A backtick fence's info string may not hold a backtick. */
function fenceOpened(line: string): Fence | null {
  const open = FENCE.exec(line);
  if (!open || (open[1][0] === "`" && line.slice(open[0].length).includes("`"))) return null;
  return { char: open[1][0], size: open[1].length };
}

function closesFence(fence: Fence, line: string): boolean {
  const close = FENCE.exec(line);
  return !!close && close[1][0] === fence.char && close[1].length >= fence.size && blank(line.slice(close[0].length));
}

/** Headings outside frontmatter, code, lists and quotes, read the way CommonMark reads them at the top level. */
function findHeadings(lines: string[], start: number): Found[] {
  const found: Found[] = [];
  let fence: Fence | null = null;
  let container: Container | null = null;
  let paragraph = -1;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (closesFence(fence, line)) fence = null;
      continue;
    }
    if (blank(line) || (container && continues(container, line))) {
      if (container) container.text = isText(inside(container, line));
      if (blank(line)) paragraph = -1;
      continue;
    }
    container = opens(line);
    fence = container ? null : fenceOpened(line);
    const heading = container || fence ? null : headingAt(lines, i, paragraph);
    if (heading) found.push(heading);
    if (container || fence || heading || BREAK.test(line) || OTHER_BLOCK.test(line)) paragraph = -1;
    else if (paragraph < 0 && indentOf(line) < 4) paragraph = i;
  }
  return found;
}

/** An ATX heading on this line, or a setext heading it underlines when a paragraph started on `paragraph`. */
function headingAt(lines: string[], i: number, paragraph: number): Found | null {
  const line = lines[i];
  const atx = ATX.exec(line);
  if (atx) return { line: i, headEnd: i, level: atx[1].length, text: atxText(atx[2]) };
  const underline = UNDERLINE.exec(line);
  if (!underline || paragraph < 0) return null;
  const text = lines
    .slice(paragraph, i)
    .map((part) => part.trim())
    .join("\n");
  return { line: paragraph, headEnd: i, level: underline[1][0] === "=" ? 1 : 2, text };
}

/** Every heading in a note with the lines it owns. */
export function noteSections(source: string): Section[] {
  const lines = source.split(/\r?\n/);
  const front = frontmatterParts(source);
  const start = front ? (source.slice(0, front.end).match(/\n/g) ?? []).length : 0;
  const headings = findHeadings(lines, start);
  const seen = new Map<string, number>();
  return headings.map((heading, i) => {
    const words = headingKey(heading.text);
    const n = seen.get(words) ?? 0;
    seen.set(words, n + 1);
    const next = headings.slice(i + 1).find((later) => later.level <= heading.level);
    const end = next?.line ?? lines.length;
    let last = end - 1;
    while (last > heading.headEnd && blank(lines[last])) last--;
    return { ...heading, key: `${words}#${n}`, end, last: last > heading.headEnd ? last : -1 };
  });
}

/** The sections that hold anything to hide. */
export const foldable = (sections: Section[]): Section[] => sections.filter((section) => section.last >= 0);

/** The innermost foldable section that contains a 0-based line. */
export function sectionAt(sections: Section[], line: number): Section | null {
  let found: Section | null = null;
  for (const section of foldable(sections)) if (section.line <= line && line < section.end) found = section;
  return found;
}
