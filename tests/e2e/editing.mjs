// Editing notes in WebKit against files on disk: tasks, live preview, conflicts, the outline and the new-tab page.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const TASKS = `---
title: Tasks
---

Intro %%a comment
over two lines%% more.

- [ ] alpha
- [x] beta
  - [ ] nested

> - [ ] quoted

## Second heading

Some **bold** text and a [[Welcome]] link.

## Third heading

\`\`\`js
const code = "- [ ] not a task";
\`\`\`

- [ ] after code

Last line.
`;
const TABLE = `# Table

| Name  |   Age | Note |
|:------|------:|---|
| Ada   |    36 | **bold** |
| Grace | 85 | with \\| pipe |

> | q | w |
> |---|---|
> | 1 | 2 |

After.
`;
const CRLF = "# Windows\r\n\r\nfirst line\r\nsecond line\r\n";

/* CodeMirror binds undo to the platform's own modifier, and CI runs on Linux. */
const EDITOR_UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";

const app = await serveFixture();
const file = (name) => path.join(app.vault, name);
const disk = (name) => readFile(file(name), "utf8");
await writeFile(file("Tasks.md"), TASKS);
await writeFile(file("Conflict.md"), "# Conflict\n\nbase text\n");
await writeFile(file("Both.md"), "# Both\n\nbase text\n");
await writeFile(file("Crlf.md"), CRLF);
await writeFile(file("Table.md"), TABLE);
await writeFile(file("Mixed.md"), "one\r\ntwo\nthree\r\n");
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const pause = (ms) => page.waitForTimeout(ms);
const openNote = async (name) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(500);
};
const box = (n) => page.locator("button.task-box").nth(n);
const saved = () =>
  page.waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "saved", null, { timeout: 5000 });
const externalChange = (name) => page.evaluate((n) => window.waymark.reader.onVaultChanged([n]), name);
const stateIs = (s) => page.evaluate((v) => document.querySelector(".edit-state").dataset.state === v, s);

