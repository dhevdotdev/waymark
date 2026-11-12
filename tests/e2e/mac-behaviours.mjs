// What a Mac app is expected to do for free: drops, link menus, gestures, undoing a delete, and the file list's keys.
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
await writeFile(
  `${app.vault}/Links.md`,
  "# Links\n\n[Site](https://example.com/page) and [Mail](mailto:a@example.com).\n\n# Heading [Inside](https://example.com/h)\n",
);
const browser = await webkit.launch();
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1320, height: 800 } })).newPage();
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);
const toastText = () => page.locator(".toast").last().textContent();
const open = async (name) => {
  await page.evaluate((target) => window.waymark.open(target), name);
  await pause(350);
};
await page.addInitScript(() => {
  window.__copied = [];
  window.__opened = [];
  window.open = (url) => {
    window.__opened.push(url);
    return null;
  };
});
await page.goto(`${app.url}?note=Links`);
await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
await pause(400);

/* Drops */
const dropOn = (selector, type) =>
  page.evaluate(
    ([sel, kind]) => {
      const event = new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
      document.querySelector(sel).dispatchEvent(event);
      return event.defaultPrevented;
    },
    [selector, type],
  );
check("a drop on the reading area is refused", await dropOn(".doc", "drop"));
check("dragging over the reading area is refused", await dropOn(".doc", "dragover"));
check("a drop on the file list is refused", await dropOn(".sidebar", "drop"));
await page.keyboard.press("Meta+e");
await page.waitForSelector(".cm-content");
await pause(300);
const refusedInEditor = await page.evaluate(() => {
  const event = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
  let refused = false;
  Object.defineProperty(event.dataTransfer, "dropEffect", {
    set: (value) => {
      refused = value === "none";
    },
  });
  document.querySelector(".cm-content").dispatchEvent(event);
  return refused;
});
check("the editor still takes drops", !refusedInEditor);
await page.keyboard.press("Meta+e");
await pause(300);

/* Link menu */
const menuLabels = () => page.locator(".context-menu .context-item").allTextContents();
await page.locator(".doc a", { hasText: "Site" }).click({ button: "right" });
await pause(150);
check(
  "right-clicking a link offers its address",
  (await menuLabels()).join() === "Open link,Copy link address",
  (await menuLabels()).join(),
);
await page.keyboard.press("Escape");
await pause(150);
await page.locator(".doc a", { hasText: "Inside" }).click({ button: "right" });
await pause(150);
check(
  "a link in a heading is treated as a link",
  (await menuLabels()).includes("Copy link address"),
  (await menuLabels()).join(),
);
await page.keyboard.press("Escape");
await pause(150);
await page.locator(".doc h1", { hasText: "Heading" }).click({ button: "right", position: { x: 20, y: 10 } });
await pause(150);
check(
  "the heading itself keeps its own menu",
  (await menuLabels()).some((l) => l.includes("heading")),
  (await menuLabels()).join(),
);
await page.keyboard.press("Escape");
await pause(150);

/* Swipe and mouse buttons */
const WIDE = Array.from({ length: 14 }, (_, i) => `| Column number ${i + 1} `).join("");
await writeFile(`${app.vault}/Swipe one.md`, "# Swipe one\n\n[[Swipe two]]\n");
await writeFile(`${app.vault}/Swipe two.md`, `# Swipe two\n\nPlain words here.\n\n${WIDE}|\n${"| --- ".repeat(14)}|\n${WIDE}|\n`);
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Swipe one.md", "Swipe two.md"]));
await pause(200);
await open("Swipe one.md");
await page.locator(".doc a.wikilink").first().click();
await pause(400);
const title = () => page.textContent(".tab.is-active .tab-title");
check("a link was followed before swiping", (await title()) === "Swipe two", await title());
const notePoint = async (selector) => {
  const box = await page.locator(selector).first().boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};
