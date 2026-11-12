// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ringMatch } from "../../src/ui/match-ring";

let finishRings: () => void = () => {};

function setup() {
  document.body.innerHTML = '<div class="scroller"><div class="reader"><p>a match here</p></div></div>';
  const scroller = document.querySelector<HTMLElement>(".scroller") as HTMLElement;
  const frame = document.querySelector<HTMLElement>(".reader") as HTMLElement;
  const text = frame.querySelector("p")?.firstChild as Text;
  const range = () => {
    const r = document.createRange();
    r.setStart(text, 2);
    r.setEnd(text, 7);
    return r;
  };
  return { scroller, frame, range };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("requestAnimationFrame", () => 0);
  Range.prototype.getClientRects = () => [new DOMRect(10, 10, 40, 16)] as unknown as DOMRectList;
  let release: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    release = resolve;
  });
  finishRings = release;
  Element.prototype.animate = vi.fn(() => ({ finished }) as unknown as Animation);
});

describe("ringMatch", () => {
  it("rings a jump's match once", () => {
    const { scroller, frame, range } = setup();
    ringMatch(range(), frame, scroller);
    expect(document.querySelectorAll(".match-ring")).toHaveLength(1);
  });

  it("keeps the ring that is showing when the note settles", () => {
    const { scroller, frame, range } = setup();
    ringMatch(range(), frame, scroller);
    const ring = document.querySelector(".match-ring");
    const started = vi.mocked(Element.prototype.animate).mock.calls.length;
    ringMatch(range(), frame, scroller, true);
    expect(document.querySelector(".match-ring")).toBe(ring);
    expect(vi.mocked(Element.prototype.animate).mock.calls.length).toBe(started);
  });

  it("does not ring again when the note settles after the ring has gone", async () => {
    const { scroller, frame, range } = setup();
    ringMatch(range(), frame, scroller);
    finishRings();
    await settle();
    expect(document.querySelectorAll(".match-ring")).toHaveLength(0);
    ringMatch(range(), frame, scroller, true);
    expect(document.querySelectorAll(".match-ring")).toHaveLength(0);
  });
});
