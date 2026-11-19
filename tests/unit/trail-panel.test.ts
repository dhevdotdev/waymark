// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { siblingPlaces } from "../../src/ui/trail-panel";

describe("siblingPlaces", () => {
  it("counts a level's rows as one set until a shallower row ends it", () => {
    // A, its side branch B with its own C, then the main line D and E; D has a side branch F.
    expect(siblingPlaces([0, 1, 2, 0, 1, 0])).toEqual([
      [1, 3],
      [1, 1],
      [1, 1],
      [2, 3],
      [1, 1],
      [3, 3],
    ]);
  });

  it("gives two side branches of one stop a set of two", () => {
    expect(siblingPlaces([0, 1, 1, 0])).toEqual([
      [1, 2],
      [1, 2],
      [2, 2],
      [2, 2],
    ]);
  });

  it("handles an empty trail", () => {
    expect(siblingPlaces([])).toEqual([]);
  });
});
