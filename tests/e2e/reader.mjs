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
await page.click('[data-rail="outline"]');
const railGraph = await page.evaluate(() => document.querySelector(".local-graph canvas")?.getBoundingClientRect().height ?? 0);
check("local graph renders in the rail", railGraph > 100, `${railGraph}px`);

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
await page.click('[data-side="files"]');
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

// Each tab keeps its own trail of followed links
await page.evaluate(async () => {
  const f = window.waymark;
  await f.open(f.vault.index.notes.find((p) => p.endsWith("Compass declination and magnetic north.md")));
});
await pause(400);
check("a tab with one note shows no trail", !(await page.locator(".trail").isVisible()));
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
check("following a link grows the trail", (await page.locator(".trail-node").count()) === 2);
await page.locator(".trail-name").first().click();
await pause(450);
check(
  "clicking the map moves this tab there",
  (await title()).startsWith("Compass declination") && (await page.locator(".trail-node").count()) === 2,
);
await followLink();
const rows = await page.evaluate(
  () => new Set([...document.querySelectorAll(".trail-node")].map((n) => n.style.insetBlockStart)).size,
);
check(
  "a second link from the same note branches",
  (await page.locator(".trail-node").count()) === 3 && rows === 2,
  `${rows} rows`,
);
await page.keyboard.down("Meta");
await page.locator(".tree-folder.is-open .nav-item").first().click();
await page.keyboard.up("Meta");
await pause(500);
await page.click(".tab:nth-child(2)");
await pause(450);
check("another tab has its own trail", !(await page.locator(".trail").isVisible()));
await page.click(".tab:nth-child(1)");
await pause(450);
check("the first tab keeps its map", (await page.locator(".trail-node").count()) === 3);
const closeControlIsLeading = (root, [button, label]) => {
  const box = (selector) => root.querySelector(selector).getBoundingClientRect();
  const control = box(button);
  const mark = box(`${button} path`);
  const centred = Math.abs(control.left + control.width / 2 - (mark.left + mark.width / 2)) <= 0.5;
  return control.right <= box(label).left && control.width >= 20 && mark.width >= 6.9 && centred;
};
check(
  "a tab's close control leads its title, centred and full size",
  await page.locator(".tab").first().evaluate(closeControlIsLeading, [".tab-close", ".tab-title"]),
);
check(
  "a trail stop's remove control leads its name, centred and full size",
  await page.locator(".trail-node").first().evaluate(closeControlIsLeading, [".trail-x", ".trail-name span"]),
);
await page.click(".tab:nth-child(2) .tab-close", { force: true });
await pause(300);
check(
  "every note on the map shows its remove button",
  await page
    .locator(".trail-x")
    .first()
    .evaluate((e) => getComputedStyle(e).opacity !== "0" && e.getBoundingClientRect().width >= 18),
);
const foldButton = page.locator(".trail-fold").first();
await foldButton.click();
await pause(150);
check(
  "the branch control folds away branches the tab is not on",
  (await foldButton.textContent()) !== "" &&
    (await page.locator(".trail-fold").first().getAttribute("aria-expanded")) === "false",
);
await page.locator(".trail-fold").first().click();
await pause(150);
await page.locator(".trail-node.is-current .trail-x").click();
await pause(450);
check(
  "removing the current note steps back to its parent",
  (await title()).startsWith("Compass declination") && (await page.locator(".trail-node").count()) === 2,
);
await page.locator(".trail-x").first().click();
await pause(200);
check(
  "removing the start keeps only the current note",
  !(await page.locator(".trail").isVisible()) && (await title()).startsWith("Compass declination"),
);
await followLink();
await page.locator(".tree-folder.is-open .nav-item:not(.is-current)").last().click();
await pause(450);
check("opening an unrelated note from Files starts a new trail", !(await page.locator(".trail").isVisible()));
await page.keyboard.press("Meta+[");
await pause(450);
check("Back brings the previous trail back", (await page.locator(".trail-node").count()) === 2);

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
  (await page.locator(".trail-node").count()) === 2 &&
    (await page.locator(".trail-node.is-current").textContent()) === (await page.locator(".trail-name").first().textContent()),
);
check("the link back is drawn on the map", (await page.locator(".trail-lines path.is-cross").count()) === 1);
await page.keyboard.press("Meta+[");
await pause(450);
check(
  "Back retraces the stop you came from",
  (await page.locator(".trail-node.is-current").textContent()) === (await page.locator(".trail-name").nth(1).textContent()),
);

await page.click('[data-rail="info"]');
await pause(150);
check("the Info pane has a history section", (await page.textContent(".rail-history")).includes("History"));
await page.click('[data-rail="outline"]');

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
    (await page.locator(".empty-state.is-page").isVisible()),
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
