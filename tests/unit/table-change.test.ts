import { describe, expect, it } from "vitest";
import { describeTableChange } from "../../src/vault/table-change";

const table = (rows: string[][], align: ("" | "left" | "center" | "right")[] = rows[0].map(() => "")) => ({ rows, align });
const base = [
  ["h1", "h2"],
  ["a", "b"],
  ["c", "d"],
  ["e", "f"],
];

describe("describeTableChange", () => {
  it("finds an added and a removed row", () => {
    const added = [base[0], base[1], ["", ""], base[2], base[3]];
    expect(describeTableChange(table(base), table(added))).toEqual({ kind: "rowsAdded", from: 2, count: 1 });
    expect(describeTableChange(table(added), table(base))).toEqual({ kind: "rowsRemoved", from: 2, count: 1 });
  });

  it("finds an added and a removed column", () => {
    const added = base.map(([a, b]) => [a, "", b]);
    expect(describeTableChange(table(base), table(added))).toEqual({ kind: "columnsAdded", from: 1, count: 1 });
    expect(describeTableChange(table(added), table(base))).toEqual({ kind: "columnsRemoved", from: 1, count: 1 });
  });

  it("finds a moved row in either direction", () => {
    const up = [base[0], base[3], base[1], base[2]];
    expect(describeTableChange(table(base), table(up))).toEqual({ kind: "rowMoved", from: 3, to: 1 });
    expect(describeTableChange(table(up), table(base))).toEqual({ kind: "rowMoved", from: 1, to: 3 });
  });

  it("finds a moved column", () => {
    const swapped = base.map(([a, b]) => [b, a]);
    const change = describeTableChange(table(base), table(swapped));
    expect(change.kind).toBe("columnMoved");
  });

  it("finds an alignment change and changed cells", () => {
    expect(describeTableChange(table(base), table(base, ["", "right"]))).toEqual({ kind: "aligned", column: 1 });
    const edited = [base[0], ["a", "z"], base[2], base[3]];
    expect(describeTableChange(table(base), table(edited))).toEqual({ kind: "cells", cells: [{ row: 1, column: 1 }] });
  });

  it("reports nothing when nothing changed", () => {
    expect(describeTableChange(table(base), table(base))).toEqual({ kind: "none" });
  });

  it("does not mistake two swapped cells in one row for a moved column", () => {
    const edited = [base[0], ["b", "a"], base[2], base[3]];
    expect(describeTableChange(table(base), table(edited)).kind).toBe("cells");
  });
});
