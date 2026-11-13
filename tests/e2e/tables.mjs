// What a person experiences editing tables in WebKit: real mouse and keyboard, measured geometry, focus, contrast and the bytes on disk.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { idle, watchIdle, writesSettled } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const DOC_END = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

const PLOT = `# Plot plan

Rotate the beds so nothing follows itself.

| Bed | Crop | Sown |
| --- | --- | ---: |
| North | Alliums | 12 |
| East | Legumes | 9 |
| South | Brassicas | 14 |

Keep the notes after the table.
`;
const AWKWARD = `# Awkward

Before.

| Name | Link | Code \\| pipe | | Note |
| --- | :---: | --- | --- | ---: |
| A very long sentence that keeps going so the column has to wrap across several lines | [[Welcome\\|the alias]] | \`a \\| b\` | | https://example.invalid/an/unbreakable/path/that/goes/on/and/on/and/on/and/on/and/on |
|  |  |  |  |  |

After.
`;
const row12 = (word) => Array.from({ length: 12 }, (_, i) => `| ${word} ${i + 1} `).join("");
const FILES = {
  Plot: PLOT,
  Awkward: AWKWARD,
  Wide: `# Wide\n\nBefore.\n\n${row12("Column")}|\n${"| --- ".repeat(12)}|\n${row12("value")}|\n\nAfter.\n`,
  Single: "# Single\n\nBefore.\n\n| Only |\n| --- |\n\nAfter.\n",
  First: "| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter the table.\n",
  Last: "Before the table.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
  Adjacent: "# Adjacent\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n",
  Bare: "# Bare\n\nName | Age\n--- | ---\nAda | 36\n\nAfter.\n",
  Tight: "# Tight\n\nA paragraph.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n# Heading right after\n",
  Blank: "# Blank\n\n",
  Headed: "# Headed\n\n## Above\n\n| A | B |\n| --- | ---: |\n| 1 | 2 |\n\n### Below\n\nAfter.\n",
  LongLast:
    "# LongLast\n\nBefore.\n\n| Item | Detail |\n| --- | --- |\n| One | A long last column whose words run all the way to the far edge of the table so the text meets the end |\n| Two | Short |\n\nAfter.\n",
  OneColumn: "# OneColumn\n\nBefore.\n\n| Only |\n| --- |\n| Value |\n| Second |\n\nAfter.\n",
  Long: `# Long\n\n${Array.from({ length: 60 }, (_, i) => `Paragraph ${i}.`).join("\n\n")}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nEnd.\n`,
};

const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
watchPageErrors(page, errors);
await watchIdle(page);
const pause = (ms) => page.waitForTimeout(ms);
const file = (name) => path.join(app.vault, `${name}.md`);
const disk = (name) => readFile(file(name), "utf8");
const saved = () =>
  page.waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "saved", null, { timeout: 5000 });
const settle = async () => {
  await writesSettled(page);
  await saved();
};

async function open(name) {
  await page.waitForFunction(() => !["unsaved", "saving"].includes(document.querySelector(".edit-state")?.dataset.state));
  await writeFile(file(name), FILES[name]);
  await page.goto(`${app.url}?note=${encodeURIComponent(name)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
}

const cell = (row, column, table = 0) =>
  page.locator(".cm-table-widget").nth(table).locator(`[data-row="${row}"][data-column="${column}"]`);
const rowGrip = () => page.locator(".cm-table-grip.is-row");
const columnGrip = () => page.locator(".cm-table-grip.is-column");
const addRow = () => page.locator(".cm-table-add.is-row");
const addColumn = () => page.locator(".cm-table-add.is-column");
const CONTROLS = [".cm-table-grip.is-row", ".cm-table-grip.is-column", ".cm-table-add.is-row", ".cm-table-add.is-column"];
const activeCell = () =>
  page.evaluate(() => {
    const { row, column } = document.activeElement?.dataset ?? {};
    return row === undefined ? `not a cell: ${document.activeElement?.tagName}` : `${row},${column}`;
  });
const item = (label) => page.locator(`.context-item:has-text("${label}")`);
const menuPick = async (grip, label) => {
  await grip.click();
  await idle(page);
  await item(label).click();
  await idle(page);
};

/** Hovers a cell so the controls for its row and column are on screen. */
const aim = async (row, column) => {
  await cell(row, column).hover();
  await idle(page);
};

const geometry = () =>
  page.evaluate((selectors) => {
    const root = document.querySelector(".cm-table-widget");
    const wrap = root.querySelector(".table-wrap").getBoundingClientRect();
    const texts = [...root.querySelectorAll("th, td")].flatMap((cell) => {
      const range = document.createRange();
      range.selectNodeContents(cell);
      return [...range.getClientRects()]
        .map((r) => ({ left: Math.max(r.left, wrap.left), right: Math.min(r.right, wrap.right), top: r.top, bottom: r.bottom }))
        .filter((r) => r.right > r.left);
    });
    const after = [...document.querySelectorAll(".cm-line")].flatMap((line) => {
      if (line.closest(".cm-table-widget") || !line.textContent.trim()) return [];
      const range = document.createRange();
      range.selectNodeContents(line);
      return [...range.getClientRects()];
    });
    const out = {};
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const hits = (rects) =>
        rects.filter((t) => t.left < r.right - 1 && t.right > r.left + 1 && t.top < r.bottom - 1 && t.bottom > r.top + 1).length;
      out[selector] = {
        x: r.left,
        right: r.right,
        y: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        clickable: hit === el || el.contains(hit),
        overlaps: hits(texts) + hits(after),
        onScreen: r.left >= -0.5 && r.right <= innerWidth + 0.5,
      };
    }
    return out;
  }, CONTROLS);

const positions = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".cm-table-widget :is(th, td), .cm-line")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)}`;
      })
      .join(" "),
  );

const undoExact = async (name, expected, label) => {
  await page.keyboard.press(`${MOD}+z`);
  await settle();
  check(`undo returns the exact file after: ${label}`, (await disk(name)) === expected);
};

