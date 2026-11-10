// Where the note editor's caret lands in WebKit: its height and position against the text, and when it is drawn at all.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);

const WRAPPED =
  "A paragraph long enough that it certainly wraps around onto a second visual line of the reading column, and then onto a third one too, because a caret has to walk across soft wraps as well as plain runs of text in this note.";
const NOTE = `## Heading 2

Before \`inline code\` and **bold** after.

${WRAPPED}

> A quoted line

| One | Two |
| --- | --- |
| a | b |

Last.
`;

const app = await serveFixture();
await writeFile(path.join(app.vault, "Caret.md"), NOTE);
await writeFile(path.join(app.vault, "Empty.md"), "");
await writeFile(path.join(app.vault, "Bare.md"), "## \n\nAfter.\n");
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);

const openEditing = async (name) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(350);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(300);
};
const caret = () =>
  page.evaluate(() => {
    const box = document.querySelector(".cm-caret")?.getBoundingClientRect();
    return box ? { left: box.left, width: box.width, top: box.top, height: box.height } : null;
  });
const press = async (key, times = 1) => {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
  await pause(40);
};
const toLine = async (text) => {
  await page
    .locator(".cm-line", { hasText: text })
    .first()
    .click({ position: { x: 2, y: 8 } });
  await press("Home");
};
/** Home stops at a line's text, and a heading or quote keeps its marks to the left of that. */
const toMarks = async (text) => {
  await toLine(text);
  const row = (await caret()).top;
  for (let i = 0; i < 6; i++) {
    await press("ArrowLeft");
    if ((await caret()).top !== row) {
      await press("ArrowRight");
      return;
    }
  }
};
/** The box of the first character of a line's own text, ignoring any hanging marks. */
const firstTextBox = (text) =>
  page.evaluate((wanted) => {
    const line = [...document.querySelectorAll(".cm-line")].find((row) => row.textContent.includes(wanted));
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement.closest(".cm-hang")) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const box = range.getBoundingClientRect();
      return { left: box.left, top: box.top, height: box.height };
    }
    return null;
  }, text);
const steady = (samples, key) => Math.max(...samples.map((s) => s[key])) - Math.min(...samples.map((s) => s[key]));

