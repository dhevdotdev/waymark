// Following a link to a note that does not exist yet creates it where the vault's Obsidian settings say.
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { idle, watchIdle, writesSettled } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const HUB = [
  "# Hub",
  "",
  "Read [[Kafka]] and [[Areas/New idea#Start|the idea]], or [[Real]].",
  "",
  "Odd: [[Time: 10am]]. Stray: [[Stray]]. Keys: [[Keyed]]. Late: [[Late]].",
  "",
  "Relative: [made](Sub/Made.md).",
  "",
].join("\n");

const app = await serveFixture({ empty: true });
const file = (name) => path.join(app.vault, name);
mkdirSync(file(".obsidian"));
const SETTINGS = JSON.stringify({ newFileLocation: "folder", newFileFolderPath: "/Inbox" });
await writeFile(file(".obsidian/app.json"), SETTINGS);
await writeFile(file("Hub.md"), HUB);
await writeFile(file("Real.md"), "# Real\n");

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await watchIdle(page);
const errors = [];
watchPageErrors(page, errors);
const toastText = () => page.locator(".toast").last().textContent();
const link = (text) => page.locator(".doc a.wikilink", { hasText: text }).first();
const notePath = () => page.evaluate(() => window.waymark.reader.notePath);
const inEditor = () => page.evaluate(() => document.activeElement?.closest(".cm-content") != null);
const back = async () => {
  await page.click('[data-act="back"]');
  await idle(page);
  await writesSettled(page);
  await idle(page);
};

try {
  await page.goto(`${app.url}?note=Hub`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);

  const looks = await page.evaluate(() => {
    const style = (el) => {
      const s = getComputedStyle(el);
      return { color: s.color, line: s.textDecorationStyle, tag: el.tagName, missing: el.dataset.missing ?? null };
    };
    const links = [...document.querySelectorAll(".doc a.wikilink")];
    return {
      missing: style(links.find((l) => l.textContent === "Kafka")),
      real: style(links.find((l) => l.textContent === "Real")),
    };
  });
  check("a missing link is a link that names its note", looks.missing.tag === "A" && looks.missing.missing === "Kafka");
  check("a real link names no note to create", looks.real.missing === null);
  check("a missing link is dashed", looks.missing.line === "dashed", looks.missing.line);
  check("and quieter than a real link", looks.missing.color !== looks.real.color, JSON.stringify(looks));

  await link("Kafka").hover();
  await page.waitForSelector(".tooltip", { timeout: 3000 });
  check("hovering says what a click does", (await page.locator(".tooltip").textContent()) === "Create note “Kafka”");
  await page.mouse.move(5, 500);
  await idle(page);

  await link("Kafka").click();
  await page.waitForSelector(".cm-content");
  await idle(page);
  check("a click creates the note in Obsidian's new-note folder", existsSync(file("Inbox/Kafka.md")));
  check("the new note is empty", (await readFile(file("Inbox/Kafka.md"), "utf8")) === "");
  check("it opens there", (await notePath()) === "Inbox/Kafka.md", await notePath());
  check("in Edit, with the caret ready", await inEditor());
  await page.keyboard.type("First thought");
  await writesSettled(page);
  check("typing goes into the new note", (await readFile(file("Inbox/Kafka.md"), "utf8")) === "First thought");
  await back();
  check("Back returns to the note with the link", (await notePath()) === "Hub.md", await notePath());
  check(
    "the link now leads to the note",
    (await link("Kafka").getAttribute("data-path")) === "Inbox/Kafka.md" &&
      (await link("Kafka").getAttribute("data-missing")) === null,
  );
  check("a note with words in it is kept", existsSync(file("Inbox/Kafka.md")));

  await link("Stray").click();
  await page.waitForSelector(".cm-content");
  await idle(page);
  check("a stray click creates its note too", existsSync(file("Inbox/Stray.md")));
  await back();
  check("leaving it empty takes it away again", !existsSync(file("Inbox/Stray.md")));
  check("and the link is missing again", (await link("Stray").getAttribute("data-missing")) === "Stray");

  await link("the idea").click();
  await page.waitForSelector(".cm-content");
  await idle(page);
  check("a target with a folder is a path from the vault root", existsSync(file("Areas/New idea.md")));
  check("the alias and heading do not leak into the name", (await notePath()) === "Areas/New idea.md", await notePath());
  await page.keyboard.type("x");
  await writesSettled(page);
  await back();

  await link("Time: 10am").click();
  await idle(page);
  check("a name a file cannot have is refused", !existsSync(file("Inbox/Time: 10am.md")) && (await notePath()) === "Hub.md");
  check("and says why", (await toastText()).includes("cannot contain"), await toastText());

  /* Written behind the app's back, so the link still reads as missing. */
  mkdirSync(file("Inbox"), { recursive: true });
  await writeFile(file("Inbox/Late.md"), "keep me\n");
  await link("Late").click();
  await idle(page);
  check("a file already on disk is never replaced", (await readFile(file("Inbox/Late.md"), "utf8")) === "keep me\n");
  check("and that is said", (await toastText()).includes("already on disk"), await toastText());

  await link("Keyed").focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".cm-content");
  await idle(page);
  check("Return on a focused missing link creates it", existsSync(file("Inbox/Keyed.md")));
  await page.keyboard.type("k");
  await writesSettled(page);
  await back();

  await link("made").click();
  await page.waitForSelector(".cm-content");
  await idle(page);
  check("a Markdown link creates the file it points at, beside its note", existsSync(file("Sub/Made.md")));
  await page.keyboard.type("m");
  await writesSettled(page);
  await back();

  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  await page.locator('[data-wikilink="Stray"]').click({ modifiers: ["Meta"] });
  await page.waitForFunction(() => window.waymark.reader.notePath === "Inbox/Stray.md");
  await page.waitForSelector(".cm-content");
  await idle(page);
  check("⌘-click on a missing link in Edit creates it as well", existsSync(file("Inbox/Stray.md")));
  check("and leaves the caret in it", await inEditor());

  check("Obsidian's settings are never touched", (await readFile(file(".obsidian/app.json"), "utf8")) === SETTINGS);
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
