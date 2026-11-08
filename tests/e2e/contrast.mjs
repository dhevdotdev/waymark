// WCAG contrast of every text role against the surfaces it sits on, for each theme variant.
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const app = await serveFixture();
const b = await webkit.launch();
const page = await b.newPage();
await page.goto(app.url);
await page.waitForFunction(() => window.folio?.metrics.indexMs > 0);
const rows = await page.evaluate(async () => {
  const { FAMILIES, applyTheme } = await import("/src/themes.ts");
  const probe = document.createElement("span");
  document.body.append(probe);
  const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgb = (v) => { probe.style.color = v; cv.clearRect(0, 0, 1, 1); cv.fillStyle = getComputedStyle(probe).color; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
  const out = [];
  for (const f of FAMILIES) for (const scheme of ["light", "dark"]) {
    applyTheme(f, scheme);
    const r = { theme: f[scheme].id };
    for (const [name, fg, bg] of [
      ["ink/paper", "var(--ink)", "var(--paper)"], ["ink2/paper", "var(--ink-2)", "var(--paper)"], ["ink3/paper", "var(--ink-3)", "var(--paper)"],
      ["link/paper", "var(--link)", "var(--paper)"], ["chromeInk/chrome", "var(--chrome-ink)", "var(--chrome)"], ["ink3/chrome", "var(--chrome-ink-3)", "var(--chrome)"], ["ink3/code", "var(--ink-3)", "var(--code-bg)"],
      ["ink/code", "var(--ink)", "var(--code-bg)"], ["accent-btn", "var(--paper)", "var(--accent)"],
    ]) r[name] = ratio(fg, bg);
    out.push(r);
  }
  return out;
});
console.table(rows);
await b.close();
await app.close();
