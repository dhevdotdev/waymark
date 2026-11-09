// Creating, renaming, moving and deleting notes, inserting into them, and the toolbars, against files on disk.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
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
await writeFile(file("Writing.md"), "# Writing\n\nFirst line here.\n");
const obsidianBefore = await disk(".obsidian/app.json");
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
  const tabs = await page.locator(".rail-tabs").boundingBox();
  const toggle = await page.locator('[data-act="rail"]').boundingBox();
  check(
    "the inspector's tabs share the top row with its toggle",
    Math.abs(tabs.y + tabs.height / 2 - (toggle.y + toggle.height / 2)) <= 3,
    `${tabs.y} ${toggle.y}`,
  );
  check("they sit clear of the toggle", tabs.x + tabs.width <= toggle.x);
  await page.click('[data-rail="info"]');
  await pause(150);
  check("the tabs still work up there", await page.locator('[data-rail="info"].is-on').isVisible());
  await page.click('[data-side="search"]');
  await pause(200);
  check("the toolbar search opens Search", await page.locator(".sidebar-search").isVisible());
  await page.click('[data-side="search"]');
  await pause(200);
  check("pressing it again returns to Files", await page.locator(".sidebar-inner").isVisible());
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
    (await page.locator(".prompt-note.is-problem").isVisible()) && existsSync(file("Target.md")),
  );
  await page.fill(".prompt input", "Renamed");
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
  const offered = await page.locator(".cm-tooltip-autocomplete li").allTextContents();
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
    "the typing replaces the placeholder",
    withTable.includes("| Name | Column 2 | Column 3 |\n| --- | --- | --- |"),
    withTable.slice(0, 120),
  );
  check("the slash is gone", !withTable.includes("/table"));
  check("the table has a blank line before it, so it counts as a table", /here\.\n\n\| Name/.test(withTable));
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
    (await page.locator(".cm-tooltip-autocomplete li").allTextContents()).some((o) => o.startsWith("Task")),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("todo");
  await saved();
  await pause(150);
  check("Task inserts a task", (await disk("Writing.md")).includes("- [ ] todo"));
  await addLine();
  await page.keyboard.press("Enter");
  await pause(100);
  await page.keyboard.type("words /");
  await pause(300);
  const midLine = await page.locator(".cm-tooltip-autocomplete li").allTextContents();
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
    (await page.locator(".cm-tooltip-autocomplete li").first().textContent()).includes("Part"),
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
