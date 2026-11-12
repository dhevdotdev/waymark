// Things in lists that arrive, leave and move: pointer actions travel, the keyboard and Reduce Motion do not, and nothing outside the list shifts.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const inVault = (name) => path.join(app.vault, name);
const put = async (name, text) => {
  await mkdir(path.dirname(inVault(name)), { recursive: true });
  await writeFile(inVault(name), text);
};
for (const name of ["Apple", "Banana", "Cherry", "Damson", "Elder"]) await put(`${name}.md`, `# ${name}\n\nBody of ${name}.\n`);
for (const name of ["One", "Two", "Three", "Four"]) await put(`Inbox/${name}.md`, `# ${name}\n`);
await put("Archive/Old.md", "# Old\n");
await put("Facts.md", "---\nfirst: 1\nsecond: 2\nthird: 3\n---\nBody\n");
await put("Plot.md", "# Plot\n\n| Bed | Crop |\n| --- | --- |\n| North | Beans |\n| East | Peas |\n| South | Kale |\n\nAfter.\n");
await put("Hub.md", "# Hub\n\n[[Apple]] [[Banana]] [[Cherry]]\n");

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 820 }, colorScheme: "light" });
const page = await context.newPage();
const errors = [];
watchPageErrors(page, errors);
await page.addInitScript(() => {
  const animate = Element.prototype.animate;
  window.heldMotion = false;
  window.rejections = [];
  window.addEventListener("unhandledrejection", (e) => window.rejections.push(String(e.reason)));
  Element.prototype.animate = function (keyframes, options) {
    const animation = animate.call(this, keyframes, options);
    if (window.heldMotion && options?.id === "list-motion") {
      animation.pause();
      animation.currentTime = options.duration * 0.4;
    }
    return animation;
  };
});

const pause = (ms) => page.waitForTimeout(ms);
const hold = () => page.evaluate(() => (window.heldMotion = true));
/** Ends held motion. A finished animation's event, which removes a ghost, arrives with the next frame, so this waits for it. */
const release = async () => {
  await page.evaluate(async () => {
    window.heldMotion = false;
    for (const animation of document.getAnimations()) if (animation.id === "list-motion") animation.finish();
    await new Promise(requestAnimationFrame);
  });
  await pause(30);
};
const motion = () =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.id === "list-motion")
      .map((animation) => {
        const target = animation.effect.target;
        const [from] = animation.effect.getKeyframes();
        return { name: target.className, tag: target.tagName, translate: from.translate, opacity: from.opacity };
      }),
  );
const openNote = async (name) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(350);
};
const openTab = (note) => page.evaluate((n) => window.waymark.reader.open(`${n}.md`, { newTab: true, focus: true }), note);
const tabTitles = () => page.$$eval(".tab .tab-title", (t) => t.map((x) => x.textContent).join());
const closeButton = (n) => page.locator(".tab").nth(n).locator(".tab-close");
const readerWidth = () => page.evaluate(() => document.querySelector(".doc").getBoundingClientRect().width);
const barBox = () =>
  page.evaluate(() => {
    const strip = document.querySelector(".tabs");
    const { left, right } = strip.getBoundingClientRect();
    return `${left},${right},${strip.scrollWidth <= strip.clientWidth}`;
  });
const pressKey = async () => {
  await page.keyboard.press("Shift+Escape");
  await pause(20);
};
const dragBy = async (from, to) => {
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await pause(40);
  await page.mouse.up();
};

