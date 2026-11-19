// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { acceleratorFrom, shortcutLabel } from "../../src/ui/capture-shortcut";

const press = (code: string, held: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...held,
});

describe("acceleratorFrom", () => {
  it("writes modifiers in a fixed order before the key", () => {
    expect(acceleratorFrom(press("Space", { ctrlKey: true, altKey: true }))).toBe("Control+Alt+Space");
    expect(acceleratorFrom(press("KeyN", { metaKey: true, shiftKey: true, altKey: true }))).toBe("Alt+Shift+Command+KeyN");
  });

  it("needs Control, Option or Command, so typing never sets a shortcut", () => {
    expect(acceleratorFrom(press("KeyA"))).toBeNull();
    expect(acceleratorFrom(press("KeyA", { shiftKey: true }))).toBeNull();
  });

  it("waits while only modifiers are down, and leaves Escape and Delete to the recorder", () => {
    expect(acceleratorFrom(press("ControlLeft", { ctrlKey: true }))).toBeNull();
    expect(acceleratorFrom(press("MetaRight", { metaKey: true }))).toBeNull();
    expect(acceleratorFrom(press("Escape", { ctrlKey: true }))).toBeNull();
    expect(acceleratorFrom(press("Backspace", { altKey: true }))).toBeNull();
  });
});

describe("shortcutLabel", () => {
  it("writes a shortcut as the menu bar does", () => {
    expect(shortcutLabel("Control+Alt+Space")).toBe("⌃⌥Space");
    expect(shortcutLabel("Alt+Shift+Command+KeyN")).toBe("⌥⇧⌘N");
    expect(shortcutLabel("Control+Digit1")).toBe("⌃1");
    expect(shortcutLabel("Command+Slash")).toBe("⌘/");
    expect(shortcutLabel("")).toBe("Off");
  });
});
