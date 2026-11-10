import { type Easing, parseCubicBezier } from "./cubic-bezier";

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

interface Glide {
  from: Viewport;
  to: Viewport;
  start: number;
  duration: number;
  ease: Easing;
}

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** A motion token's duration in milliseconds, which Reduce Motion may have zeroed. */
export const tokenMs = (name: string): number => Number.parseFloat(token(name)) || 0;

export const tokenEasing = (name: string): string => token(name);

const tokenCurve = (name: string): Easing => parseCubicBezier(token(name)) ?? ((p) => p);

/** One camera move at a time. Linear interpolation of position and scale keeps a zoom anchored on its centre. */
export class CameraGlide {
  private glide: Glide | null = null;

  /** Where the camera is heading, if it is moving. */
  get destination(): Viewport | null {
    return this.glide?.to ?? null;
  }

  /**
   * Starts from what is drawn now. A move that interrupts another is already travelling,
   * so it decelerates only: ease-in-out would stall it at zero speed under each quick click.
   * Returns false when motion is off, and the caller places the view directly.
   */
  start(from: Viewport, to: Viewport): boolean {
    const duration = tokenMs("--t-slide");
    if (duration <= 0) return false;
    const ease = tokenCurve(this.glide ? "--ease-out" : "--ease-in-out");
    this.glide = { from: { ...from }, to, start: performance.now(), duration, ease };
    return true;
  }

  /** The view for this frame, or null when nothing is moving. */
  advance(now: number): Viewport | null {
    const glide = this.glide;
    if (!glide) return null;
    const progress = (now - glide.start) / glide.duration;
    if (progress >= 1) {
      this.glide = null;
      return glide.to;
    }
    const t = glide.ease(Math.max(0, progress));
    const lerp = (a: number, b: number) => a + (b - a) * t;
    return { x: lerp(glide.from.x, glide.to.x), y: lerp(glide.from.y, glide.to.y), k: lerp(glide.from.k, glide.to.k) };
  }

  stop(): void {
    this.glide = null;
  }
}
