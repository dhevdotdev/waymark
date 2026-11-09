/** Editing a GFM table as lines of text. Every operation returns new lines and leaves the bytes of untouched cells alone. */

interface Segment {
  from: number;
  to: number;
}

export interface ParsedTable {
  /** Header first, then body rows, each exactly as many cells as the header. */
  rows: string[][];
  align: ("left" | "center" | "right" | "")[];
}

/** The stretches between unescaped pipes. A leading and trailing pipe are both optional in Markdown. */
function segments(line: string): Segment[] {
  const pipes: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "|" && line[i - 1] !== "\\") pipes.push(i);
  }
  const start = Math.max(0, line.search(/\S/));
  const end = line.trimEnd().length;
  const hasLead = pipes[0] === start;
  const hasTail = pipes.at(-1) === end - 1 && (pipes.length > 1 || !hasLead);
  const out: Segment[] = [];
  let cursor = hasLead ? start + 1 : start;
  for (const pipe of hasLead ? pipes.slice(1) : pipes) {
    out.push({ from: cursor, to: pipe });
    cursor = pipe + 1;
  }
  if (!hasTail) out.push({ from: cursor, to: end });
  return out;
}

const decode = (raw: string) => raw.trim().replace(/\\\|/g, "|");
const encode = (text: string) =>
  text
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/\\\|/g, "|")
    .replace(/\|/g, "\\|");

const lineOfRow = (row: number) => (row === 0 ? 0 : row + 1);
const cellsOf = (line: string) => segments(line).map((s) => line.slice(s.from, s.to));

export function parseTable(lines: string[]): ParsedTable {
  const header = cellsOf(lines[0]);
  const rows = [lines[0], ...lines.slice(2)].map((line) => {
    const cells = cellsOf(line).map(decode);
    return Array.from({ length: header.length }, (_, i) => cells[i] ?? "");
  });
  const align = header.map((_, i) => {
    const marker = (cellsOf(lines[1])[i] ?? "").trim();
    if (marker.startsWith(":") && marker.endsWith(":")) return "center" as const;
    if (marker.endsWith(":")) return "right" as const;
    return marker.startsWith(":") ? ("left" as const) : ("" as const);
  });
  return { rows, align };
}

/** Gives a short row the empty cells it lacks, leaving the cells it has exactly as written. */
function withCells(line: string, count: number): string {
  const missing = count - cellsOf(line).length;
  if (missing <= 0) return line;
  const row = line.trimEnd();
  const closed = row.endsWith("|") && !row.endsWith("\\|");
  return `${closed ? row : `${row} |`}${"  |".repeat(missing)}`;
}

const replaced = (lines: string[], at: number, line: string) => lines.map((l, i) => (i === at ? line : l));

export function setCell(lines: string[], row: number, column: number, text: string): string[] {
  const at = lineOfRow(row);
  const line = withCells(lines[at], column + 1);
  const { from, to } = segments(line)[column];
  const raw = line.slice(from, to);
  /* A pipe straight after a backslash would count as escaped and merge this cell with the next. */
  const value = encode(text).replace(/\\$/, "\\ ");
  if (!raw.trim()) return replaced(lines, at, `${line.slice(0, from)} ${value} ${line.slice(to)}`);
  const start = from + (raw.length - raw.trimStart().length);
  return replaced(lines, at, line.slice(0, start) + value + line.slice(from + raw.trimEnd().length));
}

export function insertRow(lines: string[], afterRow: number): string[] {
  const columns = cellsOf(lines[0]).length;
  const blank = `|${"  |".repeat(columns)}`;
  const at = lineOfRow(afterRow) + (afterRow === 0 ? 2 : 1);
  return [...lines.slice(0, at), blank, ...lines.slice(at)];
}

export function deleteRow(lines: string[], row: number): string[] {
  if (row === 0) return lines;
  return lines.filter((_, i) => i !== lineOfRow(row));
}

export function insertColumn(lines: string[], afterColumn: number): string[] {
  const needed = afterColumn + 1;
  return lines.map((original, i) => {
    const line = withCells(original, needed);
    const at = segments(line)[afterColumn].to;
    return `${line.slice(0, at)}|${i === 1 ? " --- " : "  "}${line.slice(at)}`;
  });
}

export function deleteColumn(lines: string[], column: number): string[] {
  if (cellsOf(lines[0]).length <= 1) return lines;
  return lines.map((line) => {
    const all = segments(line);
    const target = all[column];
    if (!target) return line;
    const next = all[column + 1];
    return next ? line.slice(0, target.from) + line.slice(next.from) : line.slice(0, target.from - 1) + line.slice(target.to);
  });
}
