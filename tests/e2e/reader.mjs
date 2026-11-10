// Drives the reader like a person would and asserts each behaviour.
// Usage: node tests/e2e/reader.mjs [reduced] [--video <dir>]
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { serveFixture } from "./serve.mjs";

const args = process.argv.slice(2);
const reduced = args.includes("reduced");
const videoDir = args.includes("--video") ? args[args.indexOf("--video") + 1] : null;
const app = await serveFixture();
const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: "light",
  reducedMotion: reduced ? "reduce" : "no-preference",
  ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } } : {}),
});
const page = await ctx.newPage();
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const title = () => page.textContent(".doc-title");
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
await page.waitForSelector(".diagram-svg svg");
await pause(600);

const rise = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--rise").trim());
check("travel distances follow Reduce Motion", reduced ? rise === "0px" : rise === "6px", rise);

// In-note heading link [[#Fixes]]
await page.click('.doc a.wikilink[data-anchor="Fixes"]');
await pause(500);
const fixesTop = await page.evaluate(() => document.querySelector('[data-key="fixes"]').getBoundingClientRect().top);
check("[[#Fixes]] scrolls to its heading", fixesTop >= 40 && fixesTop < 140, `top=${fixesTop.toFixed(0)}`);
check(
  "target heading flashes",
  await page.evaluate(() => document.querySelector('[data-key="fixes"]').classList.contains("is-target")),
);

// Copy button
await page.hover(".doc .code");
await pause(250);
await page.click(".doc .code .code-copy");
await pause(150);
check("code copy gives feedback", (await page.textContent(".doc .code .code-copy")) !== "Copy");
await pause(900);

// Follow a link in place
await page.evaluate(() => document.querySelector(".scroller").scrollTo({ top: 0 }));
await pause(300);
await page.click('.doc a.wikilink[data-path$="Starter feeding - float test, peak and discard.md"]');
await pause(500);
check("link opens in place", (await title()).startsWith("Starter feeding"));
check("still one tab", (await page.locator(".tab").count()) === 1);

// Back restores note and scroll position
await page.keyboard.press("Meta+[");
await pause(500);
check("⌘[ goes back", (await title()).startsWith("Crumb structure"));
await page.keyboard.press("Meta+]");
await pause(500);
check("⌘] goes forward", (await title()).startsWith("Starter feeding"));
await page.keyboard.press("Meta+[");
await pause(500);

// Cmd-click opens a background tab
await page.click('.doc a.wikilink[data-path$="Proofing baskets and banneton care.md"]', { modifiers: ["Meta"] });
await pause(500);
check(
  "⌘-click opens a background tab",
  (await page.locator(".tab").count()) === 2 && (await title()).startsWith("Crumb structure"),
);
await page.click(".tab:nth-child(2)");
await pause(500);
check("switching tabs shows the other note", (await title()).startsWith("Proofing baskets"));
await page.keyboard.press("Meta+w");
await pause(500);
check("⌘W closes the tab", (await page.locator(".tab").count()) === 1);

// File tree navigation and collapse
const flyway = await page.evaluate(() =>
  window.waymark.vault.index.notes.find((p) => p.endsWith("Compass declination and magnetic north.md")),
);
const flywayFolders = flyway
  .split("/")
  .slice(0, -1)
  .map((_, i, all) => all.slice(0, i + 1).join("/"));
for (const f of flywayFolders) {
  const head = page.locator(`.tree-head[data-folder="${f}"]`);
  if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
}
await pause(350);
await page.click('.nav-item[data-path$="Compass declination and magnetic north.md"]');
await pause(500);
check("file tree navigates", (await title()).startsWith("Compass declination"));
const leaf = page.locator(`.tree-head[data-folder="${flywayFolders.at(-1)}"]`);
await leaf.click();
await pause(350);
check("a folder collapses", (await leaf.getAttribute("aria-expanded")) === "false");
await leaf.click();
await pause(350);
const treeFolders = await page.evaluate(() => {
  const onDisk = new Set(
    window.waymark.vault.index.notes.flatMap((p) =>
      p
        .split("/")
        .slice(0, -1)
        .map((_, i, a) => a.slice(0, i + 1).join("/")),
    ),
  );
  const shown = [...document.querySelectorAll(".tree-head")].map((h) => h.dataset.folder);
  return { same: shown.length === onDisk.size && shown.every((f) => onDisk.has(f)), shown: shown.length };
});
check("the tree shows exactly the folders on disk", treeFolders.same, `${treeFolders.shown} folders`);
check(
  "long names never push the tree sideways",
  await page.evaluate(() => {
    const t = document.querySelector(".sidebar-inner");
    return t.scrollWidth <= t.clientWidth;
  }),
);
check(
  "every row in the tree is one line",
  await page.evaluate(() =>
    [...document.querySelectorAll(".nav-item")].filter((n) => n.offsetParent).every((n) => n.offsetHeight === 28),
  ),
);
const art = await page.evaluate(async () => {
  await document.fonts.load('13px "JetBrains Mono Variable"', "\u2500\u2502\u250c");
  const c = document.createElement("canvas").getContext("2d");
  c.font = '13px "JetBrains Mono Variable"';
  const width = (ch) => c.measureText(ch).width;
  return [..."\u2500\u2502\u250c\u2510\u2514\u2518\u253c\u25c0"].map(width).concat(width("a"));
});
check("box-drawing characters are as wide as letters", new Set(art.map((w) => w.toFixed(2))).size === 1, art[0].toFixed(2));
check(
  "list markers sit in the text flow",
  await page.evaluate(() =>
    [...document.querySelectorAll(".doc ul > li, .doc ol > li")]
      .filter((li) => !li.closest(".backlinks"))
      .every((li) => {
        const host = li.querySelector(":scope > p:first-child") ?? li;
        const m = getComputedStyle(host, "::before");
        return m.position === "static" && m.display === "inline-block";
      }),
  ),
);
check(
  "the reader has no scrollbar",
  await page.evaluate(() => {
    const s = document.querySelector(".scroller");
    return s.offsetWidth === s.clientWidth && getComputedStyle(s).scrollbarWidth === "none";
  }),
);
await page.keyboard.press("Meta+\\");
await pause(450);
check(
  "⌘\\ collapses the sidebar",
  await page.evaluate(() => document.querySelector(".shell").classList.contains("sidebar-closed")),
);
await page.keyboard.press("Meta+\\");
await pause(450);

