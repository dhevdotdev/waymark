import { describe, expect, it } from "vitest";
import { tabWidthLimit } from "../../src/ui/tab-strip";

describe("tabWidthLimit", () => {
  it("sets no limit while every tab fits", () => {
    expect(tabWidthLimit([100, 200, 300], 600)).toBeNull();
  });

  it("takes room only from the widest tabs, so a short title keeps its width", () => {
    expect(tabWidthLimit([100, 300, 300], 500)).toBe(200);
  });

  it("shares the room evenly when every tab is wide", () => {
    expect(tabWidthLimit([300, 300, 300], 600)).toBe(200);
  });

  it("does not depend on the order of the tabs", () => {
    expect(tabWidthLimit([300, 100, 300], 500)).toBe(200);
  });

  it("never squeezes a tab below the minimum", () => {
    expect(tabWidthLimit([300, 300], 100)).toBe(72);
  });
});
