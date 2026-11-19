import { afterEach, describe, expect, it, vi } from "vitest";
import { arrowMove, createTypeahead } from "../../src/ui/menu-keys";

const LABELS = ["Copy", "Paste", "Pin", "Plum", "Rename", "Move to Trash"];

function typing() {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const { find } = createTypeahead();
  let at = -1;
  const type = (key: string, after = 50) => {
    now += after;
    const found = find(key, LABELS, at);
    if (found >= 0) at = found;
    return found;
  };
  return type;
}

describe("createTypeahead", () => {
  afterEach(() => vi.restoreAllMocks());

  it("spells a prefix from keys typed close together", () => {
    const type = typing();
    expect(type("p")).toBe(1);
    expect(type("l")).toBe(3);
  });

  it("cycles through the items that start with a repeated letter", () => {
    const type = typing();
    expect([type("p"), type("p"), type("p"), type("p")]).toEqual([1, 2, 3, 1]);
  });

  it("starts a new search after a pause", () => {
    const type = typing();
    expect(type("p")).toBe(1);
    expect(type("r", 600)).toBe(4);
  });

  it("keeps the current item while a longer prefix still names it", () => {
    const type = typing();
    expect(type("m")).toBe(5);
    expect(type("o")).toBe(5);
  });

  it("finds nothing for a prefix no item has", () => {
    const type = typing();
    expect(type("z")).toBe(-1);
  });
});

describe("arrowMove", () => {
  it("wraps at both ends and jumps with Home and End", () => {
    expect(arrowMove("ArrowDown", 2, 3)).toBe(0);
    expect(arrowMove("ArrowUp", 0, 3)).toBe(2);
    expect(arrowMove("ArrowUp", -1, 3)).toBe(2);
    expect(arrowMove("ArrowDown", -1, 3)).toBe(0);
    expect(arrowMove("Home", 2, 3)).toBe(0);
    expect(arrowMove("End", 0, 3)).toBe(2);
  });

  it("reads the side arrows only when the group runs both ways", () => {
    expect(arrowMove("ArrowRight", 0, 3)).toBeNull();
    expect(arrowMove("ArrowRight", 0, 3, "both")).toBe(1);
    expect(arrowMove("ArrowLeft", 0, 3, "both")).toBe(2);
    expect(arrowMove("a", 0, 3, "both")).toBeNull();
  });
});
