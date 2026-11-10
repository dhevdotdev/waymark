// Editing a note's properties in the panel, against files on disk, in WebKit with real input.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const file = (name) => path.join(app.vault, name);
const disk = (name) => readFile(file(name), "utf8");

const MESSY = [
  "---",
  "# a comment at the top",
  "status:   unread   # keep this",
  "",
  "Due date: 2024-05-01",
  "'quoted key': 'single'",
  "tags: [one, 'two words']",
  "aliases:",
  "  - First",
  '  - "Second"',
  "---",
  "# Messy",
  "",
  "Body stays exactly.",
  "",
].join("\n");
const NOTES = {
  "Messy.md": MESSY,
  "Plain.md": "# Plain\n\nNo block here.\n",
  "Tasks.md": "# Tasks\n\n- [ ] first\n- [ ] second\n",
  "Solo.md": "---\nonly: one\n---\nSolo body\n",
  "Nested.md": "---\nplace:\n  city: Paris\n  zip: 75001\nkept: yes please\na: 1\nb: 2\na: 3\n---\nNested body\n",
  "Broken.md": "---\ntitle: bad: yaml\nmore: [x\n---\nBroken body\n",
  "Windows.md": "---\r\nstatus: unread\r\nother: x\r\n---\r\nWindows body\r\n",
  "Long.md": `---\n${"A property name that goes on for a good long while"}: ${"a value that keeps going ".repeat(12).trim()}\ntags: [${Array.from({ length: 14 }, (_, i) => `tag-number-${i}`).join(", ")}]\n---\nLong body\n`,
  "Editing.md": "---\nstatus: draft\nnext: x\n---\nEditing body\n",
  "Conflict.md": "---\nstatus: a\n---\nConflict body\n",
  "Locked.md": "---\nstatus: a\n---\nLocked body\n",
  "Views.base": 'views:\n  - type: table\n    name: All\n    order:\n      - file.name\n      - note["Due date"]\n',
};
for (const [name, text] of Object.entries(NOTES)) await writeFile(file(name), text);

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1320, height: 860 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);
const open = async (name) => {
  await page.evaluate((target) => window.waymark.open(target), name);
  await pause(350);
};
const cell = (key) => page.locator(`.prop-cell[data-key="${key}"]`);
const value = (key) => cell(key).locator(".prop-value");
const toast = () =>
  page
    .locator(".toast")
    .last()
    .textContent()
    .catch(() => "");
/** Puts a note back on disk and tells the app, as the file watcher would. */
const reset = async (name, text) => {
  await writeFile(file(name), text);
  await page.evaluate((target) => window.waymark.vault.applyChanges([target]), name);
  await open("Plain.md");
  await open(name);
};
const change = async (key, text) => {
  await value(key).click();
  await pause(60);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await pause(250);
};

