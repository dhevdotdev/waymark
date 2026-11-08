// Opens every note in the vault inside WebKit and reports render cost and rendering failures.
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const app = await serveFixture();

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const external = [];
const pageErrors = [];
page.on("request", (r) => {
  if (new URL(r.url()).hostname !== "localhost") external.push(r.url());
});
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(app.url);
await page.waitForSelector(".doc .doc-title");
const result = await page.evaluate(async () => {
  const app = window.folio;
  const notes = app.index.notes;
  const rows = [];
  for (const path of notes) {
    await app.open(path);
    await new Promise((r) => setTimeout(r, 0));
    const doc = document.querySelector(".doc");
    rows.push({
      path,
      ms: app.metrics.lastRenderMs,
      grammarMs: app.metrics.lastGrammarMs,
      totalMs: app.metrics.lastRenderMs + app.metrics.lastGrammarMs,
      diagramMs: app.metrics.diagramsMs,
      diagrams: doc.querySelectorAll(".diagram-svg").length,
      diagramErrors: [...doc.querySelectorAll(".diagram-error")].map((e) => e.textContent),
      missing: [...doc.querySelectorAll(".is-missing")].map((e) => e.textContent),
      ambiguous: doc.querySelectorAll(".is-ambiguous").length,
      missingEmbeds: [...doc.querySelectorAll(".embed-missing")].map((e) => e.textContent),
      brokenImages: [...doc.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).length,
      katexErrors: doc.querySelectorAll(".katex-error").length,
      rawCallouts: [...doc.querySelectorAll("p")].filter((p) => /^\[![a-z]+\]/i.test(p.textContent)).length,
      rawWikilinks: (doc.textContent.match(/\[\[[^\]]+\]\]/g) || []).length,
      rawComments: (doc.textContent.match(/%%/g) || []).length,
    });
  }
  return rows;
});
const ms = result.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(1);
const sum = (k) => result.reduce((n, r) => n + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
console.log(
  JSON.stringify(
    {
      notes: result.length,
      renderMs: { p50: pct(0.5), p95: pct(0.95), max: ms.at(-1).toFixed(1) },
      diagrams: sum("diagrams"),
      diagramErrors: result.filter((r) => r.diagramErrors.length).map((r) => [r.path, r.diagramErrors]),
      missingLinks: result.filter((r) => r.missing.length).map((r) => [r.path, r.missing]),
      ambiguous: sum("ambiguous"),
      missingEmbeds: result.filter((r) => r.missingEmbeds.length).map((r) => [r.path, r.missingEmbeds]),
      brokenImages: sum("brokenImages"),
      katexErrors: result.filter((r) => r.katexErrors).map((r) => r.path),
      rawCallouts: result.filter((r) => r.rawCallouts).map((r) => r.path),
      rawWikilinks: result.filter((r) => r.rawWikilinks).map((r) => [r.path, r.rawWikilinks]),
      rawComments: result.filter((r) => r.rawComments).map((r) => r.path),
      grammarLoadMsTotal: result.reduce((n, r) => n + r.grammarMs, 0).toFixed(0),
      slowest: [...result]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3)
        .map((r) => [r.path, r.ms.toFixed(1)]),
      external,
      pageErrors,
    },
    null,
    1,
  ),
);
await browser.close();
await app.close();
