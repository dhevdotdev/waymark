// Creating, renaming, moving and deleting notes, inserting into them, and the toolbars, against files on disk.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const SOURCE = "See [[Target]], [[Target#Part|that part]] and ![[Target]].\n\nNot `[[Target]]` though.\n";
const TARGET = "## Part\n\nBack to [[Target#Part]].\n";

/* CodeMirror binds this to the platform's own modifier, and CI runs on Linux. */
const DOC_END = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

const app = await serveFixture();
const file = (name) => path.join(app.vault, name);
const disk = (name) => readFile(file(name), "utf8");
mkdirSync(file(".obsidian"));
await writeFile(
  file(".obsidian/app.json"),
  JSON.stringify({ attachmentFolderPath: "/Attachments", newFileLocation: "folder", newFileFolderPath: "/Inbox" }),
);
await writeFile(file("Source.md"), SOURCE);
await writeFile(file("Target.md"), TARGET);
await writeFile(file("Mover.md"), "moves\n");
await writeFile(file("Doomed.md"), "going\n");
await writeFile(file("Linker.md"), "[[Doomed]]\n");
await writeFile(file("Writing.md"), "# Writing\n\nFirst line here.\n");
mkdirSync(file("Trips/Later"), { recursive: true });
mkdirSync(file("Scrap"));
const PLAN = "Day: [[Trips/Day]] and [next](Day.md), home [back](../Home.md).\n";
const HOME = "[[Trips/Plan]] [[Plan]] [m](Trips/Later/Deep.md) ![[Trips/dot.png]]\n";
await writeFile(file("Trips/Plan.md"), PLAN);
await writeFile(file("Trips/Day.md"), "day\n");
await writeFile(file("Trips/Later/Deep.md"), "[up](../Plan.md)\n");
await writeFile(file("Trips/dot.png"), Buffer.from("iVBORw0KGgo=", "base64"));
await writeFile(file("Home.md"), HOME);
await writeFile(file("Scrap/One.md"), "one\n");
await writeFile(file("Scrap/Two.md"), "two\n");
await writeFile(file("Refers.md"), "[[One]] and [t](Scrap/Two.md)\n");
await writeFile(file("Rel/A/Old.md".replace("Rel/A/", "")), "old\n");
const obsidianBefore = await disk(".obsidian/app.json");
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);
const openNote = async (name) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(500);
};
const saved = () =>
  page.waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "saved", null, { timeout: 5000 });
const rightClick = async (note, item) => {
  await page.locator(`.nav-item[data-path="${note}"]`).click({ button: "right" });
  await pause(100);
  await page.locator(`.context-item:has-text("${item}")`).click();
  await pause(150);
};
const menuPick = async (typed) => {
  await page.keyboard.type(typed);
  await pause(350);
  await page.keyboard.press("Enter");
  await pause(350);
};
const line = (text) => page.locator(".cm-line", { hasText: text });

