import { afterEach, describe, expect, it, vi } from "vitest";
import { createTypeahead } from "../../src/ui/typeahead";

const NAMES = ["Apple", "Apricot", "Banana", "Plum", "Pear", "plum jam"];

describe("createTypeahead", () => {
  afterEach(() => vi.useRealTimers());

  it("finds the next name starting with a letter, from the row after focus", () => {
    const find = createTypeahead();
    expect(find("p", NAMES, 0)).toBe(3);
  });

  it("steps through the names that start with a letter pressed again", () => {
    vi.useFakeTimers();
    const find = createTypeahead();
    expect(find("p", NAMES, 3)).toBe(4);
    expect(find("p", NAMES, 4)).toBe(5);
    expect(find("p", NAMES, 5)).toBe(3);
  });

  it("adds up characters typed without a pause and keeps a row that still matches", () => {
    vi.useFakeTimers();
    const find = createTypeahead();
    expect(find("a", NAMES, -1)).toBe(0);
    expect(find("p", NAMES, 0)).toBe(0);
    expect(find("r", NAMES, 0)).toBe(1);
  });

  it("starts again after a pause", () => {
    vi.useFakeTimers();
    const find = createTypeahead();
    expect(find("b", NAMES, 0)).toBe(2);
    expect(find.active()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(find.active()).toBe(false);
    expect(find("p", NAMES, 2)).toBe(3);
  });

  it("ignores case and reports no match", () => {
    const find = createTypeahead();
    expect(find("Z", NAMES, 0)).toBe(-1);
    expect(createTypeahead()("B", NAMES, 0)).toBe(2);
  });
});