// Collapsible callout (a real note with [!note]-)
const folded = await page.evaluate(() =>
  window.waymark.vault.index.notes.find((p) => window.waymark.vault.texts.get(p).includes("> [!note]-")),
);
await page.evaluate((p) => window.waymark.open(p), folded);
await page.waitForSelector('.callout[data-fold="closed"]');
await page.evaluate(() => document.querySelector('.callout[data-fold="closed"]').scrollIntoView({ block: "center" }));
await pause(300);
const h0 = await page.evaluate(() => document.querySelector(".callout[data-fold] .callout-body").getBoundingClientRect().height);
await page.click(".callout[data-fold] .callout-title");
await pause(reduced ? 50 : 450);
const h1 = await page.evaluate(() => document.querySelector(".callout[data-fold] .callout-body").getBoundingClientRect().height);
check("collapsed callout expands", h0 < 2 && h1 > 20, `${h0.toFixed(0)}px → ${h1.toFixed(0)}px`);

// Diagram enlarge
await page.evaluate(() =>
  window.waymark.open(
    window.waymark.vault.index.notes.find((p) => p.endsWith("Crumb structure and the overproofing problem.md")),
  ),
);
await page.waitForSelector(".diagram-svg svg");
await page.evaluate(() => document.querySelector(".diagram").scrollIntoView({ block: "center" }));
await page.hover(".diagram");
await pause(200);
await page.click(".diagram-expand");
await pause(500);
const lb = await page.evaluate(() => document.querySelector(".lightbox svg")?.getBoundingClientRect().width ?? 0);
check("diagram enlarges", lb > 900, `${lb.toFixed(0)}px wide`);
await page.keyboard.press("Escape");
await pause(300);
check("Escape closes the enlarged diagram", (await page.locator(".lightbox").count()) === 0);

// Appearance switch redraws the diagram in the new palette
const fill0 = await page.evaluate(
  () => getComputedStyle(document.querySelector(".diagram-svg .node rect, .diagram-svg .node polygon")).fill,
);
await page.keyboard.press("Meta+Shift+L");
await page
  .waitForFunction(
    (f) => {
      const n = document.querySelector(".diagram-svg .node rect, .diagram-svg .node polygon");
      return n && getComputedStyle(n).fill !== f;
    },
    fill0,
    { timeout: 8000 },
  )
  .catch(() => {});
const fill1 = await page.evaluate(
  () => getComputedStyle(document.querySelector(".diagram-svg .node rect, .diagram-svg .node polygon")).fill,
);
check("diagram follows appearance", fill0 !== fill1, `${fill0} → ${fill1}`);
await page.keyboard.press("Meta+Shift+L");
await pause(500);

// Command palette: opens instantly, fuzzy-finds a note, opens it
await page.keyboard.press("Meta+k");
const paletteVisible = await page.isVisible(".palette");
check("⌘K opens the palette", paletteVisible);
await page.keyboard.type("tide chart");
await pause(120);
const firstRow = await page.textContent(".palette-row.is-selected .palette-label");
check("palette fuzzy match ranks the right note first", /Tide charts/.test(firstRow), firstRow);
await page.keyboard.press("Enter");
await pause(500);
check("palette opens the note", (await title()).startsWith("Tide charts"));

