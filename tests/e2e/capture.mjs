// Quick capture: the page in the capture window, and the main window saving what it sends.
// Usage: node tests/e2e/capture.mjs
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { idle, watchIdle } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);

const app = await serveFixture();
await mkdir(path.join(app.vault, ".obsidian"), { recursive: true });
await writeFile(
  path.join(app.vault, ".obsidian/app.json"),
  JSON.stringify({ newFileLocation: "folder", newFileFolderPath: "Inbox/" }),
);
await mkdir(path.join(app.vault, "Inbox"), { recursive: true });
await writeFile(path.join(app.vault, "Inbox/Buy flour.md"), "Already here.\n");
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await watchIdle(page);
const errors = [];
watchPageErrors(page, errors);
/** Hands text over as the capture window would, and gives back the files that appeared in the inbox. */
const capture = async (text) => {
  const before = new Set(await readdir(path.join(app.vault, "Inbox")));
  await page.evaluate((t) => window.waymark.answerCapture({ id: 1, text: t }), text);
  return (await readdir(path.join(app.vault, "Inbox"))).filter((f) => !before.has(f)).map((f) => `Inbox/${f}`);
};
const disk = (rel) => readFile(path.join(app.vault, rel), "utf8");

try {
  await page.goto(`${app.url}?note=Welcome`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);

  const [first, ...more] = await capture("  Call the plumber about the leak\nUnder the sink.\n\n");
  check(
    "a capture goes where Obsidian puts new notes, named from its first line",
    first === "Inbox/Call the plumber about the leak.md" && more.length === 0,
    first,
  );
  check("it holds exactly what was typed", (await disk(first)) === "Call the plumber about the leak\nUnder the sink.\n");
  await idle(page);
  check(
    "the vault knows the new note at once",
    await page.evaluate(() => window.waymark.reader.vault.index.notes.includes("Inbox/Call the plumber about the leak.md")),
  );

  const [second] = await capture("Buy flour");
  check(
    "an existing note is never replaced",
    second === "Inbox/Buy flour 2.md" && (await disk("Inbox/Buy flour.md")) === "Already here.\n",
    second,
  );

  const [third] = await capture("# Q3: plan/budget?");
  check("a name loses marks and characters a name cannot hold", third === "Inbox/Q3 plan budget.md", third);
  check("an empty capture writes nothing", (await capture("  \n ")).length === 0);

  check("nothing else was written", (await readdir(path.join(app.vault, "Inbox"))).length === 4);
  check("the open note did not change", (await page.evaluate(() => window.waymark.reader.notePath)) === "Welcome.md");

  const panel = await browser.newPage({ viewport: { width: 560, height: 152 } });
  watchPageErrors(panel, errors);
  await panel.goto(`${app.url}capture.html`);
  const box = panel.locator(".capture-field");
  await box.focus();
  await panel.keyboard.type("First line");
  await panel.keyboard.press("Shift+Enter");
  await panel.keyboard.type("second line");
  check("Shift-Return starts a new line", (await box.inputValue()) === "First line\nsecond line");
  await panel.keyboard.press("Escape");
  check("Escape clears the field", (await box.inputValue()) === "");
  await panel.keyboard.press("Enter");
  check("Return on an empty field saves nothing", (await panel.locator(".capture").getAttribute("data-state")) === "editing");
  await panel.keyboard.type("Something to keep");
  await panel.keyboard.press("Enter");
  await panel.waitForSelector('.capture[data-state="problem"]');
  check(
    "with nothing to answer, it says nothing was saved and keeps the text",
    (await panel.textContent(".capture-status")).includes("nothing was saved") &&
      (await box.inputValue()) === "Something to keep",
  );
  await panel.keyboard.type("!");
  check("typing again clears the problem", (await panel.locator(".capture").getAttribute("data-state")) === "editing");

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
