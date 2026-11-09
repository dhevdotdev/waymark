import { describe, expect, it } from "vitest";
import { lineEnding, taskLists, toggleTask } from "../../src/vault/tasks";

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

describe("taskLists", () => {
  const one = (done: number, total: number) => ({ done, total });

  it("counts done and open tasks and ignores fenced code", () => {
    expect(taskLists("- [x] a\n- [ ] b\n  ```\n  - [ ] not one\n  ```\n* [X] c")).toEqual([one(2, 3)]);
    expect(taskLists("~~~\n```\n- [ ] inside\n~~~\n- [ ] after")).toEqual([one(0, 1)]);
  });

  it("gives each list under its own heading its own count", () => {
    expect(taskLists("## One\n- [ ] a\n- [ ] b\n\n## Two\n- [x] c\n- [ ] d\n- [x] e\n")).toEqual([one(0, 2), one(2, 3)]);
  });

  it("separates lists split by a paragraph or a code block", () => {
    expect(taskLists("- [ ] a\n\nSome words.\n\n- [x] b\n\n```\nx\n```\n\n- [ ] c")).toEqual([one(0, 1), one(1, 1), one(0, 1)]);
  });

  it("keeps blank lines, nesting, wrapped text and plain bullets inside one list", () => {
    expect(taskLists("- [ ] a\n\n- [x] b\n  - [ ] nested\n  more about it\n- plain\n- [ ] c")).toEqual([one(1, 4)]);
  });

  it("counts tasks in quotes", () => {
    expect(taskLists("> - [x] a\n> - [ ] b")).toEqual([one(1, 2)]);
  });

  it("has nothing to say about a note with no tasks", () => {
    expect(taskLists("# Just words\n\n- a bullet")).toEqual([]);
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