await page.keyboard.press("Meta+k");
await pause(150);
await page.fill(".palette input", "harbour approach");
await pause(100);
await page.keyboard.press("Meta+Shift+f");
await pause(250);
check(
  "⌘⇧F from the palette searches for what was typed there",
  !(await page.isVisible(".palette")) && (await page.inputValue(".search-field input")) === "harbour approach",
);
check("and shows its results", (await page.locator(".search-hit").count()) > 0);
await page.keyboard.press("Escape");
await pause(150);
await page.keyboard.press("Meta+k");
await pause(150);
const paletteSizeFor = async (query) => {
  await page.fill(".palette input", query);
  await pause(120);
  return page.evaluate(() => ({
    height: document.querySelector(".palette").getBoundingClientRect().height,
    firstRow: document.querySelector(".palette-row")?.getBoundingClientRect().top ?? null,
    headings: document.querySelectorAll(".palette-group").length,
  }));
};
const paletteSizes = [];
for (const query of ["", "show", "tide", "a", "zzzzqqq"]) paletteSizes.push(await paletteSizeFor(query));
check(
  "the palette keeps one height while typing",
  new Set(paletteSizes.map((s) => s.height)).size === 1,
  JSON.stringify(paletteSizes),
);
const typedRows = paletteSizes.slice(1, 4);
check(
  "results start at the same place whatever matched",
  new Set(typedRows.map((s) => s.firstRow)).size === 1 && typedRows.every((s) => s.headings === 0),
  JSON.stringify(typedRows),
);
await page.keyboard.press("Escape");
await pause(200);

// Full-text search jumps to the matching passage
await page.keyboard.press("Meta+Shift+f");
await page.waitForSelector(".search-field input:visible");
await page.keyboard.type("BannetonSeamDriftError");
await pause(200);
const hits = await page.locator(".search-hit").count();
check("full-text search finds a phrase inside a note", hits >= 1, `${hits} hits`);
const snippet = await page.textContent(".search-hit.is-selected .search-hit-snippet");
check("search shows a snippet around the match", /BannetonSeamDriftError/.test(snippet ?? ""), snippet?.slice(0, 80));
await page.keyboard.press("Enter");
await pause(700);
const visible = await page.evaluate(() => {
  const ranges = CSS.highlights.get("search");
  if (!ranges) return null;
  const r = [...ranges][0].getBoundingClientRect();
  return r.top > 0 && r.bottom < window.innerHeight;
});
check("search opens the note at the highlighted passage", visible === true);
await page.keyboard.press("Escape");
await pause(200);

// Find in note
await page.keyboard.press("Meta+f");
await page.keyboard.type("cold retard");
await pause(200);
const count = await page.textContent(".findbar-count");
check("⌘F finds matches in the note", /of \d+/.test(count ?? ""), count);
await page.keyboard.press("Escape");
await pause(150);
check("Escape closes find", (await page.locator(".findbar").count()) === 0);

// Backlinks and local graph
await page.click('[data-rail="links"]');
await pause(120);
const backlinks = await page.locator(".rail-links .rail-link:visible").count();
check("the Links pane lists connected notes", backlinks > 0, `${backlinks}`);
await page.click('[data-rail="links"]');
const railGraph = await page.evaluate(() => document.querySelector(".local-graph canvas")?.getBoundingClientRect().height ?? 0);
check("local graph renders in the rail", railGraph > 100, `${railGraph}px`);
const openGraph = page.locator(".rail-graph-open");
check(
  "the local graph opens from an icon in its header",
  await openGraph.evaluate((b) => {
    const box = b.getBoundingClientRect();
    const head = b.closest(".rail-section-head").getBoundingClientRect();
    return (
      b.textContent === "" &&
      b.querySelector("svg") !== null &&
      box.width >= 24 &&
      box.height >= 24 &&
      box.right <= head.right + 1
    );
  }),
);
const arrowFrames = (selector) =>
  page.evaluate(
    (target) =>
      new Promise((resolve) => {
        const seen = new Set();
        const started = performance.now();
        const look = () => {
          const d = document.querySelector(target)?.getAttribute("d");
          if (d) seen.add(d);
          if (performance.now() - started < 500) requestAnimationFrame(look);
          else resolve([...seen]);
        };
        look();
      }),
    selector,
  );
const APART = "M9.50 2.50L13.50 2.50L13.50 6.50";
const TOGETHER = "M13.30 6.70L9.30 6.70L9.30 2.70";
const leaveFrames = arrowFrames(".graph-leave path");
await openGraph.click();
const leaving = await leaveFrames;
await pause(500);
check("the icon opens the full graph", await page.locator(".graph-view canvas").isVisible());
check(
  "the arrows in the full graph turn inwards",
  (await page.locator(".graph-leave path").getAttribute("d")).startsWith(TOGETHER),
);
check(
  reduced ? "with Reduce Motion they go straight there" : "they spring through the shapes between",
  reduced ? leaving.length === 1 : leaving.length >= 6,
  `${leaving.length} shapes`,
);
const backFrames = arrowFrames(".rail-graph-open path");
await page.locator(".graph-leave").click();
const returning = await backFrames;
await pause(300);
check("the arrows take you back to the note", !(await page.locator(".graph-view").isVisible()));
check("the panel's arrows turn back outwards", (await page.locator(".rail-graph-open path").getAttribute("d")).startsWith(APART));
check(
  reduced ? "and go straight there with Reduce Motion" : "and spring on the way",
  reduced ? returning.length <= 2 : returning.length >= 6,
  `${returning.length} shapes`,
);
await page.evaluate(() => {
  window.__graphText = 0;
  const original = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (...args) {
    window.__graphText++;
    return original.apply(this, args);
  };
});
await page.locator(".local-graph canvas").hover();
await pause(200);
check("the local graph draws no names over its dots", (await page.evaluate(() => window.__graphText)) === 0);

