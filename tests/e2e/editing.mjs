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
const BLOCKS = `# Blocks

Inline $a^2+b^2$ math here.

A price of $5 stays.

And \`$code$\` stays.

\`\`\`java
class A { int x = 1; String s = "two"; }
\`\`\`

\`\`\`mermaid
graph TD; A-->B;
\`\`\`

Between them.

$$
\\int_0^1 x\\,dx
$$

After blocks.
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
await writeFile(file("Blocks.md"), BLOCKS);
await writeFile(
  file("Anchored.md"),
  `# Anchored\n\n${Array.from({ length: 60 }, (_, i) => `Paragraph number ${i} has enough words in it to fill out a line of the column for the test.\n\n${i % 7 === 0 ? `## Section ${i}\n\n` : ""}`).join("")}`,
);
await writeFile(
  file("Long para.md"),
  "- The idea here is to build apps that would help boost my identity in particular. i show myself as a java developer but i have been doing whatever i feel like so it is not really ideal because of the projects i keep making\n",
);
await writeFile(
  file("Long code.md"),
  `# Long\n\n\`\`\`java\nclass Long {\n${Array.from({ length: 500 }, (_, i) => `  int field${i} = ${i};`).join("\n")}\n}\n\`\`\`\n\nEnd of long.\n`,
);
await writeFile(file("Broken blocks.md"), "```mermaid\nthis is not -> a diagram ((\n```\n\n$$\n\\frac{\n$$\n\nStill works\n");
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
/* Only the editor's own lines: KaTeX keeps the TeX in hidden MathML inside a drawn block. */
const editText = () => page.$$eval(".cm-line", (lines) => lines.map((l) => l.textContent).join("\n"));
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
  check("the status bar counts words", /Ln \d+, Col \d+ · [\d,]+ words/.test(await page.textContent(".status-stats")));
  const headingMark = page.locator(".cm-line", { hasText: "Third heading" }).locator(".cm-hang");
  const markOpacity = () => headingMark.evaluate((mark) => getComputedStyle(mark).opacity);
  const headingLeft = () =>
    page.locator(".cm-line", { hasText: "Third heading" }).evaluate((line) => {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent.includes("Third")) node = walker.nextNode();
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      return range.getBoundingClientRect().left;
    });
  check("heading marks are hidden off the line", (await markOpacity()) === "0", await markOpacity());
  const headingAway = await headingLeft();
  await page.locator(".cm-line", { hasText: "Third heading" }).click();
  await pause(120);
  check("heading marks show on the line", (await markOpacity()) === "1", await markOpacity());
  check(
    "showing them does not move the heading",
    Math.abs((await headingLeft()) - headingAway) < 0.5,
    `${headingAway} ${await headingLeft()}`,
  );
  await page.locator(".cm-line", { hasText: "Last line." }).click();
  await pause(120);
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
  check("selecting by keyboard stays out of the way", (await page.locator(".edit-bubble-btn").count()) === 0);
  await page.keyboard.press("ArrowRight");
  const lastLine = await page.locator(".cm-line", { hasText: "Last line." }).boundingBox();
  await page.mouse.move(lastLine.x + 1, lastLine.y + lastLine.height / 2);
  await page.mouse.down();
  await page.mouse.move(lastLine.x + 300, lastLine.y + lastLine.height / 2, { steps: 6 });
  await pause(60);
  check("the toolbar waits for a mouse selection to finish", (await page.locator(".edit-bubble-btn").count()) === 0);
  await page.mouse.up();
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
  check("there is one outline, not an inspector tab as well", (await page.locator('[data-rail="outline"]').count()) === 0);
  check("the inspector opens on Links", await page.locator('[data-rail="links"].is-on').isVisible());
  check("the outline shows with the inspector open", await page.locator(".floating-outline").isVisible());
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
  check("the outline stays when the inspector opens", await outline.isVisible());

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

  await cell(1, 0).click();
  await pause(50);
  await page.evaluate(() => document.activeElement.blur());
  await pause(100);
  await cell(1, 2).focus();
  await pause(100);
  await page.keyboard.type("!");
  await saved();
  await pause(150);
  check("a cell reached without clicking keeps its formatting", (await disk("Table.md")).includes("| **bold**! |"));
  await page.keyboard.press("Backspace");
  await saved();
  await pause(150);

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
  const gripMenu = async (kind, item) => {
    await page.locator(`.cm-table-grip.is-${kind}`).click();
    await pause(120);
    await page.locator(`.context-item:has-text("${item}")`).click();
  };
  await gripMenu("column", "Insert column right");
  await pause(600);
  check("a column can be added", (await page.locator(".cm-table-widget th").count()) === 4);
  check("the delimiter row grows too", (await disk("Table.md")).includes("|:------| --- |"));
  check("focus follows into the new column", (await activeCell()) === "3,1");
  await gripMenu("column", "Delete column");
  await pause(600);
  check("a column can be deleted, leaving the file as it was", (await disk("Table.md")) === beforeColumn);
  await cell(3, 0).click();
  await gripMenu("row", "Delete row");
  await pause(600);
  check(
    "a row can be deleted",
    (await page.locator(".cm-table-widget tr").count()) === 3 && !(await disk("Table.md")).includes("| new |"),
  );
  await cell(2, 1).click();
  const columnWidths = () =>
    page.locator(".cm-table-widget th").evaluateAll((heads) => heads.map((h) => Math.round(h.getBoundingClientRect().width)));
  const widthsBefore = await columnWidths();
  await page.keyboard.press("End");
  await page.keyboard.type(" and one more word with spaces in it");
  await saved();
  await pause(150);
  check("spaces survive typing in a cell", (await disk("Table.md")).includes("and one more word with spaces in it"));
  check("columns hold still while typing", (await columnWidths()).join() === widthsBefore.join(), (await columnWidths()).join());
  await gripMenu("column", "Align center");
  await saved();
  await pause(150);
  check(
    "a column can be aligned from its handle",
    (await disk("Table.md")).includes("| :---: |"),
    (await disk("Table.md")).split("\n")[3],
  );
  await cell(1, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  check("the right arrow at a cell's end moves to the next cell", (await activeCell()) === "1,1");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  check("the left arrow at a cell's start moves back", (await activeCell()) === "1,0");
  const rowsBefore = await page.locator(".cm-table-widget tr").count();
  await page.locator(".cm-table-add.is-row").click();
  await pause(500);
  check("the bar under a table adds a row", (await page.locator(".cm-table-widget tr").count()) === rowsBefore + 1);
  await gripMenu("row", "Delete row");
  await pause(500);
  const lined = await page.evaluate(() => {
    const textLeft = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    };
    return (
      textLeft(document.querySelector(".cm-table-widget th")) -
      textLeft([...document.querySelectorAll(".cm-line")].find((l) => l.textContent.includes("After.")))
    );
  });
  check("a table's text lines up with the paragraphs", Math.abs(lined) <= 1, String(lined));
  await cell(1, 0).click();
  await gripMenu("row", "Edit as Markdown");
  await pause(250);
  check("a table can be edited as text", (await content()).includes("|:------|"));
  await page.locator(".cm-line", { hasText: "After." }).click();
  await pause(250);
  check("it goes back to a table when you leave it", (await page.locator(".cm-table-widget table").count()) === 1);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await pause(300);
  check("reading shows the edited table", (await page.locator(".doc table").first().textContent()).includes("Adax"));

  await openNote("Tasks");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(200);
  await page.keyboard.press("Meta+f");
  await pause(200);
  await page.keyboard.type("third");
  await pause(100);
  const matches = () => page.locator(".cm-searchMatch").count();
  check("find in Edit marks what is typed", (await matches()) === 1, String(await matches()));
  for (let i = 0; i < 4; i++) await page.keyboard.down("Backspace");
  await pause(80);
  check("find follows a held Backspace", (await matches()) > 1, String(await matches()));
  await page.keyboard.down("Backspace");
  await pause(80);
  check("clearing the field with Backspace held clears every match", (await matches()) === 0, String(await matches()));
  await page.keyboard.up("Backspace");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+e");
  await pause(200);

  await openNote("Tasks");
  await page.waitForFunction(() => window.waymark.sound.keys.load("tactile"));
  await page.evaluate(() => {
    window.typed = [];
    window.waymark.sound.keys.onStrike = (sound) => window.typed.push(sound);
  });
  const sounds = () => page.evaluate(() => window.typed.splice(0));
  await page.keyboard.type("x");
  check("typing while reading is silent", (await sounds()).length === 0);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(200);
  await sounds();
  await page.keyboard.type("a b");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  check(
    "each key plays its press and its release",
    (await sounds()).join() ===
      "key-down,key-up,space-down,space-up,key-down,key-up,enter-down,enter-up,backspace-down,backspace-up",
  );
  await page.keyboard.down("z");
  await page.keyboard.down("z");
  await page.keyboard.down("z");
  await page.keyboard.up("z");
  check("a held key sounds once", (await sounds()).join() === "key-down,key-up");
  const offlineRender = await page.evaluate(async () => {
    const { KeySounds } = await import(/* @vite-ignore */ `${location.origin}/src/ui/key-sounds.ts`);
    const render = async (profile, volume, code) => {
      const ctx = new OfflineAudioContext(2, 44100 * 0.4, 44100);
      const keys = new KeySounds(() => ctx);
      await keys.load(profile);
      keys.use(profile, volume);
      keys.press(code);
      keys.release(code);
      const out = await ctx.startRendering();
      const [left, right] = [out.getChannelData(0), out.getChannelData(1)];
      const energy = (channel) => channel.reduce((sum, value) => sum + value * value, 0);
      let sounding = left.length - 1;
      while (sounding > 0 && Math.abs(left[sounding]) < 0.001) sounding--;
      let crossings = 0;
      for (let i = 1; i <= sounding; i++) if (left[i] > 0 !== left[i - 1] > 0) crossings++;
      return {
        peak: Math.max(...left.map(Math.abs), ...right.map(Math.abs)),
        left: energy(left),
        right: energy(right),
        pitch: crossings / sounding,
        last: sounding / 44100,
      };
    };
    const mean = async (profile) => {
      let total = 0;
      for (let i = 0; i < 24; i++) total += (await render(profile, "medium", "KeyG")).pitch;
      return total / 24;
    };
    return {
      leftKey: await render("tactile", "medium", "KeyQ"),
      rightKey: await render("tactile", "medium", "KeyP"),
      soft: await render("tactile", "soft", "KeyG"),
      loud: await render("tactile", "loud", "KeyG"),
      loudest: await render("clicky", "loud", "Backspace"),
      linearPitch: await mean("linear"),
      clickyPitch: await mean("clicky"),
    };
  });
  const { leftKey, rightKey, soft, loud, loudest, linearPitch, clickyPitch } = offlineRender;
  check("the recording plays clearly and does not clip", loud.peak > 0.3 && loudest.peak <= 1, `${loud.peak} ${loudest.peak}`);
  check("a key on the left sounds from the left", leftKey.left > leftKey.right * 1.5, JSON.stringify(leftKey));
  check("a key on the right sounds from the right", rightKey.right > rightKey.left * 1.5, JSON.stringify(rightKey));
  check("loud is louder than soft", loud.peak > soft.peak * 1.8, `${soft.peak} ${loud.peak}`);
  check("the sound ends quickly", loud.last < 0.2, String(loud.last));
  check("clicky is brighter than linear", clickyPitch > linearPitch, `${linearPitch} ${clickyPitch}`);
  await page.evaluate(() => {
    window.waymark.sound.muted = true;
  });
  await page.keyboard.type("q");
  check("muting sounds silences typing", (await sounds()).length === 0);
  await page.evaluate(() => {
    window.waymark.sound.muted = false;
  });
  await page.click('[data-act="settings"]');
  await pause(250);
  await page.click('[data-keysound="clicky"]');
  await pause(300);
  const previewed = await sounds();
  check("picking a switch plays a few keys", previewed.length >= 10, String(previewed.length));
  check("the volume stays available", !(await page.locator(".key-volume").evaluate((row) => row.classList.contains("is-off"))));
  const volumeTop = () => page.locator(".key-volume").evaluate((row) => row.getBoundingClientRect().top);
  const beforeOff = await volumeTop();
  await page.click('[data-keysound="off"]');
  await pause(200);
  check(
    "turning sounds off disables the volume",
    await page.locator(".key-volume").evaluate((row) => row.classList.contains("is-off")),
  );
  check("and moves nothing", (await volumeTop()) === beforeOff);
  await sounds();
  await page.keyboard.press("Escape");
  await pause(200);
  await page.locator(".cm-content").click();
  await page.keyboard.type("w");
  check("off means silent", (await sounds()).length === 0);
  await page.click('[data-act="settings"]');
  await pause(250);
  await page.click('[data-keysound="tactile"]');
  await page.keyboard.press("Escape");
  await pause(200);
  await page.keyboard.press("Meta+e");
  await pause(200);

  await openNote("Long para");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(200);
  const wrapStyle = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).textWrapStyle);
  check("lines above the cursor stay put while typing", (await wrapStyle(".cm-line")) === "stable", await wrapStyle(".cm-line"));
  check("the title does too", (await wrapStyle(".doc-title")) === "stable", await wrapStyle(".doc-title"));
  await page.locator(".cm-line", { hasText: "The idea" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  await pause(100);
  await page.locator(".cm-line", { hasText: "The idea" }).click({ clickCount: 2 });
  await pause(250);
  const bubbleAlpha = await page.locator(".edit-bubble").evaluate((bubble) => {
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    canvas.fillStyle = getComputedStyle(bubble).backgroundColor;
    canvas.fillRect(0, 0, 1, 1);
    return canvas.getImageData(0, 0, 1, 1).data[3];
  });
  check("the selection toolbar has a solid background", bubbleAlpha === 255, String(bubbleAlpha));
  await page.keyboard.press("ArrowRight");
  await saved();
  await page.keyboard.press("Meta+e");
  await pause(200);

  await openNote("Anchored");
  const topText = () =>
    page.evaluate(() => {
      let scroller = document.querySelector(".doc");
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 10) scroller = scroller.parentElement;
      const box = scroller.getBoundingClientRect();
      const blocks = [...document.querySelectorAll(".doc p, .doc h2, .cm-line")].filter((b) =>
        /(?:Paragraph number|Section) \d+/.test(b.textContent),
      );
      const first = blocks.find((b) => b.getBoundingClientRect().top >= box.top);
      return {
        text: first.textContent.match(/(?:Paragraph number|Section) \d+/)[0],
        y: Math.round(first.getBoundingClientRect().top),
      };
    });
  await page.evaluate(() => {
    let node = document.querySelector(".doc");
    while (node && node.scrollHeight <= node.clientHeight + 10) node = node.parentElement;
    node.scrollTop = 2400;
  });
  await pause(150);
  const beforeEdit = await topText();
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(300);
  const inEdit = await topText();
  check("switching to Edit keeps the same text in view", beforeEdit.text === inEdit.text, `${beforeEdit.text} ${inEdit.text}`);
  check("in the same place on screen", Math.abs(beforeEdit.y - inEdit.y) <= 12, `${beforeEdit.y} ${inEdit.y}`);
  const statusText = () => page.textContent(".edit-state");
  await page.keyboard.type("a");
  await pause(40);
  check("a fast save never flashes Saving", (await statusText()).startsWith("Saved"), await statusText());
  await saved();
  await page.keyboard.press("Backspace");
  await saved();
  const editTop = await topText();
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await pause(300);
  const inRead = await topText();
  check("switching back keeps the same text in view", editTop.text === inRead.text, `${editTop.text} ${inRead.text}`);

  await openNote("Broken blocks");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-preview-block .diagram.is-error", { timeout: 15000 });
  await pause(200);
  check(
    "a broken diagram says so and keeps its source visible",
    await page.locator(".cm-preview-block .diagram-source").isVisible(),
  );
  check("starting at the top leaves a diagram there drawn", !(await editText()).includes("```mermaid"));
  check("broken math does not stop the editor", (await page.locator(".cm-math-block").count()) === 1);
  await page.locator(".cm-line", { hasText: "Still works" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await saved();
  await pause(150);
  check("typing still works beside them", (await disk("Broken blocks.md")).includes("Still works!"));

  await openNote("Long code");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-code-token");
  await pause(200);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await pause(400);
  check(
    "the end of a long code block is coloured too",
    await page.locator(".cm-line", { hasText: "field499" }).locator(".cm-code-token").first().isVisible(),
  );
  await page.locator(".cm-line", { hasText: "field499" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await pause(300);
  check(
    "a line typed in a long block keeps its colours",
    await page.locator(".cm-line", { hasText: "field499" }).locator(".cm-code-token").first().isVisible(),
  );
  await saved();

  await openNote("Blocks");
  const readColours = await page.$$eval(".code .shiki span[style]", (spans) =>
    [...new Set(spans.map((s) => getComputedStyle(s).color))].sort(),
  );
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await page.waitForSelector(".cm-preview-block svg", { timeout: 15000 });
  await pause(300);
  const line2 = (text) => page.locator(".cm-line", { hasText: text });
  const editColours = await page.$$eval(".cm-code-token", (spans) =>
    [...new Set(spans.map((s) => getComputedStyle(s).color))].sort(),
  );
  check("code has colours in Edit", editColours.length >= 3, editColours.join(" "));
  check(
    "they are the colours Read uses",
    editColours.every((c) => readColours.includes(c)),
    `${editColours} / ${readColours}`,
  );
  check("a diagram is drawn", await page.locator(".cm-preview-block .diagram-svg > svg").isVisible());
  check("display math is drawn", await page.locator(".cm-math-block .katex-html").isVisible());
  check("inline math is drawn", await page.locator(".cm-math-inline .katex-html").isVisible());
  check("the sources stay out of sight", !(await editText()).includes("graph TD") && !(await editText()).includes("int_0"));
  check("a lone dollar and code are not math", (await editText()).includes("$5") && (await editText()).includes("$code$"));
  check("drawing changes nothing on disk", (await disk("Blocks.md")) === BLOCKS);

  await line2("Inline").click({ position: { x: 4, y: 10 } });
  await pause(200);
  check("math stays drawn while the cursor is elsewhere on its line", !(await editText()).includes("$a^2+b^2$"));
  await page.locator(".cm-math-inline").first().click();
  await pause(200);
  check("math shows its source when the cursor reaches it", (await editText()).includes("$a^2+b^2$"));
  await line2("After blocks").click();
  await pause(200);
  check("and is drawn again after leaving it", !(await editText()).includes("$a^2+b^2$"));

  await page.locator(".cm-preview-block .diagram").click();
  await pause(250);
  check("clicking a diagram shows its source", (await editText()).includes("graph TD"));
  await line2("After blocks").click();
  await pause(300);
  check("leaving it draws it again without a new render", await page.locator(".cm-preview-block .diagram-svg > svg").isVisible());

  await page.locator(".cm-math-block").click();
  await pause(250);
  check("clicking math shows its source", (await editText()).includes("int_0"));
  await page.keyboard.type("+1");
  await saved();
  await pause(150);
  check("math can be edited as text", (await disk("Blocks.md")).includes("+1") && (await disk("Blocks.md")).includes("$$"));
  await line2("Between them").click();
  await pause(200);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await pause(250);
  check("the arrow keys walk into a block", (await editText()).includes("int_0"));

  await line2("After blocks").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```python\nx = 'text'\n```\n");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".cm-line")].some((l) => l.textContent.includes("x =") && l.querySelector(".cm-code-token")),
    null,
    { timeout: 5000 },
  );
  check("a new code block gets colours for its language", true);
  const firstToken = () => page.locator(".cm-code-token").first().getAttribute("style");
  const tokenBefore = await firstToken();
  await page.click('[data-act="settings"]');
  await pause(250);
  await page.click('[data-family="rose-pine"]');
  await pause(700);
  check("switching theme recolours code while editing", (await firstToken()) !== tokenBefore, await firstToken());
  check("switching theme leaves the editor open", await page.locator(".cm-content").isVisible());
  await page.click('[data-family="catppuccin"]');
  await page.keyboard.press("Escape");
  await pause(500);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await pause(300);
  check("reading still draws the same note", (await page.locator(".doc .diagram-svg > svg").count()) === 1);
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