/** Sends one swipe's wheel events back to back, as the trackpad does, so a slow runner cannot split them into separate gestures. */
const swipe = async (dx, dy = 0, steps = 8, settle = 320) => {
  await Promise.all(Array.from({ length: steps }, () => page.mouse.wheel(dx / steps, dy / steps)));
  await pause(settle);
};
/** Whether the cue was ever both showing and filled, however briefly it held. */
const watchFill = () =>
  page.evaluate(() => {
    window.__filled = false;
    for (const el of document.querySelectorAll(".swipe-cue")) {
      new MutationObserver((_, observer) => {
        if (el.classList.contains("is-on") && el.classList.contains("is-ready")) {
          window.__filled = true;
          observer.disconnect();
        }
      }).observe(el, { attributes: true, attributeFilter: ["class"] });
    }
  });
/** The cue that is on, or else the one still showing, read after the frame that presents the latest event. */
const cue = () =>
  page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    const cues = [...document.querySelectorAll(".swipe-cue")];
    const el =
      cues.find((c) => c.classList.contains("is-on")) ?? cues.find((c) => Number(getComputedStyle(c).opacity) > 0) ?? cues[0];
    const style = getComputedStyle(el);
    return {
      on: cues.some((c) => c.classList.contains("is-on")),
      ready: el.classList.contains("is-ready"),
      side: el.dataset.side,
      progress: Number(el.dataset.progress ?? 0),
      opacity: Number(style.opacity),
      clicks: style.pointerEvents,
      placed: style.position,
    };
  });
const docBox = () => page.evaluate(() => JSON.stringify(document.querySelector(".doc").getBoundingClientRect()));
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(-40);
check("a small sideways nudge does nothing", (await title()) === "Swipe two", await title());
const layoutBefore = await docBox();
await swipe(-60, 0, 6, 0);
const partway = await cue();
check(
  "the cue follows a swipe on the back edge",
  partway.on &&
    !partway.ready &&
    partway.side === "back" &&
    partway.progress > 0.2 &&
    partway.progress < 1 &&
    partway.opacity > 0,
  JSON.stringify(partway),
);
check(
  "the cue takes no clicks and moves nothing",
  partway.clicks === "none" && partway.placed === "absolute" && (await docBox()) === layoutBefore,
);
await page
  .waitForFunction(() => [...document.querySelectorAll(".swipe-cue")].every((c) => getComputedStyle(c).opacity === "0"), null, {
    polling: 50,
    timeout: 2000,
  })
  .catch(() => {});
const cancelled = await cue();
check(
  "stopping short cancels and the cue fades",
  !cancelled.on && cancelled.opacity === 0 && (await title()) === "Swipe two",
  JSON.stringify(cancelled),
);
await swipe(-80, 0, 6, 0);
await swipe(80, 0, 6, 0);
check(
  "reversing before the threshold withdraws the cue",
  !(await cue()).on && (await title()) === "Swipe two",
  JSON.stringify(await cue()),
);
await pause(320);
await swipe(240, 0, 16, 0);
check(
  "with nothing forward there is no cue and no step",
  !(await cue()).on && (await title()) === "Swipe two",
  JSON.stringify(await cue()),
);
await pause(320);
await swipe(60, 400);
check("mostly vertical scrolling is not a swipe", (await title()) === "Swipe two", await title());
await page.mouse.move(...(await notePoint(".table-wrap")));
await swipe(300);
await swipe(-600, 0, 8, 0);
const overTable = await cue();
await pause(320);
check("swiping over a wide table scrolls the table only", (await title()) === "Swipe two" && !overTable.on, await title());
await page.mouse.move(...(await notePoint(".doc p")));
await watchFill();
await swipe(-260, 0, 16, 400);
check("crossing the threshold fills the cue", await page.evaluate(() => window.__filled));
check("it goes back one step however long the momentum runs", (await title()) === "Swipe one", await title());
check("the filled cue fades once it has stepped", (await cue()).opacity === 0, JSON.stringify(await cue()));
/**
 * Dispatches wheel events in the page at chosen gaps and samples both cues on every frame until
 * `tail` ms after the last one, so timing is the page's own and not the runner's.
 */