// Vault graph
await page.keyboard.press("Meta+g");
await pause(reduced ? 300 : 1500);
const stats = await page.textContent(".graph-stats");
check("graph view shows the vault", /\d{3} notes/.test(stats ?? ""), stats);
await page.click('[data-gmode="local"]');
await pause(400);
const localStats = await page.textContent(".graph-stats");
check("graph switches to this note's neighbourhood", localStats !== stats, localStats);
await page.keyboard.press("Escape");
await pause(300);
check("Escape closes the graph", (await page.locator(".graph-view").count()) === 0);

// Every state has a visible way in and out
await page.keyboard.press("Meta+g");
await pause(900);
check("the graph button shows that the graph is open", (await page.locator('[data-act="graph"].is-on').count()) === 1);
const strip = page.locator(".graph-groups");
await strip.hover();
await page.mouse.wheel(0, 240);
await pause(150);
check(
  "the community strip scrolls sideways",
  await strip.evaluate((e) => e.scrollWidth > e.clientWidth && e.scrollLeft > 0),
  await strip.evaluate((e) => `${Math.round(e.scrollLeft)} of ${e.scrollWidth - e.clientWidth}`),
);
check(
  "the graph opens as a tab",
  (await page.locator(".tab.is-graph-tab.is-active").count()) === 1,
  await page.textContent(".tab.is-active .tab-title"),
);
const beforeGraphClick = await title();
const sibling = page.locator(".tree-folder.is-open .nav-item:not(.is-current)").first();
await sibling.click();
await pause(500);
check(
  "opening a note from the tree replaces the graph in its tab",
  (await page.locator(".graph-view").count()) === 0 && (await title()) !== beforeGraphClick,
  await title(),
);
await page.keyboard.press("Meta+[");
await pause(600);
check("Back returns to the graph", (await page.locator(".graph-view").count()) === 1);
await page.keyboard.press("Escape");
await pause(300);
check("Escape closes the graph tab", (await page.locator(".graph-view").count()) === 0);
await page.click('[data-side="search"]');
await pause(120);
check("Search tab shows the search field", await page.locator(".search-field input").isVisible());
await page.keyboard.type("zzzznothing");
await pause(150);
await page.click('[data-act="search-clear"]');
await pause(100);
check(
  "the X clears the field and stays in Search",
  (await page.inputValue(".search-field input")) === "" && (await page.locator(".search-field input").isVisible()),
);
await page.keyboard.type("declination");
await pause(200);
await page.click('[data-side="search"]');
await pause(120);
check(
  "Files tab returns to the tree",
  (await page.locator(".tree").isVisible()) && !(await page.locator(".search-field input").isVisible()),
);
await page.click('[data-side="search"]');
await pause(120);
check(
  "Search keeps the query when you come back",
  (await page.inputValue(".search-field input")) === "declination" && (await page.locator(".search-hit").count()) > 0,
);
await page.keyboard.press("Escape");
await pause(120);
check("Escape in Search returns to the tree", await page.locator(".tree").isVisible());

// The right panel's edge drags to resize it
const railWidth = () => page.locator(".rail").evaluate((r) => r.getBoundingClientRect().width);
const dragRailEdge = async (by) => {
  const edge = await page.locator(".rail-resize").boundingBox();
  await page.mouse.move(edge.x + 3, edge.y + 200);
  await page.mouse.down();
  await page.mouse.move(edge.x + 3 + by, edge.y + 200, { steps: 4 });
  await page.mouse.up();
  await pause(200);
};
const railAtStart = await railWidth();
await dragRailEdge(-60);
check("dragging the panel's edge widens it", (await railWidth()) === railAtStart + 60, `${await railWidth()}`);
check("the width is remembered", (await page.evaluate(() => window.waymark.prefs.value.railWidth)) === railAtStart + 60);
await dragRailEdge(-900);
check("it stops at its widest", (await railWidth()) === 440, `${await railWidth()}`);
await dragRailEdge(900);
check("it stops at its narrowest", (await railWidth()) === 220, `${await railWidth()}`);
await dragRailEdge(-(railAtStart - 220));
check("it comes back to where it was", (await railWidth()) === railAtStart, `${await railWidth()}`);

// Each tab keeps its own trail of followed links
await page.evaluate(async () => {
  const f = window.waymark;
  await f.open(f.vault.index.notes.find((p) => p.endsWith("Compass declination and magnetic north.md")));
});
await pause(400);
const readout = page.locator(".trail-readout");
const trailPane = page.locator(".rail-trail");
const titleTop = () => page.locator(".doc-title").evaluate((t) => t.getBoundingClientRect().top);
const slotPlace = () =>
  page.locator(".trail-slot").evaluate((s) => {
    const r = s.getBoundingClientRect();
    return `${r.left},${r.width}`;
  });