try {
  await openNote("Writing");
  check("Files and Search no longer take a row", (await page.locator(".sidebar-head").count()) === 0);
  const firstLine = await page.evaluate(() => {
    const mid = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const box = range.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    return { head: mid(document.querySelector(".crumbs")), panel: mid(document.querySelector(".rail-links > :first-child")) };
  });
  check(
    "the panel's first line sits on the pane head's row",
    Math.abs(firstLine.head - firstLine.panel) <= 1,
    JSON.stringify(firstLine),
  );
  await page.click('[data-rail="info"]');
  await pause(150);
  check("Info in the title bar switches the panel", await page.locator('[data-rail="info"].is-on').isVisible());
  const menuItems = () => page.locator(".context-menu:not(.is-leaving) .context-item").allTextContents();
  await page.locator('.nav-item[data-path="Writing.md"]').click({ button: "right" });
  await pause(150);
  const fromList = await menuItems();
  await page.keyboard.press("Escape");
  await pause(200);
  const more = page.locator('[data-act="note-menu"]');
  await more.click();
  await pause(150);
  const menuBox = await page.locator(".context-menu:not(.is-leaving)").boundingBox();
  const moreBox = await more.boundingBox();
  check(
    "the title bar's … offers the file list's actions for the note",
    JSON.stringify(await menuItems()) === JSON.stringify(fromList),
    (await menuItems()).join(", "),
  );
  check(
    "it opens under its button, aligned to its end",
    menuBox.y >= moreBox.y + moreBox.height && Math.abs(menuBox.x + menuBox.width - (moreBox.x + moreBox.width)) <= 1,
  );
  check("the button says its menu is open", (await more.getAttribute("aria-expanded")) === "true");
  await more.click();
  await pause(200);
  check(
    "a second click on … closes its menu",
    (await page.locator(".context-menu:not(.is-leaving)").count()) === 0 &&
      (await more.getAttribute("aria-expanded")) === "false",
  );
  await more.click();
  await pause(150);
  await page.keyboard.press("Escape");
  await pause(200);
  check("and closed", (await more.getAttribute("aria-expanded")) === "false");
  await more.focus();
  await page.keyboard.press("Enter");
  await pause(150);
  check(
    "from the keyboard the first item takes focus",
    await page.evaluate(() => document.activeElement?.matches(".context-menu .context-item:first-child")),
  );
  await page.keyboard.press("Escape");
  await pause(200);
  check("Escape gives focus back to …", await page.evaluate(() => document.activeElement?.dataset.act === "note-menu"));
  await page.click('[data-side="search"]');
  await pause(200);
  check("the file tools' search opens Search", await page.locator(".sidebar-search").isVisible());
  await page.click('[data-act="search-clear"]');
  await pause(200);
  check("the X on an empty field returns to Files", await page.locator(".sidebar-inner").isVisible());
  check(
    "the reading status bar counts words",
    /^\d+ words$/.test(await page.textContent(".status-stats")),
    await page.textContent(".status-stats"),
  );
  await page.locator(".doc p").first().selectText();
  await pause(150);
  check(
    "selecting text counts the selection",
    /^3 of \d+ words$/.test(await page.textContent(".status-stats")),
    await page.textContent(".status-stats"),
  );
  await page.mouse.click(700, 700);
  const scheme = () => page.evaluate(() => document.documentElement.dataset.scheme);
  const before = await scheme();
  await page.click('[data-act="appearance"]');
  await pause(200);
  check("one click flips light and dark", (await scheme()) !== before);
  await page.click('[data-act="appearance"]');

  await page.keyboard.press("Meta+n");
  await page.waitForSelector(".cm-content");
  await pause(300);
  check("a new note goes where Obsidian is set to put them", existsSync(file("Inbox/Untitled.md")));
  check("the title is ready to type", await page.evaluate(() => document.activeElement.classList.contains("doc-title")));
  await page.keyboard.type("My idea");
  await page.keyboard.press("Enter");
  await pause(500);
  check("naming it renames the file", existsSync(file("Inbox/My idea.md")) && !existsSync(file("Inbox/Untitled.md")));
  check("Enter moves on to the body", await page.evaluate(() => document.activeElement.classList.contains("cm-content")));
  check(
    "the tab shows the new name",
    (await page.textContent(".tab.is-active .tab-title, .single-tab .tab-title")).includes("My idea"),
  );
  await page.keyboard.type("Body text.");
  await saved();
  await pause(150);
  check("saving follows the renamed file", (await disk("Inbox/My idea.md")) === "Body text.");

  await page.keyboard.press("Meta+n");
  await page.waitForSelector(".cm-content");
  await pause(300);
  await page.keyboard.type("My idea");
  await page.keyboard.press("Enter");
  await pause(400);
  check(
    "a name already in use is refused",
    existsSync(file("Inbox/Untitled.md")) && (await disk("Inbox/My idea.md")) === "Body text.",
  );
  check("the title goes back", (await page.textContent(".doc-title")) === "Untitled");
  await page.keyboard.press("Meta+e");
  await pause(300);

  await openNote("Target");
  await rightClick("Target.md", "Rename");
  await page.keyboard.type("Bad/name");
  await page.keyboard.press("Enter");
  await pause(150);
  check(
    "a bad name is explained and nothing happens",
    (await page.locator(".tree-name-input.is-problem").isVisible()) && existsSync(file("Target.md")),
  );
  await page.fill(".tree-name-input", "Renamed");
  await page.keyboard.press("Enter");
  await pause(600);
  check("renaming moves the file", existsSync(file("Renamed.md")) && !existsSync(file("Target.md")));
  check(
    "links in other notes follow, and code does not",
    (await disk("Source.md")) === "See [[Renamed]], [[Renamed#Part|that part]] and ![[Renamed]].\n\nNot `[[Target]]` though.\n",
    await disk("Source.md"),
  );
  check("links in the note itself follow", (await disk("Renamed.md")) === "## Part\n\nBack to [[Renamed#Part]].\n");
  check("the open tab follows", (await page.textContent(".doc-title")).includes("Renamed"));

  await rightClick("Mover.md", "Move to…");
  await menuPick("Archive/Deep");
  check("a note can move to a new folder", existsSync(file("Archive/Deep/Mover.md")) && !existsSync(file("Mover.md")));
  await page.click('.tree-head[data-folder="Archive"]');
  await page.click('.tree-head[data-folder="Archive/Deep"]');
  await pause(350);
  await rightClick("Archive/Deep/Mover.md", "Move to…");
  await menuPick("Vault root");
  check("and back to the root", existsSync(file("Mover.md")));

  await rightClick("Doomed.md", "Move to Trash");
  await page.keyboard.press("Escape");
  await pause(200);
  check("cancelling keeps the note", existsSync(file("Doomed.md")));
  await openNote("Doomed");
  await rightClick("Doomed.md", "Move to Trash");
  await page.locator('.prompt button:has-text("Move to Trash")').click();
  await pause(500);
  check("deleting removes the note", !existsSync(file("Doomed.md")));
  check("its tab goes to the start page", await page.locator(".start-page").isVisible());

  await openNote("Writing");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(200);
  await line("First line here.").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await pause(300);
  check("typing / opens the insert menu", await page.locator(".cm-tooltip-autocomplete").isVisible());
  const offered = await page.locator(".cm-tooltip-autocomplete li .cm-completionLabel").allTextContents();
  check(
    "it offers tables",
    offered.some((o) => o.startsWith("Table")),
    offered.slice(0, 4).join(),
  );
  await page.keyboard.type("table");
  await pause(300);
  await page.keyboard.press("Enter");
  await pause(400);
  check("choosing Table makes a table", (await page.locator(".cm-table-widget table").count()) === 1);
  check(
    "the header is ready to type",
    await page.evaluate(() => document.activeElement.dataset.row === "0" && document.activeElement.dataset.column === "0"),
  );
  await page.keyboard.type("Name");
  await saved();
  await pause(150);
  const withTable = await disk("Writing.md");
  check(
    "the typing goes into an empty header",
    withTable.includes("| Name |  |  |\n| --- | --- | --- |"),
    withTable.slice(0, 120),
  );
  check("the slash is gone", !withTable.includes("/table"));
  check("the table has a blank line before it, so it counts as a table", /here\.\n\n\| Name/.test(withTable));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await pause(200);

  const addLine = async () => {
    await page.keyboard.press(DOC_END);
    await page.keyboard.press("Enter");
  };
  await addLine();
  await page.keyboard.type("/check");
  await pause(300);
  check(
    "menu items can be found by other words",
    (await page.locator(".cm-tooltip-autocomplete li .cm-completionLabel").allTextContents()).some((o) => o.startsWith("Task")),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("todo");
  await saved();
  await page.keyboard.press("Home");
  await page.keyboard.type("/");
  await pause(300);
  check(
    "blocks that need a whole line are not offered above existing text",
    !(await page.locator(".cm-tooltip-autocomplete li .cm-completionLabel").allTextContents()).some((o) =>
      o.startsWith("Code block"),
    ),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("End");
  await saved();
  await pause(150);
  check("Task inserts a task", (await disk("Writing.md")).includes("- [ ] todo"));
  await addLine();
  await page.keyboard.press("Enter");
  await pause(100);
  await page.keyboard.type("words /");
  await pause(300);
  const midLine = await page.locator(".cm-tooltip-autocomplete li .cm-completionLabel").allTextContents();
  check(
    "mid-sentence, only inline items are offered",
    !midLine.some((o) => o.startsWith("Table")) && midLine.some((o) => o.startsWith("Web link")),
    midLine.join(),
  );
  await page.keyboard.press("Escape");

  await addLine();
  await page.keyboard.type("[[Rena");
  await pause(350);
  await page.keyboard.press("Enter");
  await saved();
  await pause(150);
  check("[[ completes a note and closes the link", (await disk("Writing.md")).includes("[[Renamed]]"));
  await addLine();
  await page.keyboard.type("[[Renamed#");
  await pause(350);
  check(
    "# offers that note's headings",
    (await page.locator(".cm-tooltip-autocomplete li .cm-completionLabel").first().textContent()).includes("Part"),
  );
  await page.keyboard.press("Enter");
  await saved();
  await pause(150);
  check("a heading can be completed", (await disk("Writing.md")).includes("[[Renamed#Part]]"));

  await addLine();
  await saved();
  await pause(600);
  const contentBefore = await disk("Writing.md");
  await page.evaluate(async () => {
    const bytes = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], "image.png", { type: "image/png" }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    document.querySelector(".cm-content").dispatchEvent(event);
  });
  await pause(500);
  const attached = readdirSync(file("Attachments")).filter((name) => name.startsWith("Pasted image"));
  check(
    "a pasted image goes where Obsidian is set to keep attachments",
    attached.length === 1 && attached[0].startsWith("Pasted image"),
    attached.join(),
  );
  await saved();
  await pause(150);
  check(
    "it is embedded where the cursor was",
    (await disk("Writing.md")) === `${contentBefore}![[${attached[0]}]]`,
    (await disk("Writing.md")).slice(-60),
  );
  await addLine();
  await pause(300);
  check("the image shows in the editor", await page.locator("img.cm-embed-image").evaluate((img) => img.naturalWidth === 1));

  await line("First line here.").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "https://example.com/x");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    document.querySelector(".cm-content").dispatchEvent(event);
  });
  await saved();
  await pause(150);
  check(
    "pasting a URL over a selection makes a link",
    (await disk("Writing.md")).includes("[First line here.](https://example.com/x)"),
  );
  const folderMenu = async (folder, item) => {
    await page.locator(`.tree-head[data-folder="${folder}"]`).click({ button: "right" });
    await pause(100);
    await page.locator(`.context-item:has-text("${item}")`).click();
    await pause(150);
  };

  await openNote("Trips/Plan");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(200);
  await folderMenu("Trips", "Rename");
  await page.fill(".tree-name-input", "Scrap");
  await page.keyboard.press("Enter");
  await pause(100);
  check("a folder cannot take the name of another", await page.locator(".tree-name-input.is-problem").isVisible());
  await page.fill(".tree-name-input", "a/b");
  await page.keyboard.press("Enter");
  await pause(100);
  check("a folder name with a slash is refused", await page.locator(".tree-name-input.is-problem").isVisible());
  await page.fill(".tree-name-input", "Journeys");
  await page.keyboard.press("Enter");
  await pause(900);
  check(
    "renaming a folder moves everything in it",
    existsSync(file("Journeys/Later/Deep.md")) && existsSync(file("Journeys/dot.png")),
  );
  check("the old folder is gone", !existsSync(file("Trips")));
  check(
    "links from outside follow, by path, by name and to attachments",
    (await disk("Home.md")) === "[[Journeys/Plan]] [[Plan]] [m](Journeys/Later/Deep.md) ![[Journeys/dot.png]]\n",
    await disk("Home.md"),
  );
  check(
    "a path link inside follows and relative links between moved notes stay as they were",
    (await disk("Journeys/Plan.md")) === "Day: [[Journeys/Day]] and [next](Day.md), home [back](../Home.md).\n",
    await disk("Journeys/Plan.md"),
  );
  check("the note being edited stays open at its new path", await page.locator(".cm-content").isVisible());
  await page.locator(".cm-line").first().click();
  await page.keyboard.press("Meta+ArrowDown");
  await page.keyboard.type("after the move");
  await saved();
  await pause(150);
  check("saving goes to the new path", (await disk("Journeys/Plan.md")).includes("after the move"));
  check("the tree shows the new name", await page.locator('.tree-head[data-folder="Journeys"]').isVisible());
  check("no trace of the old folder is left in the tree", (await page.locator('.tree-head[data-folder="Trips"]').count()) === 0);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await pause(300);
  await page.locator(".doc a.wikilink", { hasText: "next" }).click();
  await pause(400);
  check("a Markdown link opens its note in reading", (await page.textContent(".doc-title")).includes("Day"));

  await openNote("Scrap/One");
  await folderMenu("Scrap", "Move to Trash");
  check(
    "deleting a folder says what goes and what breaks",
    /2 notes/.test(await page.textContent(".prompt-note")) && /1 note outside link/.test(await page.textContent(".prompt-note")),
    await page.textContent(".prompt-note"),
  );
  await page.locator('.prompt button:has-text("Cancel")').click();
  await pause(150);
  check("cancelling keeps the folder", existsSync(file("Scrap/One.md")));
  await folderMenu("Scrap", "Move to Trash");
  await page.locator('.prompt button:has-text("Move to Trash")').click();
  await pause(600);
  check("the folder is removed", !existsSync(file("Scrap")));
  check("nothing outside it was touched", existsSync(file("Refers.md")) && (await disk("Refers.md")).includes("[[One]]"));
  check("the tab showing it goes blank", (await page.locator(".doc-title").count()) === 0);

  await openNote("Home");
  const hover = async (selector) => {
    await page.mouse.move(0, 0);
    await page.locator(selector).hover();
    await pause(80);
  };
  const strip = () => page.locator(".row-actions:not([hidden]) .row-action");
  check(
    "the file-actions row has new note, new folder, sort, search and collapse",
    (await page.locator(".files-actions .icon-btn").count()) === 5,
  );
  check("new note left the title bar", (await page.locator('.titlebar [data-act="new-note"]').count()) === 0);
  const moreMenu = async (selector, item) => {
    /* A file change can rebuild the tree under the pointer and take the buttons with it. */
    for (let tries = 5; tries > 0; tries--) {
      await hover(selector);
      const clicked = await strip()
        .last()
        .click({ timeout: 1500 })
        .then(
          () => true,
          (error) => {
            if (tries === 1) throw error;
            return false;
          },
        );
      if (clicked) break;
    }
    await pause(120);
    await page.locator(`.context-item:has-text("${item}")`).click();
    await pause(150);
  };
  await hover('.nav-item[data-path="Writing.md"]');
  check("hovering a note shows only its menu button", (await strip().count()) === 1);
  await hover('.tree-head[data-folder="Journeys"]');
  check("hovering a folder shows add and menu buttons", (await strip().count()) === 2);
  check(
    "they take the place of the count",
    await page
      .locator('.tree-head[data-folder="Journeys"] .tree-count')
      .evaluate((count) => getComputedStyle(count).visibility === "hidden"),
  );
  const onRow = await page.evaluate(() => {
    const row = document.querySelector('.tree-head[data-folder="Journeys"]').getBoundingClientRect();
    const box = document.querySelector(".row-actions").getBoundingClientRect();
    return box.top >= row.top - 1 && box.bottom <= row.bottom + 1 && box.right < row.right && box.left > row.left + row.width / 2;
  });
  check("the buttons sit at the row's end, leaving its middle clickable", onRow);
  check(
    "there is no box behind them",
    await page.locator(".row-actions").evaluate((box) => getComputedStyle(box).backgroundColor === "rgba(0, 0, 0, 0)"),
  );
  const styleOf = (selector) =>
    page.locator(selector).evaluate((row) => {
      const { backgroundColor, color } = getComputedStyle(row);
      return { backgroundColor, color };
    });
  const FOLDER = '.tree-head[data-folder="Journeys"]';
  await page.mouse.move(0, 0);
  await pause(300);
  const folderAtRest = await styleOf(FOLDER);
  await hover(FOLDER);
  await pause(250);
  const folderHovered = await styleOf(FOLDER);
  check(
    "hovering a folder adds no shade",
    folderHovered.backgroundColor === folderAtRest.backgroundColor,
    folderHovered.backgroundColor,
  );
  check("it brightens the folder's text instead", folderHovered.color !== folderAtRest.color, folderHovered.color);
  await strip().last().hover();
  await pause(250);
  check("the text stays bright with the pointer on a button", (await styleOf(FOLDER)).color === folderHovered.color);
  const NOTE = '.nav-item[data-path="Writing.md"]';
  await hover(NOTE);
  await pause(250);
  const noteHovered = await styleOf(NOTE);
  check("hovering a note still shades it", noteHovered.backgroundColor !== "rgba(0, 0, 0, 0)", noteHovered.backgroundColor);
  await strip().last().hover();
  await pause(250);
  check(
    "the note stays shaded with the pointer on its button",
    (await styleOf(NOTE)).backgroundColor === noteHovered.backgroundColor,
  );
  await hover(FOLDER);
  await pause(100);
  await strip().last().click();
  await pause(350);
  const menuPlacement = await page.evaluate(() => {
    const button = document.querySelector(".row-actions .row-action:last-child").getBoundingClientRect();
    const menu = document.querySelector(".context-menu").getBoundingClientRect();
    return Math.abs(menu.right - button.right) <= 1 && menu.top >= button.bottom;
  });
  check("the menu opens under its button, aligned to it", menuPlacement);
  check(
    "the menu has the folder actions",
    (await page.locator(".context-item").allTextContents()).join().includes("New folder here"),
  );
  await page.mouse.move(700, 500);
  await pause(120);
  check("the row stays marked while its menu is open", await page.locator(".row-actions:not([hidden])").isVisible());
  await page.keyboard.press("Escape");
  await pause(120);
  check("closing the menu clears the row", (await page.locator(".has-actions").count()) === 0);
  const headerLine = await page.evaluate(() => {
    const centre = (r) => r.left + r.width / 2;
    const first = document.querySelector(".files-actions .icon-btn svg").getBoundingClientRect();
    const end = document.querySelector('.files-actions [data-act="collapse-folders"] svg').getBoundingClientRect();
    const search = document.querySelector('.files-actions [data-side="search"] svg').getBoundingClientRect();
    const forward = document.querySelector('.titlebar [data-act="forward"] svg').getBoundingClientRect();
    const back = document.querySelector('.titlebar [data-act="back"] svg').getBoundingClientRect();
    const rowIcon = [...document.querySelectorAll(".nav-item .tree-icon")]
      .map((icon) => icon.getBoundingClientRect())
      .sort((a, b) => a.left - b.left)[0];
    return {
      left: first.left - rowIcon.left,
      right: centre(end) - centre(forward),
      search: centre(search) - centre(back),
      size: first.width - rowIcon.width,
    };
  });
  check(
    "the top row lines up with the tree and the bar above",
    Math.abs(headerLine.left) <= 0.5 &&
      Math.abs(headerLine.right) <= 0.5 &&
      Math.abs(headerLine.search) <= 0.5 &&
      headerLine.size === 0,
    JSON.stringify(headerLine),
  );
  await page.mouse.move(0, 0);
  await pause(80);
  await page.keyboard.press("Shift");
  await page.locator('.tree-head[data-folder="Journeys"]').focus();
  await pause(100);
  check("keyboard focus on a row shows its buttons", (await strip().count()) === 2);
  check(
    "and they come next in tab order",
    await page.evaluate(() => document.activeElement.nextElementSibling === document.querySelector(".row-actions")),
  );
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement.blur());
  await pause(80);
  const offCentre = await page.$$eval(".row-actions .row-action", (buttons) =>
    Math.max(
      ...buttons.map((button) => {
        const box = button.getBoundingClientRect();
        const icon = button.querySelector("svg").getBoundingClientRect();
        return Math.max(
          Math.abs(box.left + box.width / 2 - (icon.left + icon.width / 2)),
          Math.abs(box.top + box.height / 2 - (icon.top + icon.height / 2)),
        );
      }),
    ),
  );
  check("each icon is centred in its button", offCentre <= 0.5, String(offCentre));

  await page.locator('.tree-head[data-folder="Journeys"]').click({ button: "right" });
  await pause(100);
  check("the folder menu offers a new folder", await page.locator('.context-item:has-text("New folder here")').isVisible());
  await page.keyboard.press("Escape");
  await pause(100);

  await page.click('[data-act="new-folder"]');
  await pause(100);
  await page.keyboard.press("Escape");
  await pause(100);
  check("escaping a new folder leaves no row behind", (await page.locator(".tree-name-input").count()) === 0);
  await page.click('[data-act="new-folder"]');
  await pause(100);
  await page.keyboard.type("Journeys");
  await page.keyboard.press("Enter");
  await pause(100);
  check("a new folder cannot reuse a name", await page.locator(".tree-name-input.is-problem").isVisible());
  await page.fill(".tree-name-input", "Fresh ideas");
  await page.keyboard.press("Enter");
  await pause(700);
  check("a new folder is created with a first note", existsSync(file("Fresh ideas/Untitled.md")));
  check("and that note is ready to name", await page.locator(".cm-content, .doc-editing").first().isVisible());
  await page.keyboard.press("Escape");
  await moreMenu('.tree-head[data-folder="Journeys"]', "New folder here");
  await page.keyboard.type("Nested");
  await page.keyboard.press("Enter");
  await pause(700);
  check("a folder can be made inside a folder", existsSync(file("Journeys/Nested/Untitled.md")));

  await openNote("Writing");
  await page.keyboard.press("F2");
  await pause(150);
  check("F2 renames the open note in place", await page.locator(".tree-name-input").isVisible());
  await page.keyboard.press("Escape");
  await pause(150);
  check("escaping keeps the name", existsSync(file("Writing.md")) && (await page.locator(".tree-name-input").count()) === 0);

  await moreMenu('.nav-item[data-path="Mover.md"]', "Rename");
  await page.keyboard.type("Moved on");
  await page.locator(".doc-title, .start-page").first().click();
  await pause(600);
  check("clicking away accepts a rename", existsSync(file("Moved on.md")) && !existsSync(file("Mover.md")));
  await moreMenu('.nav-item[data-path="Moved on.md"]', "Move to Trash");
  await pause(350);
  check(
    "a note nothing links to goes without a dialog",
    !existsSync(file("Moved on.md")) && (await page.locator(".prompt").count()) === 0,
  );

  await page.click('[data-act="collapse-folders"]');
  await pause(350);
  check("collapse closes every folder", (await page.locator(".tree-folder.is-open").count()) === 0);

  await writeFile(file("Plans.md"), "## One\n- [ ] a\n- [ ] b\n\n## Two\n- [x] c\n- [ ] d\n- [x] e\n");
  await openNote("Plans");
  await page.keyboard.press("Meta+t");
  await pause(400);
  check(
    "the new tab shows a count for each to-do list",
    (await page.locator('.start-row[data-path="Plans.md"] .start-count').allTextContents()).join(" ") === "0/2 2/3",
    (await page.locator('.start-row[data-path="Plans.md"] .start-count').allTextContents()).join(" "),
  );
  /* The docked inspector draws its own edge up through the title bar, so the edge shows exactly when the inspector does. */
  const inspectorEdge = () =>
    page.evaluate(() => {
      const rail = document.querySelector(".rail");
      const shown = getComputedStyle(rail).visibility === "visible" && getComputedStyle(rail).opacity === "1";
      return {
        room: window.innerWidth - document.querySelector(".reader").getBoundingClientRect().right,
        shown,
        edge: shown && getComputedStyle(rail, "::after").content !== "none",
      };
    });
  const onBlank = await inspectorEdge();
  check(
    "a blank tab hides the inspector's edge in the title bar along with the inspector",
    onBlank.room === 0 && !onBlank.shown && !onBlank.edge,
    JSON.stringify(onBlank),
  );
  await page.keyboard.press("Meta+n");
  await page.waitForSelector(".cm-content");
  await pause(300);
  const onNew = await inspectorEdge();
  check(
    "a new note from a blank tab brings the inspector back whole",
    onNew.room > 0 && onNew.shown && onNew.edge && (await page.locator('[data-rail="links"]').isVisible()),
    JSON.stringify(onNew),
  );

  const diffGeometry = await page.evaluate(async () => {
    const { renderDiff } = await import(/* @vite-ignore */ `${location.origin}/src/ui/diff.ts`);
    const long = "x".repeat(900);
    const text = `diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -1,2 +1,3 @@\n ${long}\n-short\n+also short\n+${long}y\n`;
    let saved = null;
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;left:40px;top:40px;width:700px;height:400px;overflow:auto;background:var(--paper);z-index:9999";
    const view = renderDiff(text, {
      wrapped: true,
      onWrapChange: (on) => {
        saved = on;
      },
    });
    host.append(view);
    document.body.append(host);
    const hunk = view.querySelector(".diff-hunk");
    const lines = () => [...view.querySelectorAll(".diff-line")];
    const wrappedFits = hunk.scrollWidth <= hunk.clientWidth;
    const wrappedTall = lines()[0].getBoundingClientRect().height > 40;
    view.querySelector(".diff-wrap").click();
    const scrolls = hunk.scrollWidth > hunk.clientWidth;
    const widths = new Set(lines().map((l) => Math.round(l.getBoundingClientRect().width)));
    const noBefore = lines()[2].querySelector(".diff-no").getBoundingClientRect().left;
    hunk.scrollLeft = 400;
    const noAfter = lines()[2].querySelector(".diff-no").getBoundingClientRect().left;
    host.remove();
    return { wrappedFits, wrappedTall, scrolls, widths: widths.size, moved: Math.abs(noBefore - noAfter), saved };
  });
  check("wrapped lines stay inside the pane", diffGeometry.wrappedFits && diffGeometry.wrappedTall, JSON.stringify(diffGeometry));
  check("unwrapped lines scroll sideways", diffGeometry.scrolls);
  check("every unwrapped row has the same width, so tints line up", diffGeometry.widths === 1);
  check("line numbers stay put while scrolling sideways", diffGeometry.moved < 1, String(diffGeometry.moved));
  check("the wrap choice is remembered", diffGeometry.saved === false);

  const heightsWhileOpening = (note) =>
    page.evaluate(async (path) => {
      const reader = window.waymark.reader;
      const heights = [];
      let sampling = true;
      const sample = () => {
        const doc = document.querySelector(".doc");
        if (reader.current === path && doc) heights.push(Math.round(doc.getBoundingClientRect().height));
        if (sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      await reader.open(path);
      await new Promise((done) => setTimeout(done, 900));
      sampling = false;
      return [...new Set(heights)];
    }, note);
  await writeFile(
    file("Tall.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="teal"/></svg>',
  );
  await writeFile(file("Picture.md"), "# Picture\n\n![[Tall.svg]]\n\nBelow it.\n");
  await writeFile(file("Small picture.md"), "# Small\n\n![[Tall.svg|300]]\n");
  await writeFile(file("Chart.md"), "# Chart\n\n```mermaid\ngraph TD; A-->B; B-->C; C-->D;\n```\n\nBelow it.\n");
  await openNote("Writing");
  await page.reload();
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(500);
  const pictureHeights = await heightsWhileOpening("Picture.md");
  check("an image never moves the page as it loads", pictureHeights.length === 1, pictureHeights.join());
  await page.evaluate(() => window.waymark.reader.open("Small picture.md"));
  await pause(300);
  check(
    "a size written on an image is honoured",
    Math.round(await page.locator(".doc img").evaluate((img) => img.getBoundingClientRect().width)) === 300,
  );
  await page.evaluate(() => window.waymark.reader.open("Chart.md"));
  await page.waitForSelector(".doc .diagram-svg svg", { timeout: 15000 });
  await page.evaluate(() => window.waymark.reader.open("Writing.md"));
  await pause(200);
  const chartHeights = await heightsWhileOpening("Chart.md");
  check("a diagram seen before never moves the page", chartHeights.length === 1, chartHeights.join());
  await page.reload();
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(500);
  const afterRestart = await heightsWhileOpening("Chart.md");
  check("nor does it after the app restarts", afterRestart.length === 1, afterRestart.join());

  await openNote("Writing");
  await page.click('[data-side="search"]');
  await pause(150);
  await page.fill(".search-field input", "Below");
  await pause(150);
  await page.keyboard.press("Enter");
  await pause(500);
  const searchMarks = () => page.evaluate(() => CSS.highlights.get("search")?.size ?? 0);
  check("opening a search result marks the matches", (await searchMarks()) > 0, String(await searchMarks()));
  await page.locator(".search-field input").click();
  await page.keyboard.press("Backspace");
  await pause(80);
  check("editing the search clears the old marks at once", (await searchMarks()) === 0, String(await searchMarks()));
  await page.keyboard.press("Escape");
  await pause(150);

  const outside = (paths) => page.evaluate((p) => window.waymark.reader.onVaultChanged(p), paths);
  const listed = (selector) => page.locator(`.sidebar-inner ${selector}`).count();
  const treeState = () =>
    page.evaluate(() => {
      const box = document.querySelector(".sidebar-inner");
      return {
        scroll: box.scrollTop,
        focused: document.activeElement?.dataset.folder ?? document.activeElement?.dataset.path ?? null,
        open: [...box.querySelectorAll(".tree-folder.is-open > .tree-head")].map((h) => h.dataset.folder).join(),
      };
    });
  for (const mode of ["Read", "Edit"]) {
    await openNote("Writing");
    if (mode === "Edit") {
      await page.keyboard.press("Meta+e");
      await pause(300);
    }
    if (!(await page.locator('.sidebar-inner .tree-folder.is-open > [data-folder="Apiary"]').count())) {
      await page.locator('.sidebar-inner [data-folder="Apiary"]').click();
    }
    await page.evaluate(() => {
      const box = document.querySelector(".sidebar-inner");
      box.scrollTop = box.scrollHeight;
      box.querySelector('[data-folder="Apiary"]').focus({ preventScroll: true });
    });
    await pause(250);
    const before = await treeState();
    const unchanged = async (what) => {
      const now = await treeState();
      check(
        `${mode}: the file list keeps its scroll, focus and open folders when ${what}`,
        JSON.stringify(now) === JSON.stringify(before),
        `${JSON.stringify(before)} -> ${JSON.stringify(now)}`,
      );
    };
    await writeFile(file(`Arrived ${mode}.md`), "new\n");
    await outside([`Arrived ${mode}.md`]);
    await pause(150);
    check(
      `${mode}: a note written outside the app appears in the file list`,
      (await listed(`[data-path="Arrived ${mode}.md"]`)) === 1,
    );
    await unchanged("a note arrives");
    await rename(file(`Arrived ${mode}.md`), file(`Renamed ${mode}.md`));
    await outside([`Arrived ${mode}.md`, `Renamed ${mode}.md`]);
    await pause(150);
    check(
      `${mode}: a note renamed outside the app is listed under its new name only`,
      (await listed(`[data-path="Arrived ${mode}.md"]`)) === 0 && (await listed(`[data-path="Renamed ${mode}.md"]`)) === 1,
    );
    await unlink(file(`Renamed ${mode}.md`));
    await outside([`Renamed ${mode}.md`]);
    await pause(150);
    check(
      `${mode}: a note deleted outside the app leaves the file list`,
      (await listed(`[data-path="Renamed ${mode}.md"]`)) === 0,
    );
    mkdirSync(file(`Outside ${mode}`));
    await writeFile(file(`Outside ${mode}/Inner.md`), "inner\n");
    await outside([`Outside ${mode}/Inner.md`]);
    await pause(150);
    check(
      `${mode}: a folder made outside the app appears in the file list`,
      (await listed(`[data-folder="Outside ${mode}"]`)) === 1,
    );
    await unchanged("files come and go");
    if (mode === "Edit") await page.keyboard.press("Meta+e");
  }

  check("Obsidian's settings are never touched", (await disk(".obsidian/app.json")) === obsidianBefore);
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
