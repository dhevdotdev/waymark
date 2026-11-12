// Bookmarks, views from .base files, pasting from the web, and Obsidian's excluded files.
// Mutates only the throwaway fixture vault.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { fetchRoute } from "./route-fetch.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);

function installFakeGit() {
  const status = {
    isRepo: true,
    branch: "main",
    head: "abc",
    upstream: null,
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    files: [{ path: "AGENTS.md", origPath: null, staged: ".", unstaged: "M", conflicted: false }],
    operation: null,
  };
  window.__fakeGit = {
    status: async () => status,
    fetch: async () => status,
    log: async () => [],
    diff: async () => "diff --git a/AGENTS.md b/AGENTS.md\n--- a/AGENTS.md\n+++ b/AGENTS.md\n@@ -1 +1 @@\n-a\n+b\n",
  };
}

const app = await serveFixture();
const file = (name) => path.join(app.vault, name);
const put = async (name, text) => {
  await mkdir(path.dirname(file(name)), { recursive: true });
  await writeFile(file(name), text);
};
const disk = (name) => readFile(file(name), "utf8");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await mkdir(file(".obsidian"), { recursive: true });
await writeFile(
  file(".obsidian/app.json"),
  JSON.stringify({ userIgnoreFilters: ["AGENTS.md", "Hidden stuff/", "/\\.scratch\\.md$/", "/(/"] }),
);
await put("AGENTS.md", "# Agent rules\n\nuniquewordagents\n");
await put("Hidden stuff/Deep.md", "uniquewordhidden\n");
await put("Lists/temp.scratch.md", "uniquewordscratch\n");
await put("Links to agents.md", "See [[AGENTS]].\n");
await put("Items/One.md", "---\nstate: open\nrank: 2\n---\n\nFirst.\n");
await put("Items/Two.md", "---\nstate: open\nrank: 10\n---\n\nSecond.\n");
await put("Items/Three.md", "---\nstate: shut\nrank: 5\n---\n\nThird.\n");
const BASE = `filters:
  and:
    - note.state == "open"
properties:
  note.state:
    displayName: Condition
views:
  - type: table
    name: By rank
    order:
      - file.name
      - state
      - rank
    sort:
      - property: rank
        direction: DESC
  - type: table
    name: Shut only
    filters: note.state == "shut"
    order:
      - file.name
`;
await put("Views/Open items.base", BASE);
await put("Views/Cannot.base", 'filters: file.hasTag("x")\nviews:\n  - type: table\n');
await put("Views/Cards.base", "views:\n  - type: cards\n");
await put("Views/Broken.base", "views: [\n");
const HEADINGS = `# Top\n\n${"Filler paragraph that takes some room on the page.\n\n".repeat(40)}## Deep heading\n\nUnder the heading.\n\n${"More filler text to scroll past.\n\n".repeat(40)}`;
await put("Marked/Keep.md", HEADINGS);
await put("Marked/Going.md", "Will be deleted.\n");
await put("Elsewhere/Going.md", "A different note with the same name.\n");
await put("Paste.md", "# Paste\n\nStart.\n\n```js\nconst inside = 1;\n```\n\nEnd.\n");

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
const requests = [];
watchPageErrors(page, errors);
page.on("request", (r) => requests.push(r.url()));
await page.addInitScript(installFakeGit);
await page.route(/\/src\/platform\.ts/, async (route) => {
  const response = await fetchRoute(route);
  if (!response) return;
  await route.fulfill({ response, body: `${await response.text()}\n;Object.assign(git, window.__fakeGit ?? {});\n` });
});
await page.route(/\/src\/ui\/(sync-controller|reader|note-files)\.ts/, async (route) => {
  const response = await fetchRoute(route);
  if (!response) return;
  const body = (await response.text()).replace(
    /import\s*\{([^}]*)\}\s*from\s*"(\/src\/platform\.ts[^"]*)"/,
    (whole, names, from) =>
      /\bisDesktop\b/.test(names)
        ? `import {${names.replace(/\bisDesktop\b/, "isDesktop as __isDesktop")}} from "${from}";\nconst isDesktop = true`
        : whole,
  );
  await route.fulfill({ response, body });
});

