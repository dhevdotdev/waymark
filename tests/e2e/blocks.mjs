// How tables and callouts read in WebKit: the header band, the header staying in view, and inline code inside a callout.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { idle, watchIdle } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const rows = (n) => Array.from({ length: n }, (_, i) => `| Row ${i + 1} | value ${i + 1} | ${i * 3} |`).join("\n");
const wide = (word) => Array.from({ length: 14 }, (_, i) => `| ${word} number ${i + 1} `).join("");
const KINDS = ["note", "tip", "warning", "danger", "info", "success", "question", "quote"];
const NOTES = {
  "Tall.md": `# Tall\n\nBefore.\n\n| Name | Detail | Count |\n| --- | --- | ---: |\n${rows(60)}\n\n${"After.\n\n".repeat(30)}`,
  "Breaks.md":
    "# Breaks\n\none\ntwo  \nthree\n\n> [!note] Title\n> first\n> second\n\n- item\n  more\n\n| Head |\n| --- |\n| a<br>b |\n",
  "Empty corner.md": "# Empty corner\n\n|  | Symmetric | Asymmetric |\n| --- | --- | --- |\n| Keys | One | Two |\n",
  "Picking.md":
    "# Picking\n\nBefore the table.\n\n| Step | Party A | Party B |\n| --- | --- | --- |\n| Public value | `5^6 mod 23` | `5^15 mod 23` |\n| Received | 19 | 8 |\n\nAfter the table.\n",
  "Layout.md": "# Layout\n\n|  |  |\n| --- | --- |\n| left | right |\n| more | cells |\n",
  "Sideways.md": `# Sideways\n\n${wide("Column")}|\n${"| --- ".repeat(14)}|\n${Array.from({ length: 50 }, () => `${wide("value")}|`).join("\n")}\n`,
  "Callouts.md": `# Callouts\n\nPlain \`code\` here.\n\n${KINDS.map((k) => `> [!${k}] ${k}\n> Uses \`InlineCode\` inside.\n`).join("\n")}\n> [!warning] With a table\n> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n`,
};
const app = await serveFixture();
for (const [name, text] of Object.entries(NOTES)) await writeFile(path.join(app.vault, name), text);
const browser = await webkit.launch();
const errors = [];

async function run(scheme) {
  const page = await (await browser.newContext({ viewport: { width: 1320, height: 800 }, colorScheme: scheme })).newPage();
  await watchIdle(page);
  watchPageErrors(page, errors);
  const pause = (ms) => page.waitForTimeout(ms);
  const open = async (name) => {
    await page.evaluate((target) => window.waymark.open(target), name);
    await idle(page);
  };
  const label = (text) => `${text} (${scheme})`;
  await page.goto(`${app.url}?note=Tall`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);

  const head = () =>
    page.evaluate(() => {
      const scroller = document.querySelector(".scroller").getBoundingClientRect();
      const th = document.querySelector(".scroller th");
      const cell = th.getBoundingClientRect();
      const style = getComputedStyle(th);
      const probe = document.elementFromPoint(cell.left + 30, cell.top + cell.height / 2);
      return {
        top: Math.round(cell.top - scroller.top),
        background: style.backgroundColor,
        paper: getComputedStyle(document.querySelector(".scroller")).backgroundColor,
        onTop: probe === th || th.contains(probe),
      };
    });
  const resting = await head();
  check(
    label("a header row has its own band"),
    resting.background !== "rgba(0, 0, 0, 0)" && !resting.background.includes(", 0)"),
    resting.background,
  );
  check(
    label("the band is opaque, so rows cannot show through"),
    !/rgba\(.*,\s*0?\.\d+\)/.test(resting.background),
    resting.background,
  );
  const edge = () =>
    page
      .locator(".table-wrap")
      .first()
      .evaluate((w) => {
        const style = getComputedStyle(w);
        return {
          width: style.outlineWidth,
          style: style.outlineStyle,
          radius: style.borderTopLeftRadius,
          firstCell: Math.round(w.querySelector("th").getBoundingClientRect().left),
        };
      });
  const headerEdges = await page.evaluate(() => {
    const cells = [...document.querySelector(".scroller thead tr").children].map((c) => getComputedStyle(c).boxShadow);
    return { first: cells[0], last: cells.at(-1) };
  });
  check(
    label("the header row carries the outline across its band"),
    headerEdges.first.split("inset").length >= 4 && headerEdges.last.split("inset").length >= 4,
    JSON.stringify(headerEdges),
  );
  const outlined = await edge();
  check(
    label("a table has an outline around it"),
    outlined.width === "1px" && outlined.style === "solid" && outlined.radius !== "0px",
    JSON.stringify(outlined),
  );
  const titleBefore = await page.locator(".doc-title").evaluate((t) => t.getBoundingClientRect().height);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 900);
  await idle(page);
  const stuck = await head();
  check(label("the header stays in view while its rows scroll"), stuck.top === 0 && stuck.onTop, JSON.stringify(stuck));
  check(label("a row is under it, not over it"), stuck.onTop);
  await page.mouse.wheel(0, 6000);
  await idle(page);
  check(label("it leaves with its table"), (await head()).top < 0, String((await head()).top));
  check(
    label("nothing else changed size"),
    (await page.locator(".doc-title").evaluate((t) => t.getBoundingClientRect().height)) === titleBefore,
  );

  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  await page.locator(".scroller").evaluate((s) => {
    const table = s.querySelector(".table-wrap").getBoundingClientRect();
    s.scrollTop += table.top - s.getBoundingClientRect().top + 500;
  });
  await idle(page);
  const editing = await head();
  check(label("the header stays in view in Edit too"), editing.top === 0 && editing.onTop, JSON.stringify(editing));
  const outlinedEdit = await edge();
  check(
    label("the outline is the same in Edit, and the cells stay put"),
    outlinedEdit.width === "1px" && outlinedEdit.radius === outlined.radius && outlinedEdit.firstCell === outlined.firstCell,
    JSON.stringify(outlinedEdit),
  );
  const grips = await page.evaluate(() => {
    const th = document.querySelector(".scroller th").getBoundingClientRect();
    return [...document.querySelectorAll(".cm-table-grip, .cm-table-add")]
      .filter((g) => !g.hidden && g.offsetParent)
      .map((g) => g.getBoundingClientRect())
      .filter((g) => g.left < th.right + 400 && g.right > th.left && g.top < th.bottom && g.bottom > th.top && g.left >= th.left)
      .length;
  });
  check(label("no table control sits on the stuck header"), grips === 0, String(grips));
  await page.locator(".scroller td").nth(40).click();
  await page.keyboard.type("x");
  await idle(page);
  check(label("typing in a cell leaves the header in view"), (await head()).top === 0, String((await head()).top));
  await page.keyboard.press("Backspace");
  await idle(page);
  await page.keyboard.press("Meta+e");
  await idle(page);

  await open("Breaks.md");
  const brs = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => el.querySelectorAll("br").length);
  check(
    label("a single newline is a line break, and two trailing spaces only one"),
    (await brs(".doc p")) === 2,
    String(await brs(".doc p")),
  );
  check(label("a callout keeps its lines"), (await brs(".callout")) === 1, String(await brs(".callout")));
  check(label("a list item keeps its lines"), (await brs(".doc li")) === 1, String(await brs(".doc li")));
  check(label("a table cell's break stays one break"), (await brs(".doc td")) === 1, String(await brs(".doc td")));
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  const editLines = await page.locator(".cm-line").allTextContents();
  check(
    label("Edit shows the same lines Read does"),
    ["one", "three"].every((word) => editLines.some((t) => t.trim() === word)) &&
      editLines.some((t) => t.trim().startsWith("two")),
    JSON.stringify(editLines.slice(0, 6)),
  );
  check(
    label("the rendered table cell in Edit keeps its one break"),
    (await page.locator(".cm-table-widget [data-row] br").count()) === 1,
    String(await page.locator(".cm-table-widget [data-row] br").count()),
  );
  await page.keyboard.press("Meta+e");
  await idle(page);
  await open("Picking.md");
  const spanned = () => page.locator(".doc .is-spanned").evaluateAll((cells) => cells.map((c) => c.textContent));
  const pick = (from, fromAt, to, toAt) =>
    page.evaluate(
      ([a, aAt, b, bAt]) => {
        const textOf = (i) => document.querySelectorAll(".doc :is(td, th)")[i].firstChild;
        const place = (i, at) => (at < 0 ? [document.querySelectorAll(".doc :is(td, th)")[i], 0] : [textOf(i), at]);
        getSelection().setBaseAndExtent(...place(a, aAt), ...place(b, bAt));
      },
      [from, fromAt, to, toAt],
    );
  await pick(0, 1, 3, 2);
  await pause(60);
  check(label("a selection across cells fills them"), (await spanned()).length === 4, JSON.stringify(await spanned()));
  const firstFill = await page
    .locator(".doc th")
    .first()
    .evaluate((c) => getComputedStyle(c).backgroundImage);
  check(label("the fill is drawn"), firstFill.includes("gradient"), firstFill);
  await pick(0, 1, 0, 3);
  await pause(60);
  check(label("inside one cell it stays a text highlight"), (await spanned()).length === 0);
  await pick(0, 0, 1, -1);
  await pause(60);
  check(
    label("a selection stopping at a cell's start leaves that cell out"),
    (await spanned()).length === 1,
    JSON.stringify(await spanned()),
  );
  await page.evaluate(() => {
    const doc = document.querySelector(".doc");
    const para = [...doc.querySelectorAll("p")];
    getSelection().setBaseAndExtent(para[0].firstChild, 2, para[1].firstChild, 3);
  });
  await pause(60);
  check(
    label("running through a whole table fills every cell"),
    (await spanned()).length === 9,
    String((await spanned()).length),
  );
  check(label("copying still gives the text"), (await page.evaluate(() => getSelection().toString())).includes("Party A"));
  const a = await page.locator(".doc th").first().boundingBox();
  const b = await page.locator(".doc td").nth(4).boundingBox();
  await page.evaluate(() => getSelection().removeAllRanges());
  await pause(60);
  check(label("clearing the selection clears the fill"), (await spanned()).length === 0);
  await page.mouse.move(a.x + 20, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 10, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await pause(60);
  check(label("dragging across cells fills them"), (await spanned()).length >= 2, JSON.stringify(await spanned()));
  await page.evaluate(() => getSelection().removeAllRanges());
  await open("Empty corner.md");
  const corner = await page.locator(".doc th").first().boundingBox();
  const farCell = await page.locator(".doc td").last().boundingBox();
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(farCell.x + 30, farCell.y + farCell.height / 2, { steps: 6 });
  await page.mouse.up();
  await pause(80);
  check(
    label("a selection from an empty cell fills that cell too"),
    (await page
      .locator(".doc th")
      .first()
      .evaluate((c) => c.classList.contains("is-spanned"))) && (await page.locator(".doc .is-spanned").count()) === 6,
    String(await page.locator(".doc .is-spanned").count()),
  );
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".doc :is(td, th)")];
    getSelection().setBaseAndExtent(cells[0], 0, cells[1].firstChild, 3);
  });
  await pause(60);
  check(
    label("starting exactly at an empty cell counts"),
    await page
      .locator(".doc th")
      .first()
      .evaluate((c) => c.classList.contains("is-spanned")),
  );
  await page.evaluate(() => getSelection().removeAllRanges());
  await open("Layout.md");
  const blank = await head();
  check(label("a table with an empty header gets no band"), blank.background === "rgba(0, 0, 0, 0)", blank.background);

  await open("Sideways.md");
  check(
    label("a table wider than the column still scrolls sideways"),
    await page.locator(".table-wrap").evaluate((w) => w.scrollWidth > w.clientWidth + 20 && !w.classList.contains("fits")),
  );
  await page.locator(".table-wrap").evaluate((w) => {
    w.scrollLeft = 300;
  });
  check(label("and really moves"), (await page.locator(".table-wrap").evaluate((w) => w.scrollLeft)) === 300);

  await open("Callouts.md");
  const chips = await page.evaluate(() => {
    const plain = getComputedStyle(document.querySelector(".doc > p code")).backgroundColor;
    return [...document.querySelectorAll(".callout")].slice(0, 8).map((callout) => {
      const code = callout.querySelector(".callout-content code");
      return {
        kind: callout.dataset.callout,
        code: getComputedStyle(code).backgroundColor,
        same: getComputedStyle(code).backgroundColor === plain,
      };
    });
  });
  check(
    label("inline code in a callout drops the plain grey"),
    chips.length === 8 && chips.every((c) => !c.same),
    JSON.stringify(chips.filter((c) => c.same)),
  );
  check(
    label("each kind of callout tints its code its own way"),
    new Set(chips.map((c) => c.code)).size >= 6,
    String(new Set(chips.map((c) => c.code)).size),
  );
  const inCallout = await page.evaluate(() => {
    const callout = document.querySelectorAll(".callout")[8];
    const th = callout.querySelector("th");
    return { th: getComputedStyle(th).backgroundColor, callout: getComputedStyle(callout).backgroundColor };
  });
  check(
    label("a table inside a callout bands over the callout's colour"),
    inCallout.th !== inCallout.callout && inCallout.th !== "rgba(0, 0, 0, 0)",
    JSON.stringify(inCallout),
  );
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await idle(page);
  const editChips = await page.evaluate(() => {
    const codes = [...document.querySelectorAll(".cm-inline-code")];
    const plain = getComputedStyle(codes.find((c) => !c.closest(".cm-callout"))).backgroundColor;
    return codes.filter((c) => c.closest(".cm-callout")).map((c) => getComputedStyle(c).backgroundColor === plain);
  });
  check(label("the same holds in Edit"), editChips.length >= 8 && editChips.every((same) => !same), JSON.stringify(editChips));
  await page.keyboard.press("Meta+e");
  await idle(page);
  await page.close();
}

try {
  await run("light");
  await run("dark");
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
