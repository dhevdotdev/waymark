// Where outside links go, shown on hover: the same in Read and Edit, truthful for hostile notes, and always inside the window.
import { writeFile } from "node:fs/promises";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const longPath = `https://docs.example.com/${Array.from({ length: 30 }, (_, i) => `section-${i}`).join("/")}/final-page?ref=sidebar#the-end`;
const longHost = `https://${Array.from({ length: 7 }, () => "averyveryverylonglabelforthishost").join(".")}.example.com/path`;
const NOTE = `# Links

[Short](https://example.com/) and [path](https://example.com/guides/getting-started?tab=mac).

[Long path](${longPath})

[Long host](${longHost})

[Claims github](https://github.com.login-check.net/session) and [plain](http://insecure.example/login)

[Mail](mailto:someone@example.com?subject=Hi) and [Greek](https://xn--pple-43d.com/) and [word](https://example.com/caf%C3%A9)

<a id="forged" href="https://real.example/x" data-tip="https://fake.example" title="https://fake.example">raw</a>

[Note link](Other.md) and [[Other]]

> [!tip] A callout
> Inside [callout](https://callout.example/a).

| Cell |
| --- |
| [table](https://table.example/b) |
| <a href="https://cellreal.example/" data-tip="https://fake.example">rawcell</a> |

${"Words to fill the measure so that the link below has to run across the end of one line and onto the next one. ".repeat(1)}[a link written with a long enough label that it certainly wraps over two lines in the column](https://wrapped.example/two)

${"Filler paragraph.\n\n".repeat(60)}
[Last](https://last.example/bottom)
`;
const app = await serveFixture();
await writeFile(`${app.vault}/Links.md`, NOTE);
await writeFile(`${app.vault}/Other.md`, "# Other\n");
const browser = await webkit.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1320, height: 800 } })).newPage();
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);
const tooltip = page.locator(".tooltip.is-destination");
const tipState = () =>
  page.evaluate(() => {
    const t = document.querySelector(".tooltip.is-destination");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const s = getComputedStyle(t);
    return {
      text: t.textContent,
      site: t.children[0].textContent,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      lines: Math.round((r.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight)),
      restColor: getComputedStyle(t.children[1]).color,
      restWeight: getComputedStyle(t.children[1]).fontWeight,
      siteWeight: getComputedStyle(t.children[0]).fontWeight,
    };
  });
const away = async () => {
  await page.mouse.move(640, 790);
  await pause(60);
};
const hover = async (locator, line = 0) => {
  await locator.scrollIntoViewIfNeeded();
  await pause(60);
  const rect = await locator.evaluate((el, i) => {
    const r = el.getClientRects()[i];
    return { x: r.left, y: r.top, w: r.width, h: r.height, bottom: r.bottom };
  }, line);
  await away();
  await page.mouse.move(rect.x + Math.min(rect.w - 2, 6), rect.y + rect.h / 2);
  await pause(720);
  return rect;
};
const inWindow = (t) => t && t.left >= 7.5 && t.top >= 7.5 && t.right <= 1320 - 7.5 && t.bottom <= 800 - 7.5;
const a = (text) => page.locator(".doc a", { hasText: text }).first();

await page.goto(`${app.url}?note=Links`);
await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
await pause(500);

let rect = await hover(a("Short"));
let tip = await tipState();
check("a web link shows its site", tip?.site === "example.com" && tip.text === "example.com", JSON.stringify(tip));
check(
  "it sits under the link, left-aligned",
  tip && Math.abs(tip.left - rect.x) < 1 && Math.abs(tip.top - (rect.bottom + 6)) < 1,
  JSON.stringify([tip, rect]),
);
rect = await hover(a("path"));
tip = await tipState();
check(
  "the rest of the address is quieter",
  tip?.text === "example.com/guides/getting-started?tab=mac" &&
    tip.restColor !== "" &&
    Number(tip.restWeight) < Number(tip.siteWeight),
  JSON.stringify(tip),
);

const before = await page.evaluate(() => {
  const s = document.querySelector(".scroller");
  const d = document.querySelector(".doc").getBoundingClientRect();
  return [s.scrollTop, d.width, d.height, document.documentElement.scrollWidth];
});
check(
  "showing it does not move the page",
  JSON.stringify(before) ===
    JSON.stringify(
      await page.evaluate(() => {
        const s = document.querySelector(".scroller");
        const d = document.querySelector(".doc").getBoundingClientRect();
        return [s.scrollTop, d.width, d.height, document.documentElement.scrollWidth];
      }),
    ),
);

