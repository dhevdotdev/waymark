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
const swipe = async (dx, dy = 0, steps = 8, settle = 320) => {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(dx / steps, dy / steps);
    await pause(16);
  }
  await pause(settle);
};
const cue = () =>
  page.evaluate(() => {
    const el = document.querySelector(".swipe-cue");
    const style = getComputedStyle(el);
    return {
      on: el.classList.contains("is-on"),
      ready: el.classList.contains("is-ready"),
      side: el.dataset.side,
      progress: Number(style.getPropertyValue("--swipe")),
      opacity: Number(style.opacity),
      clicks: style.pointerEvents,
      placed: style.position,
    };
  });
const docBox = () => page.evaluate(() => JSON.stringify(document.querySelector(".doc").getBoundingClientRect()));
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(-40);
check("a small sideways nudge does nothing", (await title()) === "Swipe two", await title());
const layoutBefore = await docBox();
await swipe(-60, 0, 6, 0);
const partway = await cue();
check(
  "the cue follows a swipe on the back edge",
  partway.on &&
    !partway.ready &&
    partway.side === "back" &&
    partway.progress > 0.2 &&
    partway.progress < 1 &&
    partway.opacity > 0,
  JSON.stringify(partway),
);
check(
  "the cue takes no clicks and moves nothing",
  partway.clicks === "none" && partway.placed === "absolute" && (await docBox()) === layoutBefore,
);
await pause(320);
const cancelled = await cue();
check(
  "stopping short cancels and the cue fades",
  !cancelled.on && cancelled.opacity === 0 && (await title()) === "Swipe two",
  JSON.stringify(cancelled),
);
await swipe(-80, 0, 6, 0);
await swipe(80, 0, 6, 0);
check(
  "reversing before the threshold withdraws the cue",
  !(await cue()).on && (await title()) === "Swipe two",
  JSON.stringify(await cue()),
);
await pause(320);
await swipe(240, 0, 16, 0);
check(
  "with nothing forward there is no cue and no step",
  !(await cue()).on && (await title()) === "Swipe two",
  JSON.stringify(await cue()),
);
await pause(320);
await swipe(60, 400);
check("mostly vertical scrolling is not a swipe", (await title()) === "Swipe two", await title());
await page.mouse.move(...(await notePoint(".table-wrap")));
await swipe(300);
await swipe(-600, 0, 8, 0);
const overTable = await cue();
await pause(320);
check("swiping over a wide table scrolls the table only", (await title()) === "Swipe two" && !overTable.on, await title());
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(-130, 0, 8, 0);
const committed = await cue();
check("crossing the threshold fills the cue", committed.on && committed.ready, JSON.stringify(committed));
await swipe(-130, 0, 8, 0);
await pause(400);
check("it goes back one step however long the momentum runs", (await title()) === "Swipe one", await title());
check("the filled cue fades once it has stepped", (await cue()).opacity === 0, JSON.stringify(await cue()));
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
    (await page.locator(".graph-view").isVisible()) &&
    !(await cue()).on,
);
await page.keyboard.press("Meta+g");
await pause(400);
await page.emulateMedia({ reducedMotion: "reduce" });
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(-50, 0, 6, 0);
const still = await page.evaluate(() => {
  const el = document.querySelector(".swipe-cue");
  return { on: el.classList.contains("is-on"), translate: getComputedStyle(el).translate };
});
await pause(400);
const settled = await cue();
check(
  "under Reduce Motion the cue appears whole without following the fingers",
  still.on && still.translate === "none" && settled.opacity === 0,
  `${JSON.stringify(still)} ${JSON.stringify(settled)}`,
);
await swipe(-260, 0, 16);
check("under Reduce Motion a swipe still steps", (await title()) === "Swipe one", await title());
await page.emulateMedia({ reducedMotion: "no-preference" });

/* Undo a delete */
const inVault = (name) => `${app.vault}/${name}`;
const moreAction = async (selector, label) => {
  await page.locator(selector).first().click({ button: "right" });
  await pause(150);
  await page.locator(".context-item", { hasText: label }).click();
  await pause(150);
  const confirm = page.locator('.prompt button:has-text("Move to Trash")');
  if (await confirm.count()) await confirm.click();
  await pause(400);
};
const undoButton = page.locator(".toast .toast-action", { hasText: "Undo" });
await writeFile(inVault("Doomed.md"), "# Doomed\n\nExact   bytes  \n");
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Doomed.md"]));
await pause(250);
await open("Doomed.md");
const tabsBefore = await page.$$eval(".tab", (t) => t.length);
await moreAction('.nav-item[data-path="Doomed.md"]', "Move to Trash");
check("the note left the vault", !existsSync(inVault("Doomed.md")));
check("the toast offers Undo", (await undoButton.count()) === 1);
await undoButton.click();
await pause(500);
check("Undo restores the exact bytes", (await readFile(inVault("Doomed.md"), "utf8")) === "# Doomed\n\nExact   bytes  \n");
check(
  "its tab is back",
  (await title()) === "Doomed" && (await page.$$eval(".tab", (t) => t.length)) === tabsBefore,
  await title(),
);
check("it says so", (await toastText()).includes("Put back"), await toastText());
await moreAction('.nav-item[data-path="Doomed.md"]', "Move to Trash");
await writeFile(inVault("Doomed.md"), "someone else\n");
await undoButton.click();
await pause(400);
check("Undo refuses to overwrite", (await readFile(inVault("Doomed.md"), "utf8")) === "someone else\n");
check("and says why", !(await toastText()).includes("Put back"), await toastText());
await rm(inVault("Doomed.md"));
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Doomed.md"]));
await pause(200);

