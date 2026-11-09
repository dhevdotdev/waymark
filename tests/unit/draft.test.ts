import { describe, expect, it, vi } from "vitest";
import { Draft, type DraftState } from "../../src/vault/draft";
import type { WriteOutcome } from "../../src/vault/source";

/** A file on a fake disk that applies the same rule as the real write. */
function setup(initial = "one") {
  const disk = { text: initial as string | null, writes: [] as [string, string | null][] };
  const write = vi.fn(async (text: string, expected: string | null): Promise<WriteOutcome> => {
    disk.writes.push([text, expected]);
    if (disk.text === null && expected !== null) return { kind: "missing" };
    if (disk.text !== expected) return { kind: "changed", current: disk.text as string };
    disk.text = text;
    return { kind: "saved" };
  });
  const states: DraftState[] = [];
  const draft = new Draft(initial, write, (s) => states.push(s), 0);
  return { disk, write, draft, states };
}

describe("Draft", () => {
  it("saves the latest text and expects what it last saw", async () => {
    const { disk, draft } = setup();
    draft.update("two");
    expect(await draft.flush()).toBe(true);
    draft.update("three");
    await draft.flush();
    expect(disk.text).toBe("three");
    expect(disk.writes).toEqual([
      ["two", "one"],
      ["three", "two"],
    ]);
    expect(draft.state.kind).toBe("saved");
  });

  it("writes nothing when the text is unchanged", async () => {
    const { write, draft } = setup();
    expect(await draft.flush()).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("stops at a change made elsewhere and overwrites nothing", async () => {
    const { disk, draft } = setup();
    disk.text = "theirs";
    draft.update("mine");
    expect(await draft.flush()).toBe(false);
    expect(disk.text).toBe("theirs");
    expect(draft.state).toEqual({ kind: "conflict", disk: "theirs" });
    draft.update("mine, still typing");
    await draft.flush();
    expect(disk.text).toBe("theirs");
    expect(draft.text).toBe("mine, still typing");
  });

  it("overwrites only after the user chooses, and only the version they saw", async () => {
    const { disk, draft } = setup();
    disk.text = "theirs";
    draft.update("mine");
    await draft.flush();
    disk.text = "newer still";
    await draft.keepMine();
    expect(disk.text).toBe("newer still");
    expect(draft.state).toEqual({ kind: "conflict", disk: "newer still" });
    await draft.keepMine();
    expect(disk.text).toBe("mine");
    expect(draft.state.kind).toBe("saved");
  });

  it("follows the disk when nothing is unsaved", () => {
    const { draft } = setup();
    expect(draft.diskChanged("from sync")).toBe("from sync");
    expect(draft.text).toBe("from sync");
  });

  it("does not replace unsaved typing when the disk changes", async () => {
    const { disk, draft } = setup();
    draft.update("mine");
    disk.text = "theirs";
    expect(draft.diskChanged("theirs")).toBeNull();
    await draft.flush();
    expect(draft.text).toBe("mine");
    expect(draft.state.kind).toBe("conflict");
  });

  it("ignores the echo of its own save", async () => {
    const { draft } = setup();
    draft.update("two");
    await draft.flush();
    expect(draft.diskChanged("two")).toBeNull();
    expect(draft.state.kind).toBe("saved");
  });

  it("reports a deleted note and only recreates it when asked", async () => {
    const { disk, draft } = setup();
    disk.text = null;
    draft.update("mine");
    await draft.flush();
    expect(draft.state.kind).toBe("missing");
    expect(disk.text).toBeNull();
    await draft.keepMine();
    expect(disk.text).toBe("mine");
  });

  it("keeps the text when a write fails and retries on the next change", async () => {
    const { disk, write, draft } = setup();
    write.mockRejectedValueOnce(new Error("disk full"));
    draft.update("two");
    expect(await draft.flush()).toBe(false);
    expect(draft.state).toEqual({ kind: "failed", message: "disk full" });
    expect(draft.text).toBe("two");
    draft.update("three");
    expect(await draft.flush()).toBe(true);
    expect(disk.text).toBe("three");
  });

  it("treats a file already holding its text as saved", async () => {
    const { disk, draft } = setup();
    disk.text = "same";
    draft.update("same");
    expect(await draft.flush()).toBe(true);
    expect(draft.state.kind).toBe("saved");
  });
});
