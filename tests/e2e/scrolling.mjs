// The app's own scrollbars and edges: nothing native shows, nothing bounces, and the bar appears, follows, drags and leaves.
import { writeFile } from "node:fs/promises";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const wide = Array.from({ length: 14 }, (_, i) => `| Column number ${i + 1} `).join("");
const NOTES = {
  "Long.md": `# Long\n\n${"A paragraph of plain words.\n\n".repeat(160)}`,
  "Sideways.md": `# Sideways\n\nBefore.\n\n${wide}|\n${"| --- ".repeat(14)}|\n${`${wide}|\n`.repeat(4)}\n${"After.\n\n".repeat(120)}`,
};
const app = await serveFixture();
for (const [name, text] of Object.entries(NOTES)) await writeFile(`${app.vault}/${name}`, text);
const browser = await webkit.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1320, height: 800 } })).newPage();
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);
const open = async (name) => {
  await page.evaluate((target) => window.waymark.open(target), name);
  await pause(400);
};
const bar = (axis) =>
  page.locator(`.scrollbar.is-${axis}`).evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      on: el.classList.contains("is-on"),
      near: el.classList.contains("is-near"),
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      height: box.height,
      width: box.width,
    };
  });
const scrollTop = () => page.locator(".scroller").evaluate((s) => s.scrollTop);

await page.goto(`${app.url}?note=Long`);
await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
await pause(400);
const scroller = await page.locator(".scroller").boundingBox();
const middle = [scroller.x + scroller.width / 2, scroller.y + scroller.height / 2];

const edges = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("*")].flatMap((el) => {
      const s = getComputedStyle(el);
      const bad = [];
      if (s.scrollbarWidth !== "none") bad.push(`${el.className} scrollbar`);
      if (s.overscrollBehaviorX !== "none") bad.push(`${el.className} x`);
      const scrolls = (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 1;
      if (scrolls && s.overscrollBehaviorY !== "none") bad.push(`${el.className} y`);
      return bad;
    }),
  );
check("nothing draws a native bar or bounces", (await edges()).length === 0, (await edges()).slice(0, 4).join("; "));
check(
  "the window itself cannot bounce",
  await page.evaluate(() =>
    ["html", "body"].every((t) => getComputedStyle(document.querySelector(t)).overscrollBehaviorY === "none"),
  ),
);
check("bars start out of sight", !(await bar("y")).on && !(await bar("x")).on);

const widthBefore = await page.locator(".doc").evaluate((d) => d.getBoundingClientRect().width);
await page.mouse.move(...middle);
await page.mouse.wheel(0, 700);
await pause(120);
const scrolled = await bar("y");
check("scrolling shows the bar", scrolled.on, JSON.stringify(scrolled));
check(
  "the bar sits at the scroller's edge",
  Math.abs(scrolled.right - (scroller.x + scroller.width)) < 1,
  String(scrolled.right),
);
check("the bar shows where the page is", scrolled.top > scroller.y + 2);
check(
  "the note takes no less width",
  (await page.locator(".doc").evaluate((d) => d.getBoundingClientRect().width)) === widthBefore,
);
check("a bar being only shown lets clicks through", !scrolled.near);
await pause(1200);
check("it leaves when scrolling stops", !(await bar("y")).on);

const top = await scrollTop();
await page.locator(".scroller").evaluate((s) => {
  s.scrollTop -= 100;
});
await pause(150);
check("scrolling the app does itself shows nothing", !(await bar("y")).on && (await scrollTop()) === top - 100);

const edgeX = scroller.x + scroller.width - 5;
await page.mouse.move(edgeX, middle[1]);
await pause(250);
const near = await bar("y");
check("the pointer at the edge brings it back", near.on && near.near, JSON.stringify(near));
const dragFrom = await scrollTop();
await page.mouse.move(edgeX, near.top + near.height / 2);
await page.mouse.down();
await page.mouse.move(edgeX, near.top + near.height / 2 + 90, { steps: 5 });
await pause(80);
const dragged = await scrollTop();
check("dragging it scrolls the note", dragged > dragFrom + 200, `${dragFrom} to ${dragged}`);
await page.mouse.move(middle[0], near.top + 200, { steps: 3 });
check("the drag holds when the pointer strays", (await bar("y")).on);
await page.mouse.up();
check("no text was selected by dragging", (await page.evaluate(() => getSelection().toString())) === "");
await page.mouse.move(...middle);
await pause(1200);
check("it leaves once the pointer has gone", !(await bar("y")).on);

await page.locator(".scroller").focus();
const beforeKey = await scrollTop();
await page.keyboard.press("PageDown");
await pause(120);
const afterKey = await bar("y");
check("scrolling by key shows it too", afterKey.on && (await scrollTop()) > beforeKey, `${beforeKey} to ${await scrollTop()}`);
await pause(1000);

await open("Sideways.md");
const table = await page.locator(".table-wrap").first().boundingBox();
await page.mouse.move(table.x + table.width / 2, table.y + 20);
const before = await scrollTop();
await page.mouse.wheel(0, 200);
await pause(160);
check("a wheel over a wide table still scrolls the note", (await scrollTop()) > before);
await page.locator(".scroller").evaluate((s) => {
  s.scrollTop = 0;
});
await pause(1000);
const fresh = await page.locator(".table-wrap").first().boundingBox();
await page.mouse.move(fresh.x + fresh.width / 2, fresh.y + 20);
await page.mouse.wheel(240, 0);
await pause(160);
const sideways = await bar("x");
check(
  "sideways scrolling shows a bar along the table",
  sideways.on && Math.abs(sideways.bottom - (fresh.y + fresh.height)) < 1,
  JSON.stringify(sideways),
);
check("that bar stays inside the table", sideways.left >= fresh.x && sideways.right <= fresh.x + fresh.width);
check(
  "the table moved",
  (await page
    .locator(".table-wrap")
    .first()
    .evaluate((t) => t.scrollLeft)) > 0,
);

const sidebar = await page.locator(".sidebar-resize").boundingBox();
await page.mouse.move(sidebar.x + sidebar.width / 2, 300);
await pause(150);
check(
  "the sidebar's handle keeps the pointer",
  await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y).matches(".sidebar-resize"),
    [sidebar.x + sidebar.width / 2, 300],
  ),
);

check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));
await browser.close();
await app.close();
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
