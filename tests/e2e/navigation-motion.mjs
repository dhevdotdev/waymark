// Motion belongs to the pointer: what moves when a note, folder or panel changes, and that the keyboard always lands at once.
// Usage: node tests/e2e/navigation-motion.mjs [reduced]
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const app = await serveFixture();
const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 800 },
  colorScheme: "light",
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const pause = (ms) => page.waitForTimeout(ms);
const settled = () => pause(reduced ? 200 : 450);

/* The note is drawn again once the code theme has loaded, which would replace a page still fading. */
const untilPageStopsRedrawing = () =>
  page.evaluate(
    () =>
      new Promise((done) => {
        let quiet = setTimeout(done, 1000);
        new MutationObserver(() => {
          clearTimeout(quiet);
          quiet = setTimeout(done, 1000);
        }).observe(document.querySelector(".scroller"), { childList: true });
      }),
  );

const openNote = async (name) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(name)}`);
  await page.waitForSelector(".doc-title");
  /* Start-up draws the note again once the vault is indexed, which a slow machine can finish after a quiet second. */
  await page.waitForFunction(() => window.waymark?.metrics.startMs > 0);
  await untilPageStopsRedrawing();
};
const moving = (selector) => page.evaluate((s) => document.querySelector(s).getAnimations().length > 0, selector);
const fading = () => page.evaluate(() => document.querySelector(".doc").classList.contains("doc-enter"));
const landed = async (before) => {
  await page.waitForFunction((t) => document.querySelector(".doc-title")?.textContent !== t, before);
  await pause(30);
};
const title = () => page.textContent(".doc-title");
const scrimMoving = () =>
  page.evaluate(() =>
    document
      .querySelector(".reader")
      .getAnimations({ subtree: true })
      .some((a) => a.effect.pseudoElement === "::after"),
  );
const nextFrames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/* The document fade */
const LINK = ".doc > :not(.doc-head) a.wikilink:not([data-anchor])";
await openNote(NOTES.hero);
let before = await title();
await page.locator(LINK).first().click();
await landed(before);
check("a followed link fades the new page in", await fading());

await openNote(NOTES.hero);
before = await title();
await page.locator(LINK).first().focus();
await page.keyboard.press("Enter");
await landed(before);
check("a link followed with Return does not fade", !(await fading()));

before = await title();
await page.keyboard.press("Meta+[");
await landed(before);
check("going back does not fade", !(await fading()));

before = await title();
await page.locator(".tree-folder.is-open > .tree-body > .tree-inner > .nav-item:not(.is-current)").first().click();
await landed(before);
check("a file-list click does not fade", !(await fading()));

before = await title();
await page.keyboard.press("Meta+k");
await page.keyboard.type(NOTES.tide);
await pause(100);
await page.keyboard.press("Enter");
await landed(before);
check("a palette choice does not fade", !(await fading()));

before = await title();
await page.keyboard.press("Meta+Shift+f");
await page.keyboard.type("declination");
await pause(200);
await page.keyboard.press("Enter");
await landed(before);
check("a search result opened with Return does not fade", !(await fading()));

/* Folders */
await openNote(NOTES.hero);
const folder = await page.$eval(".tree-folder:not(.is-open) > .tree-head[data-folder]", (h) => h.dataset.folder);
const head = `.tree-head[data-folder="${folder}"]`;
const body = `.tree-folder:has(> ${head}) > .tree-body`;
const chevron = `${head} .tree-chevron`;
await page.click(head);
check("a clicked folder opens by moving", (await moving(body)) === !reduced);
await settled();
await page.click(head);
await settled();
await page.focus(head);
await page.keyboard.press("ArrowRight");
check("ArrowRight opens a folder at once", !(await moving(body)) && !(await moving(chevron)));
await page.keyboard.press("ArrowLeft");
check("ArrowLeft closes a folder at once", !(await moving(body)) && !(await moving(chevron)));
await page.keyboard.press("Space");
check("Space opens a folder at once", !(await moving(body)) && !(await moving(chevron)));
await page.keyboard.press("Space");

/* Callouts */
const CALLOUT = ".callout[data-fold]";
await openNote(NOTES.compass);
await page.click(`${CALLOUT} .callout-title`);
check("a clicked callout opens by moving", (await moving(`${CALLOUT} .callout-body`)) === !reduced);
await settled();
await page.locator(`${CALLOUT} .callout-title`).focus();
await page.keyboard.press("Enter");
check("Return folds a callout at once", !(await moving(`${CALLOUT} .callout-body`)));
await page.keyboard.press("Meta+f");
await page.keyboard.type("magnetic pole");
await pause(150);
check(
  "find opens a callout at once",
  (await page.getAttribute(CALLOUT, "data-fold")) === "open" && !(await moving(`${CALLOUT} .callout-body`)),
);
await page.click(`${CALLOUT} .callout-title`);
await settled();
await page.click('[data-find="next"]');
check(
  "find opens a callout at once even from the pointer",
  (await page.getAttribute(CALLOUT, "data-fold")) === "open" && !(await moving(`${CALLOUT} .callout-body`)),
);
await page.keyboard.press("Escape");

/* Docked panels */
await openNote(NOTES.hero);
const widthNow = () => page.evaluate(() => document.querySelector(".reader").getBoundingClientRect().width);
const startWidth = await widthNow();
await page.click('[data-act="sidebar"]');
const clickedWidth = await widthNow();
await settled();
check("a docked sidebar never animates the column", clickedWidth === (await widthNow()) && clickedWidth > startWidth);
await page.click('[data-act="sidebar"]');
await settled();

/* Rail sections */
const SECTION = '.rail-section[data-section="graph"]';
const TOGGLE = '[data-fold-section="graph"]';
await page.click(TOGGLE);
check("a clicked section folds by moving", (await moving(SECTION)) === !reduced);
await settled();
await page.focus(TOGGLE);
await page.keyboard.press("Enter");
check("Return unfolds a section at once", !(await moving(SECTION)));
await page.click(".doc-title");
await page.setViewportSize({ width: 1500, height: 680 });
await nextFrames();
check("a window resize does not animate the sections", !(await moving(SECTION)));
await page.setViewportSize({ width: 1500, height: 800 });
await settled();

/* The heading target */
const IN_NOTE = '.doc a.wikilink[data-anchor="Fixes"]';
const TARGET = '[data-key="fixes"]';
await openNote(NOTES.hero);
await page.locator(IN_NOTE).focus();
await page.keyboard.press("Enter");
await pause(40);
check("a heading reached with Return does not flash", !(await moving(TARGET)));
await page.click(IN_NOTE);
await pause(40);
check("a heading reached by the pointer flashes", (await moving(TARGET)) === !reduced);
await pause(700);
await page.click(IN_NOTE);
await pause(40);
check("a second jump to the same heading flashes again", (await moving(TARGET)) === !reduced);
await settled();
await page.locator(IN_NOTE).focus();
await page.keyboard.press("Enter");
await pause(40);
check("a keyboard jump clears the last target", (await page.locator(".doc .is-target").count()) === 0);

/* The outline */
await page.evaluate(() => document.querySelector(".scroller").scrollTo({ top: 0 }));
const outlineLink = page.locator(".floating-outline a").nth(1);
await outlineLink.focus();
await page.keyboard.press("Enter");
const jumped = await page.evaluate(() => document.querySelector(".scroller").scrollTop);
await nextFrames();
check(
  "the outline jumps at once from the keyboard",
  jumped > 0 && jumped === (await page.evaluate(() => document.querySelector(".scroller").scrollTop)),
  String(jumped),
);

/* Bookmarks */
await openNote(NOTES.hero);
await page.keyboard.press("Meta+k");
await page.keyboard.type("Bookmark this note");
await pause(100);
await page.keyboard.press("Enter");
await pause(100);
await page.evaluate(() => {
  window.__head = document.querySelector(".bookmarks > .tree-head");
});
await page.click(".bookmarks > .tree-head");
check("the Bookmarks fold moves like a folder", (await moving(".bookmarks > .tree-body")) === !reduced);
check(
  "the Bookmarks group keeps its elements",
  await page.evaluate(() => window.__head === document.querySelector(".bookmarks > .tree-head")),
);
await settled();
await page.focus(".bookmarks > .tree-head");
await page.keyboard.press("ArrowRight");
check(
  "ArrowRight opens Bookmarks at once",
  (await page.getAttribute(".bookmarks > .tree-head", "aria-expanded")) === "true" && !(await moving(".bookmarks > .tree-body")),
);
await page.keyboard.press("ArrowDown");
const rowFocused = () => page.evaluate(() => document.activeElement?.matches(".bookmarks .nav-item"));
check("arrows reach a bookmark row", await rowFocused());
await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
check(
  "ArrowLeft folds Bookmarks at once",
  (await page.getAttribute(".bookmarks > .tree-head", "aria-expanded")) === "false" && !(await moving(".bookmarks > .tree-body")),
);

/* Floating panels */
await page.setViewportSize({ width: 800, height: 700 });
await settled();
await page.click('[data-act="sidebar"]');
check("a clicked narrow sidebar slides", (await moving(".sidebar")) === !reduced);
check("its scrim fades with it", await scrimMoving());
await settled();
await page.keyboard.press("Meta+\\");
check("the shortcut closes it at once, scrim included", !(await moving(".sidebar")) && !(await scrimMoving()));
await settled();
await page.keyboard.press("Meta+k");
await page.keyboard.type("Toggle sidebar");
await pause(100);
await page.locator(".palette-row").first().click();
check("a palette choice made with the pointer is instant", !(await moving(".sidebar")) && !(await scrimMoving()));
await settled();
await page.keyboard.press("Meta+\\");
await page.setViewportSize({ width: 1100, height: 700 });
await settled();
await page.click('[data-act="rail"]');
check("a clicked floating inspector slides", (await moving(".rail")) === !reduced);
await settled();
await page.keyboard.press("Meta+Alt+\\");
check("the shortcut closes the inspector at once", !(await moving(".rail")));

check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));
await browser.close();
await app.close();
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
