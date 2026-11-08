interface Line {
  kind: "add" | "del" | "ctx" | "meta";
  text: string;
  old?: number;
  new?: number;
}

interface FileDiff {
  path: string;
  oldPath: string | null;
  status: "added" | "deleted" | "renamed" | "modified" | "binary";
  hunks: { header: string; lines: Line[] }[];
  added: number;
  removed: number;
}

const unquotePath = (p: string) => p.replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");

/** Applies a per-file header line; false when the line is not one. */
function applyFileHeader(file: FileDiff, raw: string, inHunk: boolean): boolean {
  if (raw.startsWith("new file")) file.status = "added";
  else if (raw.startsWith("deleted file")) file.status = "deleted";
  else if (raw.startsWith("rename from ")) {
    file.status = "renamed";
    file.oldPath = raw.slice(12);
  } else if (raw.startsWith("Binary files")) file.status = "binary";
  else if (raw.startsWith("--- ") && !inHunk) {
    if (raw !== "--- /dev/null" && !file.oldPath) file.oldPath = unquotePath(raw.slice(4));
  } else if (raw.startsWith("+++ ") && !inHunk) {
    if (raw !== "+++ /dev/null") file.path = unquotePath(raw.slice(4));
  } else return false;
  return true;
}

function startFile(raw: string): FileDiff {
  const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(raw);
  return { path: m?.[2] ?? raw.slice(11), oldPath: null, status: "modified", hunks: [], added: 0, removed: 0 };
}

function startHunk(file: FileDiff, raw: string, cursor: { old: number; new: number }): FileDiff["hunks"][number] {
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(raw);
  cursor.old = Number(m?.[1] ?? 0);
  cursor.new = Number(m?.[2] ?? 0);
  const hunk = { header: m?.[3] ?? "", lines: [] };
  file.hunks.push(hunk);
  return hunk;
}

function addHunkLine(file: FileDiff, hunk: FileDiff["hunks"][number], raw: string, cursor: { old: number; new: number }): void {
  if (raw.startsWith("+")) {
    hunk.lines.push({ kind: "add", text: raw.slice(1), new: cursor.new++ });
    file.added++;
  } else if (raw.startsWith("-")) {
    hunk.lines.push({ kind: "del", text: raw.slice(1), old: cursor.old++ });
    file.removed++;
  } else if (raw.startsWith(" ")) {
    hunk.lines.push({ kind: "ctx", text: raw.slice(1), old: cursor.old++, new: cursor.new++ });
  } else if (raw.startsWith("\\")) {
    hunk.lines.push({ kind: "meta", text: raw.slice(2) });
  }
}

function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: FileDiff["hunks"][number] | null = null;
  const cursor = { old: 0, new: 0 };
  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      file = startFile(raw);
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file || applyFileHeader(file, raw, hunk !== null)) continue;
    if (raw.startsWith("@@")) hunk = startHunk(file, raw, cursor);
    else if (hunk) addHunkLine(file, hunk, raw, cursor);
  }
  if (file && file.oldPath === file.path) file.oldPath = null;
  for (const f of files) if (f.oldPath === f.path) f.oldPath = null;
  return files;
}

/** Marks the changed middle of a removed/added line pair so prose edits are easy to spot. */
function emphasise(a: string, b: string): [DocumentFragment, DocumentFragment] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const build = (s: string, from: number, to: number) => {
    const f = document.createDocumentFragment();
    f.append(s.slice(0, from));
    if (to > from) {
      const m = document.createElement("span");
      m.className = "diff-word";
      m.textContent = s.slice(from, to);
      f.append(m);
    }
    f.append(s.slice(to));
    return f;
  };
  const similar = start + (a.length - endA) > Math.min(a.length, b.length) * 0.3;
  if (!similar) {
    const fa = document.createDocumentFragment();
    fa.append(a);
    const fb = document.createDocumentFragment();
    fb.append(b);
    return [fa, fb];
  }
  return [build(a, start, endA), build(b, start, endB)];
}

export function renderDiff(text: string, opts: { emptyMessage?: string } = {}): HTMLElement {
  const root = document.createElement("div");
  root.className = "diff";
  const files = parseDiff(text);
  if (!files.length) {
    const empty = document.createElement("p");
    empty.className = "diff-empty";
    empty.textContent = opts.emptyMessage ?? "No changes.";
    root.append(empty);
    return root;
  }
  for (const f of files) {
    const section = document.createElement("section");
    section.className = "diff-file";
    const head = document.createElement("header");
    head.className = "diff-file-head";
    const name = document.createElement("span");
    name.className = "diff-file-name";
    name.textContent = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
    const stat = document.createElement("span");
    stat.className = "diff-stat";
    stat.innerHTML = `<span class="add">+${f.added}</span><span class="del">−${f.removed}</span>`;
    const badge = document.createElement("span");
    badge.className = `diff-badge is-${f.status}`;
    badge.textContent = f.status;
    head.append(badge, name, stat);
    section.append(head);
    if (f.status === "binary") {
      const p = document.createElement("p");
      p.className = "diff-empty";
      p.textContent = "Binary file changed.";
      section.append(p);
    }
    for (const h of f.hunks) {
      const table = document.createElement("div");
      table.className = "diff-hunk";
      if (h.header) {
        const hh = document.createElement("div");
        hh.className = "diff-hunk-head";
        hh.textContent = h.header;
        table.append(hh);
      }
      for (let i = 0; i < h.lines.length; i++) {
        const line = h.lines[i];
        const next = h.lines[i + 1];
        if (line.kind === "del" && next?.kind === "add" && h.lines[i + 2]?.kind !== "add" && h.lines[i - 1]?.kind !== "del") {
          const [a, b] = emphasise(line.text, next.text);
          table.append(row(line, a), row(next, b));
          i++;
          continue;
        }
        table.append(row(line));
      }
      section.append(table);
    }
    root.append(section);
  }
  return root;
}

function row(line: Line, content?: DocumentFragment): HTMLElement {
  const el = document.createElement("div");
  el.className = `diff-line is-${line.kind}`;
  const o = document.createElement("span");
  o.className = "diff-no";
  o.textContent = line.old !== undefined && line.kind !== "add" ? String(line.old) : "";
  const n = document.createElement("span");
  n.className = "diff-no";
  n.textContent = line.new !== undefined && line.kind !== "del" ? String(line.new) : "";
  const sign = document.createElement("span");
  sign.className = "diff-sign";
  sign.textContent = line.kind === "add" ? "+" : line.kind === "del" ? "−" : "";
  const text = document.createElement("span");
  text.className = "diff-text";
  if (content) text.append(content);
  else text.textContent = line.text || " ";
  el.append(o, n, sign, text);
  return el;
}