try {
  await openEditing("Caret");

  await toMarks("Heading 2");
  const heading = [];
  for (let column = 0; column < 13; column++) {
    heading.push(await caret());
    await press("ArrowRight");
  }
  check("every caret position in a heading was drawn", heading.every(Boolean));
  check(
    "a heading's caret keeps one height over its marks and text",
    steady(heading, "height") === 0,
    heading.map((c) => c.height).join(),
  );
  check(
    "a heading's caret keeps one top over its marks and text",
    steady(heading, "top") === 0,
    heading.map((c) => c.top).join(),
  );
  const headingText = await firstTextBox("Heading 2");
  const afterMarks = heading[3].left + heading[3].width / 2;
  check(
    "after the marks the caret sits at the start of the text",
    Math.abs(afterMarks - headingText.left) <= 1,
    `${afterMarks} at ${headingText.left}`,
  );
  check(
    "a heading's caret is the height of its text",
    Math.abs(heading[3].height - headingText.height) <= 1.5,
    `${heading[3].height} for ${headingText.height}`,
  );

  await toLine("Before");
  const inline = [];
  for (let column = 0; column < 40; column++) {
    inline.push(await caret());
    await press("ArrowRight");
  }
  check(
    "inline code and bold do not change the caret's height",
    steady(inline, "height") === 0,
    [...new Set(inline.map((c) => c.height))].join(),
  );
  check(
    "inline code and bold do not move the caret up or down",
    steady(inline, "top") <= 0.5,
    [...new Set(inline.map((c) => c.top))].join(),
  );

  await toLine("A paragraph long");
  const rows = [await caret()];
  await press("ArrowDown");
  rows.push(await caret());
  await press("ArrowDown");
  rows.push(await caret());
  check("every row of a wrapped paragraph gets the same caret", steady(rows, "height") === 0, rows.map((c) => c.height).join());
  const gaps = [rows[1].top - rows[0].top, rows[2].top - rows[1].top];
  check(
    "a wrapped row's caret stays on its row",
    gaps.every((gap) => gap >= rows[0].height),
    gaps.join(),
  );
  check("the caret is shorter than a line of text", rows[0].height < 28, rows[0].height);

  await toLine("A paragraph long");
  await press("End");
  const rowEnd = await caret();
  check(
    "End stops on the row it was pressed in",
    Math.abs(rowEnd.top - rows[0].top) < 1 && rowEnd.left > rows[0].left + 200,
    `${rowEnd.top} ${rowEnd.left}`,
  );
  await press("ArrowRight", 2);
  const pastWrap = await caret();
  check(
    "moving past a soft wrap carries the caret to the next row",
    Math.abs(pastWrap.top - rows[1].top) < 1,
    `${pastWrap.top} vs ${rows[1].top}`,
  );

  await toMarks("A quoted line");
  const quote = [await caret()];
  for (let column = 0; column < 4; column++) {
    await press("ArrowRight");
    quote.push(await caret());
  }
  check(
    "a quote's caret keeps one height and top over its marks",
    steady(quote, "height") === 0 && steady(quote, "top") === 0,
    JSON.stringify(quote.map((c) => [c.height, c.top])),
  );

  const textTop = () =>
    page.evaluate(() => {
      const content = document.querySelector(".cm-content").getBoundingClientRect();
      return [...document.querySelectorAll(".cm-line")].map((row) => row.getBoundingClientRect().top - content.top).join();
    });
  await toLine("Last.");
  const beforeMove = await textTop();
  await press("ArrowRight");
  check("moving the caret moves no text", (await textTop()) === beforeMove);
  check(
    "the caret has no transition, so it moves at once",
    await page.$eval(
      ".cm-caret",
      (el) => getComputedStyle(el).transitionDuration === "0s" || getComputedStyle(el).transitionProperty === "none",
    ),
  );

  const nativeColours = await page.evaluate(() => ({
    line: getComputedStyle(document.querySelector(".cm-line")).caretColor,
    cell: getComputedStyle(document.querySelector(".cm-table-widget [data-row]")).caretColor,
    accent: getComputedStyle(document.querySelector(".cm-caret")).backgroundColor,
  }));
  check("WebKit's own caret is hidden in the note's text", nativeColours.line === "rgba(0, 0, 0, 0)", nativeColours.line);
  check(
    "a table cell keeps WebKit's caret, in the accent colour",
    nativeColours.cell === nativeColours.accent,
    JSON.stringify(nativeColours),
  );

  await page.keyboard.press("Shift+ArrowRight");
  await pause(40);
  check("a selection has no caret", (await caret()) === null);
  await press("ArrowRight");
  check("collapsing the selection brings it back", (await caret()) !== null);

  await page.locator('.cm-table-widget [data-row="1"][data-column="0"]').click();
  await pause(60);
  check("a focused table cell has no drawn caret", (await caret()) === null);
  await toLine("Last.");
  check("coming back to the text draws it again", (await caret()) !== null);

  await page.locator(".cm-content").evaluate((content) => content.blur());
  await pause(60);
  check("no focus, no caret", (await caret()) === null);
  await toLine("Last.");

  await press("End");
  const blinkName = () => page.evaluate(() => getComputedStyle(document.querySelector(".cm-caret-layer")).animationName);
  const firstBlink = await blinkName();
  await press("ArrowLeft");
  const secondBlink = await blinkName();
  check(
    "moving restarts the blink, so the caret shows while it moves",
    firstBlink !== secondBlink && secondBlink.startsWith("caret-blink"),
    `${firstBlink} ${secondBlink}`,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  check("Reduce Motion keeps the caret steady", (await blinkName()) === "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  /* Read after the frame's callbacks have all run, which is what that frame painted. */
  const typing = await page.evaluate(async () => {
    const left = () => document.querySelector(".cm-caret").getBoundingClientRect().left;
    const afterFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    let trailing = 0;
    for (let i = 0; i < 8; i++) {
      await afterFrame();
      const before = left();
      document.execCommand("insertText", false, "m");
      await afterFrame();
      if (left() === before) trailing++;
    }
    return { trailing };
  });
  check("the caret moves in the same frame as the typed text", typing.trailing === 0, JSON.stringify(typing));

  await page.evaluate(() => document.documentElement.style.setProperty("--text-scale", "1.3"));
  await pause(200);
  await press("ArrowLeft");
  const zoomed = await caret();
  await page.evaluate(() => document.documentElement.style.removeProperty("--text-scale"));
  await pause(200);
  await press("ArrowLeft");
  const unzoomed = await caret();
  check("the caret follows the text size", zoomed.height > unzoomed.height + 3, `${zoomed.height} over ${unzoomed.height}`);

  await page.evaluate(() => {
    document.querySelector(".cm-content").dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  const composing = await page.evaluate(() => ({
    layer: getComputedStyle(document.querySelector(".cm-caret-layer")).display,
    native: getComputedStyle(document.querySelector(".cm-line")).caretColor,
  }));
  check(
    "an input method gets WebKit's own caret",
    composing.layer === "none" && composing.native !== "rgba(0, 0, 0, 0)",
    JSON.stringify(composing),
  );
  await page.evaluate(() => {
    document.querySelector(".cm-content").dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  check(
    "composing ends with the drawn caret back",
    await page.evaluate(() => getComputedStyle(document.querySelector(".cm-caret-layer")).display !== "none"),
  );

  await openEditing("Empty");
  await page.locator(".cm-content").click();
  await pause(60);
  const empty = await caret();
  check("an empty note still has a caret", empty !== null && empty.height >= 16, JSON.stringify(empty));

  await openEditing("Bare");
  await page.locator(".cm-line").first().click();
  await press("Meta+ArrowUp");
  await press("End");
  const bare = await caret();
  const typedInto = await page.evaluate(() => {
    const hang = document.querySelector(".cm-hang");
    return hang.getBoundingClientRect().right + Number.parseFloat(getComputedStyle(hang).marginInlineEnd);
  });
  check(
    "a heading with no words waits where they will start",
    Math.abs(bare.left + bare.width / 2 - typedInto) <= 1,
    `${bare.left} at ${typedInto}`,
  );
  check("a heading with no words already has its height", bare.height >= 28, bare.height);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("the run finished", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
  await app.close();
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
