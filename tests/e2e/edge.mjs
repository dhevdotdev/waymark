// Cases the main flow never reaches: an empty vault, hostile note content and a very long title.
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const browser = await webkit.launch();

async function withApp(options, drive) {
  const app = await serveFixture(options);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => requests.push(r.url()));
  await drive(page, app, { errors, requests });
  await page.close();
  await app.close();
}

await withApp({ empty: true }, async (page, app, { errors }) => {
  await page.goto(app.url);
  await page.waitForSelector(".empty-state.is-page");
  check("an empty vault explains itself", (await page.textContent(".empty-state.is-page")).includes("No Markdown notes"));
  for (const chord of ["Meta+[", "Meta+]", "Meta+w", "Meta+g", "Meta+f", "Meta+t", "Control+Tab", "Escape"])
    await page.keyboard.press(chord);
  await page.click('[data-act="graph"]');
  await page.click('[data-act="rail"]');
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(150);
  check("the palette still opens in an empty vault", await page.isVisible(".palette"));
  await page.keyboard.press("Escape");
  check("nothing throws with no note open", errors.length === 0, errors[0]);
});

await withApp({}, async (page, app, { errors, requests }) => {
  await page.goto(`${app.url}?note=${encodeURIComponent("Untrusted content")}`);
  await page.waitForSelector(".doc .doc-title");
  await page.waitForTimeout(400);
  check("scripts and handlers in a note do not run", (await page.evaluate(() => window.pwned)) === undefined);
  await page.click("#js-link", { noWaitAfter: true }).catch(() => {});
  await page.waitForTimeout(100);
  check("a javascript: link does nothing", (await page.evaluate(() => window.pwned)) === undefined);
  check("note HTML cannot trigger app commands", (await page.locator(".doc [data-act]").count()) === 0);
  check("media and frames are removed", (await page.locator(".doc iframe, .doc video, .doc audio").count()) === 0);
  check("images that are not local become placeholders", (await page.locator(".doc .remote-image").count()) === 2);
  const external = requests.filter((url) => new URL(url).hostname !== "localhost");
  check("a hostile note makes no network request", external.length === 0, external[0]);
  check("nothing throws on hostile content", errors.length === 0, errors[0]);
});

await withApp({}, async (page, app, { errors }) => {
  await page.goto(`${app.url}?note=${encodeURIComponent("A very long note title")}`);
  await page.evaluate(() =>
    window.waymark.open(
      "A very long note title that keeps going well past the width of any sidebar so that truncation has something to do.md",
    ),
  );
  await page.waitForTimeout(500);
  const box = await page.locator(".tab.is-active").boundingBox();
  const clipped = await page.locator(".tab.is-active .tab-title").evaluate((t) => t.scrollWidth > t.clientWidth);
  check("a very long title is clipped inside a capped tab", box.width <= 420 && clipped, `${Math.round(box.width)}px`);
  check(
    "a very long title does not push the page sideways",
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  check("nothing throws on a long title", errors.length === 0, errors[0]);

  const openInNewTab = async (query) => {
    await page.keyboard.press("Meta+k");
    await page.keyboard.type(query);
    await page.waitForTimeout(200);
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(400);
  };
  for (const query of ["Crumb structure", "Starter feeding", "Welcome"]) await openInNewTab(query);
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(300);
  await page.locator(".tab").first().click();
  await page.waitForTimeout(300);
  const measureTabs = () =>
    page.$$eval(".tab", (tabs) =>
      tabs.map((tab) => {
        const title = tab.querySelector(".tab-title");
        const text = document.createRange();
        text.selectNodeContents(title);
        return { width: tab.offsetWidth, text: Math.ceil(text.getBoundingClientRect().width), shown: title.clientWidth };
      }),
    );
  const crowded = await measureTabs();
  const shortest = crowded.reduce((a, b) => (b.text < a.text ? b : a));
  check(
    "a short title keeps its full width when tabs are crowded",
    crowded.length === 4 && shortest.text <= shortest.shown,
    JSON.stringify(shortest),
  );
  check(
    "no tab is wider than its own title needs",
    crowded.every((t) => t.width <= t.text + 41),
    JSON.stringify(crowded),
  );
  check(
    "crowded tabs and the + button stay inside the strip",
    await page.evaluate(
      () =>
        document.querySelector(".tab-new").getBoundingClientRect().right <=
        document.querySelector(".tabs").getBoundingClientRect().right,
    ),
  );
  await page.setViewportSize({ width: 1900, height: 800 });
  await page.waitForTimeout(300);
  const roomy = await measureTabs();
  check(
    "tabs grow back when the window gives them room",
    roomy.every((t) => (t.text <= t.shown || t.width >= 319) && t.width <= t.text + 41),
    JSON.stringify(roomy),
  );
});

await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
