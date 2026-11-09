const TASK_LINE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\])/;
const LIST_ITEM = /^(?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
const FENCE = /^ {0,3}(```|~~~)/;

/** Flips the task on a line of the note. Null means that line is not a task, so nothing should be written. */
export function toggleTask(text: string, line: number): string | null {
  if (!Number.isInteger(line) || line < 0) return null;
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

export interface TaskList {
  done: number;
  total: number;
}

/**
 * Each to-do list in a note, in order, ignoring fenced code. Blank lines,
 * indented text and plain bullets stay inside a list. Anything else between
 * two tasks, such as a heading or paragraph, starts a new one.
 */
export function taskLists(text: string): TaskList[] {
  const lists: TaskList[] = [];
  let current: TaskList | null = null;
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const marker = FENCE.exec(line)?.[1] ?? null;
    if (marker && (fence === null || fence === marker)) {
      fence = fence === null ? marker : null;
      if (!/^\s/.test(line)) current = null;
      continue;
    }
    if (fence !== null) continue;
    const match = TASK_LINE.exec(line);
    if (match) {
      if (!current) {
        current = { done: 0, total: 0 };
        lists.push(current);
      }
      current.total++;
      if (match[2] !== " ") current.done++;
    } else if (line.trim() && !/^\s/.test(line) && !LIST_ITEM.test(line)) {
      current = null;
    }
  }
  return lists;
}

/** The line ending to keep when editing, or null when a file mixes them and could not be saved unchanged. */
export function lineEnding(text: string): "\n" | "\r\n" | null {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  if (crlf === 0) return "\n";
  return crlf === (text.match(/\n/g) ?? []).length ? "\r\n" : null;
}
