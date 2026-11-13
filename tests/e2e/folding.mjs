// Folding sections under headings in Read and Edit, and the /toggle block.
// Usage: node tests/e2e/folding.mjs [reduced]
// Pointer actions are dispatched as DOM events, so the suite also runs while the Mac's screen is locked.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const filler = (word, n = 3) =>
  Array.from({ length: n }, (_, i) => `${word} paragraph ${i + 1} sits under this heading so the section has length.`).join(
    "\n\n",
  );
const NOTES = {
  "Folding.md": `# Folding\n\nIntro.\n\n## Setup\n\n${filler("Setup")}\n\n### Install\n\n${filler("Install")}\n\n### Configure\n\nConfigure holds the word zebrafish.\n\n## Usage\n\n${filler("Usage", 12)}\n\n\`\`\`bash\n# not a heading\n\`\`\`\n\n## Setup\n\nSecond setup.\n\n## Empty\n`,
  "Pointer.md": "# Pointer\n\nSee [[Folding#Configure]] for details.\n",
  "Tight.md": "# Tight\n\n## First\nbody line\n## Second\nmore\n",
};

const app = await serveFixture();
for (const [name, text] of Object.entries(NOTES)) await writeFile(path.join(app.vault, name), text);
const disk = (name) => readFile(path.join(app.vault, name), "utf8");
const browser = await webkit.launch();
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1320, height: 860 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await context.newPage();
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);

/** A click from the pointer, sent as events so it works without a window server. */
const pointerClick = (selector, n = 0) =>
  page.evaluate(
    ([sel, i]) => {
      const el = document.querySelectorAll(sel)[i];
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      el.click();
    },
    [selector, n],
  );
const state = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".doc > *")]
      .map((el) => `${el.tagName}${el.hasAttribute("data-folded") ? "*" : ""}${el.hasAttribute("data-fold-hidden") ? "-" : ""}`)
      .join(" "),
  );
const topOf = (selector, n = 0) =>
  page.evaluate(([sel, i]) => document.querySelectorAll(sel)[i].getBoundingClientRect().top, [selector, n]);
const savedFolds = () =>
  page.evaluate(async () => {
    await window.waymark.reader.deps.prefs.flush();
    const vaults = JSON.parse(localStorage.getItem("waymark.prefs") ?? "{}").vaults ?? {};
    return Object.values(vaults)[0]?.folds ?? {};
  });
const runningFades = () =>
  page.evaluate(() => [...document.querySelectorAll(".doc > *")].reduce((n, el) => n + el.getAnimations().length, 0));
/** Puts the editor's cursor at the start of the first line that starts with `text`. */
const cursorOn = (text) =>
  page.evaluate(async (start) => {
    const { editing } = window.waymark.reader;
    const lines = editing.session.draft.text.split("\n");
    editing.session.editor.revealLine(lines.findIndex((line) => line.startsWith(start)));
  }, text);
const open = async (name) => {
  await page.evaluate((target) => window.waymark.open(target), name);
  await pause(400);
};