const load = async (note) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(note)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(350);
};
const palette = async (query) => {
  await page.keyboard.press("Meta+k");
  await pause(120);
  await page.keyboard.type(query);
  await pause(150);
};
const runPalette = async (query) => {
  await palette(query);
  await page.keyboard.press("Enter");
  await pause(350);
};
const paletteRows = () => page.locator(".palette-row .palette-label").allTextContents();
const closePalette = async () => {
  await page.keyboard.press("Escape");
  await pause(250);
};
const lastToast = () => page.evaluate(() => [...document.querySelectorAll(".toast")].at(-1)?.textContent ?? "");
const currentPath = () => page.evaluate(() => window.waymark.reader.current);
const bookmarkRows = () => page.locator(".bookmarks .nav-item .nav-text").allTextContents();
const paste = (html, plain, extra = {}) =>
  page.evaluate(
    ([h, p, more]) => {
      const data = new DataTransfer();
      if (h) data.setData("text/html", h);
      data.setData("text/plain", p);
      for (const [type, value] of Object.entries(more)) data.setData(type, value);
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      document.querySelector(".cm-content").dispatchEvent(event);
      return event.defaultPrevented;
    },
    [html, plain, extra],
  );
const saved = () =>
  page.waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "saved", null, { timeout: 5000 });

