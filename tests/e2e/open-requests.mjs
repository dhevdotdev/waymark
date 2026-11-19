// Notes handed over from outside the app: a Finder open or a waymark:// link, as the Rust layer passes them on.
// Usage: node tests/e2e/open-requests.mjs
import { webkit } from "playwright";
import { idle, watchIdle } from "./idle.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);

const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await watchIdle(page);
const errors = [];
watchPageErrors(page, errors);
const hand = async (...requests) => {
  await page.evaluate((list) => window.waymark.handleRequests(list), requests);
  await page.evaluate(() => window.waymark.requests);
  await idle(page);
};
const notePath = () => page.evaluate(() => window.waymark.reader.notePath);
const toastText = () => page.locator(".toast:not(.is-leaving)").last().textContent();

try {
  await page.goto(`${app.url}?note=Welcome`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await idle(page);

  await hand({ kind: "inVault", path: "Baking/Tools/Proofing baskets and banneton care.md", heading: null });
  check(
    "a vault path opens its note",
    (await notePath()) === "Baking/Tools/Proofing baskets and banneton care.md",
    await notePath(),
  );

  await hand({ kind: "inVault", path: "Crumb structure and the overproofing problem", heading: "Fixes" });
  check(
    "a bare name opens the note a link would",
    (await notePath()) === "Baking/Sourdough/Crumb structure and the overproofing problem.md",
    await notePath(),
  );
  const heading = await page.evaluate(() => {
    const h = [...document.querySelectorAll(".doc h2")].find((el) => el.textContent.includes("Fixes"));
    const top = h.getBoundingClientRect().top - document.querySelector(".scroller").getBoundingClientRect().top;
    return Math.round(top);
  });
  check("the heading is brought to the top", heading >= 0 && heading < 80, `${heading}px from the top`);

  const before = await notePath();
  await hand({ kind: "inVault", path: "../Welcome.md", heading: null });
  check("a path that climbs out of the vault opens nothing", (await notePath()) === before);
  check("and says so", (await toastText()).includes("no note"), await toastText());

  await hand({ kind: "inVault", path: "Duplicate name", heading: null });
  check("a name shared by two notes asks for a path", (await toastText()).includes("More than one note"), await toastText());

  await hand({ kind: "file", path: "/Users/someone/Elsewhere/Stray.md", heading: null });
  check("a file outside every known vault is not opened", (await notePath()) === before);
  check("and the reason names the file", (await toastText()).includes("“Stray.md” is not in a vault"), await toastText());

  await hand({ kind: "refused", reason: "This Waymark link names no note, so nothing was opened." });
  check("a refusal from the Rust layer is shown as it is", (await toastText()).startsWith("This Waymark link names no note"));

  await hand(
    { kind: "inVault", path: "Welcome", heading: null },
    { kind: "inVault", path: "Baking/Tools/Proofing baskets and banneton care.md", heading: null },
  );
  check("two requests at once are taken in order", (await notePath()) === "Baking/Tools/Proofing baskets and banneton care.md");

  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  check("the suite finished", false, `${error.message.split("\n").slice(0, 3).join(" ")} | ${errors[0] ?? ""}`);
}
await browser.close();
await app.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
