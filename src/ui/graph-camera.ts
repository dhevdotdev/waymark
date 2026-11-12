import { type Easing, parseCubicBezier } from "./cubic-bezier";
import type { GraphNode } from "./graph-types";

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

/** The margins the toolbar and the community chips cover. */
export const SAFE = { top: 72, bottom: 64, side: 56 };

/** The view that frames the notes inside the safe margins, leaving out the furthest 1% on each side of a large graph. */
export function fitView(nodes: GraphNode[], size: { w: number; h: number }): Viewport {
  const xs = nodes.map((n) => n.x!).sort((a, b) => a - b);
  const ys = nodes.map((n) => n.y!).sort((a, b) => a - b);
  const cut = nodes.length > 40 ? Math.floor(nodes.length * 0.01) : 0;
  const minX = xs[cut],
    maxX = xs[xs.length - 1 - cut],
    minY = ys[cut],
    maxY = ys[ys.length - 1 - cut];
  const k = Math.max(
    0.15,
    Math.min(
      (size.w - SAFE.side * 2) / Math.max(1, maxX - minX),
      (size.h - SAFE.top - SAFE.bottom) / Math.max(1, maxY - minY),
      2.4,
    ),
  );
  return {
    k,
    x: size.w / 2 - ((minX + maxX) / 2) * k,
    y: SAFE.top + (size.h - SAFE.top - SAFE.bottom) / 2 - ((minY + maxY) / 2) * k,
  };
}

/** `view` magnified `factor` times with `node` moved to the middle of `size`. Without a node it magnifies about the middle. */
export function closeView(view: Viewport, size: { w: number; h: number }, node: GraphNode | undefined, factor: number): Viewport {
  const k = view.k * factor;
  const [cx, cy] = [size.w / 2, size.h / 2];
  if (node) return { k, x: cx - node.x! * k, y: cy - node.y! * k };
  return { k, x: cx - (cx - view.x) * factor, y: cy - (cy - view.y) * factor };
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
   * `ease` names an easing token that overrides that choice.
   * Returns false when motion is off, and the caller places the view directly.
   */
  start(from: Viewport, to: Viewport, ease?: string): boolean {
    const duration = tokenMs("--t-slide");
    if (duration <= 0) return false;
    const curve = tokenCurve(ease ?? (this.glide ? "--ease-out" : "--ease-in-out"));
    this.glide = { from: { ...from }, to, start: performance.now(), duration, ease: curve };
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