const sampleSwipe = async (events, tail) => {
  await gestureOver();
  await page.waitForFunction(
    () => [...document.querySelectorAll(".swipe-cue")].every((c) => getComputedStyle(c).opacity === "0"),
    null,
    { polling: 20 },
  );
  return page.evaluate(
    async ([script, tail]) => {
      const read = (side) => {
        const el = document.querySelector(`.swipe-cue[data-side="${side}"]`);
        const style = getComputedStyle(el);
        return {
          o: Number(style.opacity),
          x: new DOMMatrix(style.transform).m41,
          left: el.getBoundingClientRect().left,
          progress: Number(el.dataset.progress ?? 0),
        };
      };
      const samples = [];
      let sent = 0;
      let running = true;
      /* Read after the frame's own work, the cue's spring included, so each value belongs to its frame's time; a read that misses its frame is dropped. */
      const after = new MessageChannel();
      let frames = 0;
      const frame = (t) => {
        frames += 1;
        const at = frames;
        after.port1.onmessage = () => {
          if (at === frames) samples.push({ t, sent, back: read("back"), forward: read("forward") });
        };
        after.port2.postMessage(null);
        if (running) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      for (const [gap, dx, dy] of script) {
        await new Promise((r) => setTimeout(r, gap));
        /* Looked up per event: a note that finishes rendering replaces the whole article. */
        document.querySelector(".doc p").dispatchEvent(new WheelEvent("wheel", { deltaX: dx, deltaY: dy ?? 0, bubbles: true }));
        sent += 1;
      }
      const last = performance.now();
      await new Promise((r) => setTimeout(r, tail));
      running = false;
      return { samples, last };
    },
    [events, tail],
  );
};
/** Waits for the page to treat the last swipe as over, which can take longer than its gap while the page is busy. */
const gestureOver = () =>
  page.waitForFunction(() => document.querySelector(".scroller").dataset.gesture === undefined, null, { polling: 20 });
/** Change between samples per 60 Hz frame, so a slow frame does not read as a jump. */
const steps = (samples, side, key) =>
  samples
    .slice(1)
    .map((s, i) => (Math.abs(s[side][key] - samples[i][side][key]) * (1000 / 60)) / Math.max(1, s.t - samples[i].t));
await page.mouse.move(...(await notePoint(".doc p")));
const uneven = await sampleSwipe(
  [
    [0, -10],
    [8, -10],
    [40, -10],
    [10, -10],
    [45, -10],
    [12, -10],
    [30, -10],
  ],
  150,
);
const during = uneven.samples.filter((s) => s.sent > 0 && s.t <= uneven.last);
const unevenEnd = uneven.samples.at(-1).back;
/** Where the cue rests for a progress: 30px of travel from outside the edge, slowing towards the threshold. */
const restAt = (progress) => -(1 - (1 - (1 - progress) ** 2)) * 30;
const restingX = restAt(unevenEnd.progress);
/* Frames where the cue has not yet reached the place its latest event points to; counted per frame, not per gap, so slow frames do not thin it out. */
const shown = during.filter((s) => s.back.o > 0);
const lagging = shown.filter((s) => Math.abs(s.back.x - restAt(s.back.progress)) > 0.5);
const xs = uneven.samples.filter((s) => s.back.o > 0).map((s) => s.back.x);
check(
  "the cue eases between uneven events and settles where the fingers are",
  lagging.length >= 2 &&
    lagging.length * 2 >= shown.length &&
    xs.every((x, i) => i === 0 || x >= xs[i - 1] - 0.01) &&
    Math.abs(unevenEnd.x - restingX) < 0.1 &&
    Math.abs(xs.at(-1) - during.at(-1).back.x) > 0.5,
  `${lagging.length} of ${shown.length} frames behind the fingers, rests at ${unevenEnd.x.toFixed(2)} for ${restingX.toFixed(2)}`,
);
await page.waitForFunction(() => !document.querySelector(".swipe-cue.is-on"));
await gestureOver();
const nearSlack = await sampleSwipe([[0, -30], ...Array.from({ length: 10 }, (_, i) => [16, 0, i % 2 === 0 ? 16 : -16])], 60);
const flicker = Math.max(...steps(nearSlack.samples, "back", "o"));
check(
  "a swipe that hovers near the slack or turns vertical does not flicker",
  flicker < 0.15 && nearSlack.samples.some((s) => s.back.o > 0),
  `largest change per frame at 60 Hz ${flicker.toFixed(3)}`,
);
await page.waitForFunction(() => !document.querySelector(".swipe-cue.is-on"));
await gestureOver();
const bothWays = await page.evaluate(() => {
  const { trail } = window.waymark.reader.workspace.active;
  return trail.canBack && trail.canForward;
});
const turned = await sampleSwipe(
  [
    [0, -10],
    [16, -10],
    [16, -10],
    [16, -10],
    [60, 20],
    [16, 20],
    [16, 20],
    [16, 20],
  ],
  120,
);
const spread = (samples, side) => {
  const lefts = samples.map((s) => s[side].left);
  return Math.max(...lefts) - Math.min(...lefts);
};
const backPeak = Math.max(...turned.samples.map((s) => s.back.o));
const ends = turned.samples.at(-1);
check(
  "changing sides withdraws one cue and brings in the other, each at its own edge",
  bothWays &&
    Math.max(...steps(turned.samples, "back", "o"), ...steps(turned.samples, "forward", "o")) < 0.2 &&
    spread(turned.samples, "back") < 40 &&
    spread(turned.samples, "forward") < 40 &&
    Math.max(...turned.samples.map((s) => s.back.left)) < Math.min(...turned.samples.map((s) => s.forward.left)) &&
    ends.back.o < backPeak / 2 &&
    ends.forward.o > 0.3 &&
    ends.forward.progress > 0,
  `back peak ${backPeak.toFixed(2)}, ends ${ends.back.o.toFixed(2)} / ${ends.forward.o.toFixed(2)}`,
);
await page.waitForFunction(() => !document.querySelector(".swipe-cue.is-on"));
await gestureOver();
check("neither half of that swipe navigated", (await title()) === "Swipe one", await title());
await page.evaluate(() => {
  const commands = window.waymark.reader.commands;
  window.__run = commands.run.bind(commands);
  commands.run = (id, how) => (id === "back" ? undefined : window.__run(id, how));
});
const regrab = await sampleSwipe(
  [...Array.from({ length: 12 }, () => [8, -10]), [200, -10], [16, -10], [16, -10], [16, -10]],
  60,
);
await page.evaluate(() => {
  window.waymark.reader.commands.run = window.__run;
});
const afterCommit = regrab.samples.filter((s) => s.back.o > 0 && s.sent >= 12);
const jumps = { o: Math.max(...steps(afterCommit, "back", "o")), x: Math.max(...steps(afterCommit, "back", "x")) };
check(
  "a swipe during the exit picks the cue up where it was",
  afterCommit.length > 5 && jumps.o < 0.25 && jumps.x < 8 && regrab.samples.at(-1).back.progress > 0,
  `largest change per frame at 60 Hz: opacity ${jumps.o.toFixed(3)}, ${jumps.x.toFixed(1)} px`,
);
await page.waitForFunction(() => !document.querySelector(".swipe-cue.is-on"));
await gestureOver();
await page.mouse.move(...(await notePoint(".doc p")));
await gestureOver();
await page.keyboard.press("Escape");
await page.evaluate(() => {
  window.__slides = [];
  const scroller = document.querySelector(".scroller");
  window.__slideWatch = new MutationObserver(() => {
    for (const a of scroller.querySelector(":scope > .doc")?.getAnimations() ?? []) {
      const from = a.effect.getKeyframes()[0]?.translate;
      if (from !== undefined && !window.__slides.includes(from)) window.__slides.push(from);
    }
  });
  window.__slideWatch.observe(scroller, { childList: true });
});
await swipe(260, 0, 16);
check("swiping left goes forward", (await title()) === "Swipe two", await title());
const slides = await page.evaluate(() => {
  window.__slideWatch.disconnect();
  return window.__slides;
});
check(
  "its page slides in from the side the cue showed, even after a key press",
  slides.length === 1 && Number.parseFloat(slides[0]) === 28,
  JSON.stringify(slides),
);
await page.evaluate(() => {
  const commands = window.waymark.reader.commands;
  const run = commands.run.bind(commands);
  window.__run = run;
  const back = document.querySelector('.swipe-cue[data-side="back"]');
  window.__goAt = undefined;
  window.__framesBeforeGo = 0;
  /* Counts the frames drawn between the cue filling and the step, however long a slow machine takes over each. */
  const count = () => {
    if (window.__goAt !== undefined) return;
    window.__framesBeforeGo++;
    requestAnimationFrame(count);
  };
  new MutationObserver((_, observer) => {
    if (!back.classList.contains("is-ready")) return;
    window.__readyAt = performance.now();
    requestAnimationFrame(count);
    observer.disconnect();
  }).observe(back, { attributes: true, attributeFilter: ["class"] });
  commands.run = (id, how) => {
    if (id === "back") {
      window.__goAt = performance.now();
      while (performance.now() - window.__goAt < 450) {}
      requestAnimationFrame(() => {
        window.__afterBusy = back.getAnimations().filter((a) => a.playState === "running").length;
      });
    }
    return run(id, how);
  };
});
await gestureOver();
await swipe(-260, 0, 16, 0);
await page.waitForFunction(() => window.__afterBusy !== undefined, null, { timeout: 5000 }).catch(() => {});
const busy = await page.evaluate(() => {
  window.waymark.reader.commands.run = window.__run;
  return {
    running: window.__afterBusy,
    frames: window.__framesBeforeGo,
    wait: Math.round(window.__goAt - window.__readyAt),
  };
});
check(
  "the exit runs while the next note holds the page, and the step waits for the next frame and no longer",
  busy.running === 0 && busy.frames === 1 && busy.wait >= 0,
  JSON.stringify(busy),
);
await pause(320);
check("that swipe went back", (await title()) === "Swipe one", await title());
await gestureOver();
await swipe(260, 0, 16);
check("and the next goes forward again", (await title()) === "Swipe two", await title());
const mouseButton = (button) =>
  page.evaluate(
    (b) =>
      document.querySelector(".doc").dispatchEvent(new MouseEvent("mouseup", { button: b, bubbles: true, cancelable: true })),
    button,
  );
await mouseButton(3);
await pause(350);
check("mouse button 3 goes back", (await title()) === "Swipe one", await title());
await mouseButton(4);
await pause(350);
check("mouse button 4 goes forward", (await title()) === "Swipe two", await title());
await page.keyboard.press("Meta+g");
await pause(500);
const graphBefore = await page.evaluate(() => window.waymark.reader.workspace.active.trail.size);
await page.mouse.move(600, 400);
await swipe(-260, 0, 16);
check(
  "swiping on the graph does not navigate",
  (await page.evaluate(() => window.waymark.reader.workspace.active.trail.size)) === graphBefore &&
    (await page.locator(".graph-view").isVisible()) &&
    !(await cue()).on,
);
await page.keyboard.press("Meta+g");
await pause(400);
await page.emulateMedia({ reducedMotion: "reduce" });
await page.mouse.move(...(await notePoint(".doc p")));
await swipe(-50, 0, 6, 0);
const still = await page.evaluate(() => {
  const el = document.querySelector(".swipe-cue.is-on");
  return { on: el !== null, transform: el && getComputedStyle(el).transform };
});
await pause(400);
const settled = await cue();
check(
  "under Reduce Motion the cue appears whole without following the fingers",
  still.on && still.transform === "none" && settled.opacity === 0,
  `${JSON.stringify(still)} ${JSON.stringify(settled)}`,
);
await swipe(-260, 0, 16);
check("under Reduce Motion a swipe still steps", (await title()) === "Swipe one", await title());
await page.emulateMedia({ reducedMotion: "no-preference" });

/* Undo a delete */
const inVault = (name) => `${app.vault}/${name}`;
const moreAction = async (selector, label) => {
  await page.locator(selector).first().click({ button: "right" });
  await pause(150);
  await page.locator(".context-item", { hasText: label }).click();
  await pause(150);
  const confirm = page.locator('.prompt button:has-text("Move to Trash")');
  if (await confirm.count()) await confirm.click();
  await pause(400);
};
const undoButton = page.locator(".toast .toast-action", { hasText: "Undo" });
await writeFile(inVault("Doomed.md"), "# Doomed\n\nExact   bytes  \n");
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Doomed.md"]));
await pause(250);
await open("Doomed.md");
await page.waitForFunction(() => document.querySelector(".tab.is-active .tab-title")?.textContent === "Doomed");
const tabsBefore = await page.$$eval(".tab", (t) => t.length);
await moreAction('.nav-item[data-path="Doomed.md"]', "Move to Trash");
check("the note left the vault", !existsSync(inVault("Doomed.md")));
check("the toast offers Undo", (await undoButton.count()) === 1);
await undoButton.click();
await page
  .waitForFunction(
    (count) =>
      document.querySelector(".tab.is-active .tab-title")?.textContent === "Doomed" &&
      document.querySelectorAll(".tab").length === count,
    tabsBefore,
    { timeout: 5000 },
  )
  .catch(() => {});
check("Undo restores the exact bytes", (await readFile(inVault("Doomed.md"), "utf8")) === "# Doomed\n\nExact   bytes  \n");
check(
  "its tab is back",
  (await title()) === "Doomed" && (await page.$$eval(".tab", (t) => t.length)) === tabsBefore,
  `${await title()}, ${await page.$$eval(".tab", (t) => t.length)} of ${tabsBefore} tabs`,
);
check("it says so", (await toastText()).includes("Put back"), await toastText());
await moreAction('.nav-item[data-path="Doomed.md"]', "Move to Trash");
await writeFile(inVault("Doomed.md"), "someone else\n");
await undoButton.click();
await pause(400);
check("Undo refuses to overwrite", (await readFile(inVault("Doomed.md"), "utf8")) === "someone else\n");
check("and says why", !(await toastText()).includes("Put back"), await toastText());
await rm(inVault("Doomed.md"));
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Doomed.md"]));
await pause(200);

/* Command-K */
await writeFile(inVault("Keyed.md"), "# Keyed\n\nSome words here.\n\n| A | B |\n| --- | --- |\n| one | two |\n");
await page.evaluate(() => window.waymark.reader.vault.applyChanges(["Keyed.md"]));
await pause(200);
await open("Keyed.md");
await page.keyboard.press("Meta+e");
await page.waitForSelector(".cm-content");
await pause(400);
const paletteOpen = () => page.locator(".palette").count();
const line = page.locator(".cm-line", { hasText: "Some words here" });
await line.click({ position: { x: 4, y: 8 } });
await pause(80);
await page.keyboard.press("Home");
await page.keyboard.press("Shift+End");
await pause(80);
await page.keyboard.press("Meta+k");
await pause(200);
check(
  "Command-K with text selected makes a link",
  (await line.first().textContent()).includes("Some words here.") &&
    (await page.locator(".cm-content").textContent()).includes("](url)") &&
    (await paletteOpen()) === 0,
  await line.first().textContent(),
);
await page.keyboard.press("Meta+p");
await pause(200);
check("Command-P stays the palette with text selected", (await paletteOpen()) === 1);
await page.keyboard.press("Escape");
await pause(200);
await page.locator(".cm-line").last().click();
await pause(80);
await page.keyboard.press("Meta+k");
await pause(200);
check("with nothing selected Command-K is the palette", (await paletteOpen()) === 1);
await page.keyboard.press("Escape");
await pause(200);
const cell = page.locator('.cm-table-widget td[data-row="1"][data-column="0"]');
await cell.click();
await pause(120);
await page.keyboard.press("Shift+End");
await pause(80);
await page.keyboard.press("Meta+k");
await pause(200);
check(
  "a table cell keeps the palette and its text",
  (await paletteOpen()) === 1 && (await cell.textContent()) === "one",
  await cell.textContent(),
);
await page.keyboard.press("Escape");
await pause(200);
await page.keyboard.press("Meta+e");
await pause(500);

/* The file list */
const focused = () =>
  page.evaluate(
    () => document.activeElement?.dataset.path ?? document.activeElement?.dataset.folder ?? document.activeElement?.tagName,
  );
const tabStops = () => page.locator(".sidebar .tree :is(.tree-head, .nav-item)[tabindex='0']").count();
await pause(200);
check("the file list is one Tab stop", (await tabStops()) === 1, String(await tabStops()));
await page.evaluate(() => window.waymark.reader.sidebar.tree.collapseAll());
await pause(300);
const heads = await page.$$eval(".sidebar .tree-head[data-folder]", (h) => h.map((x) => x.dataset.folder));
await page.locator(".sidebar .tree [tabindex='0']").focus();
await page.locator(`.tree-head[data-folder="${heads[0]}"]`).focus();
await page.keyboard.press("ArrowDown");
await pause(60);
check("Down moves to the next row", (await focused()) === heads[1], await focused());
await page.keyboard.press("ArrowUp");
await pause(60);
check("Up moves back", (await focused()) === heads[0], await focused());
await page.keyboard.press("ArrowRight");
await pause(300);
check(
  "Right opens a folder",
  await page.locator(`.tree-head[data-folder="${heads[0]}"]`).evaluate((h) => h.getAttribute("aria-expanded") === "true"),
);
await page.keyboard.press("ArrowRight");
await pause(60);
const child = await focused();
check("Right again enters it", child !== heads[0] && String(child).startsWith(`${heads[0]}/`), child);
await page.keyboard.press("ArrowLeft");
await pause(60);
check("Left goes to the parent", (await focused()) === heads[0], await focused());
await page.keyboard.press("ArrowLeft");
await pause(300);
check(
  "Left closes it",
  await page.locator(`.tree-head[data-folder="${heads[0]}"]`).evaluate((h) => h.getAttribute("aria-expanded") === "false"),
);
await page.keyboard.press("ArrowDown");
await pause(60);
check("closed folders are skipped", (await focused()) === heads[1], await focused());
await page.keyboard.press("End");
await pause(60);
const lastRow = await focused();
check("End reaches the last row", typeof lastRow === "string" && lastRow.endsWith(".md"), lastRow);
await page.keyboard.press("Enter");
await pause(450);
check(
  "Enter opens the note",
  (await page.evaluate(() => window.waymark.reader.notePath)) === lastRow,
  await page.evaluate(() => window.waymark.reader.notePath),
);
check("still one Tab stop after moving around", (await tabStops()) === 1, String(await tabStops()));
const ring = await page.evaluate((path) => {
  const row = document.querySelector(`.nav-item[data-path="${CSS.escape(path)}"]`);
  row.focus();
  const style = getComputedStyle(row);
  return style.outlineOffset;
}, lastRow);
check("the focus ring is drawn inside the row", ring === "-2px", ring);
/* The file list after a click. WebKit on macOS leaves a pressed button unfocused; Playwright's WebKit focuses it, so the
 * Mac behaviour is reproduced by holding focus where it was. */
await page.evaluate(() =>
  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.target.closest("button")) e.preventDefault();
    },
    true,
  ),
);
await page.evaluate(() => window.waymark.reader.sidebar.tree.collapseAll());
await pause(300);
await page
  .locator(".doc")
  .first()
  .click({ position: { x: 5, y: 5 } });
