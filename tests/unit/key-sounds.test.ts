import { describe, expect, it } from "vitest";
import strokes from "../../src/assets/key-sounds/strokes.json";
import { familyOf, keyPan, keyTune, touchFor } from "../../src/ui/key-sounds";

describe("familyOf", () => {
  it.each([
    ["KeyA", "key"],
    ["Digit7", "key"],
    ["ArrowLeft", "key"],
    ["Space", "space"],
    ["Enter", "enter"],
    ["NumpadEnter", "enter"],
    ["Backspace", "backspace"],
    ["Delete", "backspace"],
    ["ShiftLeft", "modifier"],
    ["MetaRight", "modifier"],
    ["Tab", "modifier"],
    ["CapsLock", "modifier"],
  ])("%s sounds like a %s", (code, family) => {
    expect(familyOf(code)).toBe(family);
  });
});

describe("keyPan", () => {
  it("places keys from left to right across a row", () => {
    expect(keyPan("KeyQ")).toBeLessThan(keyPan("KeyT"));
    expect(keyPan("KeyT")).toBeLessThan(keyPan("KeyP"));
  });

  it("keeps the ends of a row at the edges and the space bar in the middle", () => {
    expect(keyPan("Backquote")).toBe(-1);
    expect(keyPan("Backspace")).toBe(1);
    expect(keyPan("Space")).toBe(0);
  });

  it("puts a key it does not know in the middle", () => {
    expect(keyPan("F13")).toBe(0);
  });
});

describe("keyTune", () => {
  it("gives a key the same slight tuning every time", () => {
    expect(keyTune("KeyA")).toBe(keyTune("KeyA"));
    expect(keyTune("KeyA")).toBeGreaterThanOrEqual(0.98);
    expect(keyTune("KeyA")).toBeLessThanOrEqual(1.02);
  });

  it("tunes different keys differently", () => {
    expect(new Set(["KeyA", "KeyB", "KeyC", "KeyD"].map(keyTune)).size).toBe(4);
  });
});

describe("touchFor", () => {
  it("lands a deliberate press at full strength", () => {
    expect(touchFor(5000)).toBe(1);
    expect(touchFor(220)).toBe(1);
  });

  it("softens the fastest typing without silencing it", () => {
    expect(touchFor(10)).toBe(0.6);
    expect(touchFor(145)).toBeCloseTo(0.8);
  });
});

describe("the packed strokes", () => {
  it.each(Object.keys(strokes))("%s has a release for every press, and no empty slices", (profile) => {
    for (const { down, up } of Object.values(strokes[profile as keyof typeof strokes])) {
      expect(up.length).toBe(down.length);
      for (const [, duration] of [...down, ...up]) expect(duration).toBeGreaterThan(0.02);
    }
  });
});
