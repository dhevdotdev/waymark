const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/;
const FENCE = /^ {0,3}(```|~~~)/;

/** Flips the task on a line of the note. Null means that line is not a task, so nothing should be written. */
export function toggleTask(text: string, line: number): string | null {
  let start = 0;
  for (let i = 0; i < line; i++) {
    const next = text.indexOf("\n", start);
    if (next < 0) return null;
    start = next + 1;
  }
  const end = text.indexOf("\n", start);
  const match = TASK_LINE.exec(text.slice(start, end < 0 ? undefined : end));
  if (!match) return null;
  const at = start + match[1].length;
  return `${text.slice(0, at)}${match[2] === " " ? "x" : " "}${text.slice(at + 1)}`;
}

/** How many tasks a note has and how many are done, ignoring anything inside fenced code. */
export function taskProgress(text: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  let inFence = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) continue;
    const match = TASK_LINE.exec(line);
    if (!match) continue;
    total++;
    if (match[2] !== " ") done++;
  }
  return { done, total };
}

/** The line ending to keep when editing, or null when a file mixes them and could not be saved unchanged. */
export function lineEnding(text: string): "\n" | "\r\n" | null {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  if (crlf === 0) return "\n";
  return crlf === (text.match(/\n/g) ?? []).length ? "\r\n" : null;
}
