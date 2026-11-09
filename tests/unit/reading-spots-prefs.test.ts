// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { moveSpot, ReadingSpots } from "../../src/ui/reading-spots";

const prefStub = () => {
  const value = {
    vaults: {} as Record<string, { tabs: unknown[]; active: number; lastSync: null; spots?: Record<string, unknown> }>,
  };
  return { value, update: (change: (p: typeof value) => void) => change(value) };
};

function scrollerWith(top: number): HTMLElement {
  const scroller = document.createElement("div");
  Object.defineProperty(scroller, "scrollTop", { value: top, writable: true });
  scroller.innerHTML = `<article class="doc"><p data-line="4">a</p><p data-line="9">b</p></article>`;
  const blocks = scroller.querySelectorAll<HTMLElement>("[data-line]");
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  blocks[0].getBoundingClientRect = () => ({ top: -60, bottom: -20, height: 40 }) as DOMRect;
  blocks[1].getBoundingClientRect = () => ({ top: 12, bottom: 52, height: 40 }) as DOMRect;
  return scroller;
}

const make = (scroller: HTMLElement, prefs: ReturnType<typeof prefStub>, note: string | null = "A.md") =>
  new ReadingSpots({
    prefs: prefs as never,
    root: "/v",
    scroller,
    note: () => note,
    isEditing: () => false,
    editingAnchor: () => null,
  });

describe("ReadingSpots", () => {
  it("keeps the block at the top of the view, and only in preferences", () => {
    const prefs = prefStub();
    make(scrollerWith(300), prefs).record();
    expect(prefs.value.vaults["/v"].spots?.["A.md"]).toMatchObject({ line: 9, offset: 12 });
  });

  it("forgets a note read back to the top", () => {
    const prefs = prefStub();
    make(scrollerWith(300), prefs).record();
    make(scrollerWith(0), prefs).record();
    expect(prefs.value.vaults["/v"].spots?.["A.md"]).toBeUndefined();
  });

  it("records nothing when no note is on screen", () => {
    const prefs = prefStub();
    make(scrollerWith(300), prefs, null).record();
    expect(prefs.value.vaults["/v"]).toBeUndefined();
  });

  it("ignores a saved spot that is not valid", () => {
    const prefs = prefStub();
    prefs.value.vaults["/v"] = { tabs: [], active: 0, lastSync: null, spots: { "A.md": { line: "x" } } };
    const scroller = scrollerWith(0);
    make(scroller, prefs).restore("A.md");
    expect(scroller.scrollTop).toBe(0);
  });

  it("goes to the last block when the note got shorter", () => {
    const prefs = prefStub();
    prefs.value.vaults["/v"] = { tabs: [], active: 0, lastSync: null, spots: { "A.md": { line: 500, offset: 0, at: 1 } } };
    const scroller = scrollerWith(100);
    make(scroller, prefs).restore("A.md");
    expect(scroller.scrollTop).toBe(112);
  });

  it("follows a renamed note", () => {
    const prefs = prefStub();
    prefs.value.vaults["/v"] = { tabs: [], active: 0, lastSync: null, spots: { "A.md": { line: 2, offset: 0, at: 1 } } };
    moveSpot(prefs as never, "/v", "A.md", "B.md");
    expect(prefs.value.vaults["/v"].spots).toEqual({ "B.md": { line: 2, offset: 0, at: 1 } });
  });
});
