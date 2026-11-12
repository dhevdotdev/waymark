// Motion belongs to the pointer: what moves when a note, folder or panel changes, and that the keyboard always lands at once.
// Usage: node tests/e2e/navigation-motion.mjs [reduced]
import { writeFile } from "node:fs/promises";
import path from "node:path";
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
const LONG = "A note whose title is long enough that it has to wrap onto a second line in the reading column";

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
const scrimMoving = () =>
  page.evaluate(() =>
    document
      .querySelector(".reader")
      .getAnimations({ subtree: true })
      .some((a) => a.effect.pseudoElement === "::after"),
  );
const nextFrames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * Records every animation the next navigation starts on the page, its ghost, the carried copies, the title and the
 * body, read from each animation as it starts rather than from sampled frames, until the new page has settled.
 */
const watchEntrance = () =>
  page.evaluate(() => {
    const before = document.querySelector(".doc-title")?.textContent;
    const seen = new Map();
    const stats = { ghosts: 0, layoutMoved: false, wrapMatched: null };
    const roleOf = (el) => {
      if (!(el instanceof Element)) return null;
      if (el.matches(".page-ghost")) return "ghost";
      if (el.matches(".page-carry")) return "carry";
      if (el.matches(".scroller > .doc")) return "page";
      if (el.matches(".scroller > .doc .doc-title")) return "title";
      if (el.parentElement?.matches(".scroller > .doc")) return "block";
      return null;
    };
    const frameOf = () => {
      const head = document.querySelector(".pane-head").getBoundingClientRect();
      return `${head.top},${head.left},${document.querySelector(".scroller").getBoundingClientRect().width}`;
    };
    const frame0 = frameOf();
    const read = () => {
      stats.ghosts = Math.max(stats.ghosts, document.querySelectorAll(".page-ghost").length);
      if (frameOf() !== frame0) stats.layoutMoved = true;
      for (const a of document.getAnimations()) {
        const role = roleOf(a.effect.target);
        if (!role || seen.has(a)) continue;
        const keys = a.effect.getKeyframes();
        const timing = a.effect.getComputedTiming();
        const target = a.effect.target;
        if (role === "carry" && target.style.whiteSpace === "normal") {
          const t = document.querySelector(".scroller > .doc .doc-title");
          stats.wrapMatched = Math.abs(target.offsetHeight - t.offsetHeight) < 1 && target.offsetWidth === t.offsetWidth;
        }
        seen.set(a, {
          role,
          name: a.animationName ?? null,
          ms: timing.duration,
          delay: timing.delay,
          from: { opacity: keys[0]?.opacity, translate: keys[0]?.translate, transform: keys[0]?.transform },
          to: { opacity: keys.at(-1)?.opacity, translate: keys.at(-1)?.translate },
        });
      }
    };
    const observer = new MutationObserver(read);
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    const started = performance.now();
    window.__entrance = new Promise((resolve) => {
      let still = 0;
      const tick = () => {
        read();
        const arrived = document.querySelector(".doc-title")?.textContent !== before;
        const running = [...seen.keys()].some((a) => a.playState === "running");
        still = arrived && !running ? still + 1 : 0;
        if (still >= 3 || performance.now() - started > 5000) {
          observer.disconnect();
          resolve({
            motions: [...seen.values()],
            ...stats,
            leftovers: document.querySelectorAll(".page-ghost, .page-carry").length,
            titleShown: getComputedStyle(document.querySelector(".scroller > .doc .doc-title")).opacity === "1",
          });
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
const entranceOf = async (act) => {
  await watchEntrance();
  await act();
  return page.evaluate(() => window.__entrance);
};
const of = (r, role) => r.motions.filter((m) => m.role === role);
const faded = (r) => r.motions.some((m) => m.name === "doc-enter");
const still = (r) => r.motions.length === 0;
const shown = (r) =>
  JSON.stringify(r.motions.map(({ role, name, ms, delay, from, to }) => ({ role, name, ms, delay, from, to })));
const px = (t) => Number.parseFloat(String(t ?? "0"));
/** The new page and the ghost travel opposite ways along x, by the slide's distance, or only fade under Reduce Motion. */
const slid = (r, step) => {
  const [enter] = of(r, "page");
  const [ghost] = of(r, "ghost");
  if (!enter || !ghost || faded(r) || of(r, "carry").length) return false;
  const travel = reduced ? 0 : 28;
  return (
    px(enter.from.translate) === step * travel &&
    px(ghost.to.translate) === -step * travel &&
    enter.ms === (reduced ? 140 : 240) &&
    ghost.ms === 140 &&
    Number(enter.from.opacity) === 0 &&
    Number(ghost.to.opacity) === 0 &&
    !r.layoutMoved
  );
};
/** The clicked text flies into the title in two crossfading copies while the old page fades in place, then the body rises. */
const carried = (r) => {
  if (reduced) return faded(r) && of(r, "carry").length === 0;
  const blocks = of(r, "block");
  return (
    of(r, "carry").length === 2 &&
    of(r, "carry").every((m) => m.ms === 250) &&
    of(r, "ghost").every((m) => m.ms === 140 && px(m.to.translate) === 0) &&
    of(r, "title").some((m) => Number(m.from.opacity) === 0) &&
    blocks.length > 0 &&
    blocks.every((m) => m.delay === 60 && m.ms === 200 && m.from.translate?.endsWith("6px")) &&
    !faded(r) &&
    !r.layoutMoved
  );
};
const settledClean = (r) => r.leftovers === 0 && r.titleShown;

/* Page entrances */
const LINK = ".doc > :not(.doc-head) a.wikilink:not([data-anchor])";
const TREE_ROW = ".tree-folder.is-open > .tree-body > .tree-inner > .nav-item:not(.is-current)";
await openNote(NOTES.hero);
let seen = await entranceOf(() => page.locator(LINK).first().click());
check(
  reduced ? "a clicked link fades the page in without flying" : "a clicked link carries its text into the title",
  carried(seen) && settledClean(seen),
  shown(seen),
);
seen = await entranceOf(() => page.click('[data-act="back"]'));
check("the Back button slides the page in from the left", slid(seen, -1) && settledClean(seen), shown(seen));
seen = await entranceOf(() => page.click('[data-act="forward"]'));
check("the Forward button slides the page in from the right", slid(seen, 1) && settledClean(seen), shown(seen));
await page.keyboard.press("Escape");
seen = await entranceOf(() =>
  page.evaluate(() =>
    document.querySelector(".doc").dispatchEvent(new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true })),
  ),
);
check("the mouse's back button slides like the Back button", slid(seen, -1), shown(seen));

await openNote(NOTES.hero);
await page.locator(LINK).first().focus();
seen = await entranceOf(() => page.keyboard.press("Enter"));
check("a link followed with Return lands at once", still(seen), shown(seen));

seen = await entranceOf(() => page.keyboard.press("Meta+["));
check("going back with ⌘[ lands at once", still(seen), shown(seen));
seen = await entranceOf(() => page.keyboard.press("Meta+]"));
check("going forward with ⌘] lands at once", still(seen), shown(seen));
seen = await entranceOf(() => page.evaluate(() => window.waymark.reader.commands.runFromMenu("back")));
check("Back from the menu bar lands at once", still(seen), shown(seen));

seen = await entranceOf(() => page.locator(TREE_ROW).first().click());
check(
  reduced ? "a file-list click fades the page in without flying" : "a file-list click carries the row's name into the title",
  carried(seen) && settledClean(seen),
  shown(seen),
);

seen = await entranceOf(async () => {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type(NOTES.tide);
  await pause(100);
  await page.keyboard.press("Enter");
});
check("a palette choice lands at once", still(seen), shown(seen));

seen = await entranceOf(async () => {
  await page.keyboard.press("Meta+Shift+f");
  await page.keyboard.type("declination");
  await pause(200);
  await page.keyboard.press("Enter");
});
check("a search result opened with Return lands at once", still(seen), shown(seen));

/* Carrying where it cannot be seen, is slow, wraps or is interrupted */
await writeFile(path.join(app.vault, `${LONG}.md`), `# ${LONG}\n\nA short body.\n`);
await writeFile(
  path.join(app.vault, "Wrap source.md"),
  `# Wrap source\n\nGo to [[${LONG}]] from here.\n\nGo to [[Wrap source]] too.\n`,
);
await page.evaluate((files) => window.waymark.reader.vault.applyChanges(files), [`${LONG}.md`, "Wrap source.md"]);
await openNote("Wrap source");
seen = await entranceOf(() => page.locator(LINK).first().click());
check(
  "a title that wraps is carried by a copy that wraps the same way",
  reduced ? carried(seen) : carried(seen) && seen.wrapMatched === true,
  `${seen.wrapMatched} ${shown(seen)}`,
);

await openNote(NOTES.hero);
seen = await entranceOf(() =>
  page.evaluate(() => document.querySelector(".tree-folder:not(.is-open) .nav-item[data-path]").click()),
);
check("a row inside a closed folder gets the plain fade", faded(seen) && of(seen, "carry").length === 0, shown(seen));

await openNote(NOTES.hero);
await page.evaluate(() => {
  const vault = window.waymark.reader.vault;
  const read = vault.read.bind(vault);
  vault.read = (p) => new Promise((done) => setTimeout(() => done(read(p)), 400));
  window.__restoreRead = () => {
    vault.read = read;
  };
});
const clickedAt = Date.now();
seen = await entranceOf(async () => {
  await page.locator(LINK).first().click();
  check("a slow note does not hold the click", Date.now() - clickedAt < 300, `${Date.now() - clickedAt}ms`);
});
await page.evaluate(() => window.__restoreRead());
check("a note that arrives late gets the plain fade", faded(seen) && of(seen, "carry").length === 0, shown(seen));

await openNote(NOTES.hero);
seen = await entranceOf(async () => {
  await page.locator(LINK).first().click();
  await page.waitForFunction((t) => document.querySelector(".doc-title")?.textContent !== t, NOTES.hero);
  await pause(60);
  await page.locator(TREE_ROW).first().click();
});
check(
  "a second click mid-carry starts again from the page on screen and leaves nothing behind",
  seen.ghosts <= 1 && settledClean(seen) && !seen.layoutMoved,
  `ghosts ${seen.ghosts}, leftovers ${seen.leftovers}`,
);

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
await page.click('[data-rail="links"]');
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