await hover(a("Long path"));
tip = await tipState();
check(
  "a long path stops at three lines",
  tip?.lines === 3 &&
    tip.text.includes("…") &&
    tip.text.startsWith("docs.example.com/section-0") &&
    tip.text.endsWith("#the-end"),
  JSON.stringify(tip),
);
await hover(a("Long host"));
tip = await tipState();
const hostOnly = new URL(longHost).host;
check("a very long host is never cut", tip?.site === hostOnly && tip.lines > 3, JSON.stringify(tip));
check("and stays in the window", inWindow(tip), JSON.stringify(tip));
await hover(a("Claims github"));
tip = await tipState();
check(
  "a lookalike host is shown whole",
  tip?.site === "github.com.login-check.net" && tip.text.endsWith("/session"),
  JSON.stringify(tip),
);
await hover(a("plain"));
check("http keeps its scheme", (await tipState())?.site === "http://insecure.example", JSON.stringify(await tipState()));
await hover(a("Mail"));
check("mail shows just the address", (await tipState())?.text === "someone@example.com", JSON.stringify(await tipState()));
await hover(a("Greek"));
check("an international host stays as it is", (await tipState())?.site === "xn--pple-43d.com", JSON.stringify(await tipState()));
await hover(a("word"));
check("plain words in a path are decoded", (await tipState())?.text === "example.com/café", JSON.stringify(await tipState()));

await hover(page.locator("#forged"));
tip = await tipState();
check("a raw HTML link shows where it really goes", tip?.text === "real.example/x", JSON.stringify(tip));
check("no second, native tooltip is possible", (await page.locator("#forged").getAttribute("title")) === null);
await page.evaluate(() => {
  document.querySelector("#forged").setAttribute("href", "https://changed.example/");
});
await hover(page.locator("#forged"));
check(
  "the address is read when shown, not remembered",
  (await tipState())?.text === "changed.example",
  JSON.stringify(await tipState()),
);
check("the address is there for VoiceOver", (await a("Short").getAttribute("aria-description")) === "Goes to example.com");

await hover(a("Note link"));
check("a note link does not get one", (await tooltip.count()) === 0);
await page
  .locator(".link-preview, .preview-card")
  .first()
  .waitFor({ timeout: 2000 })
  .catch(() => {});
await away();
await pause(500);

await hover(a("callout"));
check("works in a callout", (await tipState())?.text === "callout.example/a", JSON.stringify(await tipState()));
await hover(a("table"));
check("works in a table", (await tipState())?.text === "table.example/b", JSON.stringify(await tipState()));

const wrapped = a("written with a long enough label");
const lineCount = await wrapped.evaluate((el) => el.getClientRects().length);
check("the wrapped link does wrap", lineCount >= 2, String(lineCount));
rect = await hover(wrapped, 1);
tip = await tipState();
check(
  "a wrapped link's tooltip sits under the line pointed at",
  tip && Math.abs(tip.top - (rect.bottom + 6)) < 1 && Math.abs(tip.left - rect.x) < 1,
  JSON.stringify([tip, rect]),
);

await page.locator(".scroller").evaluate((s) => {
  s.scrollTop = s.scrollHeight;
});
await pause(150);
const last = a("Last");
rect = await last.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, h: r.height };
});
const statusHeight = await page.locator(".statusbar").evaluate((el) => el.getBoundingClientRect().height);
await page.setViewportSize({ width: 1320, height: Math.ceil(rect.y + rect.h + statusHeight + 4) });
await pause(250);
const flip = await last.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await page.mouse.move(flip.x + 4, flip.y + flip.h / 2);
await pause(720);
tip = await tipState();
check(
  "at the bottom edge it flips above",
  tip && tip.bottom <= flip.y && tip.bottom <= (await page.evaluate(() => innerHeight)),
  JSON.stringify([tip, flip]),
);
await page.setViewportSize({ width: 1320, height: 800 });
await pause(200);

await page.locator(".scroller").evaluate((s) => {
  s.scrollTop = 0;
});
await pause(200);
await page.keyboard.press("Meta+Alt+\\");
await pause(350);
await page.evaluate(() => {
  const link = document.querySelector("#forged");
  link.style.cssText = "position: fixed; right: 12px; top: 300px;";
  link.setAttribute("href", longPath());
  function longPath() {
    return `https://rightedge.example/${"segment/".repeat(40)}`;
  }
});
await pause(50);
await hover(page.locator("#forged"));
tip = await tipState();
check("at the right edge it stays in the window", inWindow(tip), JSON.stringify(tip));
await page.keyboard.press("Meta+Alt+\\");
await pause(350);

await hover(a("Short"));
check("it is showing before the checks that hide it", (await tooltip.count()) === 1);
await page.mouse.wheel(0, 40);
await pause(120);
check("scrolling hides it", (await tooltip.count()) === 0);
await page.locator(".scroller").evaluate((s) => {
  s.scrollTop = 0;
});
await pause(200);
await hover(a("Short"));
await away();
await pause(60);
check("leaving hides it", (await tooltip.count()) === 0);
const short = await a("Short").boundingBox();
await page.mouse.move(short.x + 4, short.y + short.height / 2);
await pause(120);
check("a second link soon after skips the delay", (await tooltip.count()) === 1);
await hover(a("Short"));
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await pause(150);
check("a menu hides it", (await tooltip.count()) === 0);
await page.keyboard.press("Escape");
await pause(150);
await hover(a("Short"));
await page.evaluate(() => {
  document.addEventListener("click", (e) => e.preventDefault(), { capture: true, once: true });
});
await page.mouse.down();
await pause(30);
check("pressing hides it", (await tooltip.count()) === 0);
await page.mouse.up();
await pause(150);

