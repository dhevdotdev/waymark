// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { type Command, CommandTable, chordOf } from "../../src/ui/commands";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("chordOf", () => {
  it.each([
    [{ key: "k", metaKey: true }, "mod+k"],
    [{ key: "G", metaKey: true, shiftKey: true }, "mod+shift+g"],
    [{ key: "{", metaKey: true, shiftKey: true }, "mod+shift+["],
    [{ key: "+", metaKey: true, shiftKey: true }, "mod+shift+="],
    [{ key: "«", code: "Backslash", metaKey: true, altKey: true }, "mod+alt+\\"],
    [{ key: "Tab", ctrlKey: true }, "ctrl+tab"],
  ])("%o", (init, chord) => {
    expect(chordOf(key(init))).toBe(chord);
  });
});

describe("CommandTable", () => {
  const make = (commands: Partial<Command>[], env = { desktop: true, hasNote: () => true }) =>
    new CommandTable(commands.map((c, i) => ({ id: `c${i}`, run: vi.fn(), ...c })) as Command[], env);

  it("runs the command bound to a chord", () => {
    const run = vi.fn();
    expect(make([{ keys: ["mod+k"], run }]).handleKey(key({ key: "k", metaKey: true }), false)).toBe(true);
    expect(run).toHaveBeenCalledWith("key");
  });

  it("ignores chords with no command", () => {
    expect(make([{ keys: ["mod+k"] }]).handleKey(key({ key: "j", metaKey: true }), false)).toBe(false);
  });

  it("does not fire while typing unless the command allows it", () => {
    const run = vi.fn();
    const table = make([
      { keys: ["mod+w"], run },
      { keys: ["mod+k"], inField: true, run },
    ]);
    expect(table.handleKey(key({ key: "w", metaKey: true }), true)).toBe(false);
    expect(table.handleKey(key({ key: "k", metaKey: true }), true)).toBe(true);
  });

  it("leaves desktop shortcuts unbound in the browser", () => {
    const table = make([{ keys: ["mod+shift+s"], desktop: true }], { desktop: false, hasNote: () => true });
    expect(table.handleKey(key({ key: "s", metaKey: true, shiftKey: true }), false)).toBe(false);
  });

  it("holds back commands that need a note when none is open", () => {
    const run = vi.fn();
    const table = make([{ id: "x", keys: ["mod+w"], needsNote: true, run }], { desktop: true, hasNote: () => false });
    expect(table.handleKey(key({ key: "w", metaKey: true }), false)).toBe(false);
    table.run("x", "click");
    expect(run).not.toHaveBeenCalled();
  });

  it("lists only labelled, currently available commands in table order", () => {
    const table = make([
      { id: "a", label: "A" },
      { id: "hidden" },
      { id: "b", label: () => "B", when: () => false },
      { id: "c", label: "C" },
    ]);
    expect(table.listed().map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("menu choices", () => {
  const run = vi.fn();
  const table = () => new CommandTable([{ id: "x", keys: ["mod+j"], run }], { desktop: true, hasNote: () => true });
  const press = (t: CommandTable) => t.handleKey(new KeyboardEvent("keydown", { key: "j", metaKey: true }), false);

  it("runs a command", () => {
    run.mockClear();
    table().runFromMenu("x");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not run twice when the key and the menu both see one press", () => {
    run.mockClear();
    const t = table();
    press(t);
    t.runFromMenu("x");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
