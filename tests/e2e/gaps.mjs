// Measures the vertical space between consecutive blocks in every note, and blank space inside diagrams.
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const app = await serveFixture();

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(app.url);
await page.waitForSelector(".doc .doc-title");
await page.waitForFunction(() => window.folio?.index?.notes?.length > 0 && window.folio.texts.size >= window.folio.index.notes.length);
const out = await page.evaluate(async () => {
  const app = window.folio;
  const name = (el) => {
    if (el.classList.contains("code")) return "code";
    if (el.classList.contains("callout")) return "callout";
    if (el.classList.contains("table-wrap")) return "table";
    if (el.classList.contains("diagram")) return "diagram";
    if (el.classList.contains("doc-head")) return "head";
    if (el.classList.contains("backlinks")) return "backlinks";
    return el.tagName.toLowerCase();
  };
  const gaps = [];
  const empties = [];
  const diagrams = [];
  for (const path of app.index.notes) {
    await app.open(path);
    for (let i = 0; i < 400 && document.querySelector(".diagram.is-pending"); i++) await new Promise((r) => setTimeout(r, 25));
    const doc = document.querySelector(".doc");
    const kids = [...doc.children].filter((k) => k.getBoundingClientRect().height > 0 || k.textContent === "");
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
      gaps.push({ pair: `${name(kids[i - 1])}>${name(kids[i])}`, gap: Math.round(b.top - a.bottom), path });
    }
    for (const k of doc.querySelectorAll("p, li, div.callout-content")) {
      if (!k.textContent.trim() && !k.querySelector("img,svg,iframe,code,.katex,a")) empties.push({ path, tag: k.tagName, h: Math.round(k.getBoundingClientRect().height) });
    }
    for (const f of doc.querySelectorAll(".diagram-svg svg")) {
      const fr = f.getBoundingClientRect();
      const vb = f.viewBox.baseVal;
      let bb = null;
      try { bb = f.getBBox(); } catch {}
      diagrams.push({ path, w: Math.round(fr.width), h: Math.round(fr.height), vbw: Math.round(vb.width), vbh: Math.round(vb.height), bbw: bb && Math.round(bb.width), bbh: bb && Math.round(bb.height), scale: +(fr.width / (vb.width || 1)).toFixed(2), kind: f.getAttribute("aria-roledescription") });
    }
  }
  return { gaps, empties, diagrams };
});
const by = new Map();
for (const g of out.gaps) { if (!by.has(g.pair)) by.set(g.pair, []); by.get(g.pair).push(g.gap); }
const rows = [...by].map(([pair, v]) => { v.sort((a, b) => a - b); return { pair, n: v.length, min: v[0], p50: v[v.length >> 1], max: v.at(-1) }; }).sort((a, b) => b.p50 - a.p50);
console.table(rows.filter((r) => r.n >= 3).slice(0, 30));
const all = out.gaps.map((g) => g.gap).sort((a, b) => a - b);
console.log("blocks", all.length, "p50", all[all.length >> 1], "p90", all[Math.floor(all.length * 0.9)], "max", all.at(-1), "over48", all.filter((g) => g > 48).length, "over72", all.filter((g) => g > 72).length);
console.log("biggest", out.gaps.sort((a, b) => b.gap - a.gap).slice(0, 12).map((g) => [g.pair, g.gap]));
console.log("empties", out.empties.length, out.empties.slice(0, 10));
const d = out.diagrams;
const tall = [...d].sort((a, b) => b.h - a.h).slice(0, 12);
console.log("diagrams", d.length, "upscaled>1.15", d.filter((x) => x.scale > 1.15).length, "tall>600", d.filter((x) => x.h > 600).length, "scale p50", [...d].sort((a, b) => a.scale - b.scale)[d.length >> 1]?.scale);
console.table(tall.map(({ path, ...r }) => ({ note: path.split("/").pop().slice(0, 34), ...r })));
await browser.close();
await app.close();