const rootNotes = await page.$$eval(".sidebar-inner .tree > .nav-item[data-path]", (r) => r.map((x) => x.dataset.path));
const rowFill = (path) =>
  page.evaluate((p) => getComputedStyle(document.querySelector(`.nav-item[data-path="${CSS.escape(p)}"]`)).backgroundColor, path);
const clickRow = async (path) => {
  const box = await page.locator(`.sidebar-inner .nav-item[data-path="${path}"]`).boundingBox();
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
  await pause(450);
};
const plainFill = await rowFill(rootNotes[1]);
await clickRow(rootNotes[0]);
check("a click opens the row", (await page.evaluate(() => window.waymark.reader.notePath)) === rootNotes[0]);
check("a click hands the arrows to the list", (await focused()) === rootNotes[0], await focused());
const clickRing = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
check("a click draws no focus ring", clickRing === "none", clickRing);
await page.mouse.move(1000, 400);
await page.keyboard.press("ArrowDown");
await pause(60);
check("Down after a click moves the selection", (await focused()) === rootNotes[1], await focused());
check(
  "Down selects without opening",
  (await page.evaluate(() => window.waymark.reader.notePath)) === rootNotes[0],
  await page.evaluate(() => window.waymark.reader.notePath),
);
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme });
  await pause(100);
  const selected = await rowFill(rootNotes[1]);
  const current = await rowFill(rootNotes[0]);
  const plain = await rowFill(rootNotes[2]);
  check(
    `the selected row is filled, apart from the open note, in ${scheme}`,
    selected !== plain && selected !== current && !selected.endsWith(", 0)") && selected !== "rgba(0, 0, 0, 0)",
    `${selected} / ${current} / ${plain}`,
  );
}
await page.emulateMedia({ colorScheme: null });
const transitionNow = await page.evaluate(
  (p) => getComputedStyle(document.querySelector(`.nav-item[data-path="${CSS.escape(p)}"]`)).transitionDuration,
  rootNotes[1],
);
check("the selection moves without a fade from the keyboard", /^0s(, 0s)*$/.test(transitionNow), transitionNow);
await page.keyboard.press("Enter");
await pause(450);
check(
  "Enter opens the selected note",
  (await page.evaluate(() => window.waymark.reader.notePath)) === rootNotes[1],
  await page.evaluate(() => window.waymark.reader.notePath),
);
check("leaving the row clears its selection", (await rowFill(rootNotes[0])) === plainFill, await rowFill(rootNotes[0]));
const panel = await page.locator(".sidebar-inner").boundingBox();
await page
  .locator(".doc")
  .first()
  .click({ position: { x: 5, y: 5 } });