try {
  /* Clarity */
  await open("Plot");
  const quiet = await positions();
  await aim(3, 1);
  const hovered = await geometry();
  check(
    "no control overlaps cell text",
    Object.values(hovered).every((c) => c.overlaps === 0),
    JSON.stringify(Object.values(hovered).map((c) => c.overlaps)),
  );
  check(
    "targets are at least 24 px",
    Object.values(hovered).every((c) => c.width >= 24 && c.height >= 24),
    JSON.stringify(Object.values(hovered).map((c) => [c.width, c.height])),
  );
  check(
    "every control can be clicked",
    Object.values(hovered).every((c) => c.clickable),
  );
  const shapes = await page.evaluate(() => {
    const table = document.querySelector(".cm-table-widget table").getBoundingClientRect();
    const hoveredRow = document.querySelector('.cm-table-widget [data-row="3"]').parentElement.getBoundingClientRect();
    const hoveredColumn = document.querySelector('.cm-table-widget [data-row="3"][data-column="1"]').getBoundingClientRect();
    return {
      table: { top: table.top, bottom: table.bottom, right: table.right },
      row: { top: hoveredRow.top, height: hoveredRow.height },
      column: { left: hoveredColumn.left, width: hoveredColumn.width },
    };
  });
  const bottomBar = hovered[CONTROLS[2]];
  const sideBar = hovered[CONTROLS[3]];
  check(
    "add bars sit outside the table",
    bottomBar.y >= shapes.table.bottom - 1 && sideBar.right > shapes.table.right - 16,
    JSON.stringify([bottomBar.y, shapes.table.bottom]),
  );
  check("the add-column bar spans the whole table", Math.abs(sideBar.height - (shapes.table.bottom - shapes.table.top)) <= 2);
  const grip = hovered[CONTROLS[0]];
  const top = hovered[CONTROLS[1]];
  check(
    "handles attach to their row and column",
    Math.abs(grip.y - shapes.row.top) <= 1 &&
      Math.abs(grip.height - shapes.row.height) <= 1 &&
      Math.abs(top.bottom - (shapes.table.top - 6)) <= 1 &&
      Math.abs(top.x - shapes.column.left) <= 1 &&
      Math.abs(top.width - shapes.column.width) <= 1,
    JSON.stringify([grip.y, shapes.row, top.bottom, shapes.table.top]),
  );
  await aim(1, 0);
  const movedAim = await geometry();
  check(
    "the add-column bar stays put as the pointer moves between rows",
    movedAim[CONTROLS[3]].y === sideBar.y && movedAim[CONTROLS[3]].height === sideBar.height,
  );
  check("hover and focus move nothing", (await positions()) === quiet);
  await cell(1, 1).click();
  await idle(page);
  check(
    "focusing a cell moves nothing else on the page",
    (await page.evaluate(() => document.querySelector(".cm-line:last-of-type").getBoundingClientRect().top)) > 0 &&
      (await positions()).split(" ").length === quiet.split(" ").length,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await idle(page);

  for (const selector of CONTROLS) {
    await open("Plot");
    await aim(1, 1);
    const control = page.locator(selector);
    await control.hover();
    await page
      .locator(".tooltip")
      .first()
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const name = await control.getAttribute("aria-label");
    const tip = await page
      .locator(".tooltip")
      .first()
      .textContent()
      .catch(() => "");
    check(
      `every control has a name and tooltip: ${selector}`,
      (!!name && tip.startsWith(name.replace(/ \d+/, ""))) || tip === name,
      `${name} / ${tip}`,
    );
  }

  await open("Plot");
  await aim(2, 1);
  await rowGrip().hover();
  await idle(page);
  const rowHighlight = await page.evaluate(() => ({
    target: document.querySelectorAll('.cm-table-widget .is-acted-on[data-row="2"]').length,
    other: document.querySelectorAll('.cm-table-widget .is-acted-on:not([data-row="2"])').length,
    changed:
      getComputedStyle(document.querySelector('.cm-table-widget [data-row="2"][data-column="1"]')).backgroundColor !==
      getComputedStyle(document.querySelector('.cm-table-widget [data-row="1"][data-column="1"]')).backgroundColor,
  }));
  check(
    "hovering a handle highlights only its target",
    rowHighlight.target === 3 && rowHighlight.other === 0 && rowHighlight.changed,
    JSON.stringify(rowHighlight),
  );
  await rowGrip().click();
  await idle(page);
  const rowMenu = await page.evaluate(() => {
    const menu = document.querySelector(".context-menu").getBoundingClientRect();
    const row = document.querySelector('.cm-table-widget [data-row="2"]').parentElement.getBoundingClientRect();
    return {
      apart: menu.top >= row.bottom || menu.bottom <= row.top,
      highlighted: document.querySelectorAll('.cm-table-widget .is-acted-on[data-row="2"]').length,
    };
  });
  check("the target stays highlighted while its menu is open", rowMenu.highlighted === 3, String(rowMenu.highlighted));
  check("menus do not cover their target: row", rowMenu.apart);
  await page.keyboard.press("Escape");
  await idle(page);
  await aim(1, 1);
  await columnGrip().click();
  await idle(page);
  const columnMenu = await page.evaluate(() => {
    const menu = document.querySelector(".context-menu").getBoundingClientRect();
    const column = document.querySelector('.cm-table-widget [data-row="0"][data-column="1"]').getBoundingClientRect();
    return menu.left >= column.right || menu.right <= column.left;
  });
  check("menus do not cover their target: column", columnMenu);
  await page.keyboard.press("Escape");

  await open("Awkward");
  const blankBefore = await cell(2, 2).evaluate((el) => getComputedStyle(el).backgroundColor);
  await cell(2, 2).hover();
  await idle(page);
  const emptyLook = await page.evaluate(() => {
    const emptyHeader = document.querySelector('.cm-table-widget [data-row="0"][data-column="3"]');
    const emptyCell = document.querySelector('.cm-table-widget [data-row="2"][data-column="2"]');
    return {
      header: getComputedStyle(emptyHeader, "::before").content,
      ghost: getComputedStyle(emptyCell, "::before").content,
      fill: getComputedStyle(emptyCell).backgroundColor,
      cursor: getComputedStyle(emptyCell).cursor,
    };
  });
  check(
    "empty cells show they can be typed in",
    /Heading/.test(emptyLook.header) && emptyLook.fill !== blankBefore && emptyLook.cursor === "text",
    JSON.stringify(emptyLook),
  );
  check("a blank cell shows no stray word under the pointer", emptyLook.ghost === "none", emptyLook.ghost);

  /* The geometry gate: every control, in every state, at every width, in both themes, measured from the table's real box. */
  const auditGeometry = () =>
    page.evaluate(() => {
      const root = document.querySelector(".cm-table-widget");
      const table = root.querySelector("table").getBoundingClientRect();
      const wrap = root.querySelector(".table-wrap").getBoundingClientRect();
      const box = {
        left: Math.max(table.left, wrap.left),
        right: Math.min(table.right, wrap.right),
        top: table.top,
        bottom: table.bottom,
      };
      const gap = (a, b) =>
        Math.hypot(
          Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)),
          Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)),
        );
      const intersects = (a, b) =>
        a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
      const glyphs = [...document.querySelectorAll(".cm-table-widget :is(th, td), .cm-line, .doc-title")].flatMap((el) => {
        if (el.matches(".cm-line") && el.closest(".cm-table-widget")) return [];
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...range.getClientRects()]
          .filter((r) => r.width > 0)
          .map((r) => ({
            left: Math.max(r.left, el.closest(".table-wrap") ? wrap.left : r.left),
            right: Math.min(r.right, el.closest(".table-wrap") ? wrap.right : r.right),
            top: r.top,
            bottom: r.bottom,
          }))
          .filter((r) => r.right > r.left);
      });
      const controls = [...root.querySelectorAll(".cm-table-grip:not([hidden]), .cm-table-add")].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: el.className.replace(/cm-table-/g, ""),
          hitsTable: intersects(r, box),
          toTable: Math.round(gap(r, box) * 10) / 10,
          toText: Math.round(Math.min(...glyphs.map((g) => gap(r, g))) * 10) / 10,
          onScreen: r.left >= -0.5 && r.right <= innerWidth + 0.5,
        };
      });
      const tinted = [...root.querySelectorAll(".is-acted-on, .is-marked")].map((c) => c.getBoundingClientRect());
      const tint = tinted.length
        ? { left: Math.min(...tinted.map((r) => r.left)), right: Math.max(...tinted.map((r) => r.right)) }
        : null;
      const rowOrColumn = root.querySelector(".is-acted-on")?.dataset;
      const spansWidth =
        !tint ||
        (rowOrColumn &&
          document.querySelectorAll(`.cm-table-widget .is-acted-on[data-column="${rowOrColumn.column}"]`).length > 1) ||
        (Math.abs(tint.left - table.left) <= 1 && Math.abs(tint.right - table.right) <= 1);
      const ghost = [...root.querySelectorAll(".cm-table-ghost-cell")].map((c) => c.getBoundingClientRect());
      const ghostInside = ghost.every((r) => r.left >= table.left - 1 && r.right <= table.right + 1);
      return { controls, spansWidth, ghostInside, tint, table: { left: table.left, right: table.right } };
    });
  const judge = (label, audit) => {
    const bad = audit.controls.filter((c) => c.hitsTable || c.toTable < 5.5 || c.toText < 5.5 || !c.onScreen);
    check(
      `geometry: ${label}`,
      bad.length === 0 && audit.spansWidth && audit.ghostInside,
      JSON.stringify({ bad, spans: audit.spansWidth, ghost: audit.ghostInside, tint: audit.tint, table: audit.table }),
    );
  };
  for (const width of [1400, 900, 560]) {
    await page.setViewportSize({ width, height: 800 });
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const name of ["Plot", "LongLast", "OneColumn", "Wide", "Headed"]) {
        const where = `${name} at ${width} in ${scheme}`;
        await open(name);
        await aim(1, 0);
        judge(`hover, ${where}`, await auditGeometry());
        await cell(1, 0).click();
        await pause(60);
        judge(`cell focus, ${where}`, await auditGeometry());
        await page.keyboard.press("Escape");
        await pause(40);
        judge(`grid focus, ${where}`, await auditGeometry());
        await page.keyboard.press("Enter");
        await aim(1, 0);
        await rowGrip().click();
        await idle(page);
        judge(`row menu open, ${where}`, await auditGeometry());
        await page.keyboard.press("Escape");
        await idle(page);
        await aim(1, 0);
        await addRow().click();
        await page.evaluate(() => {
          for (const a of document.getAnimations()) a.playbackRate = 0.05;
        });
        for (const sample of [1, 2, 3]) {
          await pause(60);
          judge(`arrival frame ${sample}, ${where}`, await auditGeometry());
        }
      }
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await open("Plot");
  const restLook = await page.evaluate(() => {
    const add = document.querySelector(".cm-table-add.is-row");
    const side = document.querySelector(".cm-table-add.is-column");
    return { add: getComputedStyle(add).backgroundColor, side: getComputedStyle(side).backgroundColor };
  });
  await aim(1, 0);
  await idle(page);
  const shownLook = await page.evaluate(() => {
    const add = document.querySelector(".cm-table-add.is-row");
    const side = document.querySelector(".cm-table-add.is-column");
    return {
      add: getComputedStyle(add).backgroundColor,
      side: getComputedStyle(side).backgroundColor,
      label: getComputedStyle(add.querySelector("span")).opacity,
    };
  });
  check(
    "no grey band at rest: add controls have no fill until hovered",
    /rgba\(0, 0, 0, 0\)|transparent/.test(shownLook.side) &&
      /rgba\(0, 0, 0, 0\)|transparent/.test(shownLook.add) &&
      shownLook.label === "0",
    JSON.stringify({ restLook, shownLook }),
  );
  await addColumn().hover();
  await idle(page);
  check(
    "hovering an add control fills only that control",
    await page.evaluate(() => {
      const add = document.querySelector(".cm-table-add.is-row");
      const side = document.querySelector(".cm-table-add.is-column");
      return (
        !/rgba\(0, 0, 0, 0\)/.test(getComputedStyle(side).backgroundColor) &&
        /rgba\(0, 0, 0, 0\)/.test(getComputedStyle(add).backgroundColor)
      );
    }),
  );
  await addRow().hover();
  await idle(page);
  const namedOpacity = await page.evaluate(() => getComputedStyle(document.querySelector(".cm-table-add.is-row span")).opacity);
  check("hovering Add row names it", Number(namedOpacity) > 0.95, namedOpacity);

  /* The header row's shape */
  await open("Awkward");
  const headerShape = await page.evaluate(() => {
    const heads = [...document.querySelectorAll(".cm-table-widget th")].map((h) => h.getBoundingClientRect().height);
    const filled = document.querySelector('.cm-table-widget [data-row="0"][data-column="0"]');
    const style = getComputedStyle(filled);
    return { heads, top: style.paddingTop, bottom: style.paddingBottom };
  });
  check(
    "a header cell has the same space above and below its text",
    headerShape.top === headerShape.bottom && headerShape.top !== "0px",
    JSON.stringify(headerShape),
  );
  check(
    "a blank header is as tall as a filled one",
    new Set(headerShape.heads.map(Math.round)).size === 1,
    headerShape.heads.join(),
  );
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await idle(page);
  const headerHeights = await page.$$eval(".doc table th", (heads) =>
    heads.map((h) => Math.round(h.getBoundingClientRect().height)),
  );
  check("a blank header is as tall as a filled one in Read too", new Set(headerHeights).size === 1, headerHeights.join());

  /* Selecting text in a cell */
  await open("Plot");
  await cell(2, 1).click({ button: "right" });
  await idle(page);
  const rightClicked = await page.evaluate(() => {
    const selection = getSelection();
    return {
      collapsed: selection.isCollapsed,
      inCell: selection.anchorNode?.parentElement?.dataset.row === "2" || selection.anchorNode?.dataset?.row === "2",
      focus: selection.focusNode?.nodeName,
    };
  });
  check(
    "a right-click on blank space selects nothing across cells",
    rightClicked.collapsed && rightClicked.inCell,
    JSON.stringify(rightClicked),
  );
  check("a right-click still opens the menu", (await page.locator(".context-menu").count()) === 1);
  await page.keyboard.press("Escape");
  await idle(page);
  await open("Plot");
  await cell(2, 1).dblclick({ position: { x: 40, y: 20 } });
  await idle(page);
  check(
    "a double-click selects the word",
    (await page.evaluate(() => getSelection().toString())) === "Legumes",
    await page.evaluate(() => getSelection().toString()),
  );
  await open("Plot");
  const dragBox = await cell(2, 1).boundingBox();
  await page.mouse.move(dragBox.x + 18, dragBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(dragBox.x + 70, dragBox.y + 20, { steps: 8 });
  await page.mouse.up();
  await idle(page);
  const dragged = await page.evaluate(() => getSelection().toString());
  check(
    "dragging across text in a cell that had no focus selects it",
    dragged.length >= 4 && "Legumes".startsWith(dragged),
    dragged,
  );

  /* Deleting a table */
  const deleteByMenu = async (table = 0) => {
    await cell(1, 0, table).hover();
    await idle(page);
    await page.locator(".cm-table-widget").nth(table).locator(".cm-table-grip.is-table").click();
    await idle(page);
    await item("Delete table").click();
    await idle(page);
  };
  const deleteByPalette = async (table = 0) => {
    await cell(1, 0, table).click();
    await pause(80);
    await page.keyboard.press("Meta+k");
    await idle(page);
    await page.keyboard.type(">delete table");
    await idle(page);
    await page.keyboard.press("Enter");
    await idle(page);
  };
  const removal = async (label, name, how, table, expected) => {
    await open(name);
    await how(table);
    await settle();
    check(
      `deleting a table: ${label}: the file is exact`,
      (await disk(name)) === expected,
      JSON.stringify((await disk(name)).slice(0, 80)),
    );
    check(
      `deleting a table: ${label}: it says so`,
      (
        await page
          .locator(".toast")
          .last()
          .textContent()
          .catch(() => "")
      ).includes("Table deleted"),
    );
    await page.keyboard.press(`${MOD}+z`);
    await settle();
    check(
      `deleting a table: ${label}: one undo restores the exact file`,
      (await disk(name)) === FILES[name],
      JSON.stringify((await disk(name)).slice(0, 80)),
    );
  };
  const plotWithout = PLOT.replace(
    "| Bed | Crop | Sown |\n| --- | --- | ---: |\n| North | Alliums | 12 |\n| East | Legumes | 9 |\n| South | Brassicas | 14 |\n\n",
    "",
  );
  await removal("from the menu", "Plot", deleteByMenu, 0, plotWithout);
  await removal("from the palette", "Plot", deleteByPalette, 0, plotWithout);
  await removal("at the start of a note", "First", deleteByMenu, 0, "After the table.\n");
  await removal("at the end of a note", "Last", deleteByMenu, 0, "Before the table.");
  const firstOfTwo = "# Adjacent\n\n| C | D |\n| --- | --- |\n| 3 | 4 |\n";
  const secondOfTwo = "# Adjacent\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
  await removal("the first of two adjacent tables", "Adjacent", deleteByMenu, 0, firstOfTwo);
  await removal("the second of two adjacent tables", "Adjacent", deleteByPalette, 1, secondOfTwo);
  await open("Plot");
  await page.locator(".cm-line", { hasText: "Rotate the beds" }).click();
  await page.keyboard.press("Meta+k");
  await idle(page);
  await page.keyboard.type(">delete table");
  await idle(page);
  check(
    "the palette offers Delete table only with the cursor in a table",
    (await page.locator('.palette-row:has-text("Delete table")').count()) === 0,
  );
  await page.keyboard.press("Escape");
  await idle(page);
  await cell(1, 0).click();
  await page.keyboard.press("Meta+k");
  await idle(page);
  await page.keyboard.type(">delete table");
  await idle(page);
  check(
    "the palette offers Delete table with the cursor in a cell",
    (await page.locator('.palette-row:has-text("Delete table")').count()) === 1,
  );
  await page.keyboard.press("Escape");
  await idle(page);
  await aim(1, 0);
  await page.locator(".cm-table-grip.is-table").hover();
  await idle(page);
  check(
    "hovering the table handle marks the whole table",
    (await page.locator(".cm-table-widget .is-acted-on").count()) ===
      (await page.locator(".cm-table-widget :is(th, td)").count()),
  );

  /* New tables */
  await open("Blank");
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("/table");
  await idle(page);
  await page.keyboard.press("Enter");
  await idle(page);
  const fresh = await page.evaluate(() => ({
    row: document.activeElement.dataset.row,
    column: document.activeElement.dataset.column,
    picked: getSelection().toString(),
  }));
  check(
    "a new table starts empty with the cursor in the first header",
    fresh.row === "0" && fresh.column === "0" && fresh.picked === "",
    JSON.stringify(fresh),
  );
  await page.keyboard.type("Name");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Qty");
  await settle();
  check(
    "headers type into blank cells",
    (await disk("Blank")).includes("| Name | Qty |  |\n| --- | --- | --- |"),
    (await disk("Blank")).slice(0, 80),
  );
  await open("Blank");
  const line = await page.evaluate(() => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const r = lines[lines.length - 1].getBoundingClientRect();
    return { x: r.left + 30, y: r.top + r.height / 2 };
  });
  await page.mouse.click(line.x, line.y, { button: "right" });
  await idle(page);
  const offered = await page.locator(".context-item").allTextContents();
  check(
    "an empty line offers Table on right-click",
    offered.some((t) => t.startsWith("Table")),
    offered.join(),
  );
  await item("Table").click();
  await idle(page);
  check(
    "choosing it inserts a table and starts typing",
    (await page.locator(".cm-table-widget").count()) === 1 && (await activeCell()) === "0,0",
  );

  /* Feedback */
  await open("Plot");
  await aim(3, 0);
  await addRow().click();
  const arrived = await page.evaluate(() => ({
    marked: document.querySelectorAll(".cm-table-widget .is-marked[data-row='4']").length,
    moving: document
      .querySelector(".cm-table-widget")
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getKeyframes().some((k) => k.transform)).length,
  }));
  check("a new row is marked as it arrives", arrived.marked === 3, JSON.stringify(arrived));
  check("the cursor lands in the new row", (await activeCell()) === "4,0");
  await page.keyboard.type("now");
  await settle();
  check("typing right after an action is not held back", (await disk("Plot")).includes("| now |"));
  await page.keyboard.press(`${MOD}+z`);
  await idle(page);
  await page.keyboard.press(`${MOD}+z`);
  await settle();
  check("add row undoes in steps: the text, then the row", (await disk("Plot")) === PLOT);

  await open("Plot");
  await aim(2, 1);
  /* The trace fades over a press's length, so a slow machine can finish it before a fixed pause ends. Count it as it is drawn. */
  await page.evaluate(() => {
    window.ghostCells = new Promise((resolve) => {
      const observer = new MutationObserver((records) => {
        const layer = records.flatMap((r) => [...r.addedNodes]).find((n) => n.classList?.contains("cm-table-ghost"));
        if (!layer) return;
        observer.disconnect();
        resolve(layer.querySelectorAll(".cm-table-ghost-cell").length);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  });
  await menuPick(rowGrip(), "Delete row");
  const ghostCount = await page.evaluate(() =>
    Promise.race([window.ghostCells, new Promise((r) => setTimeout(() => r(0), 3000))]),
  );
  check("a deleted row leaves a trace", ghostCount === 3, String(ghostCount));
  check("the cursor stays where the row was", (await activeCell()) === "2,1", await activeCell());
  await settle();
  const noEast = await disk("Plot");
  check("the row is gone from the file", !noEast.includes("East"));
  await page.keyboard.press(`${MOD}+z`);
  await pause(80);
  const brought = await page.locator(".cm-table-widget .is-marked").count();
  check("undo marks what came back", brought === 3, String(brought));
  check("focus returns to a cell after undo", (await activeCell()).includes(","), await activeCell());
  await settle();
  check("undo returns the exact file after: delete row", (await disk("Plot")) === PLOT);

  await open("Plot");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await aim(3, 0);
  await addRow().click();
  const reduced = await page.evaluate(() => ({
    marked: document.querySelectorAll(".cm-table-widget .is-marked").length,
    moving: document
      .querySelector(".cm-table-widget")
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getKeyframes().some((k) => k.transform)).length,
  }));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  check(
    "Reduce Motion keeps the mark and drops the movement",
    reduced.marked > 0 && reduced.moving === 0 && arrived.moving > 0,
    JSON.stringify({ reduced, arrived }),
  );

  await open("Single");
  await cell(0, 0).click({ timeout: 5000 });
  await idle(page);
  check("a header-only table can be clicked and grown", (await activeCell()) === "0,0", await activeCell());
  await page.keyboard.press(`${MOD}+Alt+Backspace`);
  await idle(page);
  const why = await page
    .locator(".toast")
    .last()
    .textContent()
    .catch(() => "");
  check("an impossible action says why", /needs one column/.test(why), why);
  check("the impossible action changes nothing", (await disk("Single")) === FILES.Single);
  await addRow().click();
  await idle(page);
  check("a header-only table can be clicked and grown: add row", (await page.locator(".cm-table-widget tr").count()) === 2);

  await open("Plot");
  await aim(1, 1);
  await columnGrip().click();
  await idle(page);
  await page.keyboard.press("Escape");
  await aim(1, 0);
  await columnGrip().click();
  await idle(page);
  const blockedItem = await page.locator('.context-item:has-text("Move column left") .context-hint').textContent();
  check("a blocked menu item says why", /first/i.test(blockedItem), blockedItem);
  await page.keyboard.press("Escape");

  /* Dragging */
  const drag = async (kind, from, to) => {
    const handle = kind === "row" ? rowGrip() : columnGrip();
    await (kind === "row" ? aim(from, 0) : aim(1, from));
    const box = await handle.boundingBox();
    const target = await cell(kind === "row" ? to : 1, kind === "row" ? 0 : to).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const x = kind === "row" ? box.x + 4 : target.x + target.width * (to > from ? 0.8 : 0.2);
    const y = kind === "row" ? target.y + target.height * (to > from ? 0.8 : 0.2) : box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 8 });
    await pause(50);
    const guide = await page.locator(".cm-table-drop").count();
    const tinted = await page.locator(".cm-table-widget .is-acted-on").count();
    await page.mouse.up();
    await pause(60);
    return { guide, tinted };
  };
  await open("Plot");
  const dragRow = await drag("row", 3, 1);
  const markedRow = await page.locator('.cm-table-widget .is-marked[data-row="1"]').count();
  check("a row can be dragged to a new place", dragRow.guide === 1 && dragRow.tinted === 3, JSON.stringify(dragRow));
  check("a moved row is marked at its new place", markedRow === 3, String(markedRow));
  await settle();
  const movedRow = await disk("Plot");
  check(
    "moving keeps every cell's bytes: row",
    movedRow ===
      PLOT.replace(
        "| North | Alliums | 12 |\n| East | Legumes | 9 |\n| South | Brassicas | 14 |",
        "| South | Brassicas | 14 |\n| North | Alliums | 12 |\n| East | Legumes | 9 |",
      ),
    movedRow.slice(40, 180),
  );
  await undoExact("Plot", PLOT, "drag row");
  await open("Plot");
  const dragColumn = await drag("column", 0, 2);
  check("a column can be dragged to a new place", dragColumn.guide === 1 && dragColumn.tinted >= 4, JSON.stringify(dragColumn));
  await settle();
  check(
    "moving keeps every cell's bytes: column",
    (await disk("Plot")).includes("| Crop | Sown | Bed |\n| --- | ---: | --- |\n| Alliums | 12 | North |"),
    (await disk("Plot")).slice(40, 150),
  );
  await undoExact("Plot", PLOT, "drag column");

  /* Every action from the keyboard */
  const keyActions = [
    ["Insert row above", `${MOD}+Alt+ArrowUp`, "2,1", (t) => t.split("\n").length === PLOT.split("\n").length + 1],
    ["Insert row below", `${MOD}+Alt+ArrowDown`, "3,1", (t) => t.split("\n").length === PLOT.split("\n").length + 1],
    [
      "Insert column left",
      `${MOD}+Alt+ArrowLeft`,
      "2,1",
      (t) => t.includes("| --- | --- | --- | ---: |") && t.includes("| East |  | Legumes |"),
    ],
    ["Insert column right", `${MOD}+Alt+ArrowRight`, "2,2", (t) => t.includes("| East | Legumes |  | 9 |")],
    ["Move row up", `${MOD}+Alt+Shift+ArrowUp`, "1,1", (t) => t.indexOf("| East |") < t.indexOf("| North |")],
    ["Move row down", `${MOD}+Alt+Shift+ArrowDown`, "3,1", (t) => t.indexOf("| East |") > t.indexOf("| South |")],
    ["Move column left", `${MOD}+Alt+Shift+ArrowLeft`, "2,0", (t) => t.includes("| Legumes | East | 9 |")],
    ["Move column right", `${MOD}+Alt+Shift+ArrowRight`, "2,2", (t) => t.includes("| East | 9 | Legumes |")],
    ["Delete row", `${MOD}+Alt+Shift+Backspace`, "2,1", (t) => !t.includes("| East |")],
    ["Delete column", `${MOD}+Alt+Backspace`, "2,1", (t) => !t.includes("Legumes")],
  ];
  for (const [label, keys, lands, happened] of keyActions) {
    await open("Plot");
    await cell(2, 1).focus();
    await pause(80);
    await page.keyboard.press(keys);
    await pause(60);
    await settle();
    check(`every action works from the keyboard: ${label}`, happened(await disk("Plot")));
    check(`focus lands in the right cell after every action: ${label}`, (await activeCell()) === lands, await activeCell());
    await undoExact("Plot", PLOT, label);
    check(`each action is one undo step: ${label}`, (await activeCell()).includes(","), await activeCell());
  }

  /* Menus from the keyboard */
  await open("Plot");
  await cell(2, 1).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+F10");
  await idle(page);
  const menuFocus = () => page.evaluate(() => document.activeElement?.textContent ?? "");
  check(
    "menus work from the keyboard: opens with the first item focused",
    (await menuFocus()).startsWith("Insert row above"),
    await menuFocus(),
  );
  await page.keyboard.press("ArrowDown");
  check("menus work from the keyboard: arrows move", (await menuFocus()).startsWith("Insert row below"), await menuFocus());
  await page.keyboard.press("End");
  check("menus work from the keyboard: End", (await menuFocus()).startsWith("Delete table"), await menuFocus());
  await page.keyboard.press("Home");
  check("menus work from the keyboard: Home", (await menuFocus()).startsWith("Insert row above"), await menuFocus());
  await page.keyboard.press("Escape");
  await idle(page);
  check("Escape returns focus to where it came from", (await activeCell()) === "2,1", await activeCell());
  const caret = await page.evaluate(() => getSelection().anchorOffset);
  check("Escape returns the caret to where it was", caret === "Legumes".length - 1, String(caret));
  await page.keyboard.press("Shift+F10");
  await idle(page);
  await page.keyboard.press("a");
  await page.keyboard.press("a");
  check(
    "menus work from the keyboard: typing a letter jumps to it",
    (await menuFocus()).startsWith("Align center"),
    await menuFocus(),
  );
  await page.keyboard.press("Enter");
  await idle(page);
  check("alignment works from the keyboard", (await activeCell()) === "2,1", await activeCell());
  await settle();
  check("alignment reaches the file", (await disk("Plot")).includes("| :---: |"));
  await undoExact("Plot", PLOT, "align");

  await open("Plot");
  await cell(2, 1).focus();
  await pause(80);
  await page.keyboard.press("Escape");
  await pause(80);
  check(
    "Enter, F2 and Escape switch modes: Escape selects the cell",
    await page.evaluate(() => getSelection().rangeCount === 0 && document.activeElement.dataset.row === "2"),
  );
  const tabbed = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    await pause(30);
    tabbed.push(
      await page.evaluate(() => [
        document.activeElement.getAttribute("aria-label"),
        getComputedStyle(document.activeElement).opacity,
        document.activeElement.matches(":focus-visible"),
      ]),
    );
  }
  check(
    "Tab reaches every control",
    tabbed.map(([name]) => name.replace(/ \d+/, "")).join() === "Row actions,Column actions,Table actions,Add row,Add column",
    JSON.stringify(tabbed),
  );
  check(
    "controls show on keyboard focus",
    tabbed.every(([, opacity, visible]) => Number(opacity) === 1 && visible),
  );
  await page.keyboard.press("Escape");
  await pause(60);
  check("Escape from a control returns to its cell", (await activeCell()) === "2,1", await activeCell());
  const gridMoves = [
    ["ArrowUp", "1,1"],
    ["ArrowLeft", "1,0"],
    ["End", "1,2"],
    ["Home", "1,0"],
    [`${MOD}+End`, "3,2"],
    [`${MOD}+Home`, "0,0"],
    ["PageDown", "3,0"],
    ["PageUp", "0,0"],
    ["ArrowUp", "0,0"],
  ];
  for (const [key, to] of gridMoves) {
    await page.keyboard.press(key);
    await pause(30);
    check(`grid keys move the cell: ${key}`, (await activeCell()) === to, await activeCell());
  }
  const spoken = await page.locator(".cm-table-live").textContent();
  check("moving between cells is announced", /Bed, row 1 of 4, column 1 of 3: Bed/.test(spoken), spoken);
  await page.keyboard.press("Enter");
  await pause(40);
  check(
    "Enter, F2 and Escape switch modes: Enter edits",
    await page.evaluate(() => getSelection().rangeCount === 1 && getSelection().isCollapsed),
  );
  await page.keyboard.press("Escape");
  await pause(40);
  await page.keyboard.press("F2");
  await pause(40);
  check(
    "Enter, F2 and Escape switch modes: F2 edits and stays in the table",
    (await activeCell()) === "0,0" && (await page.evaluate(() => getSelection().rangeCount === 1)),
    await activeCell(),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.type("z");
  await settle();
  check("typing on a selected cell starts editing it", (await disk("Plot")).includes("| Bedz |"));
  await page.keyboard.press(`${MOD}+z`);
  await settle();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await pause(60);
  check("a second Escape leaves the table", !(await activeCell()).includes(","), await activeCell());

  await open("Plot");
  await page.locator(".cm-line", { hasText: "Rotate the beds" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await pause(80);
  check("the arrows enter a table from the text around it: down", (await activeCell()) === "0,0", await activeCell());
  await page.locator(".cm-line", { hasText: "Keep the notes" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await pause(80);
  check("the arrows enter a table from the text around it: up", (await activeCell()).startsWith("3,"), await activeCell());
  await page.locator(".cm-line", { hasText: "Keep the notes" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await idle(page);
  await settle();
  check(
    "Backspace after a table never pulls the next line into it",
    (await page.locator(".cm-table-widget tr").count()) === 4 &&
      (await disk("Plot")) === PLOT &&
      (await activeCell()).startsWith("3,"),
    await activeCell(),
  );

  const caretOnLine = (text) =>
    page.evaluate((wanted) => {
      const selection = getSelection();
      const caret = selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      const line = [...document.querySelectorAll(".cm-line")].find(
        (l) => !l.closest(".cm-table-widget") && l.textContent === wanted,
      );
      const box = line?.getBoundingClientRect();
      return !!caret && !!box && caret.height > 0 && caret.top >= box.top - 2 && caret.bottom <= box.bottom + 2;
    }, text);
  const gaps = [
    ["below", "Keep the notes", ["Home", "ArrowUp"], PLOT.replace("\n\nKeep", "\n\nx\n\nKeep")],
    ["above", "Rotate the beds", ["End", "ArrowDown"], PLOT.replace("itself.\n\n", "itself.\n\nx\n\n")],
  ];
  for (const [side, from, keys, expected] of gaps) {
    await open("Plot");
    await page.locator(".cm-line", { hasText: from }).click();
    for (const key of keys) await page.keyboard.press(key);
    await page.keyboard.type("x");
    await pause(80);
    check(
      `typing on the blank line ${side} a table keeps the text out of it and the caret in view`,
      (await page.locator(".cm-table-widget tr").count()) === 4 && (await caretOnLine("x")),
      `${await page.locator(".cm-table-widget tr").count()} rows`,
    );
    await settle();
    check(
      `the blank line ${side} the table stays between it and the typed text`,
      (await disk("Plot")) === expected,
      await disk("Plot"),
    );
  }
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc table");
  check(
    "Read agrees that the typed text is not a row",
    (await page.locator(".doc table tr").count()) === 4 && (await page.locator(".doc p", { hasText: /^x$/ }).count()) === 1,
  );
  await open("Plot");
  await page.locator(".cm-line", { hasText: "Keep the notes" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Delete");
  await idle(page);
  check(
    "Delete on the blank line under a table never pulls the next line into it",
    (await page.locator(".cm-table-widget tr").count()) === 4 && (await caretOnLine("Keep the notes after the table.")),
    `${await page.locator(".cm-table-widget tr").count()} rows`,
  );
  await settle().catch(() => {});
  check("and the file is untouched", (await disk("Plot")) === PLOT, await disk("Plot"));

  /* Semantics */
  await open("Plot");
  const grid = await page.evaluate(() => {
    const table = document.querySelector(".cm-table-widget table");
    const th = table.querySelector("th");
    const td = table.querySelector('td[data-column="1"]');
    const header = document.getElementById(td.getAttribute("headers"));
    return {
      role: table.getAttribute("role"),
      rows: table.getAttribute("aria-rowcount"),
      columns: table.getAttribute("aria-colcount"),
      rowIndex: td.parentElement.getAttribute("aria-rowindex"),
      colIndex: td.getAttribute("aria-colindex"),
      headerRole: th.getAttribute("role"),
      cellRole: td.getAttribute("role"),
      header: header?.textContent,
      label: td.getAttribute("aria-label"),
    };
  });
  check(
    "the table is a grid with indices",
    grid.role === "grid" &&
      grid.rows === "4" &&
      grid.columns === "3" &&
      grid.rowIndex === "2" &&
      grid.colIndex === "2" &&
      grid.cellRole === "gridcell",
    JSON.stringify(grid),
  );
  check(
    "cells name their header and keep their text",
    grid.headerRole === "columnheader" && grid.header === "Crop" && grid.label === null,
    JSON.stringify(grid),
  );

  /* Contrast */
  await open("Plot");
  await aim(1, 1);
  const contrast = await page.evaluate(async () => {
    const { FAMILIES, applyTheme } = await import(/* @vite-ignore */ `${location.origin}/src/themes.ts`);
    const lum = ([r, g, b]) => {
      const f = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const rgb = (color, under) => {
      paint.clearRect(0, 0, 1, 1);
      if (under) {
        paint.fillStyle = under;
        paint.fillRect(0, 0, 1, 1);
      }
      paint.fillStyle = color;
      paint.fillRect(0, 0, 1, 1);
      return [...paint.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const still = document.createElement("style");
    still.textContent = "* { transition: none !important; }";
    document.head.append(still);
    const probe = document.createElement("span");
    document.body.append(probe);
    const cssColor = (v) => {
      probe.style.color = v;
      return getComputedStyle(probe).color;
    };
    const out = [];
    for (const family of FAMILIES)
      for (const scheme of ["light", "dark"]) {
        applyTheme(family, scheme);
        const ground = cssColor("var(--paper)");
        const icon = getComputedStyle(document.querySelector(".cm-table-grip")).color;
        const tinted = cssColor("color-mix(in oklab, var(--accent) 7%, var(--paper))");
        out.push({
          theme: family[scheme].id,
          icon: ratio(rgb(icon, ground), rgb(ground)),
          ring: ratio(rgb(cssColor("var(--accent)"), ground), rgb(ground)),
          ringOnTint: ratio(rgb(cssColor("var(--accent)"), tinted), rgb(tinted)),
        });
      }
    still.remove();
    return out;
  });
  check(
    "control icons are at least 3:1 in every theme",
    contrast.every((c) => c.icon >= 3),
    JSON.stringify(contrast.map((c) => [c.theme, Math.round(c.icon * 100) / 100])),
  );
  check(
    "the focus ring is at least 3:1 in every theme",
    contrast.every((c) => c.ring >= 3 && c.ringOnTint >= 3),
    JSON.stringify(contrast.map((c) => [c.theme, Math.round(c.ring * 100) / 100])),
  );

  /* Fidelity */
  await open("Awkward");
  await cell(1, 1).click();
  await pause(60);
  await cell(1, 3).click();
  await pause(60);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settle();
  check("opening and clicking through writes nothing", (await disk("Awkward")) === AWKWARD);
  await cell(1, 3).click();
  await page.keyboard.type("y");
  await settle();
  check(
    "aliases and code survive an edit nearby",
    (await disk("Awkward")) === AWKWARD.replace("| `a \\| b` | |", "| `a \\| b` | y |"),
  );
  await open("Plot");
  await cell(2, 1).click();
  await page.keyboard.press("End");
  await page.keyboard.type("x|y");
  await settle();
  check("a typed pipe is escaped", (await disk("Plot")).includes("| East | Legumesx\\|y | 9 |"));
  check("an edit changes only that cell", (await disk("Plot")) === PLOT.replace("Legumes", "Legumesx\\|y"));
  check("the file is still a plain table", (await disk("Plot")).includes("| --- | --- | ---: |"));
  for (const name of ["Adjacent", "Bare"]) {
    await open(name);
    await cell(0, 0).click();
    await pause(50);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await settle();
    check(`odd tables keep their bytes: ${name}`, (await disk(name)) === FILES[name]);
  }
  await open("Bare");
  await cell(1, 1).click();
  await page.keyboard.press(`${MOD}+Alt+Shift+ArrowLeft`);
  await settle();
  check(
    "a table without outer pipes can move a column and stay valid",
    (await disk("Bare")).includes("36 | Ada"),
    (await disk("Bare")).slice(0, 40),
  );

  await open("Last");
  await page.mouse.click(700, 620);
  await idle(page);
  await page.keyboard.type("Z");
  await settle();
  check(
    "typing after a table at the end of a note",
    (await disk("Last")) === `${FILES.Last}\n\nZ`,
    JSON.stringify((await disk("Last")).slice(-20)),
  );
  await page.keyboard.press(`${MOD}+z`);
  await idle(page);
  await page.keyboard.press(`${MOD}+z`);
  await settle();
  check(
    "undo returns the exact file after: typing below a final table",
    (await disk("Last")) === FILES.Last,
    JSON.stringify((await disk("Last")).slice(-20)),
  );
  await open("First");
  await cell(0, 0).click();
  await page.keyboard.press("ArrowUp");
  await idle(page);
  await page.keyboard.type("Q");
  await settle();
  check(
    "typing before a table at the start of a note",
    (await disk("First")) === `Q\n\n${FILES.First}`,
    JSON.stringify((await disk("First")).slice(0, 20)),
  );
  await open("Tight");
  await aim(1, 1);
  const tight = await geometry();
  check(
    "a table touching the next line keeps room for its controls",
    tight[CONTROLS[2]].overlaps === 0 && tight[CONTROLS[1]].overlaps === 0,
    JSON.stringify(tight[CONTROLS[2]]),
  );

  await open("Plot");
  await cell(1, 0).click();
  await page.evaluate(() => {
    const cell = document.activeElement;
    for (const key of ["Enter", "Tab"])
      cell.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true, cancelable: true }));
  });
  await pause(60);
  check("composition is left alone", (await activeCell()) === "1,0" && (await page.locator(".cm-table-widget tr").count()) === 4);

  /* Width */
  await open("Wide");
  await aim(1, 1);
  const wide = await page.evaluate(() => {
    const wrap = document.querySelector(".cm-table-widget .table-wrap");
    const content = document.querySelector(".cm-content");
    let sideways = 0;
    for (let el = content; el && el !== document.documentElement; el = el.parentElement) {
      const before = el.scrollLeft;
      el.scrollLeft = before + 40;
      sideways += el.scrollLeft - before;
      el.scrollLeft = before;
    }
    return {
      scrolls: wrap.scrollWidth > wrap.clientWidth,
      content: content.getBoundingClientRect().width,
      parent: content.parentElement.getBoundingClientRect().width,
      sideways,
    };
  });
  check(
    "a wide table scrolls inside its own box",
    wide.scrolls && wide.content <= wide.parent + 1 && wide.sideways === 0,
    JSON.stringify(wide),
  );
  const wideControls = await geometry();
  check(
    "no control overlaps cell text in a wide table",
    Object.values(wideControls).every((c) => c.overlaps === 0),
    JSON.stringify(Object.values(wideControls).map((c) => c.overlaps)),
  );
  await addColumn().click();
  await idle(page);
  check("the add-column bar works on a wide table", (await page.locator(".cm-table-widget th").count()) === 13);
  check(
    "the new column is scrolled into view",
    await page.evaluate(() => {
      const r = document.activeElement.getBoundingClientRect();
      const w = document.querySelector(".cm-table-widget .table-wrap").getBoundingClientRect();
      return r.right <= w.right + 1 && r.left >= w.left - 1;
    }),
  );

  await page.setViewportSize({ width: 560, height: 800 });
  for (const name of ["Plot", "Awkward", "Wide"]) {
    await open(name);
    await addRow().scrollIntoViewIfNeeded();
    await aim(1, 1);
    const narrow = await geometry();
    check(
      `controls are clickable at the minimum window: ${name}`,
      Object.values(narrow).every((c) => c.clickable && c.onScreen),
      JSON.stringify(Object.values(narrow).map((c) => [Math.round(c.x), Math.round(c.right), c.clickable])),
    );
    check(
      `no control overlaps cell text at the minimum window: ${name}`,
      Object.values(narrow).every((c) => c.overlaps === 0),
      JSON.stringify(Object.values(narrow).map((c) => c.overlaps)),
    );
    check(
      `targets are at least 24 px at the minimum window: ${name}`,
      Object.values(narrow).every((c) => c.width >= 24 && c.height >= 24),
    );
  }
  await page.setViewportSize({ width: 1400, height: 900 });

  await open("Long");
  await page.locator(".cm-content").click({ position: { x: 100, y: 200 } });
  await page.keyboard.press(DOC_END);
  await idle(page);
  await page.locator(".cm-line", { hasText: "End." }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await idle(page);
  const unobscured = await page.evaluate(() => {
    const cell = document.activeElement;
    const r = cell.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return cell === hit || cell.contains(hit);
  });
  check("a focused cell is not hidden", unobscured);

  await open("Plot");
  await aim(1, 1);
  await page.keyboard.press("Meta+=");
  await page.keyboard.press("Meta+=");
  await page.keyboard.press("Meta+=");
  await idle(page);
  await aim(2, 1);
  const larger = await geometry();
  const biggerRow = await page.evaluate(() => {
    const row = document.querySelector('.cm-table-widget [data-row="2"]').parentElement.getBoundingClientRect();
    return { top: row.top, height: row.height };
  });
  check(
    "larger text keeps controls in place",
    Math.abs(larger[CONTROLS[0]].y - biggerRow.top) <= 1 &&
      Math.abs(larger[CONTROLS[0]].height - biggerRow.height) <= 1 &&
      Object.values(larger).every((c) => c.overlaps === 0),
    JSON.stringify(biggerRow),
  );
  await page.keyboard.press("Meta+0");
  await idle(page);

  await page.evaluate(() => document.activeElement?.blur?.());
  await open("Plot");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".doc-title");
  await idle(page);
  const readHeads = await page.$$eval(".doc table th", (heads) => heads.map((h) => Math.round(h.getBoundingClientRect().left)));
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-table-widget");
  await idle(page);
  const editHeads = await page.$$eval(".cm-table-widget th", (heads) =>
    heads.map((h) => Math.round(h.getBoundingClientRect().left)),
  );
  check("table text lines up in Read and Edit", readHeads.join() === editHeads.join(), `${readHeads} / ${editHeads}`);

  await open("Plot");
  await page.route("**/*", (route) => {
    const request = route.request();
    return request.method() !== "GET" && /write|save|vault/.test(request.url()) ? route.abort() : route.continue();
  });
  await cell(1, 0).click();
  await page.keyboard.press("End");
  await page.keyboard.type("q");
  await page
    .waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "failed", null, { timeout: 5000 })
    .catch(() => {});
  const failedState = await page.evaluate(() => ({
    state: document.querySelector(".edit-state")?.dataset.state,
    banner: document.querySelector(".edit-banner, [class*='banner']:not([hidden])")?.textContent ?? "",
  }));
  check("a failed write from a table is visible", failedState.state === "failed", JSON.stringify(failedState));
  await page.unroute("**/*");

  /* The table clips to its rounded corners, so a focused corner cell has to round the same corner by the same amount. */
  const cornerRadii = (row, column) =>
    cell(row, column).evaluate((focused) => {
      focused.focus();
      const style = getComputedStyle(focused);
      return {
        tl: Number.parseFloat(style.borderTopLeftRadius),
        tr: Number.parseFloat(style.borderTopRightRadius),
        bl: Number.parseFloat(style.borderBottomLeftRadius),
        br: Number.parseFloat(style.borderBottomRightRadius),
        table: Number.parseFloat(getComputedStyle(focused.closest(".table-wrap")).borderTopLeftRadius),
      };
    });
  const roundsOnly = (radii, corners) =>
    ["tl", "tr", "bl", "br"].every((corner) => (radii[corner] === radii.table) === corners.includes(corner));
  await open("Plot");
  for (const [row, column, corners, name] of [
    [0, 0, ["tl"], "top left"],
    [0, 2, ["tr"], "top right"],
    [3, 0, ["bl"], "bottom left"],
    [3, 2, ["br"], "bottom right"],
    [1, 1, [], "middle"],
  ]) {
    const radii = await cornerRadii(row, column);
    check(`a focused ${name} cell's outline follows the table's corners`, roundsOnly(radii, corners), JSON.stringify(radii));
  }
  await open("OneColumn");
  const columnHead = await cornerRadii(0, 0);
  const columnLast = await cornerRadii(2, 0);
  check("a one-column header rounds both top corners", roundsOnly(columnHead, ["tl", "tr"]), JSON.stringify(columnHead));
  check("a one-column last row rounds both bottom corners", roundsOnly(columnLast, ["bl", "br"]), JSON.stringify(columnLast));
  await open("Single");
  const alone = await cornerRadii(0, 0);
  check("a header-only single cell rounds all four corners", roundsOnly(alone, ["tl", "tr", "bl", "br"]), JSON.stringify(alone));

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("the run finished", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
  await app.close();
}

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
