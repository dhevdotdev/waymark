let pixel: CanvasRenderingContext2D | null = null;

/** Resolves a CSS colour expression (including color-mix and var) to an rgb() string canvas can use. */
export function resolveColor(expr: string): string {
  return resolveColors([expr])[0];
}

/**
 * Resolves several colour expressions together. Each probe added to the page makes the next style read work out the
 * whole page again, so adding them all before reading any costs one pass instead of one per colour.
 */
export function resolveColors(exprs: readonly string[]): string[] {
  if (!exprs.length) return [];
  const probes = exprs.map((expr) => {
    const probe = document.createElement("span");
    probe.style.color = expr;
    probe.style.display = "none";
    return probe;
  });
  document.body.append(...probes);
  const values = probes.map((probe) => getComputedStyle(probe).color);
  for (const probe of probes) probe.remove();
  if (!pixel) {
    pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    pixel.globalCompositeOperation = "copy";
  }
  const ctx = pixel;
  return values.map((value) => {
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`;
  });
}