await page.mouse.click(panel.x + panel.width / 2, panel.y + panel.height - 12);
await pause(150);
check("a click on empty space hands the arrows to the list", (await focused()) === rootNotes[1], await focused());
await page.keyboard.press("ArrowUp");
await pause(60);
check("Up then moves from the open note", (await focused()) === rootNotes[0], await focused());
await page
  .locator(".doc")
  .first()
  .click({ position: { x: 5, y: 5 } });
await pause(100);
await page.keyboard.press("ArrowDown");
await pause(100);
check(
  "arrows outside the list leave it alone",
  !(await page.evaluate(() => document.activeElement?.closest(".sidebar-inner"))),
  await focused(),
);
await page.locator(`.nav-item[data-path="${lastRow}"]`).click({ button: "right" });
await pause(150);
await page.locator(".context-item", { hasText: "Rename" }).click();
await pause(200);
const nameBox = page.locator(".tree-name-input");
await page.keyboard.press("ArrowLeft");
await page.keyboard.type("z");
await pause(100);
check(
  "inline rename keeps its keys",
  (await nameBox.inputValue()).startsWith("z") && (await nameBox.inputValue()).length > 1,
  await nameBox.inputValue(),
);
await page.keyboard.press("Escape");
await pause(200);

check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));
await browser.close();
await app.close();
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
