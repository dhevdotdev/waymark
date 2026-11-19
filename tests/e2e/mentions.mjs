// Unlinked mentions: notes that name the open note without linking it, and turning one into a link.
// Usage: node tests/e2e/mentions.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { idle, watchIdle } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);

const JOURNAL =
  "# Journal\n\nI added two titles to my reading list, then reordered the Reading list.\n\nCode `reading list`, [[Reading list]] and https://example.com/reading-list stay as they are.\n";
const PLANS = "Spring plans: finish the books to read pile.\n";
const app = await serveFixture();
const file = (name) => path.join(app.vault, name);
await writeFile(
  file("Reading list.md"),
  "---\naliases: [Books to read]\n---\n# Reading list\n\nStart here, then see [[Plans]].\n",
);
await writeFile(file("Journal.md"), JOURNAL);
await writeFile(file("Plans.md"), PLANS);
for (let i = 1; i <= 30; i++) await writeFile(file(`Weekly ${i}.md`), "Morning pages. Picked something from the reading list.\n");

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await watchIdle(page);
const errors = [];
watchPageErrors(page, errors);
const toggle = page.locator(".mentions-toggle");
const toastText = () => page.locator(".toast").last().textContent();
/** Waits for a file to read `text`, since a write lands after the click returns. */
const fileReads = async (name, text) => {
  for (let i = 0; i < 40; i++) {
    if ((await readFile(file(name), "utf8")) === text) return true;
    await page.waitForTimeout(50);
  }
  return false;
};

try {
  await page.goto(`${app.url}?note=${encodeURIComponent("Reading list")}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);

  check(
    "the section starts folded under the backlinks, and nothing is searched until it opens",
    (await toggle.getAttribute("aria-expanded")) === "false" &&
      (await page.locator(".mention").count()) === 0 &&
      (await page.evaluate(() => {
        const head = document.querySelector(".mentions-toggle");
        const before = head.previousElementSibling;
        return before?.matches(".rail-link") && head.nextElementSibling.nextElementSibling?.textContent.startsWith("Links to");
      })),
  );
  await toggle.click();
  await idle(page);
  const label = await toggle.textContent();
  check("opening it counts every mention", label === "Unlinked mentions · 33", label);
  check(
    "it shows at most 24, and says how many more",
    (await page.locator(".mentions-more").textContent()) === "and 9 more mentions",
  );
  const journal = await page.$$eval(".mention-quote", (all) =>
    all.filter((q) => q.dataset.mentionOpen === "Journal.md").map((q) => q.querySelector("mark").textContent),
  );
  check(
    "code, links and web addresses are skipped, and case does not matter",
    JSON.stringify(journal) === '["reading list","Reading list"]',
    JSON.stringify(journal),
  );
  check(
    "aliases count as the note's name",
    (await page.locator('.mention-quote[data-mention-open="Plans.md"] mark').textContent()) === "books to read",
  );
  check(
    "notes are listed in natural order",
    (await page.locator(".mentions .rail-link-name").nth(3).textContent()) === "Weekly 2",
  );
  check(
    "the note's own text is never listed",
    (await page.locator('.mention-quote[data-mention-open="Reading list.md"]').count()) === 0,
  );

  await page.locator('.mention-link[data-mention-link="Journal.md"]').first().click();
  const linked = JOURNAL.replace("my reading list", "my [[Reading list|reading list]]");
  check("Link writes exactly that mention as a link, keeping its words", await fileReads("Journal.md", linked));
  await idle(page);
  check("and says where, with Undo", (await toastText()).startsWith("Linked in “Journal”"));
  check(
    "the mention leaves the list",
    (await page.locator('.mention-quote[data-mention-open="Journal.md"]').count()) === 1 &&
      (await toggle.textContent()) === "Unlinked mentions · 32",
  );
  await page.locator(".toast-action").last().click();
  check("Undo puts the words back as they were", await fileReads("Journal.md", JOURNAL));
  await idle(page);
  check("and the mention comes back", (await toggle.textContent()) === "Unlinked mentions · 33");

  await page.locator('.mention-link[data-mention-link="Journal.md"]').nth(1).click();
  check(
    "a mention that matches the name exactly becomes a plain link",
    await fileReads("Journal.md", JOURNAL.replace("the Reading list.", "the [[Reading list]].")),
  );
  await idle(page);
  await writeFile(file("Journal.md"), JOURNAL);
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Journal.md"]));
  await idle(page);

  const changed = "Spring plans: finish the novels pile.\n";
  await writeFile(file("Plans.md"), changed);
  await page.locator('.mention-link[data-mention-link="Plans.md"]').click();
  await idle(page);
  await page.waitForTimeout(300);
  check("a mention changed on disk since it was listed is left alone", (await readFile(file("Plans.md"), "utf8")) === changed);
  check("and says so", /changed/.test(await toastText()), await toastText());

  await page.locator('.mention-quote[data-mention-open="Weekly 1.md"]').click();
  await idle(page);
  check(
    "a mention opens its note with the words marked",
    (await page.evaluate(() => window.waymark.reader.notePath)) === "Weekly 1.md" &&
      (await page.evaluate(() => CSS.highlights?.get("search")?.size ?? document.querySelectorAll(".doc mark").length)) > 0,
  );

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
