import { describe, expect, it } from "vitest";
import { unifiedDiff } from "../../src/vault/line-diff";

/** Applies a unified diff back onto the old text, so a diff can be checked against what it claims. */
function apply(before: string, diff: string): string {
  const oldLines = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const out: string[] = [];
  let at = 0;
  for (const line of diff.split("\n").slice(3)) {
    const hunk = /^@@ -(\d+),(\d+) \+/.exec(line);
    if (hunk) {
      const start = Number(hunk[1]) - 1;
      while (at < start) out.push(oldLines[at++]);
    } else if (line.startsWith(" ")) {
      out.push(oldLines[at++]);
    } else if (line.startsWith("-")) {
      at++;
    } else if (line.startsWith("+")) {
      out.push(line.slice(1));
    }
  }
  while (at < oldLines.length) out.push(oldLines[at++]);
  return `${out.join("\n")}\n`;
}

describe("unifiedDiff", () => {
  it("is empty for identical text", () => {
    expect(unifiedDiff("a.md", "one\ntwo\n", "one\ntwo\n")).toBe("");
  });

  it("marks only the changed line, with its context", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = before.replace("d", "D");
    const lines = unifiedDiff("a.md", `${before}\n`, `${after}\n`).split("\n");
    expect(lines[0]).toBe("diff --git a/a.md b/a.md");
    expect(lines[3]).toBe("@@ -1,7 +1,7 @@");
    expect(lines.filter((l) => l.startsWith("-") && !l.startsWith("---"))).toEqual(["-d"]);
    expect(lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toEqual(["+D"]);
  });

  it("separates changes that are far apart into hunks", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[2] = "changed early";
    after[35] = "changed late";
    const diff = unifiedDiff("a.md", `${before.join("\n")}\n`, `${after.join("\n")}\n`);
    expect(diff.match(/^@@/gm)).toHaveLength(2);
  });

  it("round-trips a mix of inserts, deletes and edits", () => {
    const before = "title\n\nfirst\nsecond\nthird\nfourth\n\nend\n";
    const after = "title\n\nnew opening\nfirst\nthird\nfourth changed\n\nextra\nend\n";
    expect(apply(before, unifiedDiff("a.md", before, after))).toBe(after);
  });

  it("handles an empty side", () => {
    expect(unifiedDiff("a.md", "", "only\n")).toContain("+only");
    expect(unifiedDiff("a.md", "only\n", "")).toContain("-only");
  });

  it("falls back to replacing the whole middle when two large files share nothing", () => {
    const before = `${Array.from({ length: 6000 }, (_, i) => `a${i}`).join("\n")}\n`;
    const after = `${Array.from({ length: 6000 }, (_, i) => `b${i}`).join("\n")}\n`;
    const started = performance.now();
    const diff = unifiedDiff("a.md", before, after);
    expect(apply(before, diff)).toBe(after);
    expect(performance.now() - started).toBeLessThan(4000);
  });
});
