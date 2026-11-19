// Zen mode: one shortcut hides the app around the note and brings back exactly what was there.
// Usage: node tests/e2e/zen.mjs [reduced]
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { idle, watchIdle, writesSettled } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const mode = reduced ? "reduced: " : "";
const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"}  ${mode}${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
await writeFile(path.join(app.vault, "Zen conflict.md"), "# Zen conflict\n\nbase text\n");
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 860 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await context.newPage();
await watchIdle(page);
const errors = [];
watchPageErrors(page, errors);

const ZEN = "Meta+Shift+Backslash";
const isZen = () => page.evaluate(() => document.querySelector(".shell").classList.contains("is-zen"));
/** What is on screen around the note, and where the note is. */
const layout = () =>
  page.evaluate(() => {
    const shown = (sel) => {
      const el = document.querySelector(sel);
      const style = getComputedStyle(el);
      return style.visibility === "visible" && Number(style.opacity) > 0 && el.getBoundingClientRect().width > 0;
    };
    const shell = document.querySelector(".shell");
    const title = document.querySelector(".doc h1, .doc-title").getBoundingClientRect();
    const para = document.querySelector(".doc p").getBoundingClientRect();
    return {
      sidebar: shown(".sidebar"),
      rail: shown(".rail"),
      paneHead: shown(".pane-head"),
      status: shown(".statusbar"),
      tabs: Number(getComputedStyle(document.querySelector(".tabs")).opacity),
      sidebarClosed: shell.classList.contains("sidebar-closed"),
      railClosed: shell.classList.contains("rail-closed"),
      titleTop: Math.round(title.top),
      measure: Math.round(para.width),
      offCentre: Math.round(Math.abs(para.left + para.width / 2 - window.innerWidth / 2)),
      scrollerTop: Math.round(document.querySelector(".scroller").getBoundingClientRect().top),
    };
  });
const running = () =>
  page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.target?.closest?.(".shell")).length,
  );
const key = async (chord) => {
  await page.keyboard.press(chord);
  await idle(page);
};

