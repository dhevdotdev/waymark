// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CameraGlide } from "../../src/ui/graph-camera";

const FROM = { x: 0, y: 0, k: 1 };
const TO = { x: 100, y: 50, k: 3 };

describe("CameraGlide", () => {
  beforeEach(() => {
    document.documentElement.style.setProperty("--t-slide", "240ms");
    document.documentElement.style.setProperty("--ease-out", "cubic-bezier(0.23, 1, 0.32, 1)");
  });

  it("starts its clock on the first frame drawn, so work done before that frame does not use up the glide", () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const camera = new CameraGlide();
    expect(camera.start(FROM, TO, "--ease-out")).toBe(true);
    const firstFrame = 1000 + 400;
    expect(camera.advance(firstFrame)).toEqual(FROM);
    const midway = camera.advance(firstFrame + 120)!;
    expect(midway.k).toBeGreaterThan(FROM.k);
    expect(midway.k).toBeLessThan(TO.k);
    expect(camera.advance(firstFrame + 240)).toEqual(TO);
    expect(camera.destination).toBeNull();
  });

  it("does not move when motion is off", () => {
    document.documentElement.style.setProperty("--t-slide", "0ms");
    const camera = new CameraGlide();
    expect(camera.start(FROM, TO)).toBe(false);
    expect(camera.advance(5000)).toBeNull();
  });
});