const focusedRow = () => page.evaluate(() => document.activeElement?.closest(".trail-row")?.textContent ?? "");
const currentRow = () => page.locator(".trail-row.is-current .trail-name").textContent();
check("a tab with one note shows no trail readout", !(await readout.isVisible()));
const titleWithOneStop = await titleTop();
const slotWithOneStop = await slotPlace();
const followed = [];
const followLink = async () => {
  const index = await page.evaluate(() => {
    const onMap = new Set([...document.querySelectorAll(".trail-name")].map((n) => n.textContent));
    const here = document.querySelector(".doc-title").textContent;
    return [...document.querySelectorAll(".doc a.wikilink:not(.is-missing):not(.is-ambiguous)")].findIndex((l) => {
      const name = (l.dataset.path ?? "").split("/").pop().replace(/\.md$/, "");
      return name && name !== here && !onMap.has(name);
    });
  });
  const l = page.locator(".doc a.wikilink:not(.is-missing):not(.is-ambiguous)").nth(index);
  followed.push(await l.textContent());
  await l.click();
  await pause(450);
};
await followLink();
check("following a link grows the trail", (await page.locator(".trail-row").count()) === 2);
check("the readout says where the tab is", (await readout.textContent()).includes("2 of 2"), await readout.textContent());
check("a second stop leaves the readout's slot where it was", (await slotPlace()) === slotWithOneStop);
check("nothing sits between the path row and the note", (await page.locator(".reader > .trail").count()) === 0);
const readoutPlace = () => readout.evaluate((e) => e.getBoundingClientRect().left);
const readoutInRead = await readoutPlace();
await page.keyboard.press("Meta+e");
await page.waitForSelector(".cm-content");
await pause(300);
const readoutInEdit = await readoutPlace();
check("Read and Edit leave the readout where it is", readoutInEdit === readoutInRead, `${readoutInRead} and ${readoutInEdit}`);
await page.keyboard.press("Meta+e");
await pause(400);
const titleBeforeOpen = await titleTop();
await readout.click();
await pause(200);
check("the readout opens the trail in the panel", await trailPane.isVisible());
check(
  "the links, the trail and the graph are on screen together",
  (await page.locator('[data-pane="links"]').isVisible()) && (await page.locator(".local-graph canvas").isVisible()),
);
check("opening the trail leaves the note where it was", (await titleTop()) === titleBeforeOpen, `${titleBeforeOpen}`);
check(
  "the readout answers when the trail is already showing",
  await page
    .locator(".trail-here")
    .evaluate((m) => m.getAnimations().length > 0 || document.activeElement?.closest(".trail-row") !== null),
);
await page.locator(".trail-row").first().click();
await pause(450);
check(
  "clicking a stop moves this tab there",
  (await title()).startsWith("Compass declination") && (await page.locator(".trail-row").count()) === 2,
);
check("the trail stays open when another note is clicked", await trailPane.isVisible());
check(
  "a note starts at the same height with a trail as without one",
  (await titleTop()) === titleWithOneStop,
  `${await titleTop()} and ${titleWithOneStop}`,
);
await followLink();
check("the trail stays open when a link in the note is followed", await trailPane.isVisible());
const levels = await page.locator(".trail-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("aria-level")));
check("a second link from the same note branches", levels.join() === "1,2,1", levels.join());
const trailHeight = () => page.locator('[data-section="trail"]').evaluate((e) => e.getBoundingClientRect().height);
const graphTop = () => page.locator('[data-section="graph"]').evaluate((e) => e.getBoundingClientRect().top);
check("the trail is as tall as its stops", (await trailHeight()) === 31 + 3 * 28 + 8, String(await trailHeight()));
const graphWasAt = await graphTop();
await page.locator('[data-fold-section="trail"]').click();
await pause(320);
check("the graph stays put while the trail changes height", (await graphTop()) === graphWasAt);
await page.locator('[data-fold-section="trail"]').click();
await pause(320);
check("the readout counts the side branch", (await readout.locator(".trail-forks").textContent()) === "1");
await page.keyboard.down("Meta");
await page.locator(".tree-folder.is-open .nav-item").first().click();
await page.keyboard.up("Meta");
await pause(500);
await page.click(".tab:nth-child(2)");
await pause(450);
check("another tab has its own trail", !(await readout.isVisible()));
check(
  "a tab with no trail shows no trail section at all",
  await page.locator('[data-section="trail"]').evaluate((e) => getComputedStyle(e).display === "none"),
);
await page.click(".tab:nth-child(1)");
await pause(450);
check("the first tab keeps its trail", (await page.locator(".trail-row").count()) === 3);
await page.click(".tab:nth-child(2) .tab-close", { force: true });
await pause(300);

const firstStop = page.locator(".trail-row").first();
const sideRow = page.locator('.trail-row[aria-level="2"]');
await page.mouse.move(2, 450);
await pause(200);
check(
  "a stop's remove control waits until the row is pointed at",
  (await sideRow.locator(".trail-x").evaluate((e) => getComputedStyle(e).opacity)) === "0" ||
    (await sideRow.evaluate((r) => r.classList.contains("is-current"))),
);
const lastStop = page.locator(".trail-row").last();
await lastStop.hover();
await pause(200);
check(
  "pointing at a stop shows its remove control at full size",
  await lastStop
    .locator(".trail-x")
    .evaluate((e) => getComputedStyle(e).opacity === "1" && e.getBoundingClientRect().width >= 20),
);
check(
  "the current note has a remove control like any other stop",
  (await page.locator(".trail-row.is-current .trail-x").count()) === 1,
);
const foldButton = page.locator(".trail-fold").first();
const titleBeforeFold = await titleTop();
await foldButton.click();
await pause(250);
check("folding leaves the note where it is", (await titleTop()) === titleBeforeFold);
check(
  "folding hides the branch the tab is not on and says how much",
  (await page.locator(".trail-row").count()) === 2 &&
    (await firstStop.getAttribute("aria-expanded")) === "false" &&
    (await firstStop.locator(".trail-count").textContent()) === "+1",
);
await foldButton.click();
await pause(250);
check(
  "unfolding brings it back",
  (await page.locator(".trail-row").count()) === 3 && (await firstStop.getAttribute("aria-expanded")) === "true",
);

// The trail from the keyboard
await page.locator(".doc").click({ position: { x: 4, y: 4 } });
const titleBeforeSection = await titleTop();
const linksHeight = () => page.locator(".rail-body").evaluate((b) => b.getBoundingClientRect().height);
const linksTall = await linksHeight();
await page.locator('[data-fold-section="trail"]').click();
await pause(320);
check("folding the trail section hides it", !(await trailPane.isVisible()));
check("its room goes to the links", (await linksHeight()) > linksTall + 60, `${linksTall} to ${await linksHeight()}`);
check("folding a section leaves the note alone", (await titleTop()) === titleBeforeSection);
await readout.click();
await pause(320);
check("the readout unfolds it", await trailPane.isVisible());
await readout.click();
await pause(320);
check("pressing the readout again folds it back", !(await trailPane.isVisible()));
check("the links stay throughout", await page.locator('[data-pane="links"]').isVisible());
await page.keyboard.press("Meta+y");
await pause(200);
const onCurrentRow = await focusedRow();
check(
  "the shortcut opens the trail on the current stop",
  (await trailPane.isVisible()) && onCurrentRow.startsWith(await currentRow()),
  onCurrentRow,
);
await page.keyboard.press("ArrowUp");
const movedUp = await focusedRow();
check("the arrow keys move along the stops", movedUp !== onCurrentRow, movedUp);
await page.keyboard.press("Home");
check("Home goes to the start", (await focusedRow()) === (await firstStop.textContent()));
await page.keyboard.press("ArrowLeft");
await pause(250);
check("Left folds a branching stop", (await firstStop.getAttribute("aria-expanded")) === "false");
await page.keyboard.press("ArrowRight");
await pause(250);
check("Right unfolds it", (await firstStop.getAttribute("aria-expanded")) === "true");
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await pause(450);
check("Enter moves this tab to the stop", (await currentRow()) === (await lastStop.locator(".trail-name").textContent()));
check("Enter leaves focus on the trail", (await focusedRow()) !== "" && (await trailPane.isVisible()));
await page.keyboard.press("ArrowUp");
await page.keyboard.press("ArrowUp");
const beforeRemove = await page.locator(".trail-row").count();
const removedName = await page.evaluate(() => document.activeElement.querySelector(".trail-name").textContent);
await page.keyboard.press("Delete");
await pause(300);
check("Delete removes one stop", (await page.locator(".trail-row").count()) === beforeRemove - 1);
check("focus moves to the row in its place", (await focusedRow()) !== "");
check("the toast names the stop and offers Undo", (await page.locator(".toast").textContent()).includes(removedName));
check(
  "Undo in the toast is plain text in the accent, with no box of its own",
  await page.locator(".toast-action").evaluate((b) => {
    const style = getComputedStyle(b);
    const toast = b.closest(".toast").getBoundingClientRect();
    const box = b.getBoundingClientRect();
    return (
      style.backgroundColor === "rgba(0, 0, 0, 0)" &&
      style.borderTopWidth === "0px" &&
      style.appearance === "none" &&
      box.top >= toast.top &&
      box.bottom <= toast.bottom &&
      box.right <= toast.right
    );
  }),
);
await page.locator(".toast-action").click();
await pause(300);
check("Undo puts the stop back", (await page.locator(".trail-row").count()) === beforeRemove);
await page.locator(".trail-row:not(.is-current)").first().focus();
await page.keyboard.press("Delete");
await pause(250);
await page.keyboard.press("Meta+z");
await pause(250);
check("Command-Z on the trail brings the stop back", (await page.locator(".trail-row").count()) === beforeRemove);
const onNote = await title();
await page.locator(".trail-row.is-current").focus();
await page.keyboard.press("Delete");
await pause(500);
check(
  "closing the note the tab is on steps back to another stop",
  (await page.locator(".trail-row").count()) === beforeRemove - 1 && (await title()) !== onNote,
);
await page.locator(".toast-action").click();
await pause(500);
check("Undo returns to that note", (await page.locator(".trail-row").count()) === beforeRemove && (await title()) === onNote);
await page.locator(".trail-row.is-current").focus();
await page.keyboard.press("Escape");
await pause(100);
check(
  "Escape returns to the note and leaves the trail open",
  (await page.evaluate(() => document.activeElement?.classList.contains("scroller"))) && (await trailPane.isVisible()),
);
await page.locator(".trail-row").nth(1).hover();
await page.locator(".trail-row").nth(1).locator(".trail-x").click();
await pause(300);
check("a removed stop hands its place on, and the note stays", (await page.locator(".trail-row").count()) === beforeRemove - 1);
await page.locator(".trail-row:not(.is-current)").first().hover();
await page.locator(".trail-row:not(.is-current) .trail-x").first().click();
await pause(300);
check(
  "removing the last other stop empties the trail and keeps the note",
  !(await readout.isVisible()) && (await page.locator(".trail").isHidden()),
);
await followLink();
await page.locator(".tree-folder.is-open .nav-item:not(.is-current)").last().click();
await pause(450);
check("opening an unrelated note from Files starts a new trail", !(await readout.isVisible()));
await page.keyboard.press("Meta+[");
await pause(450);
check("Back brings the previous trail back", (await page.locator(".trail-row").count()) === 2);

// Twenty-odd stops with branches, in a short window, with the real wheel
{
  const big = await browser.newContext({
    viewport: { width: 1280, height: 560 },
    colorScheme: "light",
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  const p = await big.newPage();
  await p.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
  await p.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await p.evaluate(async () => {
    const r = window.waymark.reader;
    const stops = window.waymark.vault.index.notes.filter((n) => n.endsWith(".md")).slice(0, 24);
    for (const [i, n] of stops.entries()) {
      await r.open(n, { via: "link", focus: true });
      if (i && i % 7 === 0) r.tab.trail.select(r.tab.trail.layout()[Math.floor(i / 2)].id);
    }
  });
  await p.waitForTimeout(300);
  await p.locator(".trail-readout").click();
  await p.waitForTimeout(300);
  const body = () =>
    p.evaluate(() => {
      const b = document.querySelector(".rail-trail");
      const box = b.getBoundingClientRect();
      const rows = [...document.querySelectorAll(".trail-row")];
      const seen = (r) => r.getBoundingClientRect().top >= box.top - 1 && r.getBoundingClientRect().bottom <= box.bottom + 1;
      return {
        top: b.scrollTop,
        room: b.scrollHeight - b.clientHeight,
        count: rows.length,
        first: seen(rows[0]),
        last: seen(rows.at(-1)),
        current: seen(document.querySelector(".trail-row.is-current")),
        heights: new Set(rows.map((r) => r.getBoundingClientRect().height)).size,
        inside: rows.every((r) => {
          const x = r.querySelector(".trail-x").getBoundingClientRect();
          const rail = document.querySelector(".rail").getBoundingClientRect();
          return r.getBoundingClientRect().right <= rail.right && x.right <= rail.right;
        }),
      };
    });
  const opened = await body();
  check("a long trail has more than fits", opened.room > 0 && opened.count >= 24, JSON.stringify(opened));
  check("opening shows the current stop", opened.current);
  check("every row is one line high", opened.heights === 1);
  const capped = await p.locator('[data-section="trail"]').evaluate((e) => e.getBoundingClientRect().height);
  check("a long trail stops growing and scrolls", capped <= 270 && capped >= 120, String(capped));
  check("no row runs out of the panel", opened.inside);
  const title0 = await p.locator(".doc-title").evaluate((t) => t.getBoundingClientRect().top);
  const links = () => p.evaluate(() => document.querySelector(".rail-body").scrollTop);
  const linksBefore = await links();
  const trailBox = await p.locator(".rail-trail").boundingBox();
  await p.mouse.move(trailBox.x + trailBox.width / 2, trailBox.y + trailBox.height / 2);
  await p.mouse.wheel(0, -3000);
  await p.waitForTimeout(200);
  const atStart = await body();
  check("the real wheel reaches the first stop", atStart.top === 0 && atStart.first, JSON.stringify(atStart));
  await p.mouse.wheel(0, 3000);
  await p.waitForTimeout(200);
  const atEnd = await body();
  check("the real wheel reaches the last stop", atEnd.top > 0 && atEnd.last, JSON.stringify(atEnd));
  check("scrolling the trail leaves the links alone", (await links()) === linksBefore);
  check(
    "scrolling the trail leaves the note alone",
    (await p.locator(".doc-title").evaluate((t) => t.getBoundingClientRect().top)) === title0,
  );
  const stopsBefore = await p.locator(".trail-row").count();
  const unseen = await p.evaluate(() => {
    const onTrail = new Set([...document.querySelectorAll(".trail-name")].map((n) => n.textContent));
    return [...document.querySelectorAll(".rail-links .rail-link")].findIndex(
      (l) => !onTrail.has(l.querySelector(".rail-link-name").textContent),
    );
  });
  await p.locator(".rail-links .rail-link").nth(unseen).click();
  await p.waitForTimeout(400);
  check(
    "a link followed from the list adds a stop with both still showing",
    unseen >= 0 &&
      (await p.locator(".trail-row").count()) === stopsBefore + 1 &&
      (await p.locator('[data-pane="links"]').isVisible()) &&
      (await p.locator(".rail-trail").isVisible()),
  );
  await p.setViewportSize({ width: 560, height: 560 });
  await p.waitForTimeout(250);
  const narrow = () =>
    p.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      const slot = box(".trail-readout");
      return {
        inWindow: slot.left >= 0 && slot.right <= innerWidth,
        clearOfSwitch: slot.right <= box(".mode-switch").left,
        rail: box(".rail").left,
        railRight: box(".rail").right,
      };
    });
  const at560 = await narrow();
  check("the readout fits a 560 px window", at560.inWindow && at560.clearOfSwitch, JSON.stringify(at560));
  await p.locator(".trail-readout").click();
  await p.waitForTimeout(450);
  const floated = await narrow();
  check(
    "at 560 px the trail slides in, inside the window",
    floated.rail >= 0 && floated.railRight <= 560,
    JSON.stringify(floated),
  );
  await p.locator(".trail-row:not(.is-current)").first().click();
  await p.waitForTimeout(400);
  check("at 560 px clicking a stop leaves the trail open", (await narrow()).rail < 560 - 200);
  await p.locator(".rail-links .rail-link").first().click();
  await p.waitForTimeout(400);
  check("at 560 px following a link from the list leaves the trail open", (await narrow()).rail < 560 - 200);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(450);
  check("Escape slides it away", (await narrow()).rail >= 560);
  await big.close();
}

// A trail can loop back on itself
const loop = await page.evaluate(() => {
  const f = window.waymark;
  for (const a of f.vault.index.notes)
    for (const b of f.vault.links.out.get(a) ?? []) if (a !== b && f.vault.links.out.get(b)?.has(a)) return [a, b];
  return null;
});
await page.evaluate(async ([a]) => {
  await window.waymark.open(a);
}, loop);
await pause(400);
const clickTo = async (target) => {
  await page.locator(`.doc a.wikilink[data-path="${target}"]`).first().click();
  await pause(450);
};
await clickTo(loop[1]);
await clickTo(loop[0]);
check(
  "a link back to an earlier note does not repeat it",
  (await page.locator(".trail-row").count()) === 2 &&
    (await page.locator(".trail-row.is-current .trail-name").textContent()) ===
      (await page.locator(".trail-name").first().textContent()),
);
check("a link back adds no line to the trail", (await page.locator(".trail-lines path").count()) === 1);
await page.keyboard.press("Meta+[");
await pause(450);
check(
  "Back retraces the stop you came from",
  (await page.locator(".trail-row.is-current .trail-name").textContent()) ===
    (await page.locator(".trail-name").nth(1).textContent()),
);

await page.click('[data-rail="info"]');
await pause(150);
check("the Info pane has a history section", (await page.textContent(".rail-history")).includes("History"));
await page.click('[data-rail="links"]');

const tabsBefore = await page.locator(".tab").count();
const noteBefore = await title();
const activeTabTitle = () => page.textContent(".tab.is-active .tab-title");
await page.click('[data-act="new-tab"]');
await pause(400);
check(
  "the + button opens a tab labelled New tab, with the palette",
  (await page.locator(".tab").count()) === tabsBefore + 1 &&
    (await page.locator(".palette input").isVisible()) &&
    (await activeTabTitle()) === "New tab",
);
check("a new tab does not copy the note", (await page.locator(".doc-title").count()) === 0);
await page.keyboard.press("Escape");
await pause(250);
check(
  "Escape closes the palette and leaves the blank tab",
  !(await page.locator(".palette input").isVisible()) &&
    (await page.locator(".tab").count()) === tabsBefore + 1 &&
    (await page.locator(".start-page").isVisible()),
);
await page.keyboard.press("Meta+t");
await pause(250);
check(
  "a second new tab reuses the blank one",
  (await page.locator(".tab").count()) === tabsBefore + 1 && (await page.locator(".palette input").isVisible()),
);
await page.keyboard.type("Starter feeding");
await pause(250);
await page.keyboard.press("Enter");
await pause(500);
check(
  "picking a note fills the blank tab with nothing to go back to",
  (await page.locator(".tab").count()) === tabsBefore + 1 &&
    (await activeTabTitle()).startsWith("Starter feeding") &&
    (await title()).startsWith("Starter feeding") &&
    (await page.locator('[data-act="back"]').isDisabled()),
);
await page.keyboard.press("Meta+w");
await pause(300);
await page.click('[data-act="new-tab"]');
await pause(300);
await page.keyboard.press("Escape");
await pause(250);
await page.keyboard.press("Escape");
await pause(400);
check(
  "a second Escape closes the blank tab and returns to the note",
  (await page.locator(".tab").count()) === tabsBefore && (await title()) === noteBefore,
);

// Settings popover changes theme family
await page.click('[data-act="settings"]');
await pause(250);
await page.click('[data-family="rose-pine"]');
await pause(400);
const theme = await page.evaluate(() => document.documentElement.dataset.theme);
check("theme family switches", theme === "dawn" || theme === "moon", theme);
await page.click('[data-family="catppuccin"]');
await page.keyboard.press("Escape");
await pause(300);

console.log(results.join("\n"));
if (videoDir) console.log("video:", await page.video().path());
await ctx.close();
await browser.close();
await app.close();
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