try {
  await page.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);
  const before = await layout();
  check("the window starts with its panels", before.sidebar && before.rail && before.paneHead && before.status);

  await page.keyboard.press(ZEN);
  check("the shortcut changes the window at once", (await running()) === 0, String(await running()));
  await idle(page);
  const zen = await layout();
  check("the shortcut enters zen", await isZen());
  check("it hides the sidebar and the inspector", !zen.sidebar && !zen.rail, JSON.stringify(zen));
  check("it hides the tabs, the row above the note and the status bar", zen.tabs === 0 && !zen.paneHead && !zen.status);
  check("the note keeps its measure", zen.measure === before.measure, `${before.measure} -> ${zen.measure}`);
  check("and sits in the middle of the window", zen.offCentre <= 1, String(zen.offCentre));
  check("nothing moves up or down", zen.titleTop === before.titleTop, `${before.titleTop} -> ${zen.titleTop}`);
  check(
    "the title bar keeps its room, so nothing sits under the window controls",
    zen.scrollerTop === before.scrollerTop,
    `${before.scrollerTop} -> ${zen.scrollerTop}`,
  );
  check("the panels keep their own state", !zen.sidebarClosed && !zen.railClosed);

  await page.mouse.move(720, 20);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".tabs")).opacity) === 1);
  const hovered = await layout();
  check("the pointer at the top brings the tabs back", hovered.tabs === 1);
  check("without moving the note", hovered.titleTop === zen.titleTop && hovered.offCentre === zen.offCentre);
  check("the title bar offers a way out", await page.locator(".zen-exit").isVisible());
  await page.mouse.move(720, 500);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".tabs")).opacity) === 0);
  check("and fades them again when it leaves", true);

  await page.evaluate((name) => {
    const { reader } = window.waymark;
    return reader.open(reader.vault.index.notes.find((path) => path.endsWith(`/${name}.md`)));
  }, NOTES.starter);
  await idle(page);
  check(
    "zen survives opening another note",
    (await isZen()) && (await page.evaluate(() => window.waymark.reader.notePath)).includes("Starter"),
  );

  await key("Meta+k");
  check("the palette opens over zen", (await page.locator(".palette").count()) === 1);
  await page.keyboard.type(">zen");
  await idle(page);
  check(
    "the palette names the way out",
    (await page.locator(".palette-row .palette-label").first().textContent()) === "Leave zen mode",
    await page.locator(".palette-row .palette-label").first().textContent(),
  );
  await key("Escape");
  check("Escape closes the palette first and zen stays", (await page.locator(".palette").count()) === 0 && (await isZen()));

  await key("Escape");
  const left = await layout();
  check("Escape then leaves zen", !(await isZen()));
  check(
    "leaving brings back exactly what was there",
    left.sidebar && left.rail && left.paneHead && left.status && left.tabs === 1,
    JSON.stringify(left),
  );

  await key("Meta+Backslash");
  check("with the sidebar closed first", !(await layout()).sidebar);
  await key(ZEN);
  await key(ZEN);
  const restored = await layout();
  check("the same shortcut leaves", !(await isZen()));
  check("and a closed sidebar stays closed", !restored.sidebar && restored.rail, JSON.stringify(restored));

  await key(ZEN);
  await key("Meta+Backslash");
  const asked = await layout();
  check("⌘\\ in zen leaves it and shows the sidebar", !(await isZen()) && asked.sidebar && asked.rail, JSON.stringify(asked));

  await key(ZEN);
  /* The dev server has no Git, so the sync warning is set by hand. */
  await page.evaluate(() => {
    document.querySelector(".sync-btn").dataset.tone = "warn";
  });
  check(
    "a sync that needs attention still shows",
    await page.evaluate(() => getComputedStyle(document.querySelector(".sync-btn")).visibility === "visible"),
  );
  await page.evaluate(() => {
    document.querySelector(".sync-btn").dataset.tone = "off";
  });

  await key("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  check(
    "Edit works in zen",
    (await isZen()) && (await page.evaluate(() => document.activeElement?.closest(".cm-content") != null)),
  );
  await key("Escape");
  check("Escape while typing stays with the editor", await isZen());
  await key(ZEN);
  check("the shortcut leaves zen while typing", !(await isZen()));
  await key(ZEN);
  check("and enters it while typing", await isZen());
  await key("Meta+e");

  await page.mouse.move(720, 20);
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".tabs")).opacity) === 1);
  const doc = page.locator(".scroller > .doc");
  await page.click(".zen-exit");
  const gliding = await doc.evaluate((el) => el.getAnimations().length);
  if (reduced) check("leaving with the pointer does not move the note", gliding === 0, String(gliding));
  else check("leaving with the pointer glides the note to its place", gliding > 0, String(gliding));
  await idle(page);
  check("and leaves zen", !(await isZen()));

  await key(ZEN);
  await page.reload();
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);
  check("a new launch shows the whole window", !(await isZen()) && (await layout()).rail);

  await page.evaluate(() => window.waymark.reader.open("Zen conflict.md"));
  await idle(page);
  await key("Meta+e");
  await page.waitForSelector(".cm-content");
  await writesSettled(page, 200);
  await key(ZEN);
  await writeFile(path.join(app.vault, "Zen conflict.md"), "# Zen conflict\n\ntheirs text\n");
  await page.locator(".cm-line", { hasText: "base text" }).click();
  await page.keyboard.type("mine ");
  await page.waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "conflict", null, {
    timeout: 5000,
  });
  await idle(page);
  const banner = await page.evaluate(() => {
    const el = document.querySelector(".edit-banner");
    return { visibility: getComputedStyle(el).visibility, width: Math.round(el.getBoundingClientRect().width) };
  });
  check(
    "a save that failed still shows its notice in zen",
    (await isZen()) && banner.visibility === "visible" && banner.width > 0,
    JSON.stringify(banner),
  );
  check("with its way to resolve it", await page.locator('.edit-banner button:has-text("Compare")').isVisible());
  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  check("the suite finished", false, `${error.message.split("\n").slice(0, 3).join(" ")} | ${errors[0] ?? ""}`);
}
await browser.close();
await app.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