try {
  await page.goto(`${app.url}?note=${encodeURIComponent("Messy")}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(400);
  await page.click('[data-rail="info"]');
  await pause(300);

  check("a name with a space is listed", await cell("Due date").isVisible());
  check("the file is not touched by looking at it", (await disk("Messy.md")) === MESSY);

  const heightBefore = await cell("status").evaluate((c) => c.getBoundingClientRect().height);
  await value("status").click();
  await pause(60);
  check("clicking a value makes it editable in place", await value("status").evaluate((v) => v.isContentEditable));
  check(
    "the row keeps its shape while editing",
    (await cell("status").evaluate((c) => c.getBoundingClientRect().height)) === heightBefore,
  );
  await page.keyboard.type("read");
  await page.keyboard.press("Enter");
  await pause(250);
  check("Enter writes only that value, byte for byte", (await disk("Messy.md")) === MESSY.replace("unread", "read"));
  check("the value shows what was written", (await value("status").textContent()) === "read");
  check("focus stays on the value", await value("status").evaluate((v) => document.activeElement === v));

  await page.keyboard.press("Meta+z");
  await pause(350);
  check("Command-Z takes that back in one step", (await disk("Messy.md")) === MESSY);
  await pause(150);
  check("and the panel shows the old value", (await value("status").textContent()) === "unread");

  await value("status").click();
  await pause(60);
  await page.keyboard.type("nope");
  await page.keyboard.press("Escape");
  await pause(200);
  check("Escape changes nothing", (await disk("Messy.md")) === MESSY && (await value("status").textContent()) === "unread");
  check("Escape leaves the panel open", await page.locator(".rail-info").isVisible());

  await value("status").focus();
  await page.keyboard.press("Enter");
  await pause(60);
  await page.keyboard.type("by keyboard");
  await page.keyboard.press("Tab");
  await pause(250);
  check(
    "the keyboard alone can change a value, and leaving saves",
    (await disk("Messy.md")) === MESSY.replace("unread", "by keyboard"),
  );

  await change("status", "a: b #c");
  check("text that would break YAML is quoted", (await disk("Messy.md")) === MESSY.replace("unread", '"a: b #c"'));
  await change("status", "unread");
  check("and it can go back", (await disk("Messy.md")).includes('status:   "unread"') || (await disk("Messy.md")) === MESSY);

  await reset("Messy.md", MESSY);

  await cell("aliases").locator(".prop-chip").nth(1).click();
  await pause(60);
  await page.keyboard.type("Changed");
  await page.keyboard.press("Enter");
  await pause(300);
  check("a list item changes on its own line", (await disk("Messy.md")) === MESSY.replace('"Second"', "Changed"));
  await cell("aliases").locator(".prop-chip-add").click();
  await pause(60);
  await page.keyboard.type("Third: one");
  await page.keyboard.press("Enter");
  await pause(300);
  check(
    "a list grows and quotes what it must",
    (await disk("Messy.md")) === MESSY.replace('  - "Second"', '  - Changed\n  - "Third: one"'),
  );
  await cell("aliases").locator(".prop-chip").last().focus();
  await page.keyboard.press("Delete");
  await pause(300);
  check("Delete removes an item", (await disk("Messy.md")) === MESSY.replace('"Second"', "Changed"));

  await cell("tags").locator(".prop-chip-add").click();
  await pause(60);
  await page.keyboard.type("new");
  await page.keyboard.press("Enter");
  await pause(300);
  check(
    "an inline list stays inline and keeps its other items exact",
    (await disk("Messy.md")).includes("tags: [one, 'two words', new]"),
  );
  await reset("Messy.md", MESSY);

  await page.locator(".prop-add").click();
  await pause(60);
  await page.keyboard.type("Reviewed by");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Sam");
  await page.keyboard.press("Enter");
  await pause(300);
  check(
    "a new property goes at the end of the block",
    (await disk("Messy.md")) === MESSY.replace('  - "Second"\n', '  - "Second"\nReviewed by: Sam\n'),
  );
  check("it appears in the panel", (await value("Reviewed by").textContent()) === "Sam");

  await page.locator(".prop-add").click();
  await pause(60);
  await page.keyboard.type("status");
  await page.keyboard.press("Enter");
  await page.keyboard.type("twice");
  await page.keyboard.press("Enter");
  await pause(200);
  check(
    "a name already there is refused, and says so",
    (await page.locator(".prop-hint").textContent()).includes("already") && !(await disk("Messy.md")).includes("twice"),
  );
  await page.keyboard.press("Escape");
  await pause(150);
  check("Escape closes the new row", !(await page.locator(".prop-new").isVisible()));

  await cell("Reviewed by").hover();
  await pause(400);
  check(
    "the remove control shows on the row being pointed at",
    (await cell("Reviewed by")
      .locator(".prop-remove")
      .evaluate((b) => getComputedStyle(b).opacity)) === "1",
  );
  await cell("Reviewed by").locator(".prop-remove").click();
  await pause(300);
  check("removing takes out only its line", (await disk("Messy.md")) === MESSY);
  await page.locator(".toast-action").click();
  await pause(300);
  check("Undo brings it back", (await disk("Messy.md")).includes("Reviewed by: Sam"));
  await cell("Reviewed by").locator(".prop-remove").focus();
  await page.keyboard.press("Enter");
  await pause(300);
  check("removing works from the keyboard", (await disk("Messy.md")) === MESSY);

  await open("Plain.md");
  await page.locator(".prop-add").click();
  await pause(60);
  await page.keyboard.type("k");
  await page.keyboard.press("Enter");
  await page.keyboard.type("v");
  await page.keyboard.press("Enter");
  await pause(300);
  check("a note with no block gets one at the very top", (await disk("Plain.md")) === `---\nk: v\n---\n${NOTES["Plain.md"]}`);

  await open("Tasks.md");
  await page.locator(".prop-add").click();
  await pause(60);
  await page.keyboard.type("k");
  await page.keyboard.press("Enter");
  await page.keyboard.type("v");
  await page.keyboard.press("Enter");
  await pause(500);
  check(
    "focus stays in the panel after the note redraws",
    await page.evaluate(() => document.activeElement?.closest(".prop-editor") !== null),
  );
  await page.locator("button.task-box").nth(1).click();
  await pause(400);
  check(
    "a task still toggles its own line after a property moved the lines",
    (await disk("Tasks.md")) === "---\nk: v\n---\n# Tasks\n\n- [ ] first\n- [x] second\n",
    JSON.stringify(await disk("Tasks.md")),
  );

  await open("Solo.md");
  await cell("only").hover();
  await cell("only").locator(".prop-remove").click();
  await pause(300);
  check("removing the last property removes the block", (await disk("Solo.md")) === "Solo body\n");

  await open("Windows.md");
  await change("status", "read");
  check("Windows line endings survive", (await disk("Windows.md")) === NOTES["Windows.md"].replace("unread", "read"));

  await open("Nested.md");
  check(
    "a nested value is shown as written",
    (await cell("place").locator(".prop-fixed").textContent()) === "city: Paris\nzip: 75001",
  );
  check("it cannot be edited in the form", (await cell("place").locator(".prop-value").count()) === 0);
  check("nor can a duplicate name", (await page.locator('.prop-cell[data-key="a"] .prop-value').count()) === 0);
  const before = await disk("Nested.md");
  await change("kept", "changed");
  check("a value beside those still edits exactly", (await disk("Nested.md")) === before.replace("yes please", "changed"));
  await cell("place").locator(".prop-raw").click();
  await page.waitForSelector(".cm-content");
  await pause(300);
  check("Edit as text opens the raw lines", await page.locator(".cm-line", { hasText: "city: Paris" }).isVisible());
  check("the file is unchanged by that", (await disk("Nested.md")) === before.replace("yes please", "changed"));
  await page.keyboard.press("Meta+e");
  await pause(300);

  await open("Broken.md");
  check(
    "YAML that does not parse still shows what it can",
    await page.locator(".prop-fixed", { hasText: "bad: yaml" }).isVisible(),
  );
  check("and offers no way to add to it", !(await page.locator(".prop-add").isVisible()));
  check("and still opens", (await page.textContent(".doc")).includes("Broken body"));

  await open("Editing.md");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(300);
  await change("status", "done");
  await pause(500);
  check("a change during Edit reaches the file", (await disk("Editing.md")) === NOTES["Editing.md"].replace("draft", "done"));
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await pause(700);
  check("one undo in the editor takes it back", (await disk("Editing.md")) === NOTES["Editing.md"]);
  await pause(200);
  check("and the panel follows", (await value("status").textContent()) === "draft");
  await page.keyboard.press("Meta+e");
  await pause(300);

  await open("Conflict.md");
  await value("status").click();
  await pause(60);
  await page.keyboard.type("mine");
  await writeFile(file("Conflict.md"), "---\nstatus: theirs\n---\nConflict body\n");
  await pause(60);
  await page.keyboard.press("Enter");
  await pause(500);
  check("a change from elsewhere is not overwritten", (await disk("Conflict.md")).includes("status: theirs"));
  check("and the panel says so", (await toast()).includes("changed elsewhere"), await toast());
  await pause(500);
  check(
    "and shows what is really there",
    (await value("status").textContent()) === "theirs",
    await value("status").textContent(),
  );

  await open("Locked.md");
  const refuseWrites = (route) => route.fulfill({ status: 500, body: "disk full" });
  await page.route("**/@vault/write", refuseWrites);
  await value("status").click();
  await pause(60);
  await page.keyboard.type("z");
  await page.keyboard.press("Enter");
  await pause(400);
  check(
    "a failed write puts the old value back",
    (await value("status").textContent()) === "a",
    await value("status").textContent(),
  );
  check("and is visible", (await toast()) !== "", await toast());
  check("and the file is untouched", (await disk("Locked.md")) === NOTES["Locked.md"]);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(300);
  await value("status").click();
  await pause(60);
  await page.keyboard.type("y");
  await page.keyboard.press("Enter");
  await pause(700);
  check("in Edit too", (await value("status").textContent()) === "a", await value("status").textContent());
  check(
    "and the editor's text goes back",
    await page.locator(".cm-content").evaluate((c) => !c.textContent.includes("status: y")),
  );
  await page.unroute("**/@vault/write", refuseWrites);
  await pause(600);
  check("nothing was written meanwhile", (await disk("Locked.md")) === NOTES["Locked.md"]);
  await page.keyboard.press("Meta+e");
  await pause(300);

  await open("Messy.md");
  await change("Due date", "soon");
  await page.evaluate(() => window.waymark.reader.open("Views.base"));
  await pause(500);
  check('views read note["Due date"] with the new value', (await page.textContent(".reader")).includes("soon"));

  await open("Long.md");
  const overflow = () =>
    page.evaluate(() => {
      const rail = document.querySelector(".rail").getBoundingClientRect();
      return [...document.querySelectorAll(".prop-key, .prop-value, .prop-chip")].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.right > rail.right + 1 || r.left < rail.left - 1;
      }).length;
    });
  check("long names and values stay in the panel", (await overflow()) === 0, String(await overflow()));
  await page.setViewportSize({ width: 560, height: 700 });
  await page.keyboard.press("Meta+Alt+\\");
  await pause(500);
  check("including at 560 px", (await overflow()) === 0, String(await overflow()));

  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  check("the suite finished", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
  await app.close();
}
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.join("\n")}\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
