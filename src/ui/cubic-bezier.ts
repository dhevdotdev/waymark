export type Easing = (progress: number) => number;

const PRECISION = 1e-6;

/** The same curve a stylesheet's `cubic-bezier()` draws, for motion that runs on a canvas. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const at = (a: number, b: number, s: number) => ((1 - 3 * b + 3 * a) * s + (3 * b - 6 * a)) * s * s + 3 * a * s;
  const slope = (a: number, b: number, s: number) => 3 * (1 - 3 * b + 3 * a) * s * s + 2 * (3 * b - 6 * a) * s + 3 * a;

  const solve = (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const error = at(x1, x2, s) - x;
      if (Math.abs(error) < PRECISION) return s;
      const d = slope(x1, x2, s);
      if (Math.abs(d) < PRECISION) break;
      s -= error / d;
    }
    let low = 0;
    let high = 1;
    s = x;
    while (high - low > PRECISION) {
      if (at(x1, x2, s) < x) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return s;
  };

  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : at(y1, y2, solve(p)));
}

export function parseCubicBezier(css: string): Easing | null {
  const inner = css.trim().match(/^cubic-bezier\(([^)]*)\)$/)?.[1];
  if (!inner) return null;
  const parts = inner.split(",").map((part) => Number(part.trim() || Number.NaN));
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
  return cubicBezier(parts[0], parts[1], parts[2], parts[3]);
}
