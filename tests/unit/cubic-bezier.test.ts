import { describe, expect, it } from "vitest";
import { cubicBezier, parseCubicBezier } from "../../src/ui/cubic-bezier";

describe("cubicBezier", () => {
  it("passes through its end points", () => {
    const ease = cubicBezier(0.77, 0, 0.175, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("is the identity for a straight line", () => {
    const ease = cubicBezier(0.25, 0.25, 0.75, 0.75);
    for (const p of [0.1, 0.33, 0.5, 0.9]) expect(ease(p)).toBeCloseTo(p, 5);
  });

  it("agrees with what WebKit computes for the app's curves", () => {
    const inOut = cubicBezier(0.77, 0, 0.175, 1);
    const out = cubicBezier(0.23, 1, 0.32, 1);
    for (const [p, expected] of [
      [0.1, 0.006445],
      [0.25, 0.052889],
      [0.45, 0.36372],
      [0.5, 0.595971],
      [0.75, 0.956282],
    ])
      expect(inOut(p)).toBeCloseTo(expected, 4);
    for (const [p, expected] of [
      [0.05, 0.209769],
      [0.25, 0.775382],
      [0.5, 0.965983],
    ])
      expect(out(p)).toBeCloseTo(expected, 4);
  });

  it("never moves backwards", () => {
    const ease = cubicBezier(0.77, 0, 0.175, 1);
    let last = 0;
    for (let i = 1; i <= 200; i++) {
      const value = ease(i / 200);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("stays exact where the curve is flat in x", () => {
    const ease = cubicBezier(0, 0, 0, 1);
    expect(ease(0.001)).toBeGreaterThan(0);
    expect(ease(0.5)).toBeGreaterThan(0.8);
  });
});

describe("parseCubicBezier", () => {
  it("reads the form a stylesheet writes", () => {
    const ease = parseCubicBezier(" cubic-bezier(0.23, 1, 0.32, 1) ");
    expect(ease?.(0.5)).toBeCloseTo(cubicBezier(0.23, 1, 0.32, 1)(0.5), 8);
  });

  it("refuses anything else", () => {
    for (const value of ["", "ease-out", "cubic-bezier(1, 2)", "cubic-bezier(a, b, c, d)"]) {
      expect(parseCubicBezier(value)).toBeNull();
    }
  });
});
