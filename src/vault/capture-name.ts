const LONGEST_NAME = 60;
const UNTITLED = "Untitled";

/** List, quote and heading marks at the start of a line, which say how the line is written, not what it says. */
const LINE_MARK = /^(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+)/;
/** What Obsidian and the file systems a vault syncs to refuse in a name. */
const REFUSED = /[\\/:#^[\]|*"<>?]/g;

/** A note name from the first line of a capture: its words, without the characters a name cannot hold. */
export function captureName(text: string): string {
  const first = text.split("\n").find((line) => line.trim() !== "") ?? "";
  const words = first
    .trim()
    .replace(LINE_MARK, "")
    .replace(REFUSED, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!words) return UNTITLED;
  if (words.length <= LONGEST_NAME) return words;
  const cut = words.slice(0, LONGEST_NAME + 1);
  const space = cut.lastIndexOf(" ");
  return cut.slice(0, space > LONGEST_NAME / 2 ? space : LONGEST_NAME).replace(/[.\s]+$/, "");
}

/** The name, then the name with 2, 3 and on after it, so a capture never takes an existing note's place. */
export function* captureNames(name: string, limit = 50): Generator<string> {
  yield name;
  for (let n = 2; n <= limit; n++) yield `${name} ${n}`;
}
