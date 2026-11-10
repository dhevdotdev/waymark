// Organising notes in WebKit: search filters, copying links, sorting, dragging notes between folders, and pinning and reordering tabs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const pause = (ms) => page.waitForTimeout(ms);
const inVault = (name) => path.join(app.vault, name);
const put = async (name, text) => {
  await mkdir(path.dirname(inVault(name)), { recursive: true });
  await writeFile(inVault(name), text);
};
const read = (name) => readFile(inVault(name), "utf8");
const toastText = () =>
  page
    .locator(".toast")
    .last()
    .textContent()
    .catch(() => "");
const openNote = async (name) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(350);
};
const row = (file) => page.locator(`.nav-item[data-path="${file}"]`);
const folder = (name) => page.locator(`.tree-head[data-folder="${name}"]`);
const positions = () =>
  page.$$eval(".nav-item, .tree-head", (rows) =>
    rows.map((r) => `${r.textContent}:${Math.round(r.getBoundingClientRect().top)}`).join("|"),
  );

const showOnly = async (...folders) => {
  await page.evaluate((names) => {
    const { tree } = window.waymark.reader.sidebar;
    tree.collapseAll();
    for (const name of names) tree.focusFolder(name);
    document.querySelector(".sidebar-inner").scrollTop = 0;
  }, folders);
  await pause(300);
};

async function dragTo(from, to, during) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await pause(40);
  const seen = during ? await during() : null;
  await page.mouse.up();
  return seen;
}

