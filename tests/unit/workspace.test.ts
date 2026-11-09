import { describe, expect, it } from "vitest";
import type { View } from "../../src/vault/trail";
import { Workspace } from "../../src/vault/workspace";

const note = (path: string): View => ({ kind: "note", path });
const open = (...paths: string[]) => {
  const w = new Workspace();
  w.startWith(note(paths[0]));
  for (const path of paths.slice(1)) {
    w.addBeside(note(path));
    w.activeIndex += 1;
  }
  return w;
};
const current = (w: Workspace) => {
  const view = w.active.trail.current.view;
  return view.kind === "note" ? view.path : "graph";
};

describe("Workspace", () => {
  it("adds a tab directly right of the active one", () => {
    const w = open("a", "b");
    w.activeIndex = 0;
    w.addBeside(note("c"));
    expect(w.tabs.map((t) => (t.trail.current.view as { path: string }).path)).toEqual(["a", "c", "b"]);
  });

  it("keeps the same tab active when an earlier tab closes", () => {
    const w = open("a", "b", "c");
    expect(w.close(0)).toBe(true);
    expect(current(w)).toBe("c");
  });

  it("moves to the new last tab when the active last tab closes", () => {
    const w = open("a", "b");
    w.close(1);
    expect(current(w)).toBe("a");
  });

  it("never closes the last tab", () => {
    const w = open("a");
    expect(w.close(0)).toBe(false);
    expect(w.tabs).toHaveLength(1);
  });

  it("wraps when cycling past either end", () => {
    const w = open("a", "b", "c");
    w.cycle(1);
    expect(current(w)).toBe("a");
    w.cycle(-1);
    expect(current(w)).toBe("c");
  });

  it("finds the graph tab", () => {
    const w = open("a");
    expect(w.graphIndex).toBe(-1);
    w.addBeside({ kind: "graph", note: "a", scope: "vault" });
    expect(w.graphIndex).toBe(1);
  });

  it("restores tabs and clamps a stale active index", () => {
    const w = open("a", "b");
    const saved = w.save();
    const next = new Workspace();
    next.restore({ ...saved, active: 9 }, () => true);
    expect(next.tabs).toHaveLength(2);
    expect(next.activeIndex).toBe(1);
  });

  it("drops saved tabs whose notes no longer exist", () => {
    const w = open("a", "b");
    const next = new Workspace();
    next.restore(w.save(), (view) => view.kind === "note" && view.path === "b");
    expect(next.tabs).toHaveLength(1);
    expect(current(next)).toBe("b");
  });

  describe("blank tabs", () => {
    const withBlank = (blankAt: number) => {
      const w = open("a", "b");
      w.activeIndex = blankAt - 1;
      w.addBeside({ kind: "blank" });
      w.activeIndex = blankAt;
      return w;
    };

    it.each([
      ["jumping", (trail: Workspace["active"]["trail"]) => trail.jump(note("c"))],
      ["following a link", (trail: Workspace["active"]["trail"]) => trail.follow(note("c"))],
    ])("%s from a blank tab replaces it and leaves nothing to go back to", (_name, go) => {
      const w = withBlank(1);
      go(w.active.trail);
      expect(current(w)).toBe("c");
      expect(w.active.trail.size).toBe(1);
      expect(w.active.trail.canBack).toBe(false);
    });

    it("finds the blank tab so a second one is not opened", () => {
      expect(withBlank(1).blankIndex).toBe(1);
      expect(open("a").blankIndex).toBe(-1);
    });

    it("does not save a blank tab and keeps the active tab pointing at the same note", () => {
      const w = withBlank(1);
      w.activeIndex = 2;
      const saved = w.save();
      expect(saved.tabs).toHaveLength(2);
      const next = new Workspace();
      next.restore(saved, () => true);
      expect(current(next)).toBe("b");
    });

    it("restores the nearest note when the blank tab was active", () => {
      const next = new Workspace();
      next.restore(withBlank(2).save(), () => true);
      expect(next.tabs).toHaveLength(2);
      expect(current(next)).toBe("b");
    });
  });
});