await away();
await pause(1000);
await page.evaluate(() => document.querySelector(".doc a[href^='https://example.com/guides']").focus());
await page.keyboard.press("Tab");
await page.keyboard.press("Shift+Tab");
await pause(720);
const focused = await page.evaluate(
  () => document.activeElement?.matches(":focus-visible") && document.activeElement.tagName === "A",
);
check("keyboard focus on a link shows it too", !focused || (await tooltip.count()) === 1, String(focused));
await page.keyboard.press("Escape");
await page.evaluate(() => document.activeElement?.blur());

/* A control's tooltip is a real tooltip, reached by the keyboard too, and only adds what the control's name lacks. */
const keyFocus = async (selector) => {
  await page.keyboard.press("Shift");
  await page.evaluate((s) => document.querySelector(s).focus(), selector);
};
await keyFocus('[data-act="settings"]');
await page.locator(".tooltip").waitFor({ timeout: 2000 });
const described = await page.evaluate(() => {
  const button = document.querySelector('[data-act="settings"]');
  const tip = document.querySelector(".tooltip");
  const by = button.getAttribute("aria-describedby");
  return { role: tip.getAttribute("role"), says: by && document.getElementById(by)?.textContent };
});
check("keyboard focus on a control shows its tooltip", described.role === "tooltip", JSON.stringify(described));
check("the control is described by the shortcut its name lacks", described.says === "⌘,", JSON.stringify(described));
await keyFocus('[data-act="sidebar"]');
await page.locator(".tooltip").waitFor({ timeout: 2000 });
const sidebarTip = await page.evaluate(() => {
  const by = document.querySelector('[data-act="sidebar"]').getAttribute("aria-describedby");
  return by && document.getElementById(by)?.textContent;
});
check("a tooltip that says more than the name describes it whole", sidebarTip === "Sidebar⌘\\", String(sidebarTip));
check(
  "the description goes with the tooltip",
  (await page.locator('[data-act="settings"]').getAttribute("aria-describedby")) === null,
);
await page.evaluate(() => document.activeElement?.blur());
check("leaving the control hides it", (await page.locator(".tooltip").count()) === 0);

/* A note link previews for the keyboard as well as the pointer. */
await keyFocus(".doc a.wikilink[data-path]");
const preview = page.locator(".preview");
await preview.waitFor({ timeout: 2000 }).catch(() => {});
const region = await page.evaluate(() => {
  const box = document.querySelector(".preview");
  const by = box?.getAttribute("aria-labelledby");
  return box && { role: box.getAttribute("role"), name: by && document.getElementById(by)?.textContent };
});
check(
  "keyboard focus on a note link opens its preview",
  region?.role === "region" && region.name === "Other",
  JSON.stringify(region),
);
await page.keyboard.press("Escape");
check("Escape closes the preview", (await preview.count()) === 0);
check(
  "and leaves focus on the link",
  await page.evaluate(() => document.activeElement?.matches(".doc a.wikilink[data-path]") === true),
);
await keyFocus(".doc a.wikilink[data-path]");
await preview.waitFor({ timeout: 2000 }).catch(() => {});
await page.evaluate(() => document.activeElement?.blur());
check("moving focus off the link closes the preview", (await preview.count()) === 0);

await away();
await page.keyboard.press("Meta+e");
await page.waitForSelector(".cm-content");
await pause(500);
const editLink = (href) => page.locator(`.cm-link[data-href="${href}"]`).first();
await hover(editLink("https://example.com/guides/getting-started?tab=mac"));
check(
  "Edit shows the same thing",
  (await tipState())?.text === "example.com/guides/getting-started?tab=mac",
  JSON.stringify(await tipState()),
);
await hover(editLink("mailto:someone@example.com?subject=Hi"));
check("Edit shows mail the same way", (await tipState())?.text === "someone@example.com", JSON.stringify(await tipState()));
await hover(page.locator(".cm-table-widget a").first());
check(
  "a link in a rendered table cell in Edit shows it",
  (await tipState())?.text === "table.example/b",
  JSON.stringify(await tipState()),
);
await hover(page.locator(".cm-table-widget a", { hasText: "rawcell" }).first());
check(
  "a raw HTML link in an Edit table cell shows where it really goes",
  (await tipState())?.text === "cellreal.example",
  JSON.stringify(await tipState()),
);
await page.keyboard.press("x");
await pause(120);
check("typing hides it", (await tooltip.count()) === 0);
await page.keyboard.press("Meta+z");
await pause(800);

check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));
await browser.close();
await app.close();
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