try {
  await page.goto(`${app.url}?note=Folding`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(500);

  const controls = await page.evaluate(() =>
    [...document.querySelectorAll(".doc > :is(h1, h2, h3, h4, h5, h6)")].map(
      (h) => `${h.textContent}:${!!h.querySelector(".fold-toggle")}`,
    ),
  );
  check(
    "every heading with something under it has a fold control, and an empty one has none",
    JSON.stringify(controls) ===
      JSON.stringify(["Folding:true", "Setup:true", "Install:true", "Configure:true", "Usage:true", "Setup:true", "Empty:false"]),
    JSON.stringify(controls),
  );
  check("a comment in a code block is not a heading", (await page.locator(".doc .fold-toggle").count()) === 6);

  const before = await topOf(".doc > h2");
  await pointerClick(".doc > h2 .fold-toggle");
  const folded = await state();
  check(
    "a pointer fold hides the section and the headings inside it",
    folded === "HEADER H1 P H2* P- P- P- H3- P- P- P- H3- P- H2 P P P P P P P P P P P P DIV H2 P H2 SECTION",
    folded,
  );
  check("the folded heading stays exactly where it was", Math.abs((await topOf(".doc > h2")) - before) < 0.5);
  check(
    "a folded heading says so with its chevron and a trailing mark",
    (await page.getAttribute(".doc > h2 .fold-toggle", "aria-expanded")) === "false" &&
      (await page.locator(".doc > h2[data-folded] .fold-more").isVisible()),
  );
  await pause(500);
  check("the fold is kept in the app's preferences", JSON.stringify((await savedFolds())["Folding.md"]) === '["setup#0"]');
  check("the note itself is untouched", (await disk("Folding.md")) === NOTES["Folding.md"]);

  await pointerClick(".doc > h2[data-folded] .fold-more");
  check("the trailing mark unfolds", !(await state()).includes("-"));
  check("content revealed by the pointer fades in, and only fades", (await runningFades()) > 0);
  await pause(400);

  await page.evaluate(() => {
    const s = document.querySelector(".scroller");
    s.scrollTop +=
      [...document.querySelectorAll(".doc > p")]
        .find((p) => p.textContent.startsWith("Install paragraph 1"))
        .getBoundingClientRect().top - s.getBoundingClientRect().top;
  });
  await page.keyboard.press("Meta+Alt+BracketLeft");
  check("⌥⌘[ folds the section being read", (await state()).includes("H3* P- P- P- H3 P"), await state());
  check("a keyboard fold does not animate", (await runningFades()) === 0);
  const landed = await page.evaluate(
    () =>
      document.querySelector(".doc > h3").getBoundingClientRect().top -
      document.querySelector(".scroller").getBoundingClientRect().top,
  );
  check("and puts the heading that hid the reader's place at the top", Math.abs(landed - 32) < 1, landed);
  const readingTop = await topOf(".doc > h3");
  await page.keyboard.press("Meta+Alt+BracketLeft");
  check("⌥⌘[ again unfolds it", !(await state()).includes("*"), await state());
  check("with the heading held where it is", Math.abs((await topOf(".doc > h3")) - readingTop) < 0.5);
  check("a keyboard unfold does not fade", (await runningFades()) === 0);

  await page.keyboard.press("Meta+Alt+Shift+BracketLeft");
  check(
    "⌥⇧⌘[ folds every section",
    (await state()) ===
      "HEADER H1* P- H2*- P- P- P- H3*- P- P- P- H3*- P- H2*- P- P- P- P- P- P- P- P- P- P- P- P- DIV- H2*- P- H2- SECTION",
    await state(),
  );
  await page.keyboard.press("Meta+Alt+Shift+BracketRight");
  check("⌥⇧⌘] unfolds every section", !(await state()).includes("*"));

  await pointerClick(".doc > h3 .fold-toggle", 1);
  await pointerClick(".doc > h2 .fold-toggle");
  await pause(600);
  await page.reload();
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(500);
  check("folds survive a restart", (await state()).startsWith("HEADER H1 P H2* P- P- P- H3- P- P- P- H3*- P-"), await state());
  const outline = await page.evaluate(() =>
    [...document.querySelectorAll(".floating-outline a")].map(
      (a) => `${a.textContent}${a.classList.contains("is-folded") ? "*" : ""}${a.classList.contains("is-hidden") ? "-" : ""}`,
    ),
  );
  check(
    "the outline shows the folded section and dims what it hides",
    outline.join(" ") === "Setup* Install- Configure*- Usage Setup Empty",
    outline.join(" "),
  );

  await pointerClick('.floating-outline a[data-target="h-install"]');
  check(
    "an outline click unfolds what hid the heading",
    (await state()).startsWith("HEADER H1 P H2 P P P H3 P P P H3* P"),
    await state(),
  );
  check("the outline follows", (await page.locator(".floating-outline a.is-hidden").count()) === 0);
  await pause(600);

  await page.keyboard.press("Meta+f");
  await page.keyboard.type("zebrafish");
  await page.keyboard.press("Enter");
  await pause(100);
  check("find landing on a folded match unfolds that section", !(await state()).includes("*"), await state());
  await page.keyboard.press("Escape");

  await pointerClick(".doc > h3 .fold-toggle", 1);
  await pointerClick(".doc > h2 .fold-toggle");
  await open("Pointer.md");
  await pointerClick('.doc a.wikilink[data-anchor="Configure"]');
  await pause(500);
  const linked = await state();
  check(
    "a link to a folded heading unfolds the way to it and its own section",
    !linked.includes("*") && !linked.includes("-"),
    linked,
  );
  const target = await page.evaluate(() => {
    const h = document.querySelectorAll(".doc > h3")[1].getBoundingClientRect();
    const s = document.querySelector(".scroller").getBoundingClientRect();
    return h.top >= s.top && h.bottom <= s.bottom;
  });
  check("and the heading is on screen", target);

  await pointerClick(".doc > h2 .fold-toggle", 1);
  await page.evaluate(() => window.waymark.reader.sidebar.showSearch());
  await page.keyboard.type("paragraph 12");
  await pause(400);
  await page.keyboard.press("Enter");
  await pause(500);
  check("opening a search result inside a fold unfolds it", !(await state()).includes("*"), await state());

  const placed = await page.evaluate(async () => {
    const s = document.querySelector(".scroller");
    const p = [...document.querySelectorAll(".doc > p")].find((el) => el.textContent.startsWith("Usage paragraph 3"));
    s.scrollTop += p.getBoundingClientRect().top - s.getBoundingClientRect().top;
    const { reader } = window.waymark;
    reader.spots.record();
    reader.noteView.foldStore.set("Folding.md", ["usage#0"]);
    await reader.deps.prefs.flush();
    return p.getBoundingClientRect().top - s.getBoundingClientRect().top;
  });
  await page.reload();
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(600);
  const restored = await page.evaluate(() => {
    const p = [...document.querySelectorAll(".doc > p")].find((el) => el.textContent.startsWith("Usage paragraph 3"));
    return {
      hidden: p.hasAttribute("data-fold-hidden"),
      top: p.getBoundingClientRect().top - document.querySelector(".scroller").getBoundingClientRect().top,
    };
  });
  check(
    "coming back to a place inside a folded section unfolds it",
    !restored.hidden && Math.abs(restored.top - placed) < 2,
    `${JSON.stringify(restored)} was ${placed}`,
  );

  // Edit shares the same folds.
  await page.keyboard.press("Meta+Alt+Shift+BracketRight");
  await pointerClick(".doc > h3 .fold-toggle", 1);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(500);
  const editFolded = await page.evaluate(() => [...document.querySelectorAll(".cm-line.cm-folded")].map((l) => l.textContent));
  check(
    "a section folded in Read is folded in Edit",
    JSON.stringify(editFolded) === JSON.stringify(["### Configure"]),
    JSON.stringify(editFolded),
  );
  check(
    "Edit hides its text",
    !(await page.evaluate(() => document.querySelector(".cm-content").textContent.includes("zebrafish"))),
  );

  /** A press on the chevron Edit draws in the margin beside a heading's first line. */
  const chevronPress = (text) =>
    page.evaluate((heading) => {
      const head = [...document.querySelectorAll(".cm-fold-head")].find((h) => h.textContent === heading);
      const start = head.getClientRects()[0];
      const at = { bubbles: true, button: 0, clientX: start.left - 15, clientY: (start.top + start.bottom) / 2 };
      head.dispatchEvent(new MouseEvent("mousedown", at));
      head.dispatchEvent(new MouseEvent("mouseup", at));
    }, text);
  const editFolds = () => page.evaluate(() => [...document.querySelectorAll(".cm-line.cm-folded")].map((l) => l.textContent));
  const line = () => page.locator(".status-stats").textContent();
  const lineBefore = await line();
  await chevronPress("## Setup");
  await pause(100);
  check(
    "a press on Edit's chevron folds its section and leaves the cursor alone",
    (await editFolds()).includes("## Setup") && (await line()) === lineBefore,
    `${JSON.stringify(await editFolds())} ${await line()}`,
  );
  await chevronPress("## Setup");
  await pause(100);
  check("and a second press unfolds it", !(await editFolds()).includes("## Setup"), JSON.stringify(await editFolds()));

  await cursorOn("Usage paragraph 2");
  await page.keyboard.press("Meta+Alt+BracketLeft");
  await pause(100);
  const afterKey = await page.evaluate(() => [...document.querySelectorAll(".cm-line.cm-folded")].map((l) => l.textContent));
  check("⌥⌘[ in Edit folds the section around the cursor", afterKey.includes("## Usage"), JSON.stringify(afterKey));
  check(
    "and the cursor moves to its heading rather than out of sight",
    (await page.locator(".status-stats").textContent()).includes(
      `Ln ${NOTES["Folding.md"].split("\n").indexOf("## Usage") + 1},`,
    ),
    await page.locator(".status-stats").textContent(),
  );
  await page.keyboard.type(" notes");
  await pause(100);
  check(
    "typing at the end of a folded heading keeps it folded",
    (await page.locator(".cm-line.cm-folded", { hasText: "## Usage notes" }).count()) === 1,
  );

  await page.keyboard.press("Meta+f");
  await page.keyboard.type("zebrafish");
  await page.keyboard.press("Enter");
  await pause(150);
  check(
    "find in Edit unfolds a match out of sight",
    await page.evaluate(() => document.querySelector(".cm-content").textContent.includes("zebrafish")),
  );
  await page.keyboard.press("Escape");

  await page.keyboard.press("Meta+e");
  await pause(600);
  check("Edit's folds come back to Read", (await state()).includes("H2*"), await state());
  check(
    "the edited heading keeps its fold",
    JSON.stringify((await savedFolds())["Folding.md"]) === '["usage notes#0"]',
    JSON.stringify(await savedFolds()),
  );

  await open("Tight.md");
  await pointerClick(".doc > h2 .fold-toggle");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(400);
  await cursorOn("## Second");
  await page.keyboard.press("Backspace");
  await pause(100);
  check(
    "deleting into a folded section unfolds it, so nothing changes out of sight",
    (await page.locator(".cm-line.cm-folded").count()) === 0 &&
      (await page.evaluate(() => document.querySelector(".cm-content").textContent.includes("body line## Second"))),
  );
  await page.keyboard.press("Meta+z");

  // The /toggle block.
  await cursorOn("more");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/toggle");
  await pause(200);
  const offered = await page.locator(".cm-tooltip-autocomplete li").allTextContents();
  check(
    "the slash menu offers Toggle",
    offered.some((o) => o.includes("Toggle")),
    offered.join(" | "),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("Hidden title");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type("Hidden body");
  await page.waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "saved", null, { timeout: 5000 });
  const written = await disk("Tight.md");
  check(
    "Toggle writes a collapsed callout with the caret on its title",
    written.endsWith("\n> [!note]- Hidden title\n> Hidden body\n") ||
      written.endsWith("\n> [!note]- Hidden title\n> Hidden body"),
    JSON.stringify(written.slice(-60)),
  );
  await page.keyboard.press("Meta+e");
  await pause(600);
  const callout = await page.evaluate(() => {
    const c = document.querySelector('.callout[data-fold="closed"]');
    const path = c?.querySelector(".callout-chevron path");
    return { closed: !!c, d: path?.getAttribute("d"), width: path?.getBoundingClientRect().width };
  });
  check(
    "the toggle reads as a closed callout with its chevron drawn",
    callout.closed && callout.d === "M6 4l4 4-4 4" && callout.width > 2,
    JSON.stringify(callout),
  );
  await pointerClick(".callout-title");
  check("and opens on click", (await page.getAttribute(".callout-title", "aria-expanded")) === "true");

  // A fold whose heading has gone is dropped quietly.
  await open("Folding.md");
  await writeFile(
    path.join(app.vault, "Folding.md"),
    NOTES["Folding.md"].replace("## Usage notes", "## Renamed").replace("## Usage", "## Renamed"),
  );
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Folding.md"]));
  await pause(700);
  check(
    "a fold whose heading is gone is forgotten",
    !(await state()).includes("*") && !((await savedFolds())["Folding.md"]?.length > 0),
    JSON.stringify(await savedFolds()),
  );

  await pointerClick(".doc > h2 .fold-toggle");
  await page.evaluate(() => window.waymark.reader.files.renameTo("Folding.md", "Folded"));
  await pause(800);
  const moved = await savedFolds();
  check(
    "folds follow a renamed note",
    JSON.stringify(moved["Folded.md"]) === '["setup#0"]' && !moved["Folding.md"] && (await state()).includes("H2*"),
    JSON.stringify(moved),
  );

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
