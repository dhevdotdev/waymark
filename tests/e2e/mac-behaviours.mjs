// What a Mac app is expected to do for free: drops, link menus, gestures, undoing a delete, and the file list's keys.
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
await writeFile(
  `${app.vault}/Links.md`,
  "# Links\n\n[Site](https://example.com/page) and [Mail](mailto:a@example.com).\n\n# Heading [Inside](https://example.com/h)\n",
);
const browser = await webkit.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1320, height: 800 } })).newPage();
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);
const toastText = () => page.locator(".toast").last().textContent();
const open = async (name) => {
  await page.evaluate((target) => window.waymark.open(target), name);
  await pause(350);
};
await page.addInitScript(() => {
  window.__copied = [];
  window.__opened = [];
  window.open = (url) => {
    window.__opened.push(url);
    return null;
  };
});
await page.goto(`${app.url}?note=Links`);
await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
await pause(400);

/* Drops */
const dropOn = (selector, type) =>
  page.evaluate(
    ([sel, kind]) => {
      const event = new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
      document.querySelector(sel).dispatchEvent(event);
      return event.defaultPrevented;
    },
    [selector, type],
  );
check("a drop on the reading area is refused", await dropOn(".doc", "drop"));
check("dragging over the reading area is refused", await dropOn(".doc", "dragover"));
check("a drop on the file list is refused", await dropOn(".sidebar", "drop"));
await page.keyboard.press("Meta+e");
await page.waitForSelector(".cm-content");
await pause(300);
const refusedInEditor = await page.evaluate(() => {
  const event = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
  let refused = false;
  Object.defineProperty(event.dataTransfer, "dropEffect", {
    set: (value) => {
      refused = value === "none";
    },
  });
  document.querySelector(".cm-content").dispatchEvent(event);
  return refused;
});
check("the editor still takes drops", !refusedInEditor);
await page.keyboard.press("Meta+e");
await pause(300);

/* Link menu */
const menuLabels = () => page.locator(".context-menu .context-item").allTextContents();
await page.locator(".doc a", { hasText: "Site" }).click({ button: "right" });
await pause(150);
check(
  "right-clicking a link offers its address",
  (await menuLabels()).join() === "Open link,Copy link address",
  (await menuLabels()).join(),
);
await page.keyboard.press("Escape");
await pause(150);
await page.locator(".doc a", { hasText: "Inside" }).click({ button: "right" });
await pause(150);
check(
  "a link in a heading is treated as a link",
  (await menuLabels()).includes("Copy link address"),
  (await menuLabels()).join(),
);
await page.keyboard.press("Escape");
await pause(150);
await page.locator(".doc h1", { hasText: "Heading" }).click({ button: "right", position: { x: 20, y: 10 } });
await pause(150);
check(
  "the heading itself keeps its own menu",
  (await menuLabels()).some((l) => l.includes("heading")),
  (await menuLabels()).join(),
);
await page.keyboard.press("Escape");
await pause(150);

/* Swipe and mouse buttons */
const WIDE = Array.from({ length: 14 }, (_, i) => `| Column number ${i + 1} `).join("");
await writeFile(`${app.vault}/Swipe one.md`, "# Swipe one\n\n[[Swipe two]]\n");
await writeFile(`${app.vault}/Swipe two.md`, `# Swipe two\n\nPlain words here.\n\n${WIDE}|\n${"| --- ".repeat(14)}|\n${WIDE}|\n`);
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Swipe one.md", "Swipe two.md"]));
await pause(200);
await open("Swipe one.md");
await page.locator(".doc a.wikilink").first().click();
await pause(400);
const title = () => page.textContent(".tab.is-active .tab-title");
check("a link was followed before swiping", (await title()) === "Swipe two", await title());
const notePoint = async (selector) => {
  const box = await page.locator(selector).first().boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};
const swipe = async (dx, dy = 0, steps = 8) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(dx / steps, dy / steps);
    await pause(16);
  }
  await pause(320);
};
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(-40);
check("a small sideways nudge does nothing", (await title()) === "Swipe two", await title());
await swipe(60, 400);
check("mostly vertical scrolling is not a swipe", (await title()) === "Swipe two", await title());
await page.mouse.move(...(await notePoint(".table-wrap")));
await swipe(300);
await swipe(-600);
check("swiping over a wide table scrolls the table only", (await title()) === "Swipe two", await title());
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(-260, 0, 16);
check("swiping right goes back, one step", (await title()) === "Swipe one", await title());
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(260, 0, 16);
check("swiping left goes forward", (await title()) === "Swipe two", await title());
const mouseButton = (button) =>
  page.evaluate(
    (b) =>
      document.querySelector(".doc").dispatchEvent(new MouseEvent("mouseup", { button: b, bubbles: true, cancelable: true })),
    button,
  );
await mouseButton(3);
await pause(350);
check("mouse button 3 goes back", (await title()) === "Swipe one", await title());
await mouseButton(4);
await pause(350);
check("mouse button 4 goes forward", (await title()) === "Swipe two", await title());
await page.keyboard.press("Meta+g");
await pause(500);
const graphBefore = await page.evaluate(() => window.waymark.reader.workspace.active.trail.size);
await page.mouse.move(600, 400);
await swipe(-260, 0, 16);
check(
  "swiping on the graph does not navigate",
  (await page.evaluate(() => window.waymark.reader.workspace.active.trail.size)) === graphBefore &&
    (await page.locator(".graph-view").isVisible()),
);
await page.keyboard.press("Meta+g");
await pause(400);

check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));
await browser.close();
await app.close();
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
