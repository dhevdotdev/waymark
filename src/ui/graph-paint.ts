const HUES = ["mauve", "teal", "peach", "blue", "pink", "green", "yellow", "sky", "red", "lavender"];

export const groupColor = (group: number): string =>
  group < 0 ? "var(--ink-4)" : `var(--p-${HUES[group % HUES.length]}, var(--accent))`;

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
