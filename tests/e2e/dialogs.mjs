// Confirmations: nothing destructive is armed when a dialog opens, and every path out of one is visible.
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const pause = (ms) => page.waitForTimeout(ms);
const exists = (name) => page.locator(`.nav-item[data-path="${name}"]`).count();
const ring = (locator) =>
  locator.evaluate((el) => ({
    style: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).outlineWidth,
    focus: el.matches(":focus-visible"),
  }));

async function openDialog() {
  await page.locator('.nav-item[data-path="Doomed.md"]').click({ button: "right" });
  await pause(120);
  await page.locator('.context-item:has-text("Move to Trash")').click();
  await page.waitForSelector(".prompt");
  await pause(80);
}

try {
  await writeFile(path.join(app.vault, "Doomed.md"), "Soon gone.\n");
  await writeFile(path.join(app.vault, "Linker.md"), "See [[Doomed]].\n");
  await page.goto(`${app.url}?note=Linker`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(400);

  await openDialog();
  const danger = page.locator(".prompt .btn-danger");
  const cancel = page.locator('.prompt button:has-text("Cancel")');
  const opened = await page.evaluate(() => document.activeElement.className);
  check("the dialog itself takes focus on open", opened.includes("prompt"), opened);
  const armed = await ring(danger);
  check("the destructive button shows no ring on open", !armed.focus && armed.style === "none", JSON.stringify(armed));
  const heights = await page.evaluate(() => [...document.querySelectorAll(".prompt .btn")].map((b) => b.getBoundingClientRect()));
  check("both buttons are the same height", heights[0].height === heights[1].height, heights.map((h) => h.height).join());
  check("widths follow their labels", heights[0].width !== heights[1].width);
  const edges = await page.evaluate(() =>
    [...document.querySelectorAll(".prompt .btn")].map((b) => getComputedStyle(b).boxShadow),
  );
  check(
    "both buttons carry the same edge geometry",
    edges.every((e) => /1px/.test(e)),
    edges.join(" / "),
  );

  await page.keyboard.press("Enter");
  await pause(150);
  check("Return does not delete", (await exists("Doomed.md")) === 1 && (await page.locator(".prompt").count()) === 1);
  const afterEnter = await ring(cancel);
  check("Return moves to Cancel, so the key visibly did something", afterEnter.focus, JSON.stringify(afterEnter));
  await page.keyboard.press("Tab");
  await pause(40);
  const tabbed = await ring(danger);
  check(
    "the ring shows on the destructive button when reached by keyboard",
    tabbed.focus && tabbed.style !== "none" && tabbed.width === "2px",
    JSON.stringify(tabbed),
  );
  await page.keyboard.press("Tab");
  check("Tab stays inside the dialog", (await page.evaluate(() => document.activeElement.textContent)) === "Cancel");
  await page.keyboard.press("Escape");
  check("Escape cancels at once", (await page.locator(".prompt").count()) === 0 && (await exists("Doomed.md")) === 1);

  await openDialog();
  await cancel.click();
  check("cancelling with the pointer fades the dialog out", (await page.locator(".prompt-overlay.is-leaving").count()) === 1);
  await pause(200);
  check("the fade removes it", (await page.locator(".prompt").count()) === 0 && (await exists("Doomed.md")) === 1);

  await openDialog();
  await danger.hover();
  await pause(60);
  await page.mouse.down();
  await pause(60);
  const pressed = await danger.evaluate((el) => getComputedStyle(el).scale);
  await page.mouse.up();
  check("the destructive button responds to a press", pressed !== "none", pressed);
  await pause(350);
  check("the delete goes through when the button is pressed", (await exists("Doomed.md")) === 0);

  await page.evaluate(async () => {
    const { confirmAction } = await import(/* @vite-ignore */ `${location.origin}/src/ui/prompts.ts`);
    window.answer = confirmAction({ title: "Keep your text?", body: "Saves a copy.", action: "Save a copy" });
  });
  await pause(80);
  await page.keyboard.press("Enter");
  await pause(80);
  check("a non-destructive confirm keeps Return", (await page.evaluate(() => window.answer)) === true);
  await page.evaluate(() => {
    for (const overlay of document.querySelectorAll(".prompt-overlay")) overlay.remove();
  });
} catch (e) {
  check("the run finished", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
  await rm(path.join(app.vault, "Linker.md"), { force: true });
  await app.close();
}
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
