// Organising notes in WebKit: search filters, copying links, sorting, dragging notes between folders, and pinning and reordering tabs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from "playwright";
import { idle, watchIdle, writesSettled } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await watchIdle(page);
const errors = [];
watchPageErrors(page, errors);
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
  await idle(page);
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
  await idle(page);
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
  await idle(page);
  const input = page.locator(".sidebar-search input");
  const search = async (q) => {
    await input.fill(q);
    await idle(page);
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
  await idle(page);

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
  await idle(page);
  await page.locator('.context-item:has-text("Copy link")').click();
  await idle(page);
  check("the note menu copies the note's link", (await copied()) === "[[Field guide]]", await copied());
  check("copying shows what was copied", (await toastText()).includes("[[Field guide]]"), await toastText());
  await row("Links/Twin.md").click({ button: "right" });
  await idle(page);
  await page.locator('.context-item:has-text("Copy link")').click();
  await idle(page);
  check("a shared name copies the path", (await copied()) === "[[Links/Twin]]", await copied());
  await page.locator(".doc h2", { hasText: "Soil" }).click({ button: "right" });
  await idle(page);
  await page.locator('.context-item:has-text("Copy link to this heading")').click();
  await idle(page);
  check(
    "a heading's menu copies a heading link, with link-breaking characters removed",
    (await copied()) === "[[Field guide#Soil the first layer]]",
    await copied(),
  );
  await page.keyboard.press("Meta+k");
  await idle(page);
  await page.keyboard.type(">copy link to this note");
  await idle(page);
  await page.keyboard.press("Enter");
  await idle(page);
  check("the palette copies the note's link", (await copied()) === "[[Field guide]]", await copied());
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  await page.locator(".cm-line.cm-h2", { hasText: "Water" }).click({ button: "right" });
  await idle(page);
  await page.locator('.context-item:has-text("Copy link to this heading")').click();
  await idle(page);
  check("a heading in Edit copies the same link", (await copied()) === "[[Field guide#Water]]", await copied());
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
  });
  await page.locator(".cm-line.cm-h2", { hasText: "Water" }).click({ button: "right" });
  await idle(page);
  await page.locator('.context-item:has-text("Copy link to this note")').click();
  await idle(page);
  check("a failed copy says so", (await toastText()).includes("could not be copied"), await toastText());
  await page.keyboard.press("Meta+e");
  await idle(page);

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
  await writesSettled(page, 120);
  await page.locator('.context-item:has-text("Date modified")').click();
  await writesSettled(page, 300);
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
  await idle(page);
  await page.locator('.context-item:has-text("Name")').click();
  await idle(page);

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
  await idle(page);
  check("a dragged note moves on disk", existsSync(inVault("Archive/Alpha.md")) && !existsSync(inVault("Inbox/Alpha.md")));
  check("links to it are rewritten", (await read("Refs.md")).includes("[[Archive/Alpha]]"), await read("Refs.md"));
  check("the drop is confirmed", /Updated links in 1 note|Moved/.test(await toastText()), await toastText());
  check("the note's new row is marked", (await row("Archive/Alpha.md").count()) === 1);

  await showOnly("Inbox");
  await dragTo(row("Inbox/Dup.md"), folder("Archive"));
  await idle(page);
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
  await idle(page);
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
  await idle(page);

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
  await idle(page);

  await put("Inbox/Editing.md", "Editing body.\n");
  await openNote("Editing");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  await page.locator(".cm-line", { hasText: "Editing body" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" unsaved");
  await showOnly("Inbox");
  await dragTo(row("Inbox/Editing.md"), folder("Archive"));
  await idle(page);
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
  await idle(page);

  await page.evaluate(() => {
    Object.defineProperty(window.waymark.reader.sync, "busy", { get: () => true, configurable: true });
  });
  await showOnly("Inbox");
  await dragTo(row("Inbox/Dup.md"), folder("Sorted"));
  await idle(page);
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
  await idle(page);
  check(
    "a failed move is shown and leaves the note",
    existsSync(inVault("Inbox/Dup.md")) && /could not|failed/i.test(await toastText()),
    await toastText(),
  );
  await page.unroute("**/@vault/rename");

  await page.emulateMedia({ reducedMotion: "reduce" });
  /* The mark goes on once the move is written, which a slow machine takes longer to do than a fixed pause. */
  const landing = page.evaluate(
    () =>
      new Promise((resolve) => {
        const look = () => {
          const count = document.querySelectorAll(".nav-item.is-landed").length;
          if (!count) return;
          observer.disconnect();
          resolve(count);
        };
        const observer = new MutationObserver(look);
        observer.observe(document.body, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(0);
        }, 3000);
      }),
  );
  await dragTo(row("Inbox/Dup.md"), folder("Closed"));
  const marked = await landing;
  await idle(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check("Reduce Motion keeps the landing mark", marked === 1, String(marked));

  {
    const focusedRow = () =>
      page.evaluate(
        () => document.activeElement?.dataset.path ?? document.activeElement?.dataset.folder ?? document.activeElement?.tagName,
      );
    const redrawWithout = (removed) =>
      page.evaluate((gone) => {
        const { reader } = window.waymark;
        const index = reader.vault.index;
        const copy = Object.assign(Object.create(Object.getPrototypeOf(index)), index, {
          notes: index.notes.filter((n) => !gone.some((g) => n === g || n.startsWith(`${g}/`))),
        });
        reader.sidebar.renderTree(copy, reader.current);
      }, removed);
    await page.evaluate(() => {
      window.waymark.reader.sidebar.tree.openFolder("Sorted");
    });
    await idle(page);
    await page.locator('.nav-item[data-path="Sorted/Banana.md"]').focus();
    const tree = page.locator(".sidebar .tree").first();
    const list = page.locator(".sidebar-inner");
    await list.evaluate((b) => {
      b.style.maxBlockSize = "120px";
      b.scrollTop = 40;
    });
    const scrollBefore = await list.evaluate((b) => b.scrollTop);
    await redrawWithout([]);
    check("a rebuild keeps focus on the same row", (await focusedRow()) === "Sorted/Banana.md", await focusedRow());
    check("only that row holds the Tab stop", (await tree.locator('[tabindex="0"]').count()) === 1);
    check(
      "a rebuild keeps the tree's scroll",
      scrollBefore > 0 && (await list.evaluate((b) => b.scrollTop)) === scrollBefore,
      String(scrollBefore),
    );
    await list.evaluate((b) => b.style.removeProperty("max-block-size"));
    await redrawWithout(["Sorted/Banana.md"]);
    check("a removed row hands focus to its folder", (await focusedRow()) === "Sorted", await focusedRow());
    await redrawWithout([]);
    await page.locator('.nav-item[data-path="Sorted/Banana.md"]').focus();
    await redrawWithout(["Sorted"]);
    const fallback = await focusedRow();
    check("when the folder goes too, focus lands on a row", typeof fallback === "string" && fallback.endsWith(".md"), fallback);
    await redrawWithout([]);
    await page.evaluate(() => document.activeElement?.blur());
    await redrawWithout([]);
    check("a rebuild does not pull focus into the tree", (await focusedRow()) === "BODY", await focusedRow());
    await idle(page);
    const described = await page.evaluate(() => {
      const tree = document.querySelector(".sidebar .tree");
      const rows = [...tree.querySelectorAll(".tree-head, .nav-item")];
      const wrong = rows.filter((row) => {
        const item = row.matches(".nav-item") ? row : row.parentElement;
        const siblings = [...item.parentElement.children].filter((c) => c.matches(".tree-folder, .nav-item"));
        let level = 1;
        for (let el = item.parentElement; el !== tree; el = el.parentElement) if (el.matches(".tree-inner")) level++;
        return (
          row.getAttribute("role") !== "treeitem" ||
          row.getAttribute("aria-level") !== String(level) ||
          row.getAttribute("aria-posinset") !== String(siblings.indexOf(item) + 1) ||
          row.getAttribute("aria-setsize") !== String(siblings.length)
        );
      });
      return { role: tree.getAttribute("role"), label: tree.getAttribute("aria-label"), rows: rows.length, wrong: wrong.length };
    });
    check(
      "the file list is a named tree whose rows know their depth and place",
      described.role === "tree" && described.label === "Files" && described.rows > 5 && described.wrong === 0,
      JSON.stringify(described),
    );
    const current = await page.$$eval(".sidebar .tree [aria-current]", (rows) =>
      rows.map((r) => `${r.dataset.path}=${r.getAttribute("aria-current")}`),
    );
    check(
      "the open note's row, and only it, is marked current",
      current.length === 1 && current[0] === `${await page.evaluate(() => window.waymark.reader.current)}=page`,
      current.join(),
    );
    await page.locator('.nav-item[data-path="Sorted/Apple.md"]').focus();
    await page.keyboard.type("ch");
    check("typing a name moves to its row", (await focusedRow()) === "Sorted/Cherry.md", await focusedRow());
    await page.keyboard.press("b");
    await page.waitForTimeout(600);
    await page.keyboard.press("a");
    const afterPause = await page.evaluate(() => document.activeElement.querySelector(".tree-name, .nav-text")?.textContent);
    check(
      "a pause starts a new name instead of adding to it",
      (await focusedRow()) !== "Sorted/Banana.md" && /^a/i.test(afterPause ?? ""),
      afterPause,
    );
    check("typing selects without opening", (await page.evaluate(() => window.waymark.reader.current)) !== "Sorted/Cherry.md");
    await page.evaluate(() => {
      const { reader } = window.waymark;
      reader.sidebar.renderTree(reader.vault.index, reader.current);
    });
  }
  /* Tabs (#20) */
  await openNote("Welcome");
  const openTab = (note) => page.evaluate((n) => window.waymark.reader.open(`${n}.md`, { newTab: true, focus: true }), note);
  await openTab("Refs");
  await idle(page);
  await openTab("Sorted/Apple");
  await idle(page);
  await page.locator(".tab").first().click();
  await idle(page);
  const tabs = () => page.$$eval(".tab .tab-title", (t) => t.map((x) => x.textContent).join());
  const activeTab = () => page.textContent(".tab.is-active .tab-title");

  {
    const strip = () =>
      page.evaluate(() => ({
        stops: [...document.querySelectorAll(".tab")].map((t) => t.tabIndex).join(),
        active: document.querySelector(".tab.is-active .tab-title").textContent,
        focusIsActiveTab: document.activeElement === document.querySelector(".tab.is-active"),
      }));
    check("only the active tab is a Tab stop", (await strip()).stops === "0,-1,-1", (await strip()).stops);
    await page.keyboard.press("Tab");
    await page.locator(".tab.is-active").focus();
    await page.keyboard.press("ArrowRight");
    const moved = await strip();
    check("ArrowRight selects the next tab at once", moved.active === "Refs" && moved.focusIsActiveTab, JSON.stringify(moved));
    check("the Tab stop follows the selection", moved.stops === "-1,0,-1", moved.stops);
    await page.keyboard.press("End");
    check("End reaches the last tab", (await strip()).active === "Apple" && (await strip()).focusIsActiveTab);
    await page.keyboard.press("ArrowRight");
    check("ArrowRight wraps to the first tab", (await strip()).active === "Welcome" && (await strip()).focusIsActiveTab);
    await page.keyboard.press("ArrowLeft");
    check("ArrowLeft wraps to the last tab", (await strip()).active === "Apple");
    await page.keyboard.press("Home");
    check("Home reaches the first tab", (await strip()).active === "Welcome");
    for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight", { delay: 0 });
    await idle(page);
    const rapid = await strip();
    check(
      "rapid arrows land on the right tab and keep focus",
      rapid.active === "Refs" && rapid.focusIsActiveTab,
      JSON.stringify(rapid),
    );
    await page.waitForFunction(() => document.querySelector(".doc")?.textContent.length > 0);

    const closeStyle = await page.locator(".tab.is-active [data-tab-close]").evaluate((b) => ({
      opacity: getComputedStyle(b).opacity,
      transition: getComputedStyle(b).transitionDuration,
    }));
    check(
      "a focused tab shows its close control fully at once",
      closeStyle.opacity === "1" && /^0s/.test(closeStyle.transition),
      JSON.stringify(closeStyle),
    );
    const semantics = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll(".tab")];
      const panel = document.getElementById("note-panel");
      return {
        strip: document.querySelector(".tabs").getAttribute("aria-label"),
        controls: tabs.every(
          (t) => document.getElementById(t.getAttribute("aria-controls"))?.getAttribute("role") === "tabpanel",
        ),
        labelled: panel.getAttribute("aria-labelledby") === document.querySelector(".tab.is-active").id,
        closeOutOfOrder: tabs.every((t) => t.querySelector("[data-tab-close]")?.tabIndex === -1),
      };
    });
    check(
      "the strip is named, each tab names its panel, and the panel names the active tab",
      semantics.strip === "Tabs" && semantics.controls && semantics.labelled,
      JSON.stringify(semantics),
    );
    check("a close control is never a Tab stop", semantics.closeOutOfOrder);
    await page.evaluate(() => window.waymark.reader.renderTabs());
    check("a redraw keeps focus on the active tab", (await strip()).focusIsActiveTab);
    await page.keyboard.press("Backspace");
    await idle(page);
    const closed = await strip();
    check(
      "Delete closes the focused tab and focus moves to the tab that takes over",
      closed.focusIsActiveTab && closed.stops.split(",").length === 2,
      JSON.stringify(closed),
    );
    await page.keyboard.press("Meta+Shift+t");
    await idle(page);
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator(".tab").first().click();
    await idle(page);
    const afterClick = await strip();
    check(
      "a click selects a tab without taking focus or showing a ring",
      !afterClick.focusIsActiveTab,
      JSON.stringify(afterClick),
    );
  }
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
  await idle(page);
  check(
    "a tab that was not active can be dragged too, keeping its guide",
    inactiveGuide === 1 && (await tabs()) === "Apple,Welcome,Refs",
    `${inactiveGuide} ${await tabs()}`,
  );
  await page.locator(".tab").nth(2).click();
  await idle(page);
  const back = await page.locator(".tab").nth(2).boundingBox();
  const start = await page.locator(".tab").nth(0).boundingBox();
  await page.mouse.move(back.x + back.width / 2, back.y + 14);
  await page.mouse.down();
  await page.mouse.move(start.x + 4, start.y + 14, { steps: 8 });
  await pause(40);
  await page.mouse.up();
  await idle(page);
  await page.locator(".tab", { hasText: "Welcome" }).click();
  await idle(page);
  const t1 = await page.locator(".tab").nth(0).boundingBox();
  await page.mouse.move(t1.x + 20, t1.y + 14);
  await page.mouse.down();
  await page.mouse.move(t1.x + 200, t1.y + 14, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await idle(page);
  check("Escape cancels a tab drag", (await tabs()) === "Refs,Apple,Welcome", await tabs());
  await page.locator(".tab").nth(1).click({ button: "right" });
  await idle(page);
  await page.locator('.context-item:has-text("Pin tab")').click();
  await idle(page);
  check(
    "pinning moves a tab to the left and marks it",
    (await tabs()) === "Apple,Refs,Welcome" && (await page.locator(".tab.is-pinned").count()) === 1,
    await tabs(),
  );
  {
    const countTabs = () => page.locator(".tab").count();
    const before = await countTabs();
    await page.locator(".tab").nth(1).click();
    await idle(page);
    const opener = await activeTab();
    await page.keyboard.press("Meta+t");
    await idle(page);
    check(
      "a new tab opens blank behind the palette",
      (await activeTab()) === "New tab" && (await page.locator(".palette").count()) === 1,
    );
    check("the palette's field has focus", await page.evaluate(() => document.activeElement?.matches(".palette input")));
    await page.keyboard.press("Meta+w");
    await idle(page);
    check("⌘W closes a blank tab from the palette field", (await countTabs()) === before, String(await countTabs()));
    check("the palette closes with it", (await page.locator(".palette:not(.is-leaving)").count()) === 0);
    check("the tab it opened beside comes back", (await activeTab()) === opener, await activeTab());
    await page.keyboard.press("Meta+t");
    await idle(page);
    await page.keyboard.press("Escape");
    await idle(page);
    check("Escape closed the palette and kept the blank tab", (await activeTab()) === "New tab");
    await page.keyboard.press("Meta+w");
    await idle(page);
    check("⌘W closes a blank tab with the palette shut too", (await countTabs()) === before && (await activeTab()) === opener);
    await page.keyboard.press("Meta+k");
    await idle(page);
    await page.keyboard.press("Meta+w");
    await idle(page);
    check("⌘W over a note leaves the tab alone while typing", (await countTabs()) === before);
    await page.keyboard.press("Escape");
    await idle(page);
  }
  check("a pinned tab has no close button", (await page.locator(".tab.is-pinned .tab-close").count()) === 0);
  await page.locator(".tab.is-pinned").click();
  await idle(page);
  await page.keyboard.press("Meta+w");
  await idle(page);
  check(
    "closing a pinned tab says why",
    (await toastText()).includes("Unpin") && (await page.locator(".tab").count()) === 3,
    await toastText(),
  );
  await page.keyboard.press("Meta+k");
  await idle(page);
  await page.keyboard.type(">move tab right");
  await idle(page);
  await page.keyboard.press("Enter");
  await idle(page);
  check(
    "a pinned tab cannot leave the pinned group, and says so",
    (await tabs()) === "Apple,Refs,Welcome" && (await toastText()).includes("already last"),
    await toastText(),
  );
  await page.locator(".tab").nth(1).click();
  await idle(page);
  await page.keyboard.press("Meta+k");
  await idle(page);
  await page.keyboard.type(">move tab right");
  await idle(page);
  await page.keyboard.press("Enter");
  await idle(page);
  check("the palette moves a tab without dragging", (await tabs()) === "Apple,Welcome,Refs", await tabs());
  await writeFile(inVault("Reopen side.md"), "# Reopen side\n");
  await writeFile(inVault("Reopen long.md"), `# Reopen long\n\n${"A plain paragraph of words.\n\n".repeat(200)}`);
  await page.evaluate(() => window.waymark.reader.persist());
  await idle(page);
  await page.goto(app.url);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);
  check(
    "order and pin survive a relaunch",
    (await tabs()) === "Apple,Welcome,Refs" && (await page.locator(".tab.is-pinned").count()) === 1,
    await tabs(),
  );

  /* Reopening closed tabs */
  const reopen = async () => {
    await page.keyboard.press("Meta+Shift+t");
    await idle(page);
  };
  const noteScroll = () => page.locator(".scroller").evaluate((s) => Math.round(s.scrollTop));
  const trailSize = () => page.evaluate(() => window.waymark.reader.workspace.active.trail.size);
  await reopen();
  check("with nothing closed the shortcut still answers", (await toastText()).includes("No closed tabs"), await toastText());
  await openTab("Reopen long");
  await idle(page);
  await page.evaluate(() => window.waymark.reader.open("Reopen side.md", { via: "link" }));
  await idle(page);
  await page.keyboard.press("Meta+[");
  await idle(page);
  await page.locator(".scroller").evaluate((s) => {
    s.scrollTop = 900;
  });
  await idle(page);
  const openOrder = await tabs();
  const stops = await trailSize();
  await page.keyboard.press("Meta+w");
  await idle(page);
  check("closing removes the tab", !(await tabs()).includes("Reopen long"), await tabs());
  await reopen();
  check("the tab comes back where it was", (await tabs()) === openOrder, await tabs());
  check("and is the active tab", (await activeTab()) === "Reopen long", await activeTab());
  check("with its place in the note", Math.abs((await noteScroll()) - 900) < 40, String(await noteScroll()));
  check("and its trail", stops === 2 && (await trailSize()) === 2, `${stops} ${await trailSize()}`);
  await page.keyboard.press("Meta+w");
  await idle(page);
  await page.keyboard.press("Meta+k");
  await idle(page);
  await page.keyboard.type(">reopen closed");
  await idle(page);
  const offered = await page.locator(".palette-row.is-selected").textContent();
  check("the palette offers it with its shortcut", offered.includes("Reopen closed tab") && offered.includes("⌘⇧T"), offered);
  await page.keyboard.press("Enter");
  await idle(page);
  check("the palette brings it back", (await tabs()) === openOrder, await tabs());
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  await page.keyboard.press("Meta+w");
  await idle(page);
  await reopen();
  check("it works from the editor too", (await tabs()) === openOrder, await tabs());
  await page.keyboard.press("Meta+t");
  await idle(page);
  await page.evaluate(() => {
    const { reader } = window.waymark;
    reader.closeTab(reader.workspace.activeIndex);
    reader.closeTab(reader.workspace.tabs.findIndex((t) => t.trail.current.view.path === "Reopen long.md"));
  });
  await idle(page);
  await rm(inVault("Reopen long.md"));
  await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Reopen long.md"]));
  await idle(page);
  const stillOpen = await tabs();
  await reopen();
  check("a note that has gone says so", (await toastText()).includes("no longer in the vault"), await toastText());
  check("and no other note opens in its place", (await tabs()) === stillOpen, await tabs());
  await reopen();
  check("the blank tab was not kept", (await toastText()).includes("No closed tabs"), await toastText());
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
