import { describe, expect, it } from "vitest";
import { keystrokeOf } from "../../src/ui/sound";

const press = (key: string, extra: Partial<KeyboardEvent> = {}) =>
  keystrokeOf({ key, repeat: false, metaKey: false, ctrlKey: false, isComposing: false, ...extra });

describe("keystrokeOf", () => {
  it.each([
    ["a", "key"],
    ["Z", "key"],
    ["7", "key"],
    [" ", "space"],
    ["Enter", "return"],
    ["Backspace", "delete"],
    ["Delete", "delete"],
  ])("%j sounds like %s", (key, sound) => {
    expect(press(key)).toBe(sound);
  });

  it.each(["Shift", "Meta", "Alt", "ArrowLeft", "Escape", "F2", "Tab"])("%s writes nothing, so it is silent", (key) => {
    expect(press(key)).toBeNull();
  });

  it("stays silent for shortcuts, held keys and input methods", () => {
    expect(press("b", { metaKey: true })).toBeNull();
    expect(press("b", { ctrlKey: true })).toBeNull();
    expect(press("b", { repeat: true })).toBeNull();
    expect(press("b", { isComposing: true })).toBeNull();
  });
});
