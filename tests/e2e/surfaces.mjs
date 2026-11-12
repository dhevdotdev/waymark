// Floating surfaces and small controls: a pointer gets motion, a key press gets the end state, and nothing stacks.
import { readFile, writeFile } from "node:fs/promises";
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

/**
 * Every animation of one property that the element starts once `act` runs, or once a click or key press arrives when
 * there is no `act`, resolving when they have all finished. Each is read from the animation itself as it starts: a slow
 * machine can paint its next frame after a short transition has already ended, so sampled frames can miss the motion.
 */
const motionDuring = (selector, property, act, { pseudo = null } = {}) =>
  page.evaluate(
    async ({ selector, property, pseudo, act }) => {
      const seen = new Map();
      const mine = () => {
        const el = document.querySelector(selector);
        if (!el) return [];
        getComputedStyle(el, pseudo)[property];
        return el
          .getAnimations({ subtree: true })
          .filter((a) => a.effect.target === el && (a.effect.pseudoElement ?? null) === pseudo)
          .filter((a) => a.effect.getKeyframes().some((k) => property in k));
      };
      const read = () => {
        for (const a of mine()) {
          if (seen.has(a)) continue;
          const frames = a.effect.getKeyframes().filter((k) => property in k);
          const { duration, delay } = a.effect.getComputedTiming();
          seen.set(a, { from: frames[0][property], to: frames.at(-1)[property], ms: duration, delay });
        }
      };
      let triggered = false;
      let still = 0;
      const trigger = () => {
        triggered = true;
        still = 0;
        read();
      };
      const observer = new MutationObserver(read);
      observer.observe(document, { attributes: true, childList: true, subtree: true });
      const triggers = ["click", "keydown", "keyup", "change"];
      for (const type of triggers) window.addEventListener(type, trigger);
      const started = performance.now();
      const done = new Promise((resolve) => {
        const frame = () => {
          read();
          if (triggered) still = mine().some((a) => a.playState === "running") ? 0 : still + 1;
          if (still >= 2 || performance.now() - started > 5000) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      if (act) {
        await new Function(`return (${act})()`)();
        trigger();
      }
      await done;
      observer.disconnect();
      for (const type of triggers) window.removeEventListener(type, trigger);
      return [...seen.values()];
    },
    { selector, property, pseudo, act: act?.toString() },
  );
/** Whether any of them moves the property over time, rather than setting it at once. */
const MOVES = (motions) => motions.some((m) => m.ms > 0 && m.from !== m.to);
const FADES_IN = (motions) => motions.some((m) => m.ms > 0 && Number(m.from) <= 0.02 && Number(m.to) >= 0.98);
const shown = (motions) => JSON.stringify(motions);
/** Every animation started through `Element.animate` with this id while `act` runs, read from its own options. */
const startedDuring = async (id, act) => {
  await page.evaluate((id) => {
    window.started = [];
    window.realAnimate ??= Element.prototype.animate;
    Element.prototype.animate = function (keyframes, options) {
      const animation = window.realAnimate.call(this, keyframes, options);
      if (options?.id === id) {
        const frames = animation.effect.getKeyframes();
        const { duration, delay } = animation.effect.getComputedTiming();
        window.started.push({
          target: this.className,
          frames: frames.map((k) => ({ o: k.opacity, t: k.translate, s: k.scale, at: k.computedOffset })),
          ms: duration,
          delay,
        });
      }
      return animation;
    };
  }, id);
  await act();
  return page.evaluate(() => {
    Element.prototype.animate = window.realAnimate;
    return window.started;
  });
};
const FADES_STRIKE = (motions) => motions.some((m) => m.ms === 140 && m.from !== m.to);

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
  check("settings is closed to begin with", (await count(".popover.settings")) === 0);
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
  const knob = motionDuring('.toggle:has(input[data-pref="sound"]) i', "translate", null, { pseudo: "::after" });
  await toggle.click();
  const travel = await knob;
  check(
    reduced ? "the switch does not travel under Reduce Motion" : "the knob travels when clicked",
    reduced ? !MOVES(travel) : MOVES(travel),
    shown(travel),
  );
  await page.keyboard.press("Escape");
  check("Escape closes settings at once", (await count(".popover.settings")) === 0);

  /* Sheets */
  await page.mouse.click(600, 500);
  const sheetOpacity = await motionDuring(".sheet-overlay", "opacity", () =>
    window.parts.openSheet("One", "first", window.sheetBody("a")),
  );
  check("a sheet opened with the pointer fades in", FADES_IN(sheetOpacity), shown(sheetOpacity));
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
  const lightboxOpacity = await motionDuring(".lightbox", "opacity", enlarge);
  check("the lightbox fades in from the pointer", FADES_IN(lightboxOpacity), shown(lightboxOpacity));
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
  const toastOpacity = await motionDuring(".toast:not(.is-leaving)", "opacity", () => window.overlays.toast("First"));
  check("a toast from a pointer action fades in", FADES_IN(toastOpacity), shown(toastOpacity));
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
  const tickOf = (box) => `${box} .task-tick path`;
  const strikeOf = (box) => `li:has(> ${box}) > .task-text`;
  const ARRIVES = (motions, from, to, ms, delay) =>
    motions.some((m) => m.from === from && m.to === to && m.ms === ms && m.delay === delay);
  const watchTask = (box) =>
    Promise.all([
      motionDuring(tickOf(box), "strokeDashoffset"),
      motionDuring(tickOf(box), "opacity"),
      motionDuring(strikeOf(box), "backgroundSize"),
      motionDuring(strikeOf(box), "--strike"),
    ]);
  const checking = watchTask(taskBox);
  await page.locator(taskBox).click();
  const [draw, tickFade, sweep, strikeFade] = await checking;
  if (reduced) {
    check(
      "the tick fades in place under Reduce Motion",
      !MOVES(draw) && ARRIVES(tickFade, "0", "1", 140, 0),
      shown([draw, tickFade]),
    );
    check("the strike fades in place under Reduce Motion", !MOVES(sweep) && FADES_STRIKE(strikeFade), shown([sweep, strikeFade]));
  } else {
    check("a clicked tick draws along its path", ARRIVES(draw, "1px", "0px", 200, 40), shown(draw));
    check("a strike rule sweeps across the text", ARRIVES(sweep, "0% 1.5px", "100% 1.5px", 240, 60), shown(sweep));
  }
  const checklist = () => readFile(path.join(app.vault, "Checklist.md"), "utf8");
  /** The file's text once it has the given first line, or what it holds after two seconds. */
  const savedAs = async (first) => {
    for (let waited = 0; waited < 2000; waited += 50) {
      const text = await checklist();
      if (text.startsWith(first)) return text;
      await pause(50);
    }
    return checklist();
  };
  const savedChecked = await savedAs("- [x] First thing\n");
  check(
    "the task is saved",
    (await page.locator(taskBox).getAttribute("aria-checked")) === "true" &&
      savedChecked === "- [x] First thing\n- [ ] Second thing\n",
    JSON.stringify(savedChecked),
  );
  const unchecking = watchTask(taskBox);
  await page.locator(taskBox).click();
  const [, untick, retract] = await unchecking;
  const savedUnchecked = await savedAs("- [ ] First thing\n");
  check("unchecking is saved", savedUnchecked === "- [ ] First thing\n- [ ] Second thing\n", JSON.stringify(savedUnchecked));
  check("unchecking fades the tick", ARRIVES(untick, "1", "0", 140, 0), shown(untick));
  check(
    reduced ? "unchecking does not retract under Reduce Motion" : "unchecking retracts the strike",
    reduced ? !MOVES(retract) : ARRIVES(retract, "100% 1.5px", "0% 1.5px", 140, 0),
    shown(retract),
  );
  const second = '.task-box[data-task-line="1"]';
  await page.locator(second).focus();
  const keyed = watchTask(second);
  await page.keyboard.press("Space");
  const keyMotion = (await keyed).flat();
  check("the tick and strike are immediate from the keyboard", !MOVES(keyMotion), shown(keyMotion));
  const savedSecond = await savedAs("- [ ] First thing\n- [x] Second");
  check(
    "that task is saved too",
    (await page.locator(second).getAttribute("aria-checked")) === "true" &&
      savedSecond === "- [ ] First thing\n- [x] Second thing\n",
    JSON.stringify(savedSecond),
  );
  const shownAtClick = await page.locator(second).evaluate((box) => {
    box.click();
    return box.getAttribute("aria-checked");
  });
  check("a task box shows its new state at the click, before the save", shownAtClick === "false", shownAtClick);
  const savedBoth = await savedAs("- [ ] First thing\n- [ ] Second");
  check(
    "the second task is saved unchecked again",
    savedBoth === "- [ ] First thing\n- [ ] Second thing\n",
    JSON.stringify(savedBoth),
  );

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

  /* Folders */
  await page.keyboard.press("Meta+e");
  await pause(300);
  const folderHead = page.locator('.tree-head[data-folder="Apiary"]');
  await folderHead.scrollIntoViewIfNeeded();
  const folderOpened = await startedDuring("folder-motion", () => folderHead.click());
  const rowsMoved = folderOpened.filter((m) => m.target !== "tree-inner");
  const delays = rowsMoved.map((m) => m.delay).join(",");
  if (reduced) {
    check(
      "folder rows fade in place under Reduce Motion",
      rowsMoved.length > 1 && rowsMoved.every((m) => m.ms === 140 && m.delay === 0 && m.frames[0].o === "0" && !m.frames[0].t),
      shown(rowsMoved.slice(0, 2)),
    );
  } else {
    check(
      "a clicked folder drops its rows into place",
      rowsMoved.length > 1 && rowsMoved.every((m) => m.ms === 200 && m.frames[0].o === "0" && m.frames[0].t === "0px -6px"),
      shown(rowsMoved.slice(0, 2)),
    );
    check(
      "one after another, 18ms apart and capped at the sixth",
      delays === rowsMoved.map((_, i) => Math.min(i, 6) * 18).join(","),
      delays,
    );
  }
  const shut = await startedDuring("folder-motion", () => folderHead.click());
  check(
    reduced ? "a folder closes at once under Reduce Motion" : "a clicked folder fades its rows as it closes",
    reduced
      ? shut.length === 0
      : shut.length === 1 && shut[0].ms === 200 && shut[0].frames.map((k) => `${k.o}@${k.at}`).join(" ") === "1@0 0@0.7 0@1",
    shown(shut),
  );
  await folderHead.focus();
  const keyedFolder = await startedDuring("folder-motion", async () => {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
  });
  const keyedOpen = await folderHead.getAttribute("aria-expanded");
  check(
    "folders open and close at once from the keyboard",
    keyedFolder.length === 0 && keyedOpen === "false",
    shown(keyedFolder),
  );

  /* Search jump */
  await page.keyboard.press("Meta+Shift+f");
  await page.waitForSelector(".search-field input:visible");
  await page.keyboard.type("BannetonSeamDriftError");
  await page.waitForSelector(".search-hit");
  const rang = await startedDuring("match-ring", async () => {
    await page.locator(".search-hit").first().click();
    await page.waitForSelector(".match-ring");
  });
  const enter = rang.find((m) => m.frames[0].o === "0");
  const leave = rang.find((m) => m.frames[0].o === "1");
  if (reduced) {
    check("the match ring fades in place under Reduce Motion", enter?.ms === 140 && !enter.frames[0].s, shown(rang));
  } else {
    check(
      "a clicked search jump rings the match from further out",
      enter?.ms === 240 && enter.frames[0].s !== "none" && enter.frames[0].s !== enter.frames[1].s,
      shown(rang),
    );
  }
  check(
    "the ring holds, then fades",
    leave?.ms === 400 && leave.delay === (enter?.ms ?? 0) + 400 && leave.frames[1].o === "0",
    shown(leave),
  );
  const onMatch = await page.evaluate(() => {
    const ring = document.querySelector(".match-ring");
    const frame = ring.offsetParent.getBoundingClientRect();
    const r = [...CSS.highlights.get("search")][0].getClientRects()[0];
    return [
      ring.offsetLeft + frame.left - (r.left - 2),
      ring.offsetTop + frame.top - (r.top - 1),
      ring.offsetWidth - (r.width + 4),
    ];
  });
  check(
    "the ring sits on the match",
    onMatch.every((d) => Math.abs(d) <= 1),
    onMatch.map((d) => d.toFixed(1)).join(","),
  );
  await page.waitForFunction(() => !document.querySelector(".match-ring"), null, { timeout: 4000 });
  await page.locator(".search-field input").focus();
  const keyRing = await startedDuring("match-ring", async () => {
    await page.keyboard.press("Enter");
    await page.waitForSelector(".match-ring");
  });
  check(
    "a search jump from the keyboard rings the match at rest",
    keyRing.length === 1 && keyRing[0].frames.every((k) => k.o === "1" && !k.s) && keyRing[0].ms === 640,
    shown(keyRing),
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
