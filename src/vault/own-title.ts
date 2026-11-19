import { noteBody } from "./frontmatter";

const ATX_H1 = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$/;

const comparable = (text: string) => text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/** The text of a `# Heading` line, or null when the line is not a level-one heading. */
export function levelOneHeading(line: string): string | null {
  const match = ATX_H1.exec(line);
  return match?.[1].trim() ? match[1] : null;
}

/**
 * Whether the note opens with a level-one heading that says its own name, ignoring case and spacing. Such a note shows
 * that heading as its title, so the name is not printed twice. The file is never changed for it.
 */
export function opensWithTitle(source: string, title: string): boolean {
  const first = noteBody(source)
    .split("\n")
    .find((line) => line.trim());
  const heading = first === undefined ? null : levelOneHeading(first);
  return heading !== null && comparable(heading) === comparable(title);
}