try {
  /* ---- Excluded files ---- */
  await load("Links to agents");
  await page.evaluate(() => {
    for (const head of document.querySelectorAll(".tree-head[data-folder]")) head.click();
  });
  await pause(200);
  const treeText = await page.textContent(".sidebar");
  check("an excluded file is not in the sidebar", !treeText.includes("AGENTS"), "");
  check("an excluded folder is not in the sidebar", !treeText.includes("Hidden stuff"));
  check("a /regex/ entry is honoured", !treeText.includes("temp.scratch"));
  check("an unreadable pattern hides nothing else", treeText.includes("Items"));
  await palette("AGENTS");
  check(
    "an excluded file is not in the palette",
    !(await paletteRows()).includes("AGENTS"),
    (await paletteRows()).slice(0, 4).join(),
  );
  await closePalette();
  const hits = await page.evaluate(
    () =>
      window.waymark.reader.vault.search.search("uniquewordagents", 5).length +
      window.waymark.reader.vault.search.search("uniquewordhidden", 5).length,
  );
  check("an excluded file is not searchable", hits === 0, String(hits));
  const graphHas = await page.evaluate(() => window.waymark.reader.vault.index.notes.includes("AGENTS.md"));
  check("an excluded file is not a graph node", !graphHas);
  check(
    "a link to an excluded note still resolves",
    (await page.locator(".doc a.wikilink", { hasText: "AGENTS" }).getAttribute("data-path")) === "AGENTS.md",
  );
  await page.evaluate(() => window.waymark.reader.sync.panel.refresh());
  await pause(100);
  await page.click('[data-act="sync-panel"]');
  await pause(450);
  check("the sync panel still shows a changed excluded file", (await page.textContent(".sync-sheet")).includes("AGENTS"), "");
  const sheetBox = await page.locator(".sync-sheet").boundingBox();
  const sheetPixels = async () => {
    await page.mouse.move(4, 4);
    await pause(250);
    return page.screenshot({ clip: sheetBox });
  };
  const beforeDiff = await sheetPixels();
  await page.locator(".change-name").first().click();
  await page.waitForSelector(".sheet .diff-line");
  await pause(350);
  check(
    "the sync sheet is never hidden behind a diff",
    (await page.locator(".sync-sheet").evaluate((e) => getComputedStyle(e).visibility)) === "visible",
  );
  await page.keyboard.press("Escape");
  await pause(450);
  check("coming back from a diff shows the whole sync sheet", beforeDiff.equals(await sheetPixels()));
  await page.keyboard.press("Escape");
  await pause(350);
  check(
    "Obsidian's settings were not touched",
    (await disk(".obsidian/app.json")).includes("userIgnoreFilters") && !existsSync(file(".obsidian/bookmarks.json")),
  );

  /* ---- Bookmarks ---- */
  await load("Keep");
  const toggle = page.locator(".pane-head .pane-bookmark");
  const pressed = () => toggle.getAttribute("aria-pressed");
  const emptyLine = () =>
    page
      .locator(".bookmarks .bookmarks-empty")
      .textContent()
      .catch(() => "");
  check(
    "with no bookmarks the section is shown empty",
    (await bookmarkRows()).length === 0 && (await page.locator(".bookmarks > .tree-head").isVisible()),
  );
  check("the empty section says how to add one", (await emptyLine()).includes("next to a note's path"), await emptyLine());
  check("the toggle beside the path starts off", (await toggle.isVisible()) && (await pressed()) === "false");
  await toggle.click();
  await pause(350);
  check("the toggle bookmarks the note", (await bookmarkRows()).join() === "Keep", (await bookmarkRows()).join());
  check(
    "the toggle shows it is on",
    (await pressed()) === "true" && (await toggle.getAttribute("data-tip")) === "Remove bookmark",
  );
  check(
    "the open note is highlighted once, its bookmark only tinted",
    (await page.locator(".nav-item.is-current").count()) === 1 &&
      (await page.locator(".bookmarks .nav-item.is-here").count()) === 1,
  );
  check("the empty line goes once there is a bookmark", (await page.locator(".bookmarks-empty").count()) === 0);
  await toggle.click();
  await pause(350);
  check("the toggle removes the bookmark", (await bookmarkRows()).length === 0 && (await pressed()) === "false");
  check("the empty line comes back", (await page.locator(".bookmarks-empty").count()) === 1);
  await runPalette("Bookmark this note");
  check("the palette bookmarks a note", (await bookmarkRows()).join() === "Keep", (await bookmarkRows()).join());
  check("the toggle follows a palette bookmark", (await pressed()) === "true");
  await page.evaluate(() => document.querySelector(".scroller").scrollTo({ top: 3400 }));
  await pause(200);
  await runPalette("Bookmark the current heading");
  check(
    "the current heading can be bookmarked",
    (await bookmarkRows()).includes("Keep › Deep heading"),
    (await bookmarkRows()).join(),
  );
  await load("Going");
  await page.evaluate(() => window.waymark.reader.open("Marked/Going.md", {}));
  await pause(250);
  await runPalette("Bookmark this note");
  const beforeBytes = await disk("Marked/Keep.md");
  await page.evaluate(() => window.waymark.prefs.flush());
  await page.reload();
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(400);
  check("bookmarks survive a relaunch", (await bookmarkRows()).length === 3, (await bookmarkRows()).join());
  await page.locator(".bookmarks .nav-item", { hasText: "Deep heading" }).click();
  await pause(500);
  const headingAt = await page.evaluate(() => {
    const heading = [...document.querySelectorAll(".doc h2")].find((h) => h.textContent.includes("Deep heading"));
    return Math.round(heading.getBoundingClientRect().top - document.querySelector(".scroller").getBoundingClientRect().top);
  });
  check("a heading bookmark goes to the heading", headingAt >= 0 && headingAt < 240, String(headingAt));
  await palette("");
  check("the palette lists bookmarks", (await page.locator(".palette-group", { hasText: "Bookmarks" }).count()) === 1);
  await page.keyboard.type("Deep heading");
  await pause(150);
  check(
    "a query finds a heading bookmark",
    (await paletteRows()).some((r) => r.includes("Deep heading")),
    (await paletteRows()).slice(0, 3).join(),
  );
  await closePalette();

  await page.evaluate(() => window.waymark.reader.files.renameTo("Marked/Keep.md", "Kept"));
  await pause(500);
  check(
    "a bookmark follows a rename",
    (await bookmarkRows()).includes("Kept") && !(await bookmarkRows()).includes("Keep"),
    (await bookmarkRows()).join(),
  );
  check("a heading bookmark follows a rename", (await bookmarkRows()).includes("Kept › Deep heading"));
  await page.locator(".bookmarks .nav-item", { hasText: "Going" }).click();
  await pause(300);
  await unlink(file("Marked/Going.md"));
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Marked/Going.md"]));
  await pause(300);
  const missingRow = page.locator(".bookmarks .nav-item.is-missing", { hasText: "Going" });
  check("a deleted note shows as missing", (await missingRow.count()) === 1);
  await page.evaluate(() => window.waymark.reader.open("Links to agents.md", {}));
  await pause(250);
  await missingRow.click();
  await pause(300);
  check("a missing bookmark opens nothing", (await currentPath()) === "Links to agents.md", await currentPath());
  check("not even a note with the same name", (await currentPath()) !== "Elsewhere/Going.md");
  check("it says why", (await lastToast()).includes("no longer in the vault"), await lastToast());

  await put("Marked/Kept.md", (await disk("Marked/Kept.md")).replace("## Deep heading", "## Renamed heading"));
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Marked/Kept.md"]));
  await pause(200);
  await page.locator(".bookmarks .nav-item", { hasText: "Deep heading" }).click();
  await pause(400);
  check(
    "a heading that is gone opens the note and says so",
    (await currentPath()) === "Marked/Kept.md" && (await lastToast()).includes("heading is no longer"),
    await lastToast(),
  );
  await page.locator(".bookmarks .nav-item", { hasText: "Deep heading" }).hover();
  await pause(120);
  await page.locator('.row-action[aria-label="Remove bookmark"]').click();
  await pause(150);
  check(
    "a bookmark can be removed from its row",
    !(await bookmarkRows()).some((r) => r.includes("Deep heading")),
    (await bookmarkRows()).join(),
  );
  check(
    "bookmarks never touched a note",
    beforeBytes.replace("## Deep heading", "## Renamed heading") === (await disk("Marked/Kept.md")),
  );
  check(
    "bookmarks are in the app's storage only",
    (await page.evaluate(() => JSON.stringify(window.waymark.prefs.value))).includes("Marked/Kept.md"),
  );

  /* ---- Views ---- */
  const baseBefore = await disk("Views/Open items.base");
  await load("Links to agents");
  await page.evaluate(() => {
    const head = document.querySelector('.tree-head[data-folder="Views"]');
    if (head.getAttribute("aria-expanded") !== "true") head.click();
  });
  await pause(250);
  await page.locator('.nav-item[data-path="Views/Open items.base"]').click();
  await page.waitForSelector(".doc.is-base table");
  await pause(200);
  const header = () => page.locator(".doc.is-base th").allTextContents();
  const firstColumn = () => page.locator(".doc.is-base tbody tr td:first-child").allTextContents();
  check(
    "a view opens from the sidebar with its display names",
    (await header()).join() === "file.name,Condition,rank",
    (await header()).join(),
  );
  check(
    "only matching notes appear, in the view's order",
    (await firstColumn()).join() === "Two,One",
    (await firstColumn()).join(),
  );
  check("it says how many", (await page.textContent(".base-count")).includes("2 notes"));
  check("there is no Edit control", !(await page.locator(".mode-switch").isVisible()));

  await page.locator(".base-views button", { hasText: "Shut only" }).click();
  await pause(250);
  check(
    "each view has its own filter and columns",
    (await firstColumn()).join() === "" || (await page.locator(".base-notice").count()) === 1,
    (await firstColumn()).join(),
  );
  await page.locator(".base-views button", { hasText: "By rank" }).click();
  await pause(250);

  await put("Items/Three.md", "---\nstate: open\nrank: 7\n---\n\nThird.\n");
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Items/Three.md"]));
  await pause(300);
  check(
    "the table follows a frontmatter change on disk",
    (await firstColumn()).join() === "Two,Three,One",
    (await firstColumn()).join(),
  );

  await page.locator(".doc.is-base tbody tr", { hasText: "One" }).click();
  await pause(350);
  check("a row opens its note", (await currentPath()) === "Items/One.md", await currentPath());
  await page.keyboard.press("Meta+[");
  await pause(350);
  check("back returns to the view", (await page.locator(".doc.is-base table").count()) === 1);
  await page.keyboard.press("Meta+]");
  await pause(350);
  check("forward goes to the note again", (await currentPath()) === "Items/One.md");
  await page.keyboard.press("Meta+[");
  await pause(300);
  await page.evaluate(() => window.waymark.prefs.flush());
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.waymark.reader.persist();
    return window.waymark.prefs.flush();
  });
  await page.goto(app.url);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(600);
  check("the view is restored with its tab", (await page.locator(".doc.is-base table").count()) === 1);

  await palette("Open items");
  check("a view is in the palette", (await paletteRows()).includes("Open items"), (await paletteRows()).slice(0, 3).join());
  await closePalette();

  const openBase = async (name) => {
    await page.evaluate((n) => window.waymark.reader.open(n, {}), name);
    await pause(350);
  };
  await openBase("Views/Cannot.base");
  check("a filter it cannot evaluate says so", (await page.textContent(".base-notice")).includes('file.hasTag("x")'));
  check("and shows no list", (await page.locator(".doc.is-base table").count()) === 0);
  await openBase("Views/Cards.base");
  check("a view type it cannot show says so", (await page.textContent(".base-notice")).includes("cards"));
  await openBase("Views/Broken.base");
  check(
    "a malformed file gives a readable error",
    (await page.textContent(".base-notice")).includes("not valid YAML"),
    await page.textContent(".base-notice"),
  );
  check("the .base file was never written", (await disk("Views/Open items.base")) === baseBefore);

  /* ---- Paste ---- */
  await load("Paste");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(250);
  const atLine = async (text) => {
    await page.locator(".cm-line", { hasText: text }).click();
    await page.keyboard.press("End");
  };
  await atLine("End.");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await pause(600);
  const beforePaste = await page.evaluate(() => document.querySelector(".cm-content").textContent);
  const prevented = await paste(
    '<!-- c --><script>window.pwned=1</script><h2>Web title</h2><p>A <strong>bold</strong> move.</p><ul><li>one</li></ul><img src="https://example.invalid/pic.png" alt="Remote"><table><tr><th>A</th></tr><tr><td>1</td></tr></table>',
    "plain",
  );
  await saved();
  await pause(150);
  const text = await disk("Paste.md");
  check(
    "pasted HTML becomes Markdown",
    prevented && text.includes("## Web title") && text.includes("**bold**") && text.includes("- one") && text.includes("| A |"),
    text.slice(-120),
  );
  check(
    "a remote image stays a plain link",
    text.includes("[Remote](https://example.invalid/pic.png)") && !text.includes("![Remote"),
  );
  check("no request went to the image's host", !requests.some((u) => u.includes("example.invalid")));
  check("no pasted script ran", (await page.evaluate(() => window.pwned)) === undefined);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await saved();
  await pause(150);
  check(
    "one undo reverts the whole paste",
    (await page.evaluate(() => document.querySelector(".cm-content").textContent)) === beforePaste,
  );

  await atLine("const inside");
  await paste("<b>bold</b>", "plain code");
  await saved();
  await pause(150);
  check(
    "paste inside a code block stays plain",
    (await disk("Paste.md")).includes("plain code") && !(await disk("Paste.md")).includes("**bold**"),
  );

  await atLine("Start.");
  const pastedAs = async (html, plain, extra) => {
    await paste(html, plain, extra);
    await saved();
    await pause(150);
    return disk("Paste.md");
  };
  const vscode = await pastedAs('<div style="color:#fff"><b>vscodetext</b></div>', "vscodetext", { "vscode-editor-data": "{}" });
  check("a copy from VS Code pastes as its plain text", vscode.includes("vscodetext") && !vscode.includes("**vscodetext**"));
  const jetbrains = await pastedAs(
    `<pre style="font-family:'JetBrains Mono',monospace"><span style="color:#cc7832;font-weight:bold">letkeyword</span></pre>`,
    "letkeyword",
  );
  check(
    "a styled monospace copy pastes as its plain text",
    jetbrains.includes("letkeyword") && !jetbrains.includes("**letkeyword") && !jetbrains.includes("```\nletkeyword"),
  );
  const words = await pastedAs("<p>justwords</p>", "justwords");
  check("HTML with no formatting pastes as text", words.includes("justwords"));

  await page.evaluate(() => {
    navigator.clipboard.readText = async () => "**not bold** plain";
  });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+v" : "Control+Shift+v");
  await saved();
  await pause(150);
  check("⌘⇧V pastes the plain text as it is", (await disk("Paste.md")).includes("**not bold** plain"));

  await atLine("End.");
  await page.keyboard.press("Shift+Home");
  await pause(100);
  check("a URL over a selection still makes a link", await paste("", "https://example.org/a"));
  await saved();
  await pause(150);
  check(
    "and writes it",
    /\[End\.?\]?.*\(https:\/\/example\.org\/a\)/.test(await disk("Paste.md")),
    (await disk("Paste.md")).slice(-60),
  );
  await page.keyboard.press("Meta+e");
  await pause(300);

  check("the vault gained no .obsidian/bookmarks.json", !readdirSync(file(".obsidian")).includes("bookmarks.json"));
  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  results.push(`FAIL  the run stopped: ${String(error).split("\n").slice(0, 6).join(" | ").slice(0, 600)}`);
} finally {
  await browser.close();
  await app.close();
}

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
