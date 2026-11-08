const HUES = ["mauve", "teal", "peach", "blue", "pink", "green", "yellow", "sky", "red", "lavender"];

export const groupColor = (group: number): string =>
  group < 0 ? "var(--ink-4)" : `var(--p-${HUES[group % HUES.length]}, var(--accent))`;

/** Control points for a link inside one community: a gentle sideways bow. */
export function arcControls(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): [number, number, number, number, number, number, number, number] {
  const dx = tx - sx,
    dy = ty - sy;
  return [
    sx,
    sy,
    sx + dx / 3 - dy * 0.1,
    sy + dy / 3 + dx * 0.1,
    sx + (dx * 2) / 3 - dy * 0.1,
    sy + (dy * 2) / 3 + dx * 0.1,
    tx,
    ty,
  ];
}

/** One coordinate of a cubic Bezier at t, where u is 1 - t. */
export const bezier = (p0: number, p1: number, p2: number, p3: number, t: number, u: number): number =>
  u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;

/** A soft round light in one colour: full at the centre and fading smoothly, with no visible edge. */
export function lightSprite(color: string): HTMLCanvasElement {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.2, "rgba(0,0,0,0.62)");
  g.addColorStop(0.45, "rgba(0,0,0,0.24)");
  g.addColorStop(0.72, "rgba(0,0,0,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, size, size);
  return c;
}

/**
 * The vault as a map of link communities. Each community gathers into its own
 * cluster in its own colour, links inside it arc gently, and links between
 * communities run through their centres so they read as threads, not a hairball.
 */