/* Command-K */
await writeFile(inVault("Keyed.md"), "# Keyed\n\nSome words here.\n\n| A | B |\n| --- | --- |\n| one | two |\n");
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Keyed.md"]));
await pause(200);
await open("Keyed.md");
await page.keyboard.press("Meta+e");
await page.waitForSelector(".cm-content");
await pause(400);
const paletteOpen = () => page.locator(".palette").count();
const line = page.locator(".cm-line", { hasText: "Some words here" });
await line.click({ position: { x: 4, y: 8 } });
await pause(80);
await page.keyboard.press("Home");
await page.keyboard.press("Shift+End");
await pause(80);
await page.keyboard.press("Meta+k");
await pause(200);
check(
  "Command-K with text selected makes a link",
  (await line.first().textContent()).includes("Some words here.") &&
    (await page.locator(".cm-content").textContent()).includes("](url)") &&
    (await paletteOpen()) === 0,
  await line.first().textContent(),
);
await page.keyboard.press("Meta+p");
await pause(200);
check("Command-P stays the palette with text selected", (await paletteOpen()) === 1);
await page.keyboard.press("Escape");
await pause(200);
await page.locator(".cm-line").last().click();
await pause(80);
await page.keyboard.press("Meta+k");
await pause(200);
check("with nothing selected Command-K is the palette", (await paletteOpen()) === 1);
await page.keyboard.press("Escape");
await pause(200);
const cell = page.locator('.cm-table-widget td[data-row="1"][data-column="0"]');
await cell.click();
await pause(120);
await page.keyboard.press("Shift+End");
await pause(80);
await page.keyboard.press("Meta+k");
await pause(200);
check(
  "a table cell keeps the palette and its text",
  (await paletteOpen()) === 1 && (await cell.textContent()) === "one",
  await cell.textContent(),
);
await page.keyboard.press("Escape");
await pause(200);
await page.keyboard.press("Meta+e");
await pause(500);

/* The file list */
const focused = () =>
  page.evaluate(
    () => document.activeElement?.dataset.path ?? document.activeElement?.dataset.folder ?? document.activeElement?.tagName,
  );
const tabStops = () => page.locator(".sidebar .tree :is(.tree-head, .nav-item)[tabindex='0']").count();
await pause(200);
check("the file list is one Tab stop", (await tabStops()) === 1, String(await tabStops()));
await page.evaluate(() => window.waymark.reader.sidebar.tree.collapseAll());
await pause(300);
const heads = await page.$$eval(".sidebar .tree-head[data-folder]", (h) => h.map((x) => x.dataset.folder));
await page.locator(".sidebar .tree [tabindex='0']").focus();
await page.locator(`.tree-head[data-folder="${heads[0]}"]`).focus();
await page.keyboard.press("ArrowDown");
await pause(60);
check("Down moves to the next row", (await focused()) === heads[1], await focused());
await page.keyboard.press("ArrowUp");
await pause(60);
check("Up moves back", (await focused()) === heads[0], await focused());
await page.keyboard.press("ArrowRight");
await pause(300);
check(
  "Right opens a folder",
  await page.locator(`.tree-head[data-folder="${heads[0]}"]`).evaluate((h) => h.getAttribute("aria-expanded") === "true"),
);
await page.keyboard.press("ArrowRight");
await pause(60);
const child = await focused();
check("Right again enters it", child !== heads[0] && String(child).startsWith(`${heads[0]}/`), child);
await page.keyboard.press("ArrowLeft");
await pause(60);
check("Left goes to the parent", (await focused()) === heads[0], await focused());
await page.keyboard.press("ArrowLeft");
await pause(300);
check(
  "Left closes it",
  await page.locator(`.tree-head[data-folder="${heads[0]}"]`).evaluate((h) => h.getAttribute("aria-expanded") === "false"),
);
await page.keyboard.press("ArrowDown");
await pause(60);
check("closed folders are skipped", (await focused()) === heads[1], await focused());
await page.keyboard.press("End");
await pause(60);
const lastRow = await focused();
check("End reaches the last row", typeof lastRow === "string" && lastRow.endsWith(".md"), lastRow);
await page.keyboard.press("Enter");
await pause(450);
check(
  "Enter opens the note",
  (await page.evaluate(() => window.waymark.reader.notePath)) === lastRow,
  await page.evaluate(() => window.waymark.reader.notePath),
);
check("still one Tab stop after moving around", (await tabStops()) === 1, String(await tabStops()));
const ring = await page.evaluate((path) => {
  const row = document.querySelector(`.nav-item[data-path="${CSS.escape(path)}"]`);
  row.focus();
  const style = getComputedStyle(row);
  return style.outlineOffset;
}, lastRow);
check("the focus ring is drawn inside the row", ring === "-2px", ring);
await page.locator(`.nav-item[data-path="${lastRow}"]`).click({ button: "right" });
await pause(150);
await page.locator(".context-item", { hasText: "Rename" }).click();
await pause(200);
const nameBox = page.locator(".tree-name-input");
await page.keyboard.press("ArrowLeft");
await page.keyboard.type("z");
await pause(100);
check(
  "inline rename keeps its keys",
  (await nameBox.inputValue()).startsWith("z") && (await nameBox.inputValue()).length > 1,
  await nameBox.inputValue(),
);
await page.keyboard.press("Escape");
await pause(200);

check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));
await browser.close();
await app.close();
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
