import { describe, expect, it } from "vitest";
import { type BaseRow, columnLabel, matches, parseBase, rowsFor } from "../../src/vault/base-file";

const row = (path: string, note: Record<string, string | string[]>, mtime = 0): BaseRow => ({
  path,
  note,
  file: { name: path, basename: path.replace(".md", ""), path, folder: "", ext: "md", size: 1, mtime, ctime: 0 },
});
const base = (text: string) => {
  const parsed = parseBase(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.base;
};

describe("parseBase", () => {
  it("reads filters, display names, columns and sort", () => {
    const b = base(`filters:
  and:
    - note.state == "open"
properties:
  note.state:
    displayName: State
views:
  - type: table
    name: Open
    order: [file.name, state, file.mtime]
    sort:
      - property: file.mtime
        direction: DESC
`);
    expect(columnLabel(b, "note.state")).toBe("State");
    expect(b.views[0].columns).toEqual(["file.name", "note.state", "file.mtime"]);
    const rows = rowsFor(b, b.views[0], [
      row("a.md", { state: "open" }, 1),
      row("b.md", { state: "shut" }, 9),
      row("c.md", { state: "open" }, 5),
    ]);
    expect(rows.map((r) => r.path)).toEqual(["c.md", "a.md"]);
  });

  it("combines and, or and not", () => {
    const b = base(`filters:
  or:
    - and:
        - kind == "a"
        - not:
            - flag == true
    - file.name == "z.md"
views:
  - type: table
`);
    expect(matches(b.filter, row("x.md", { kind: "a" }))).toBe(true);
    expect(matches(b.filter, row("x.md", { kind: "a", flag: "true" }))).toBe(false);
    expect(matches(b.filter, row("z.md", {}))).toBe(true);
  });

  it("treats != as true for a note without the property", () => {
    const b = base('filters: note.kind != "a"\nviews:\n  - type: table\n');
    expect(matches(b.filter, row("x.md", {}))).toBe(true);
  });

  it("says plainly when a filter cannot be evaluated", () => {
    const b = base('filters: file.hasTag("x")\nviews:\n  - type: table\n');
    expect(b.problem).toContain('file.hasTag("x")');
  });

  it("marks only the view that cannot be shown", () => {
    const b = base(
      "views:\n  - type: cards\n    name: Cards\n  - type: table\n    name: Table\n  - type: table\n    groupBy: {property: a}\n",
    );
    expect(b.views[0].problem).toContain("cards");
    expect(b.views[1].problem).toBeNull();
    expect(b.views[2].problem).toContain("groupBy");
  });

  it("refuses a formula column rather than leaving it blank", () => {
    const b = base("views:\n  - type: table\n    order: [formula.total]\n");
    expect(b.views[0].problem).toContain("formula.total");
  });

  it("gives a readable error for broken YAML and wrong shapes", () => {
    expect(parseBase("views: [").ok).toBe(false);
    expect(parseBase("- just\n- a list\n").ok).toBe(false);
    expect(parseBase("views: nope\n").ok).toBe(false);
    expect(parseBase("x".repeat(300_000)).ok).toBe(false);
  });

  it("stops an alias bomb", () => {
    expect(
      parseBase(
        `a: &a [x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]\n`,
      ).ok,
    ).toBe(false);
  });

  it("builds no objects from custom tags", () => {
    const parsed = parseBase('views: !!js/function "function () { return 1 }"\n');
    expect(parsed.ok && parsed.base.views.length).toBe(false);
  });

  it("applies a view limit after sorting", () => {
    const b = base("views:\n  - type: table\n    limit: 1\n    sort:\n      - property: n\n        direction: DESC\n");
    expect(rowsFor(b, b.views[0], [row("a.md", { n: "2" }), row("b.md", { n: "10" })]).map((r) => r.path)).toEqual(["b.md"]);
  });
});
