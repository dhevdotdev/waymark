const CONTEXT = 3;
const MAX_EDIT_DISTANCE = 4000;

type Step = { kind: "same" | "del" | "add"; text: string };

/** Myers' shortest edit script over the part of two files that differs. */
function shortestEdit(a: string[], b: string[]): Step[] | null {
  const size = a.length + b.length;
  const limit = Math.min(size, MAX_EDIT_DISTANCE);
  const trace: Map<number, number>[] = [];
  const furthest = new Map<number, number>([[1, 0]]);
  for (let d = 0; d <= limit; d++) {
    trace.push(new Map(furthest));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (furthest.get(k - 1) ?? 0) < (furthest.get(k + 1) ?? 0));
      let x = down ? (furthest.get(k + 1) ?? 0) : (furthest.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++;
        y++;
      }
      furthest.set(k, x);
      if (x >= a.length && y >= b.length) return backtrack(a, b, trace, d);
    }
  }
  return null;
}

function backtrack(a: string[], b: string[], trace: Map<number, number>[], distance: number): Step[] {
  const steps: Step[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = distance; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && (v.get(k - 1) ?? 0) < (v.get(k + 1) ?? 0));
    const previousK = down ? k + 1 : k - 1;
    const previousX = v.get(previousK) ?? 0;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      steps.push({ kind: "same", text: a[--x] });
      y--;
    }
    if (d > 0) {
      if (down) steps.push({ kind: "add", text: b[--y] });
      else steps.push({ kind: "del", text: a[--x] });
    }
  }
  return steps.reverse();
}

function diffLines(a: string[], b: string[]): Step[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const oldMiddle = a.slice(start, a.length - end);
  const newMiddle = b.slice(start, b.length - end);
  const middle = shortestEdit(oldMiddle, newMiddle) ?? [
    ...oldMiddle.map((text): Step => ({ kind: "del", text })),
    ...newMiddle.map((text): Step => ({ kind: "add", text })),
  ];
  const same = (text: string): Step => ({ kind: "same", text });
  return [...a.slice(0, start).map(same), ...middle, ...a.slice(a.length - end).map(same)];
}

const splitLines = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));

/** The change from `before` to `after` as Git would print it, or an empty string when they match. */
export function unifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return "";
  const steps = diffLines(splitLines(before), splitLines(after));
  const changed = steps.flatMap((step, i) => (step.kind === "same" ? [] : [i]));
  if (!changed.length) return "";
  const ranges: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - CONTEXT);
    const to = Math.min(steps.length - 1, i + CONTEXT);
    const last = ranges.at(-1);
    if (last && from <= last[1] + 1) last[1] = to;
    else ranges.push([from, to]);
  }
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  let oldLine = 1;
  let newLine = 1;
  let at = 0;
  const advance = (step: Step) => {
    if (step.kind !== "add") oldLine++;
    if (step.kind !== "del") newLine++;
  };
  const Sign = { same: " ", del: "-", add: "+" };
  for (const [from, to] of ranges) {
    for (; at < from; at++) advance(steps[at]);
    const slice = steps.slice(from, to + 1);
    const oldCount = slice.filter((s) => s.kind !== "add").length;
    const newCount = slice.filter((s) => s.kind !== "del").length;
    out.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (const step of slice) {
      out.push(`${Sign[step.kind]}${step.text}`);
      advance(step);
      at++;
    }
  }
  return `${out.join("\n")}\n`;
}
