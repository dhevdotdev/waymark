import { describe, expect, it } from "vitest";
import { lineEnding, taskProgress, toggleTask } from "../../src/vault/tasks";

describe("toggleTask", () => {
  it("flips only the marker on that line", () => {
    expect(toggleTask("a\n- [ ] b\n- [x] c\n", 1)).toBe("a\n- [x] b\n- [x] c\n");
    expect(toggleTask("a\n- [ ] b\n- [x] c\n", 2)).toBe("a\n- [ ] b\n- [ ] c\n");
  });

  it("keeps Windows line endings and an uppercase done marker becomes open", () => {
    expect(toggleTask("x\r\n* [X] y\r\n", 1)).toBe("x\r\n* [ ] y\r\n");
  });

  it("handles nesting, numbers and quotes", () => {
    expect(toggleTask("  - [ ] a", 0)).toBe("  - [x] a");
    expect(toggleTask("1. [ ] a", 0)).toBe("1. [x] a");
    expect(toggleTask("> - [ ] a", 0)).toBe("> - [x] a");
  });

  it("writes nothing for a line number that is not one", () => {
    expect(toggleTask("- [ ] a", Number.NaN)).toBeNull();
    expect(toggleTask("- [ ] a", -1)).toBeNull();
  });

  it("writes nothing when the line is not a task", () => {
    expect(toggleTask("plain\n- a", 0)).toBeNull();
    expect(toggleTask("- a [ ] b", 0)).toBeNull();
    expect(toggleTask("- [ ] a", 5)).toBeNull();
  });
});

describe("taskProgress", () => {
  it("counts tasks and ignores fenced examples", () => {
    expect(taskProgress("- [x] a\n- [ ] b\n```\n- [ ] not one\n```\n* [X] c")).toEqual({ done: 2, total: 3 });
    expect(taskProgress("~~~\n```\n- [ ] inside\n~~~\n- [ ] after")).toEqual({ done: 0, total: 1 });
  });
});

describe("lineEnding", () => {
  it("keeps what the file uses and refuses a mix", () => {
    expect(lineEnding("a\nb\n")).toBe("\n");
    expect(lineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(lineEnding("no breaks")).toBe("\n");
    expect(lineEnding("a\r\nb\n")).toBeNull();
  });
});
