// How tables and callouts read in WebKit: the header band, the header staying in view, and inline code inside a callout.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const rows = (n) => Array.from({ length: n }, (_, i) => `| Row ${i + 1} | value ${i + 1} | ${i * 3} |`).join("\n");
const wide = (word) => Array.from({ length: 14 }, (_, i) => `| ${word} number ${i + 1} `).join("");
const KINDS = ["note", "tip", "warning", "danger", "info", "success", "question", "quote"];
const NOTES = {
  "Tall.md": `# Tall\n\nBefore.\n\n| Name | Detail | Count |\n| --- | --- | ---: |\n${rows(60)}\n\n${"After.\n\n".repeat(30)}`,
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
  watchPageErrors(page, errors);
  const pause = (ms) => page.waitForTimeout(ms);
  const open = async (name) => {
    await page.evaluate((target) => window.waymark.open(target), name);
    await pause(400);
  };
  const label = (text) => `${text} (${scheme})`;
  await page.goto(`${app.url}?note=Tall`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(500);

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
  const titleBefore = await page.locator(".doc-title").evaluate((t) => t.getBoundingClientRect().height);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, 900);
  await pause(250);
  const stuck = await head();
  check(label("the header stays in view while its rows scroll"), stuck.top === 0 && stuck.onTop, JSON.stringify(stuck));
  check(label("a row is under it, not over it"), stuck.onTop);
  await page.mouse.wheel(0, 6000);
  await pause(250);
  check(label("it leaves with its table"), (await head()).top < 0, String((await head()).top));
  check(
    label("nothing else changed size"),
    (await page.locator(".doc-title").evaluate((t) => t.getBoundingClientRect().height)) === titleBefore,
  );

  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(500);
  await page.locator(".scroller").evaluate((s) => {
    const table = s.querySelector(".table-wrap").getBoundingClientRect();
    s.scrollTop += table.top - s.getBoundingClientRect().top + 500;
  });
  await pause(300);
  const editing = await head();
  check(label("the header stays in view in Edit too"), editing.top === 0 && editing.onTop, JSON.stringify(editing));
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
  await pause(500);
  check(label("typing in a cell leaves the header in view"), (await head()).top === 0, String((await head()).top));
  await page.keyboard.press("Backspace");
  await pause(700);
  await page.keyboard.press("Meta+e");
  await pause(400);

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
  await pause(500);
  const editChips = await page.evaluate(() => {
    const codes = [...document.querySelectorAll(".cm-inline-code")];
    const plain = getComputedStyle(codes.find((c) => !c.closest(".cm-callout"))).backgroundColor;
    return codes.filter((c) => c.closest(".cm-callout")).map((c) => getComputedStyle(c).backgroundColor === plain);
  });
  check(label("the same holds in Edit"), editChips.length >= 8 && editChips.every((same) => !same), JSON.stringify(editChips));
  await page.keyboard.press("Meta+e");
  await pause(300);
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