try {
  /* Search filters (#17) */
  await put("Baking/Rye loaf.md", "A rye loaf with caraway and a cold retard overnight.\n");
  await put("Baking/Wheat loaf.md", "A wheat loaf with a cold retard overnight.\n");
  await put("Sailing/Rye harbour.md", "The rye crew moored at the harbour.\n");
  await openNote("Welcome");
  await page.keyboard.press("Meta+Shift+f");
  await pause(200);
  const input = page.locator(".sidebar-search input");
  const search = async (q) => {
    await input.fill(q);
    await pause(150);
    return page.$$eval(".search-hit", (hits) =>
      hits.map((h) => h.querySelector(".search-hit-title, strong")?.textContent ?? h.textContent),
    );
  };
  const hasTitle = (titles, word) => titles.some((t) => t.includes(word));
  let titles = await search("rye path:Baking");
  check("path: keeps results to a folder", hasTitle(titles, "Rye loaf") && !hasTitle(titles, "Rye harbour"), titles.join());
  titles = await search("loaf -caraway");
  check("-word leaves out notes with that word", hasTitle(titles, "Wheat loaf") && !hasTitle(titles, "Rye loaf"), titles.join());
  titles = await search('"cold retard" -caraway path:Baking');
  check(
    "filters combine with a quoted phrase",
    hasTitle(titles, "Wheat loaf") && !hasTitle(titles, "Rye loaf") && !hasTitle(titles, "Rye harbour"),
    titles.join(),
  );
  const marks = await page.$$eval(".search-hit mark", (m) => m.map((x) => x.textContent.toLowerCase()));
  check(
    "filter text is never highlighted",
    marks.length > 0 && marks.every((m) => !m.includes("path") && !m.includes("caraway") && !m.includes("baking")),
    marks.join(),
  );
  titles = await search("path:Baking -caraway");
  check(
    "a query with no words still lists what passes the filters",
    hasTitle(titles, "Wheat loaf") && !hasTitle(titles, "Rye loaf"),
    titles.join(),
  );
  titles = await search("-the");
  check("a query with only exclusions works", titles.length > 0 && !hasTitle(titles, "Rye harbour"), String(titles.length));
  check("nothing is marked when only filters were typed", (await page.locator(".search-hit mark").count()) === 0);
  await search("path:Nowhere rye");
  check(
    "no results say a filter is involved",
    (await page.locator(".sidebar-search .empty-state strong").textContent()).startsWith("No note matches"),
  );
  await search("rye -");
  check("a half-typed filter is ignored", (await page.locator(".search-hit").count()) >= 2);
  await search("rye path:");
  check("a half-typed path is ignored", (await page.locator(".search-hit").count()) >= 2);
  await page.keyboard.press("Escape");
  await pause(100);

  /* Copy a link (#21) */
  await put("Links/Field guide.md", "# Field guide\n\n## Soil: the first | layer\n\nText.\n\n## Water\n\nMore.\n");
  await put("Links/Twin.md", "One.\n");
  await put("Other/Twin.md", "Two.\n");
  await openNote("Field guide");
  await page.evaluate(() => {
    window.copied = [];
    const writeText = (text) => {
      window.copied.push(text);
      return Promise.resolve();
    };
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });
  const copied = () => page.evaluate(() => window.copied.at(-1));
  await row("Links/Field guide.md").click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Copy link")').click();
  await pause(120);
  check("the note menu copies the note's link", (await copied()) === "[[Field guide]]", await copied());
  check("copying shows what was copied", (await toastText()).includes("[[Field guide]]"), await toastText());
  await row("Links/Twin.md").click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Copy link")').click();
  await pause(120);
  check("a shared name copies the path", (await copied()) === "[[Links/Twin]]", await copied());
  await page.locator(".doc h2", { hasText: "Soil" }).click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Copy link to this heading")').click();
  await pause(120);
  check(
    "a heading's menu copies a heading link, with link-breaking characters removed",
    (await copied()) === "[[Field guide#Soil the first layer]]",
    await copied(),
  );
  await page.keyboard.press("Meta+k");
  await pause(150);
  await page.keyboard.type(">copy link to this note");
  await pause(150);
  await page.keyboard.press("Enter");
  await pause(150);
  check("the palette copies the note's link", (await copied()) === "[[Field guide]]", await copied());
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(300);
  await page.locator(".cm-line.cm-h2", { hasText: "Water" }).click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Copy link to this heading")').click();
  await pause(120);
  check("a heading in Edit copies the same link", (await copied()) === "[[Field guide#Water]]", await copied());
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
  });
  await page.locator(".cm-line.cm-h2", { hasText: "Water" }).click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Copy link to this note")').click();
  await pause(150);
  check("a failed copy says so", (await toastText()).includes("could not be copied"), await toastText());
  await page.keyboard.press("Meta+e");
  await pause(200);

  /* Sort by date (#19) */
  await put("Sorted/Apple.md", "a\n");
  await put("Sorted/Banana.md", "b\n");
  await put("Sorted/Cherry.md", "c\n");
  const at = (minutes) => new Date(Date.UTC(2026, 0, 1, 12, minutes));
  await utimes(inVault("Sorted/Apple.md"), at(1), at(1));
  await utimes(inVault("Sorted/Banana.md"), at(3), at(3));
  await utimes(inVault("Sorted/Cherry.md"), at(2), at(2));
  await openNote("Apple");
  const order = () =>
    page.$$eval('.tree-head[data-folder="Sorted"] ~ .tree-body .nav-item', (rows) =>
      rows.map((r) => r.dataset.path.replace("Sorted/", "").replace(".md", "")).join(),
    );
  check("notes start in name order", (await order()) === "Apple,Banana,Cherry", await order());
  const sortButton = page.locator('[data-act="sort-files"]');
  await sortButton.click();
  await pause(120);
  await page.locator('.context-item:has-text("Date modified")').click();
  await pause(300);
  check("sorting by date puts the newest first", (await order()) === "Banana,Cherry,Apple", await order());
  check("the control shows the choice", await sortButton.evaluate((b) => b.classList.contains("is-on")));
  check("sorting confirms itself", (await toastText()).includes("date modified"), await toastText());
  const vaultFiles = await readdir(app.vault);
  check(
    "the choice is not stored in the vault",
    !vaultFiles.includes(".obsidian") && !vaultFiles.some((f) => /waymark/i.test(f)),
    vaultFiles.filter((f) => f.startsWith(".")).join(),
  );
  await openNote("Apple");
  check("the choice survives a relaunch", (await order()) === "Banana,Cherry,Apple", await order());
  const same = at(9);
  for (const name of ["Apple", "Banana", "Cherry"]) await utimes(inVault(`Sorted/${name}.md`), same, same);
  await openNote("Apple");
  check("notes written at the same moment fall back to names", (await order()) === "Apple,Banana,Cherry", await order());
  await page.locator('[data-act="sort-files"]').click();
  await pause(120);
  await page.locator('.context-item:has-text("Name")').click();
  await pause(200);

  /* Dragging notes between folders (#18) */
  await put("Inbox/Alpha.md", "Alpha text.\n");
  await put("Inbox/Dup.md", "Inbox copy.\n");
  await put("Archive/Dup.md", "Archive copy.\n");
  await put("Archive/Old.md", "Old.\n");
  await put("Refs.md", "See [[Inbox/Alpha]] for more.\n");
  await put("Closed/Deep.md", "Deep.\n");
  await openNote("Refs");
  await showOnly("Inbox");
  const before = await positions();
  const seen = await dragTo(row("Inbox/Alpha.md"), folder("Archive"), async () => ({
    target: await folder("Archive").evaluate((h) => h.classList.contains("is-drop-target")),
    chip: await page.locator(".tree-drag-chip").textContent(),
    source: await row("Inbox/Alpha.md").evaluate((r) => r.classList.contains("is-drag-source")),
    still: (await positions()) === before,
  }));
  check("the drop target is marked", seen.target && seen.chip === "Alpha" && seen.source, JSON.stringify(seen));
  check("nothing in the list moves during a drag", seen.still);
  await pause(600);
  check("a dragged note moves on disk", existsSync(inVault("Archive/Alpha.md")) && !existsSync(inVault("Inbox/Alpha.md")));
  check("links to it are rewritten", (await read("Refs.md")).includes("[[Archive/Alpha]]"), await read("Refs.md"));
  check("the drop is confirmed", /Updated links in 1 note|Moved/.test(await toastText()), await toastText());
  check("the note's new row is marked", (await row("Archive/Alpha.md").count()) === 1);

  await showOnly("Inbox");
  await dragTo(row("Inbox/Dup.md"), folder("Archive"));
  await pause(400);
  check(
    "a note of the same name is never overwritten",
    (await read("Archive/Dup.md")) === "Archive copy.\n" && (await read("Inbox/Dup.md")) === "Inbox copy.\n",
  );
  check("a refused drop says why", (await toastText()).includes("already in"), await toastText());

  await showOnly("Inbox");
  const a = await row("Inbox/Dup.md").boundingBox();
  const b = await folder("Archive").boundingBox();
  await page.mouse.move(a.x + 20, a.y + 8);
  await page.mouse.down();
  await page.mouse.move(b.x + 40, b.y + 8, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await pause(250);
  check(
    "Escape cancels a drag",
    existsSync(inVault("Inbox/Dup.md")) &&
      (await page.locator(".tree-drag-chip").count()) === 0 &&
      (await page.locator(".is-drop-target").count()) === 0,
  );

  await showOnly("Inbox");
  const closed = folder("Closed");
  const c = await row("Inbox/Dup.md").boundingBox();
  const d = await closed.boundingBox();
  await page.mouse.move(c.x + 20, c.y + 8);
  await page.mouse.down();
  await page.mouse.move(d.x + 40, d.y + 8, { steps: 6 });
  await pause(800);
  check("a closed folder opens when held over", await closed.evaluate((h) => h.getAttribute("aria-expanded") === "true"));
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await pause(150);

  const scrollerBefore = await page.evaluate(() => {
    const box = document.querySelector(".sidebar-inner");
    box.scrollTop = 0;
    return box.scrollTop;
  });
  const first = await page.locator(".sidebar-inner .nav-item:visible").first().boundingBox();
  const edge = await page.locator(".sidebar-inner").boundingBox();
  await page.mouse.move(first.x + 20, first.y + 6);
  await page.mouse.down();
  await page.mouse.move(edge.x + 40, edge.y + edge.height - 8, { steps: 6 });
  await pause(700);
  const scrolled = await page.evaluate(() => document.querySelector(".sidebar-inner").scrollTop);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  check("the list scrolls near its edges during a drag", scrolled > scrollerBefore, String(scrolled));
  await pause(150);

  await put("Inbox/Editing.md", "Editing body.\n");
  await openNote("Editing");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(300);
  await page.locator(".cm-line", { hasText: "Editing body" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" unsaved");
  await showOnly("Inbox");
  await dragTo(row("Inbox/Editing.md"), folder("Archive"));
  await pause(900);
  check(
    "an open note with unsaved typing moves with its text",
    (await read("Archive/Editing.md")).includes("unsaved") && !existsSync(inVault("Inbox/Editing.md")),
    (await read("Archive/Editing.md")).slice(0, 40),
  );
  check(
    "the open note stays open at its new place",
    (await page.textContent(".tab.is-active .tab-title")).startsWith("Editing") &&
      (await page.locator(".cm-content").isVisible()),
  );
  await page.keyboard.press("Meta+e");
  await pause(300);

  await page.evaluate(() => {
    Object.defineProperty(window.waymark.reader.sync, "busy", { get: () => true, configurable: true });
  });
  await showOnly("Inbox");
  await dragTo(row("Inbox/Dup.md"), folder("Sorted"));
  await pause(300);
  check(
    "a drag during sync waits and says so",
    existsSync(inVault("Inbox/Dup.md")) && (await toastText()).includes("Sync is running"),
    await toastText(),
  );
  await page.evaluate(() => {
    delete window.waymark.reader.sync.busy;
  });

  await page.route("**/@vault/rename", (route) => route.abort());
  await dragTo(row("Inbox/Dup.md"), folder("Sorted"));
  await pause(500);
  check(
    "a failed move is shown and leaves the note",
    existsSync(inVault("Inbox/Dup.md")) && /could not|failed/i.test(await toastText()),
    await toastText(),
  );
  await page.unroute("**/@vault/rename");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await dragTo(row("Inbox/Dup.md"), folder("Closed"));
  await pause(80);
  const marked = await page.locator(".nav-item.is-landed").count();
  await pause(600);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check("Reduce Motion keeps the landing mark", marked === 1, String(marked));

  /* Tabs (#20) */
  await openNote("Welcome");
  const openTab = (note) => page.evaluate((n) => window.waymark.reader.open(`${n}.md`, { newTab: true, focus: true }), note);
  await openTab("Refs");
  await pause(120);
  await openTab("Sorted/Apple");
  await pause(120);
  await page.locator(".tab").first().click();
  await pause(120);
  const tabs = () => page.$$eval(".tab .tab-title", (t) => t.map((x) => x.textContent).join());
  const activeTab = () => page.textContent(".tab.is-active .tab-title");
  check("tabs start in the order they opened", (await tabs()) === "Welcome,Refs,Apple", await tabs());
  const t0 = await page.locator(".tab").nth(0).boundingBox();
  const t2 = await page.locator(".tab").nth(2).boundingBox();
  await page.mouse.move(t0.x + t0.width / 2, t0.y + 14);
  await page.mouse.down();
  await page.mouse.move(t2.x + t2.width - 6, t2.y + 14, { steps: 8 });
  await pause(40);
  const guide = await page.locator(".tab-drop:not([hidden])").count();
  await page.mouse.up();
  await pause(120);
  check("a tab can be dragged to a new place", (await tabs()) === "Refs,Apple,Welcome" && guide === 1, await tabs());
  check("the active tab stays active", (await activeTab()) === "Welcome");
  check("the moved tab is marked", (await page.locator(".tab.is-landed").count()) === 1);
  const inactive = await page.locator(".tab").nth(0).boundingBox();
  const last = await page.locator(".tab").nth(2).boundingBox();
  await page.mouse.move(inactive.x + inactive.width / 2, inactive.y + 14);
  await page.mouse.down();
  await pause(150);
  await page.mouse.move(last.x + last.width - 6, last.y + 14, { steps: 8 });
  await pause(150);
  const inactiveGuide = await page.locator(".tab-drop:not([hidden])").count();
  await page.mouse.up();
  await pause(250);
  check(
    "a tab that was not active can be dragged too, keeping its guide",
    inactiveGuide === 1 && (await tabs()) === "Apple,Welcome,Refs",
    `${inactiveGuide} ${await tabs()}`,
  );
  await page.locator(".tab").nth(2).click();
  await pause(120);
  const back = await page.locator(".tab").nth(2).boundingBox();
  const start = await page.locator(".tab").nth(0).boundingBox();
  await page.mouse.move(back.x + back.width / 2, back.y + 14);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y + 14, { steps: 8 });
  await pause(40);
  await page.mouse.up();
  await pause(250);
  await page.locator(".tab", { hasText: "Welcome" }).click();
  await pause(120);
  const t1 = await page.locator(".tab").nth(0).boundingBox();
  await page.mouse.move(t1.x + 20, t1.y + 14);
  await page.mouse.down();
  await page.mouse.move(t1.x + 200, t1.y + 14, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await pause(100);
  check("Escape cancels a tab drag", (await tabs()) === "Refs,Apple,Welcome", await tabs());
  await page.locator(".tab").nth(1).click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Pin tab")').click();
  await pause(150);
  check(
    "pinning moves a tab to the left and marks it",
    (await tabs()) === "Apple,Refs,Welcome" && (await page.locator(".tab.is-pinned").count()) === 1,
    await tabs(),
  );
  check("a pinned tab has no close button", (await page.locator(".tab.is-pinned .tab-close").count()) === 0);
  await page.locator(".tab.is-pinned").click();
  await pause(150);
  await page.keyboard.press("Meta+w");
  await pause(150);
  check(
    "closing a pinned tab says why",
    (await toastText()).includes("Unpin") && (await page.locator(".tab").count()) === 3,
    await toastText(),
  );
  await page.keyboard.press("Meta+k");
  await pause(150);
  await page.keyboard.type(">move tab right");
  await pause(150);
  await page.keyboard.press("Enter");
  await pause(150);
  check(
    "a pinned tab cannot leave the pinned group, and says so",
    (await tabs()) === "Apple,Refs,Welcome" && (await toastText()).includes("already last"),
    await toastText(),
  );
  await page.locator(".tab").nth(1).click();
  await pause(150);
  await page.keyboard.press("Meta+k");
  await pause(150);
  await page.keyboard.type(">move tab right");
  await pause(150);
  await page.keyboard.press("Enter");
  await pause(200);
  check("the palette moves a tab without dragging", (await tabs()) === "Apple,Welcome,Refs", await tabs());
  await page.evaluate(() => window.waymark.reader.persist());
  await pause(300);
  await page.goto(app.url);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(400);
  check(
    "order and pin survive a relaunch",
    (await tabs()) === "Apple,Welcome,Refs" && (await page.locator(".tab.is-pinned").count()) === 1,
    await tabs(),
  );
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("the run finished", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
  await app.close();
}

/* What a fresh clone does to modified times. Recorded so sorting by date stays honest. */
const base = await mkdtemp(path.join(tmpdir(), "waymark-clone-"));
try {
  const origin = path.join(base, "origin");
  await mkdir(origin);
  const git = (cwd, ...args) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd,
      stdio: "pipe",
    });
  git(origin, "init", "-q");
  for (let i = 0; i < 40; i++) await writeFile(path.join(origin, `Note ${String(i).padStart(2, "0")}.md`), "x\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "seed");
  const clone = path.join(base, "clone");
  git(base, "clone", "-q", origin, clone);
  const notes = (await readdir(clone)).filter((f) => f.endsWith(".md")).sort();
  const seconds = async () =>
    new Map(await Promise.all(notes.map(async (f) => [f, Math.floor((await stat(path.join(clone, f))).mtimeMs / 1000)])));
  const byDate = (times) => [...notes].sort((x, y) => times.get(y) - times.get(x) || x.localeCompare(y));
  const cloned = await seconds();
  const distinct = new Set(cloned.values()).size;
  check(
    "a fresh clone sorts by date in name order when its files land in the same second",
    distinct > 1 || byDate(cloned).join() === notes.join(),
    `${distinct} distinct second(s) across 40 notes`,
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await writeFile(path.join(origin, "Note 20.md"), "changed\n");
  git(origin, "add", "-A");
  git(origin, "commit", "-qm", "edit");
  git(clone, "pull", "-q");
  check("a note changed by a pull rises to the top", byDate(await seconds())[0] === "Note 20.md", byDate(await seconds())[0]);
} finally {
  await rm(base, { recursive: true, force: true });
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
