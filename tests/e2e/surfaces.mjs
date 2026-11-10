// Floating surfaces and small controls: a pointer gets motion, a key press gets the end state, and nothing stacks.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await context.newPage();
const errors = [];
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);
const count = (selector) => page.locator(selector).count();
const IN_MOTION = (series) => series.some((v) => v > 0.02 && v < 0.98);

/** Records one computed property on every frame, starting before `act` runs. */
const sampleDuring = (selector, property, act, { pseudo, ms = 320 } = {}) =>
  page.evaluate(
    async ({ selector, property, pseudo, ms, act }) => {
      const seen = [];
      const started = performance.now();
      const read = () => {
        const el = document.querySelector(selector);
        if (el) seen.push(getComputedStyle(el, pseudo)[property]);
      };
      const done = new Promise((resolve) => {
        const frame = () => {
          read();
          if (performance.now() - started < ms) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      if (act) await new Function(`return (${act})()`)();
      await done;
      return seen;
    },
    { selector, property, pseudo, ms, act: act?.toString() },
  );
const numbers = (series) => series.map(Number);

try {
  await writeFile(path.join(app.vault, "Checklist.md"), "- [ ] First thing\n- [ ] Second thing\n");
  await page.goto(`${app.url}?note=Checklist`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(400);
  await page.evaluate(async () => {
    window.parts = await import(/* @vite-ignore */ `${location.origin}/src/ui/git-panel-parts.ts`);
    window.overlays = await import(/* @vite-ignore */ `${location.origin}/src/ui/overlays.ts`);
    window.sheetBody = (text) => Object.assign(document.createElement("div"), { textContent: text });
  });

  /* Context menus */
  const row = page.locator('.nav-item[data-path="Checklist.md"]');
  await row.scrollIntoViewIfNeeded();
  const rowBox = await row.boundingBox();
  await page.mouse.move(rowBox.x + 40, rowBox.y + 8);
  const opened = page.evaluate(() => {
    const seen = [];
    return new Promise((resolve) => {
      const frame = () => {
        const menu = document.querySelector(".context-menu");
        if (menu) seen.push(Number(getComputedStyle(menu).opacity));
        if (seen.length < 12) requestAnimationFrame(frame);
        else resolve(seen);
      };
      requestAnimationFrame(frame);
    });
  });
  await page.mouse.click(rowBox.x + 40, rowBox.y + 8, { button: "right" });
  check("a menu opened with the pointer fades in", IN_MOTION(await opened));
  await pause(260);
  const origin = await page.locator(".context-menu").evaluate((m) => m.style.transformOrigin);
  check("a menu grows from the point that opened it", origin === "0px 0px", origin);
  await page.keyboard.press("Escape");
  check("Escape removes a menu at once", (await count(".context-menu")) === 0);

  const corner = await page.evaluate(async () => {
    const { showContextMenu } = await import(/* @vite-ignore */ `${location.origin}/src/ui/context-menu.ts`);
    showContextMenu(1270, 780, [
      { label: "One", run() {} },
      { label: "Two", run() {} },
    ]);
    const menu = document.querySelector(".context-menu");
    return { origin: menu.style.transformOrigin, pointerX: 1270 - menu.getBoundingClientRect().left, height: menu.offsetHeight };
  });
  check(
    "a menu pushed back into the window grows from the corner by the pointer",
    corner.origin === `${corner.pointerX}px ${corner.height}px`,
    JSON.stringify(corner),
  );
  await page.mouse.click(rowBox.x + 40, rowBox.y + 8, { button: "right" });
  await pause(260);
  check("a menu has one live copy after a second right-click", (await count(".context-menu:not(.is-leaving)")) === 1);
  await page.mouse.click(600, 500);
  const leaving = await count(".context-menu.is-leaving");
  check("a menu dismissed with the pointer leaves through its exit", leaving === 1);
  await pause(200);
  check("the exit removes it", (await count(".context-menu")) === 0);

  /* Settings */
  await pause(100);
  const pointerSettings = await sampleDuring(".popover.settings", "opacity", null, { ms: 0 });
  check("settings is closed to begin with", pointerSettings.length === 0);
  await page.locator('[data-act="settings"]').click();
  await pause(260);
  await page.locator('[data-act="settings"]').click();
  check("clicking the gear again uses the same exit", (await count(".popover.settings.is-leaving")) === 1);
  await pause(200);
  await page.locator(".doc").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Meta+,");
  const instantSettings = await page.locator(".popover.settings").evaluate((p) => {
    const s = getComputedStyle(p);
    return { opacity: s.opacity, scale: s.scale, property: s.transitionDuration };
  });
  check(
    "settings from the keyboard is simply there",
    instantSettings.opacity === "1" && instantSettings.scale === "none",
    JSON.stringify(instantSettings),
  );

  /* The switch */
  const toggle = page.locator('.toggle:has(input[data-pref="sound"])');
  await toggle.locator("input").focus();
  const wasOn = await toggle.locator("input").isChecked();
  await page.keyboard.press("Space");
  const keyKnob = await toggle.locator("i").evaluate((i) => getComputedStyle(i, "::after").translate);
  const keyAtEnd = wasOn ? keyKnob === "none" || keyKnob === "0px" : keyKnob === "12px";
  check("the switch jumps when pressed with Space", keyAtEnd && (await toggle.locator("input").isChecked()) !== wasOn, keyKnob);
  const knob = sampleDuring('.toggle:has(input[data-pref="sound"]) i', "translate", null, { pseudo: "::after", ms: 300 });
  await toggle.click();
  const travel = [...new Set((await knob).filter((v) => v !== "none"))];
  check(
    reduced ? "the switch does not travel under Reduce Motion" : "the knob travels when clicked",
    reduced ? travel.length <= 1 : travel.length > 2,
    travel.slice(0, 4).join(" | "),
  );
  await page.keyboard.press("Escape");
  check("Escape closes settings at once", (await count(".popover.settings")) === 0);

  /* Sheets */
  await page.mouse.click(600, 500);
  const sheetOpacity = await sampleDuring(".sheet-overlay", "opacity", () =>
    window.parts.openSheet("One", "first", window.sheetBody("a")),
  );
  check("a sheet opened with the pointer fades in", IN_MOTION(numbers(sheetOpacity)));
  await page.evaluate(() => window.parts.openSheet("Two", "second", window.sheetBody("b")));
  check("a sheet opened from a sheet does not stack", (await count(".sheet-overlay")) === 1);
  check("it shows the new content", (await page.locator(".sheet-title").textContent()) === "Two");
  check("the label follows", (await page.locator(".sheet").getAttribute("aria-label")) === "Two");
  check("the old content is gone", (await page.locator(".sheet-body").textContent()) === "b");
  check("focus stays in the sheet", await page.evaluate(() => document.activeElement.closest(".sheet") !== null));
  await page.keyboard.press("Escape");
  check("Escape closes a sheet at once", (await count(".sheet-overlay")) === 0);
  await page.evaluate(() => window.parts.openSheet("Keyed", "", window.sheetBody("c")));
  check(
    "a sheet opened after a key press appears at full strength",
    (await page.locator(".sheet-overlay").evaluate((o) => getComputedStyle(o).opacity)) === "1",
  );
  await page.keyboard.press("Escape");

  /* The lightbox */
  const enlarge = () => window.overlays.lightbox(Object.assign(document.createElement("div"), { textContent: "Large" }));
  await page.mouse.click(600, 500);
  const lightboxOpacity = await sampleDuring(".lightbox", "opacity", enlarge);
  check("the lightbox fades in from the pointer", IN_MOTION(numbers(lightboxOpacity)));
  const left = await page.evaluate(() => {
    const box = document.querySelector(".lightbox");
    box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return box.classList.contains("is-leaving");
  });
  check("the lightbox leaves through its exit", left);
  await pause(200);
  check("and is removed", (await count(".lightbox")) === 0);
  await page.evaluate(enlarge);
  await page.keyboard.press("Escape");
  check("Escape closes the lightbox at once", (await count(".lightbox")) === 0);

  /* Toasts */
  await page.mouse.click(600, 500);
  const toastOpacity = await sampleDuring(".toast", "opacity", () => window.overlays.toast("First"), { ms: 500 });
  check("a toast from a pointer action fades in", IN_MOTION(numbers(toastOpacity)));
  const toastTravel = await page.evaluate(() => getComputedStyle(document.querySelector(".toast")).translate);
  check("it rests at its anchor", toastTravel.endsWith(" 0px") || !toastTravel.includes(" "), toastTravel);
  await page.evaluate(() => window.overlays.toast("Second", { label: "Undo", run: () => (window.undone = true) }));
  check("a replaced toast goes through its exit", (await count(".toast.is-leaving")) === 1);
  check(
    "the replaced toast takes no clicks",
    (await page.locator(".toast.is-leaving").evaluate((t) => getComputedStyle(t).pointerEvents)) === "none",
  );
  check("the new toast is ready at once", (await count(".toast:not(.is-leaving) .toast-action")) === 1);
  await page.locator(".toast-action").click();
  check("Undo runs without waiting", await page.evaluate(() => window.undone === true));
  await pause(200);
  check("the toast leaves after Undo", (await count(".toast")) === 0);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.evaluate(() => window.overlays.toast("Keyed"));
  check(
    "a toast from a key press is simply there",
    (await page.locator(".toast").evaluate((t) => getComputedStyle(t).opacity)) === "1",
  );
  await page.evaluate(() => window.overlays.toast("Keyed again"));
  check("and replaces the last one at once", (await count(".toast")) === 1);
  await pause(2800);
  check("a toast that shows itself out is gone", (await count(".toast")) === 0);

  /* Tooltips */
  const settingsButton = page.locator('[data-act="settings"]');
  await page.mouse.move(600, 500);
  await settingsButton.hover();
  await pause(620);
  const above = await page.locator(".tooltip").evaluate((t) => t.style.transformOrigin);
  check("a tip above its control grows from its bottom edge", above.endsWith("bottom"), above);
  await page.mouse.move(600, 500);
  await pause(1000);
  await page.locator('[data-act="sidebar"]').hover();
  await pause(620);
  const below = await page.locator(".tooltip").evaluate((t) => t.style.transformOrigin);
  check("a tip below its control grows from its top edge", below.endsWith("top"), below);

  /* Press */
  await page.mouse.move(600, 500);
  await pause(300);
  const box = await settingsButton.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await pause(260);
  const pressed = await settingsButton.evaluate((b) => getComputedStyle(b).scale);
  check("a pointer press uses the shared scale", reduced ? pressed === "1" || pressed === "none" : pressed === "0.97", pressed);
  await page.mouse.move(600, 500);
  await page.mouse.up();
  await pause(250);
  const sort = settingsButton;
  await sort.focus();
  await page.keyboard.down("Space");
  await pause(200);
  const keyPress = await sort.evaluate((b) => getComputedStyle(b).scale);
  await page.keyboard.up("Space");
  check("a key press does not scale a control", keyPress === "none", keyPress);
  await page.keyboard.press("Escape");
  await pause(100);
  const originAfterKey = await page.evaluate(() => document.documentElement.dataset.input);
  await page.mouse.move(610, 505);
  await page.mouse.move(640, 520);
  const originAfterMove = await page.evaluate(() => document.documentElement.dataset.input);
  check(
    "moving the pointer ends keyboard mode",
    originAfterKey === "keyboard" && originAfterMove === "pointer",
    `${originAfterKey} -> ${originAfterMove}`,
  );

  /* Task boxes */
  await page.mouse.click(600, 500);
  await pause(120);
  const taskBox = '.task-box[data-task-line="0"]';
  const clicked = sampleDuring(taskBox, "opacity", null, { pseudo: "::after", ms: 500 });
  await page.locator(taskBox).click();
  const tick = numbers(await clicked);
  check(
    reduced ? "the check is static under Reduce Motion" : "the check fades in after a click",
    reduced ? !IN_MOTION(tick) : IN_MOTION(tick),
    tick
      .slice(0, 8)
      .map((v) => v.toFixed(2))
      .join(" "),
  );
  check("the task is saved", (await page.locator(taskBox).getAttribute("aria-checked")) === "true");
  const second = '.task-box[data-task-line="1"]';
  await page.locator(second).focus();
  const keyed = sampleDuring(second, "opacity", null, { pseudo: "::after", ms: 400 });
  await page.keyboard.press("Space");
  const keyTick = numbers(await keyed);
  check(
    "the check is immediate from the keyboard",
    !IN_MOTION(keyTick),
    keyTick
      .slice(0, 8)
      .map((v) => v.toFixed(2))
      .join(" "),
  );
  check("that task is saved too", (await page.locator(second).getAttribute("aria-checked")) === "true");

  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-task");
  await pause(300);
  await page.evaluate(() => {
    window.firstEditBox = document.querySelector(".cm-task");
  });
  const before = await page.locator(".cm-task").first().getAttribute("aria-checked");
  await page.locator(".cm-task").first().click();
  await pause(250);
  const kept = await page.evaluate(() => ({
    same: window.firstEditBox === document.querySelector(".cm-task"),
    checked: document.querySelector(".cm-task").getAttribute("aria-checked"),
  }));
  check(
    "a task box in the editor keeps its element, so its check can fade",
    kept.same && kept.checked !== before,
    JSON.stringify(kept),
  );

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" ; "));
} catch (error) {
  results.push(`FAIL  threw: ${error.message}`);
} finally {
  await browser.close();
  await app.close();
}

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