try {
  /* Tabs */
  await openNote("Apple");
  await openTab("Banana");
  await pause(60);
  await openTab("Cherry");
  await pause(300);
  await page.locator(".tab").first().click();
  await pause(250);
  const widthBefore = await readerWidth();
  const barBefore = await barBox();

  await hold();
  await openTab("Damson");
  await pause(60);
  const added = await motion();
  check(
    "a tab opened with the pointer fades in",
    added.some((m) => m.name.includes("tab") && m.opacity === "0"),
    JSON.stringify(added),
  );
  check(
    "the tabs after it and the new-tab button slide over",
    added.filter((m) => m.translate && m.translate !== "none" && m.opacity === undefined).length === 3,
  );
  check("the reader keeps its width while tabs move", (await readerWidth()) === widthBefore);
  check("the strip keeps its place while tabs move", (await barBox()) === barBefore, await barBox());
  await release();
  check("nothing is left moving once it settles", (await motion()).length === 0);

  await hold();
  const middle = await page.locator(".tab").nth(2).boundingBox();
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await closeButton(2).click();
  await pause(60);
  const closing = await motion();
  const ghost = await page.evaluate(() => {
    const el = document.querySelector(".tab-ghost");
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      position: getComputedStyle(el).position,
      events: getComputedStyle(el).pointerEvents,
      inert: el.inert,
      hit: under?.closest(".tab-ghost") !== null,
      left: box.left,
      top: box.top,
      height: box.height,
    };
  });
  check(
    "a closing tab leaves a ghost that takes no space and no clicks",
    ghost?.position === "absolute" && ghost.events === "none" && ghost.inert && !ghost.hit,
    JSON.stringify(ghost),
  );
  check(
    "the ghost stays where the tab was",
    Math.abs(ghost.left - middle.x) < 1 && Math.abs(ghost.top - middle.y) < 1,
    JSON.stringify([ghost, middle]),
  );
  check("the ghost is not counted as a tab", (await page.locator(".tab").count()) === 3, await tabTitles());
  check("the tab list is final at once", (await tabTitles()).split(",").length === 3);
  check(
    "the gap closes by travel",
    closing.some((m) => m.translate && m.translate !== "none" && m.opacity === undefined),
    JSON.stringify(closing),
  );
  check("the reader keeps its width when a tab closes", (await readerWidth()) === widthBefore);
  check("the strip does not overflow", (await barBox()) === barBefore, await barBox());

  const gaps = await page.evaluate(() => {
    const lefts = () => [...document.querySelectorAll(".tab")].map((t) => t.getBoundingClientRect().left);
    window.heldMotion = false;
    const shown = lefts();
    window.waymark.reader.renderTabs();
    const after = lefts();
    window.heldMotion = true;
    return after.map((left, i) => Math.abs(left - shown[i]));
  });
  check(
    "a redraw partway through leaves tabs where they are on screen",
    gaps.every((gap) => gap < 1),
    JSON.stringify(gaps),
  );
  check("a redraw partway through keeps the ghost", (await page.locator(".tab-ghost").count()) === 1);
  await release();
  check("the ghost goes when its fade ends", (await page.locator(".tab-ghost").count()) === 0);

  await page.locator(".tab").nth(0).click({ button: "right" });
  await pause(120);
  await hold();
  await page.locator('.context-item:has-text("Pin tab")').click();
  await pause(60);
  check(
    "pinning with the pointer moves the tabs",
    (await motion()).some((m) => m.translate && m.translate !== "none"),
  );
  check("pinning does not flash the tab", (await page.locator(".tab.is-landed").count()) === 0);
  await release();
  await page.locator(".tab").nth(0).click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Unpin tab")').click();
  await pause(280);

  const titlesBeforeDrop = await tabTitles();
  await hold();
  await dragBy(await page.locator(".tab").nth(2).boundingBox(), await page.locator(".tab").nth(0).boundingBox());
  await pause(60);
  check("a dropped tab lands", (await tabTitles()) !== titlesBeforeDrop, await tabTitles());
  check("a pointer drop slides the tabs", (await motion()).length > 0);
  check("a pointer drop flashes where the tab landed", (await page.locator(".tab.is-landed").count()) === 1);
  await release();
  await pause(450);

  await pressKey();
  await page.keyboard.press("Meta+k");
  await pause(150);
  await page.keyboard.type(">move tab right");
  await pause(150);
  await hold();
  await page.keyboard.press("Enter");
  await pause(80);
  check("moving a tab from the palette has no travel", (await motion()).length === 0, JSON.stringify(await motion()));
  check("moving a tab from the palette has no flash", (await page.locator(".tab.is-landed").count()) === 0);
  await page.keyboard.press("Meta+w");
  await pause(80);
  check(
    "⌘W closes with no travel and no ghost",
    (await motion()).length === 0 && (await page.locator(".tab-ghost").count()) === 0,
  );
  await release();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".tab").first().click();
  await pause(120);
  await hold();
  await openTab("Elder");
  await pause(60);
  const reducedAdd = await motion();
  check(
    "Reduce Motion keeps the new tab's fade and drops travel",
    reducedAdd.length === 1 && reducedAdd[0].opacity === "0",
    JSON.stringify(reducedAdd),
  );
  await release();
  await hold();
  await closeButton(1).click();
  await pause(60);
  check(
    "Reduce Motion closes a tab with no ghost or travel",
    (await motion()).length === 0 && (await page.locator(".tab-ghost").count()) === 0,
  );
  await release();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  /* File tree */
  await openNote("Hub");
  const showOnly = async (...folders) => {
    await page.evaluate((names) => {
      const { tree } = window.waymark.reader.sidebar;
      tree.collapseAll();
      for (const name of names) tree.focusFolder(name);
      document.querySelector(".sidebar-inner").scrollTop = 0;
    }, folders);
    await pause(320);
  };
  const row = (file) => page.locator(`.nav-item[data-path="${file}"]`);
  const folder = (name) => page.locator(`.tree-head[data-folder="${name}"]`);
  const treeRows = () =>
    page.$$eval(".nav-item[data-path], .tree-head[data-folder]", (rows) =>
      rows.map((r) => Math.round(r.getBoundingClientRect().top)).join(),
    );
  await showOnly("Inbox", "Archive");

  const before = await treeRows();
  const from = await row("Inbox/One.md").boundingBox();
  const to = await folder("Archive").boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await pause(60);
  check("rows hold still until the drop", (await treeRows()) === before);
  check("nothing travels during a drag", (await motion()).length === 0);
  const treeWidth = await page.evaluate(() => document.querySelector(".sidebar-inner").getBoundingClientRect().width);
  await hold();
  await page.mouse.up();
  await page.waitForSelector('.nav-item[data-path="Archive/One.md"]');
  await pause(120);
  const dropped = await motion();
  const allRows = await page.locator(".nav-item[data-path], .tree-head[data-folder]").count();
  check(
    "a dropped note arrives at its destination",
    dropped.some((m) => m.opacity === "0" && m.name.includes("nav-item")),
    JSON.stringify(dropped.slice(0, 4)),
  );
  check("the place it left fades", (await page.locator(".tree-ghost").count()) === 1);
  check(
    "the ghost takes no clicks",
    await page
      .locator(".tree-ghost")
      .first()
      .evaluate((g) => g.inert && getComputedStyle(g).pointerEvents === "none"),
  );
  check(
    "the rows it left close up",
    dropped.some((m) => m.translate && m.translate !== "none" && m.opacity === undefined),
  );
  check("only rows near the view move", dropped.length < allRows, `${dropped.length}/${allRows}`);
  check(
    "the sidebar keeps its width",
    (await page.evaluate(() => document.querySelector(".sidebar-inner").getBoundingClientRect().width)) === treeWidth,
  );
  await release();
  check("the tree's ghost goes when the fade ends", (await page.locator(".tree-ghost").count()) === 0);
  await pause(450);

  await showOnly("Inbox", "Archive");
  await hold();
  await page.evaluate(() => window.waymark.reader.files.remove("Inbox/Two.md"));
  await pause(120);
  check("Trash from the pointer leaves a ghost", (await page.locator(".tree-ghost").count()) === 1);
  await release();
  await pause(450);

  await hold();
  await page.evaluate(() => window.waymark.reader.files.newNote("Inbox"));
  await page.waitForSelector(".cm-content");
  await pause(120);
  const created = await motion();
  check(
    "a note created with the pointer arrives",
    created.some((m) => m.opacity === "0" && m.translate?.includes("6px")),
    JSON.stringify(created.slice(0, 3)),
  );
  await release();
  await page.keyboard.press("Meta+e");
  await pause(300);
  await openNote("Hub");
  await showOnly("Inbox", "Archive");

  await hold();
  await page.evaluate(() => window.waymark.reader.bookmarks.toggle({ path: "Apple.md" }));
  await pause(40);
  const bookmarked = await motion();
  check(
    "a bookmark added with the pointer arrives",
    bookmarked.some((m) => m.opacity === "0" && m.name.includes("is-bookmark")),
    JSON.stringify(bookmarked.slice(0, 3)),
  );
  check(
    "rows below it make room",
    bookmarked.some((m) => m.opacity === undefined && m.translate !== "none"),
  );
  await release();
  await hold();
  await page.evaluate(() => window.waymark.reader.bookmarks.toggle({ path: "Apple.md" }));
  await pause(40);
  check("a bookmark removed with the pointer leaves a ghost", (await page.locator(".tree-ghost").count()) >= 1);
  await release();
  await pause(450);

  await pressKey();
  await hold();
  await page.evaluate(() => window.waymark.reader.bookmarks.toggle({ path: "Apple.md" }));
  await pause(40);
  check("a keyboard bookmark appears without motion", (await motion()).length === 0);
  await page.evaluate(() => window.waymark.reader.bookmarks.toggle({ path: "Apple.md" }));
  await release();

  await hold();
  await page.evaluate(() => window.waymark.reader.files.remove("Inbox/Three.md"));
  await pause(120);
  check(
    "a keyboard trash has no travel or ghost",
    (await motion()).length === 0 && (await page.locator(".tree-ghost").count()) === 0,
  );
  await release();

  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.up();
  await pause(30);
  await hold();
  await put("Inbox/External.md", "# External\n");
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Inbox/External.md"]));
  await pause(400);
  await page.evaluate(() => window.waymark.reader.renderTree());
  await page.waitForSelector('.nav-item[data-path="Inbox/External.md"]');
  await pause(80);
  check("a file arriving from outside appears without motion", (await motion()).length === 0, JSON.stringify(await motion()));
  await release();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.up();
  await hold();
  await page.evaluate(() => window.waymark.reader.files.remove("Inbox/External.md"));
  await pause(120);
  check(
    "Reduce Motion drops the tree's ghost and travel",
    (await page.locator(".tree-ghost").count()) === 0 && (await motion()).every((m) => !m.translate || m.translate === "none"),
  );
  await release();
  await page.emulateMedia({ reducedMotion: "no-preference" });

  /* Tables */
  await openNote("Plot");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-table-widget");
  await pause(300);
  const cell = (r, c) => page.locator(`.cm-table-widget [data-row="${r}"][data-column="${c}"]`);
  await cell(2, 0).click();
  await pause(120);
  await page.keyboard.press("Meta+Alt+Shift+Backspace");
  await pause(40);
  check("a keyboard delete leaves no ghost", (await page.locator(".cm-table-ghost-cell").count()) === 0);
  await pause(500);
  await page.keyboard.press("Meta+z");
  await pause(40);
  check(
    "keyboard undo tints with no fade",
    await page
      .locator(".cm-table-widget .is-marked")
      .and(page.locator(":not(:focus)"))
      .first()
      .evaluate((c) => getComputedStyle(c).animationTimingFunction.includes("step")),
  );
  await pause(500);

  await cell(1, 0).hover();
  await pause(120);
  await page.locator(".cm-table-grip.is-row").click();
  await pause(120);
  await hold();
  await page.locator('.context-item:has-text("Delete row")').click();
  await pause(40);
  await release();
  await pause(500);
  await page.keyboard.press("Meta+z");
  await pause(300);
  /* Each ghost is cancelled as soon as it is drawn, so a slow machine cannot let its short fade end first. */
  await page.evaluate(() => {
    window.__cancelledGhosts = 0;
    window.__ghostWatch = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          if (node.classList?.contains("cm-table-ghost"))
            for (const animation of node.getAnimations()) {
              animation.cancel();
              window.__cancelledGhosts++;
            }
    });
    window.__ghostWatch.observe(document.body, { childList: true, subtree: true });
  });
  for (const _ of [1, 2]) {
    await cell(1, 0).hover();
    await pause(120);
    await page.locator(".cm-table-grip.is-row").click();
    await pause(120);
    await page.locator('.context-item:has-text("Delete row")').click();
    await pause(20);
  }
  /* A cancelled animation's event arrives with the next frame, before that frame is drawn. */
  const cancelledGhosts = await page.evaluate(async () => {
    window.__ghostWatch.disconnect();
    await new Promise(requestAnimationFrame);
    return { cancelled: window.__cancelledGhosts, left: document.querySelectorAll(".cm-table-ghost").length };
  });
  check(
    "a cancelled ghost is removed",
    cancelledGhosts.cancelled === 2 && cancelledGhosts.left === 0,
    JSON.stringify(cancelledGhosts),
  );
  check(
    "a cancelled ghost raises no rejection",
    (await page.evaluate(() => window.rejections.length)) === 0,
    await page.evaluate(() => window.rejections.join()),
  );
  await pause(500);
  await page.keyboard.press("Meta+z");
  await pause(200);
  await page.keyboard.press("Meta+z");
  await pause(500);
  await page.keyboard.press("Meta+e");
  await pause(400);

  /* Properties */
  await openNote("Facts");
  await page.click('[data-rail="info"]');
  await pause(300);
  const propCell = (key) => page.locator(`.prop-cell[data-key="${key}"]`);
  const history = () => page.evaluate(() => document.querySelector(".rail-history")?.getBoundingClientRect().top ?? null);
  await propCell("first").hover();
  await pause(150);
  const historyBefore = await history();
  await hold();
  await propCell("first").locator(".prop-remove").click();
  await page.waitForSelector('.prop-cell[data-key="first"]', { state: "detached" });
  await pause(40);
  const removed = await motion();
  check(
    "rows close up after a pointer remove",
    removed.some((m) => m.tag === "DD" && m.translate !== "none"),
    JSON.stringify(removed),
  );
  check(
    "only the rows themselves move",
    removed.every((m) => m.tag === "DT" || m.tag === "DD"),
    JSON.stringify(removed),
  );
  check(
    "the rows are clipped inside the list",
    await page.locator(".props.is-settling").evaluate((p) => getComputedStyle(p).overflow === "clip"),
  );
  const historyAfter = await history();
  check(
    "History is at its final place at once",
    historyBefore === null ||
      historyAfter === (await page.evaluate(() => document.querySelector(".rail-history").getBoundingClientRect().top)),
  );
  await release();
  check("the list stops clipping once settled", (await page.locator(".props.is-settling").count()) === 0);

  await pressKey();
  await hold();
  await propCell("second").locator(".prop-remove").focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector('.prop-cell[data-key="second"]', { state: "detached" });
  await pause(60);
  check("a keyboard remove does not move rows", (await motion()).length === 0, JSON.stringify(await motion()));
  await release();

  /* Trail */
  await openNote("Hub");
  const follow = async (name) => {
    await page.locator(`.doc a.wikilink:has-text("${name}")`).first().click();
    await pause(450);
  };
  await follow("Apple");
  await page.evaluate(() => window.waymark.reader.go(-1));
  await pause(300);
  await follow("Banana");
  await page.evaluate(() => window.waymark.reader.go(-1));
  await pause(300);
  await follow("Cherry");
  await page.keyboard.press("Meta+y");
  await pause(400);
  const trailRows = () => page.locator(".trail-row");
  check("the trail has stops to act on", (await trailRows().count()) >= 3, String(await trailRows().count()));
  await page.keyboard.press("Meta+y");
  await pause(60);
  check("⌘Y does not pulse the marker", (await page.locator(".trail-here").evaluate((m) => m.getAnimations().length)) === 0);
  await page.locator(".trail-here").evaluate(() => 0);
  await pressKey();
  check(
    "the marker does not glide after the keyboard",
    await page.locator(".trail-here").evaluate((m) => getComputedStyle(m).transitionDuration === "0s"),
  );
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.up();
  await pause(30);
  check(
    "the marker glides after the pointer",
    await page.locator(".trail-here").evaluate((m) => getComputedStyle(m).transitionDuration !== "0s"),
  );

  const removeStop = async (n) => {
    await trailRows().nth(n).hover();
    await pause(100);
    await trailRows().nth(n).locator(".trail-x").click();
  };
  await hold();
  const inPanel = (n) =>
    trailRows()
      .nth(n)
      .evaluate((row) => row.getBoundingClientRect().top - row.parentElement.getBoundingClientRect().top);
  const third = await inPanel(2);
  await removeStop(1);
  await pause(60);
  const glided = await motion();
  check(
    "removing a stop with the pointer closes the gap",
    glided.some((m) => m.name.includes("trail-row") && m.translate !== "none"),
    JSON.stringify(glided),
  );
  const midTop = await inPanel(1);
  check("a row is shown partway between its places", midTop > third - 28 && midTop < third, JSON.stringify([midTop, third]));
  await release();
} catch (error) {
  check("the suite ran to the end", false, error.stack);
}

check("no errors in the page", errors.length === 0, errors.join(" | "));
for (const line of results) console.log(line);
const failed = results.filter((line) => line.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
await browser.close();
await app.close();
process.exit(failed ? 1 : 0);
