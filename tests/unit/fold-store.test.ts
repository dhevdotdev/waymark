import { describe, expect, it } from "vitest";
import { FoldStore } from "../../src/ui/fold-store";

const prefStub = () => {
  const value = {
    vaults: {} as Record<string, { tabs: unknown[]; active: number; lastSync: null; folds?: Record<string, unknown> }>,
  };
  let writes = 0;
  return {
    value,
    writes: () => writes,
    update: (change: (p: typeof value) => void) => {
      writes++;
      change(value);
    },
  };
};
const make = (prefs: ReturnType<typeof prefStub>) => new FoldStore(prefs as never, "/v");

describe("FoldStore", () => {
  it("keeps each note's folds in preferences and forgets a note with none", () => {
    const prefs = prefStub();
    const store = make(prefs);
    store.set("A.md", ["setup#0", "setup#0", "usage#1"]);
    expect(store.get("A.md")).toEqual(["setup#0", "usage#1"]);
    store.set("A.md", []);
    expect(prefs.value.vaults["/v"].folds).toEqual({});
  });

  it("writes nothing when nothing changed", () => {
    const prefs = prefStub();
    const store = make(prefs);
    store.set("A.md", ["a#0"]);
    store.set("A.md", ["a#0"]);
    expect(prefs.writes()).toBe(1);
  });

  it("follows a renamed note", () => {
    const store = make(prefStub());
    store.set("A.md", ["a#0"]);
    store.move("A.md", "Folder/B.md");
    expect(store.get("A.md")).toEqual([]);
    expect(store.get("Folder/B.md")).toEqual(["a#0"]);
  });

  it("ignores saved folds that are not a list of keys", () => {
    const prefs = prefStub();
    prefs.value.vaults["/v"] = { tabs: [], active: 0, lastSync: null, folds: { "A.md": "x", "B.md": ["b#0", 3] } };
    const store = make(prefs);
    expect(store.get("A.md")).toEqual([]);
    expect(store.get("B.md")).toEqual(["b#0"]);
  });

  it("keeps the 500 notes folded most recently", () => {
    const prefs = prefStub();
    const store = make(prefs);
    for (let i = 0; i < 502; i++) store.set(`N${i}.md`, ["a#0"]);
    store.set("N0.md", ["b#0"]);
    const kept = Object.keys(prefs.value.vaults["/v"].folds ?? {});
    expect(kept).toHaveLength(500);
    expect(kept).not.toContain("N1.md");
    expect(kept.at(-1)).toBe("N0.md");
  });
});