try {
  await openNote("Tasks");
  const taskGeometry = await page.$$eval(".doc li.task", (items) =>
    items.slice(0, 2).map((item) => {
      const box = item.querySelector(".task-box");
      const text = document.createRange();
      text.selectNodeContents(box.nextSibling);
      const boxRect = box.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      return Math.abs(boxRect.top + boxRect.height / 2 - (textRect.top + textRect.height / 2));
    }),
  );
  check(
    "open and done boxes both sit level with their text",
    taskGeometry.every((gap) => gap <= 2),
    taskGeometry.join(),
  );
  check("an open box has no fill", await box(0).evaluate((b) => getComputedStyle(b).backgroundColor === "rgba(0, 0, 0, 0)"));
  await box(0).click();
  await pause(250);
  check("clicking a task writes that line", (await disk("Tasks.md")) === TASKS.replace("- [ ] alpha", "- [x] alpha"));
  check("the box shows the new state", (await box(0).getAttribute("aria-checked")) === "true");
  await box(1).click();
  await pause(250);
  check("a done task can be reopened", (await disk("Tasks.md")).includes("- [ ] beta"));
  await box(2).click();
  await box(3).focus();
  await page.keyboard.press("Space");
  await pause(300);
  const afterMany = await disk("Tasks.md");
  check("nested tasks land on their own line", afterMany.includes("  - [x] nested"));
  check("quoted tasks work from the keyboard", afterMany.includes("> - [x] quoted"));
  check("a task inside code is left alone", afterMany.includes('"- [ ] not a task"'));
  await page.mouse.click(5, 5);
  await page.keyboard.press("Meta+z");
  await pause(300);
  check("undo reverses the last task", (await disk("Tasks.md")).includes("> - [ ] quoted"));

  await box(0).click();
  await pause(250);
  const afterClick = await disk("Tasks.md");
  await writeFile(file("Tasks.md"), afterClick.replace("Intro", "New line\n\nIntro"));
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Tasks.md"]));
  await pause(300);
  await page.mouse.click(5, 5);
  await page.keyboard.press("Meta+z");
  await pause(300);
  check(
    "undo never flips a task after the note has moved on",
    (await disk("Tasks.md")) === afterClick.replace("Intro", "New line\n\nIntro"),
  );
  await writeFile(file("Tasks.md"), afterClick);
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Tasks.md"]));
  await pause(300);

  const beforeOutside = await disk("Tasks.md");
  const outside = beforeOutside.replace("Last line.", "Changed elsewhere.");
  await writeFile(file("Tasks.md"), outside);
  await box(0).click();
  await pause(400);
  check("a task click never overwrites a change made elsewhere", (await disk("Tasks.md")) === outside);
  check("the note then shows the latest text", (await page.textContent(".doc")).includes("Changed elsewhere."));

  await writeFile(file("Tasks.md"), TASKS);
  await openNote("Tasks");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(300);
  check("the switch shows Edit", await page.locator('[data-act="mode-edit"].is-on').isVisible());
  check(
    "the save state replaces the reading time",
    !(await page.locator(".pane-meta").isVisible()) && (await page.locator(".edit-state").isVisible()),
  );
  check("the status bar counts words", /Ln \d+, Col \d+ · \d+ words/.test(await page.textContent(".status-stats")));
  check("heading marks are hidden off the line", !(await page.locator(".cm-content").textContent()).includes("## Third heading"));
  check("bold marks are hidden off the line", !(await page.locator(".cm-content").textContent()).includes("**bold**"));
  check("a task shows as a box", (await page.locator(".cm-task").count()) >= 4);
  check("the wikilink is shown as a link", (await page.locator('.cm-wikilink:has-text("Welcome")').count()) === 1);
  check("frontmatter stays visible as text", (await page.locator(".cm-frontmatter").count()) === 3);
  await page.locator(".cm-line", { hasText: "Third heading" }).click();
  await pause(150);
  check(
    "heading marks appear on the line being edited",
    (await page.locator(".cm-content").textContent()).includes("## Third heading"),
  );
  check("nothing has been written just by looking", (await disk("Tasks.md")) === TASKS);

  await page.keyboard.press("End");
  await page.keyboard.type(" extended");
  await pause(100);
  check("the state says it is saving", (await stateIs("unsaved")) || (await stateIs("saving")));
  await saved();
  await pause(150);
  check(
    "typing saves only that change",
    (await disk("Tasks.md")) === TASKS.replace("## Third heading", "## Third heading extended"),
  );

  await page.locator(".cm-task").first().click();
  await saved();
  await pause(600);
  check("a task can be clicked while editing", (await disk("Tasks.md")).includes("- [x] alpha"));
  await page.keyboard.press(EDITOR_UNDO);
  await saved();
  await pause(600);
  check("undo works in the editor", (await disk("Tasks.md")).includes("- [ ] alpha"));

  await page.locator(".cm-line", { hasText: "Last line." }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await pause(200);
  check("selecting text offers formatting", (await page.locator(".edit-bubble-btn").count()) === 6);
  await page.locator(".edit-bubble-btn.is-bold").click();
  await saved();
  await pause(600);
  check("the bubble formats the selection", (await disk("Tasks.md")).includes("**Last line.**"));
  await page.keyboard.press("Meta+f");
  await pause(200);
  check("find opens inside the editor", await page.locator(".cm-search").isVisible());
  await page.keyboard.press("Escape");

  await page.locator(".cm-line", { hasText: "Second heading" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" quick");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await pause(300);
  check("leaving straight after typing still saves", (await disk("Tasks.md")).includes("## Second heading quick"));
  check("reading shows the edit", (await page.textContent(".doc")).includes("Second heading quick"));
  check("the switch is back on Read", await page.locator('[data-act="mode-read"].is-on').isVisible());

  await page.click('[data-act="mode-edit"]');
  await page.waitForSelector(".cm-content");
  await page.locator(".cm-line", { hasText: "Second heading" }).click();
  await page.keyboard.type("Z");
  await page.keyboard.press("Meta+1");
  await pause(500);
  await page.locator(".nav-item", { hasText: "Welcome" }).first().click();
  await pause(500);
  check("moving to another note saves first", (await disk("Tasks.md")).includes("Z"));
  check("moving to another note leaves the editor", (await page.locator(".cm-editor").count()) === 0);

  await openNote("Conflict");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await writeFile(file("Conflict.md"), "# Conflict\n\nchanged on another machine\n");
  await page.locator(".cm-line", { hasText: "base text" }).click();
  await page.keyboard.type("mine ");
  await pause(800);
  check("a conflict stops the save", (await disk("Conflict.md")).includes("another machine"));
  check("a conflict explains itself", await page.locator('.edit-banner:has-text("changed outside")').isVisible());
  check("the save state says it is not saved", await stateIs("conflict"));
  await page.locator('.edit-banner button:has-text("Keep mine")').click();
  await saved();
  await pause(150);
  const kept = await disk("Conflict.md");
  check("keep mine overwrites only when asked", kept.includes("mine") && !kept.includes("another machine"));
  check("the banner goes away", !(await page.locator(".edit-banner").isVisible()));

  await openNote("Both");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await writeFile(file("Both.md"), "# Both\n\ntheirs\n");
  await page.locator(".cm-line", { hasText: "base text" }).click();
  await page.keyboard.type("mine ");
  await pause(800);
  await page.locator('.edit-banner button:has-text("Keep both")').click();
  await pause(400);
  check("keep both leaves the other version in place", (await disk("Both.md")) === "# Both\n\ntheirs\n");
  check("keep both shows the other version", (await page.locator(".cm-content").textContent()).includes("theirs"));
  const copies = (await import("node:fs")).readdirSync(app.vault).filter((f) => f.startsWith("Both (conflict"));
  check("keep both saves a copy of mine", copies.length === 1 && (await disk(copies[0])).includes("mine"), copies.join());

  await page.keyboard.press("Meta+e");
  await pause(300);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await writeFile(file("Both.md"), "# Both\n\nfrom a sync\n");
  await externalChange("Both.md");
  await pause(300);
  check(
    "with nothing unsaved the editor follows the disk",
    (await page.locator(".cm-content").textContent()).includes("from a sync"),
  );

  await openNote("Crlf");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await page.locator(".cm-line", { hasText: "first line" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await saved();
  await pause(150);
  check("Windows line endings are kept", (await disk("Crlf.md")) === CRLF.replace("first line", "first line!"));

  await openNote("Mixed");
  await page.keyboard.press("Meta+e");
  await pause(400);
  check("a file with mixed line endings is not opened for editing", (await page.locator(".cm-editor").count()) === 0);
  check("it says why", (await page.textContent("body")).includes("line endings"));

  await openNote("Tasks");
  if (await page.locator(".shell:not(.rail-closed)").count()) await page.keyboard.press("Meta+Alt+\\");
  await pause(400);
  const outline = page.locator(".floating-outline");
  check("the outline appears with the inspector closed", await outline.isVisible());
  check("one dash per heading", (await page.locator(".fo-dash").count()) === 2);
  const restingWidth = (await outline.boundingBox()).width;
  await outline.hover();
  await pause(200);
  const hovered = await outline.boundingBox();
  check(
    "hovering opens the titles",
    hovered.width > restingWidth + 40 && (await page.locator(".fo-label").first().isVisible()),
    `${restingWidth} to ${hovered.width}`,
  );
  check("the opened outline stays on screen", hovered.x >= 0 && hovered.x + hovered.width <= 1400);
  await page.locator(".fo-item").last().click();
  await pause(800);
  check(
    "clicking a title goes there",
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll(".doc h2")].pop();
      const top = heading.getBoundingClientRect().top;
      return top > 0 && top < innerHeight;
    }),
  );
  await page.mouse.move(400, 400);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  check("the outline steps aside while editing", !(await outline.isVisible()));
  await page.keyboard.press("Meta+e");
  await pause(300);
  await page.keyboard.press("Meta+Alt+\\");
  await pause(400);
  check("the outline leaves when the inspector opens", !(await outline.isVisible()));

  await page.keyboard.press("Meta+t");
  await pause(300);
  await page.keyboard.press("Escape");
  await pause(300);
  check("a new tab shows the start page", await page.locator(".start-page").isVisible());
  check("it lists recent notes", (await page.locator(".start-row").count()) >= 1);
  check("it shows task progress", /\d+\/\d+/.test(await page.locator(".start-row", { hasText: "Tasks" }).first().textContent()));
  await page.locator(".start-row", { hasText: "Tasks" }).first().click();
  await pause(500);
  check("a recent note fills the tab", (await page.textContent(".tab.is-active .tab-title")).startsWith("Tasks"));
  await openNote("Table");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-table-widget");
  await pause(300);
  const cell = (row, column) => page.locator(`.cm-table-widget [data-row="${row}"][data-column="${column}"]`);
  const activeCell = () => page.evaluate(() => `${document.activeElement.dataset.row},${document.activeElement.dataset.column}`);
  const content = () => page.locator(".cm-content").textContent();
  check("a table is shown as a table", (await page.locator(".cm-table-widget table").count()) === 1);
  check("its pipes are not on show", !(await content()).includes("|:------|"));
  check("opening a table writes nothing", (await disk("Table.md")) === TABLE);
  check("cells show formatting", (await page.locator(".cm-table-widget td strong").textContent()) === "bold");
  check("an escaped pipe reads as a pipe", (await cell(2, 2).textContent()) === "with | pipe");
  check("alignment is kept", (await cell(1, 1).evaluate((c) => c.style.textAlign)) === "right");
  check("a quoted table stays as text", (await page.locator(".cm-table-line").count()) === 3);

  await cell(1, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await saved();
  await pause(150);
  check("typing in a cell changes only that cell", (await disk("Table.md")) === TABLE.replace("| Ada   |", "| Adax   |"));
  check("the cell keeps focus while saving", (await activeCell()) === "1,0");
  await page.keyboard.press("Tab");
  check("Tab moves to the next cell", (await activeCell()) === "1,1");
  await page.keyboard.press("Tab");
  check("a focused cell shows its Markdown", (await cell(1, 2).textContent()) === "**bold**");
  check("the cell it left shows formatted text again", (await cell(1, 0).textContent()) === "Adax");
  await page.keyboard.press("Shift+Tab");
  check("Shift+Tab moves back", (await activeCell()) === "1,1");
  await page.keyboard.press("Enter");
  check("Enter moves down", (await activeCell()) === "2,1");
  await page.keyboard.press("ArrowUp");
  check("the arrows move between rows", (await activeCell()) === "1,1");

  await cell(2, 2).click();
  await page.keyboard.press("End");
  await page.keyboard.type("|z");
  await saved();
  await pause(150);
  check("a typed pipe is escaped in the file", (await disk("Table.md")).includes("with \\| pipe\\|z |"));
  await page.keyboard.press("Meta+z");
  await saved();
  await pause(150);
  check("undo works inside a cell", !(await disk("Table.md")).includes("z |"));
  await page.keyboard.press("Tab");
  await pause(250);
  check(
    "Tab on the last cell adds a row",
    (await page.locator(".cm-table-widget tr").count()) === 4 && (await activeCell()) === "3,0",
  );
  await page.keyboard.type("new");
  await saved();
  await pause(150);
  const withRow = await disk("Table.md");
  check("the new row is in the file, right under the table", /\| Grace .*\n\| new \|\s+\|\s+\|\n\n> /.test(withRow));
  const beforeColumn = withRow;
  await page.locator('.cm-table-tools button:has-text("Add column")').click();
  await pause(600);
  check("a column can be added", (await page.locator(".cm-table-widget th").count()) === 4);
  check("the delimiter row grows too", (await disk("Table.md")).includes("|:------| --- |"));
  check("focus follows into the new column", (await activeCell()) === "3,1");
  await page.locator('.cm-table-tools button:has-text("Delete column")').click();
  await pause(600);
  check("a column can be deleted, leaving the file as it was", (await disk("Table.md")) === beforeColumn);
  await cell(3, 0).click();
  await page.locator('.cm-table-tools button:has-text("Delete row")').click();
  await pause(600);
  check(
    "a row can be deleted",
    (await page.locator(".cm-table-widget tr").count()) === 3 && !(await disk("Table.md")).includes("| new |"),
  );
  await cell(1, 0).click();
  await page.locator('.cm-table-tools button:has-text("Edit as text")').click();
  await pause(250);
  check("a table can be edited as text", (await content()).includes("|:------|"));
  await page.locator(".cm-line", { hasText: "After." }).click();
  await pause(250);
  check("it goes back to a table when you leave it", (await page.locator(".cm-table-widget table").count()) === 1);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await pause(300);
  check("reading shows the edited table", (await page.locator(".doc table").first().textContent()).includes("Adax"));
  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  check("the suite finished", false, error.message.split("\n").slice(0, 3).join(" "));
}
await browser.close();
await app.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
