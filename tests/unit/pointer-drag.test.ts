import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trackPointerDrag } from "../../src/ui/pointer-drag";

const pointer = (type: string, pointerId: number, clientX = 0, clientY = 0) =>
  Object.assign(new Event(type), { pointerId, clientX, clientY }) as PointerEvent;

function begin() {
  const calls: string[] = [];
  trackPointerDrag(pointer("pointerdown", 7), {
    start: () => calls.push("start"),
    move: (e) => calls.push(`move ${e.clientX}`),
    finish: () => calls.push("finish"),
    drop: () => calls.push("drop"),
  });
  return calls;
}

describe("trackPointerDrag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("drops on release of its own pointer", () => {
    const calls = begin();
    window.dispatchEvent(pointer("pointermove", 7, 20));
    window.dispatchEvent(pointer("pointerup", 7, 20));
    expect(calls).toEqual(["start", "move 20", "finish", "drop"]);
  });

  it("ignores every other pointer", () => {
    const calls = begin();
    window.dispatchEvent(pointer("pointermove", 9, 50));
    window.dispatchEvent(pointer("pointerup", 9, 50));
    window.dispatchEvent(pointer("pointercancel", 9));
    window.dispatchEvent(pointer("lostpointercapture", 9));
    expect(calls).toEqual([]);
  });

  it("finishes without a drop when the pointer is cancelled", () => {
    const calls = begin();
    window.dispatchEvent(pointer("pointermove", 7, 20));
    window.dispatchEvent(pointer("pointercancel", 7));
    expect(calls).toEqual(["start", "move 20", "finish"]);
  });

  it("finishes without a drop when capture is lost", () => {
    const calls = begin();
    window.dispatchEvent(pointer("pointermove", 7, 20));
    window.dispatchEvent(pointer("lostpointercapture", 7));
    expect(calls).toEqual(["start", "move 20", "finish"]);
  });

  it("hears nothing after it has finished", () => {
    const calls = begin();
    window.dispatchEvent(pointer("pointercancel", 7));
    window.dispatchEvent(pointer("pointermove", 7, 60));
    window.dispatchEvent(pointer("pointerup", 7, 60));
    expect(calls).toEqual(["finish"]);
  });
});
