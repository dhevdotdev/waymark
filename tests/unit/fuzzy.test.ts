// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fuzzy } from "../../src/ui/fuzzy";

describe("fuzzy", () => {
  it("matches words at word starts and marks whole words", () => {
    expect(fuzzy("sailing kn", "Sailing Knots overview")!.marks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fuzzy("tea slow", "Tea eager and slow brewing")!.marks).toEqual([0, 1, 2, 14, 15, 16, 17]);
  });
  it("rejects scattered-letter matches", () => {
    expect(fuzzy("sailing kn", "Sailing boat storage racks - WinterCover")).toBeNull();
  });
  it("supports acronyms from word starts", () => {
    expect(fuzzy("tcdr", "Tin charts, tan and chart datum revisions")!.marks).toEqual([0, 4, 26, 32]);
    expect(fuzzy("tz", "Tin charts")).toBeNull();
    expect(fuzzy("tc", "Tin charts")!.marks).toEqual([0, 4]);
  });
  it("accepts an abbreviation inside one word", () => {
    expect(fuzzy("tin charts", "Tin charts, tan and chart datum revisions")).not.toBeNull();
    expect(fuzzy("sailing kn", "Sailing boat storage racks - WinterCover")).toBeNull();
  });
  it("prefers a direct substring", () => {
    expect(fuzzy("slow", "Tea eager and slow brewing")!.score).toBeGreaterThan(fuzzy("tes", "Tea eager and slow brewing")?.score ?? -Infinity);
  });
});
