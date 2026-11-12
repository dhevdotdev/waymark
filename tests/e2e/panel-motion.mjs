// The title bar's lead, and the docked sidebar and inspector: a click slides the panel and carries the page with it, a key lands at once.
// Usage: node tests/e2e/panel-motion.mjs [reduced]
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const app = await serveFixture();
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 800 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await context.newPage();
const errors = [];
watchPageErrors(page, errors);
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const pause = (ms) => page.waitForTimeout(ms);
/** Lets a slide finish, waiting on the animations themselves so a slow machine does not start the next step mid-slide. */
const settled = async () => {
  await pause(reduced ? 250 : 450);
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect.getComputedTiming().endTime))
        .map((a) => a.finished),
    ),
  );
};

const open = async () => {
  await page.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await page.waitForSelector(".doc-title");
  await pause(400);
};

/** The lead's parts, left to right, and the first tab's start. */
const lead = () =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, shown: r.width > 0 };
    };
    const parts = [
      ...document.querySelectorAll('.titlebar-lead [data-act="sidebar"], .wordmark, [data-act="back"], [data-act="forward"]'),
    ];
    return {
      parts: parts.map(box),
      lead: box(document.querySelector(".titlebar-lead")),
      tabs: box(document.querySelector(".tabs")),
    };
  });
const inOrder = ({ parts, lead, tabs }) => {
  const shown = parts.filter((p) => p.shown);
  return (
    shown.every((p, i) => i === 0 || shown[i - 1].right <= p.left + 0.5) &&
    shown.at(-1).right <= lead.right &&
    lead.right <= tabs.left + 0.5
  );
};

/**
 * Every animation running once a click or key press has been handled, read from the animations themselves at that
 * moment rather than from sampled frames, so a slow machine cannot miss a short one.
 */
const motionOf = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const read = () => {
          getComputedStyle(document.body).color;
          resolve(
            document.getAnimations().map((a) => {
              const frames = a.effect.getKeyframes();
              const property =
                a.transitionProperty ??
                Object.keys(frames[0]).find((k) => !["offset", "easing", "composite", "computedOffset"].includes(k));
              const el = a.effect.target;
              return {
                target:
                  ["sidebar", "rail", "doc", "crumbs", "tabs", "mode-switch"].find((name) => el.classList.contains(name)) ?? "",
                property,
                from: frames[0][property] ?? "",
                to: frames.at(-1)[property] ?? "",
                ms: a.effect.getComputedTiming().duration,
              };
            }),
          );
        };
        /*
         * A shortcut's modifier goes down first, before anything has been handled. The app takes its keys while they are
         * captured at the window and stops them there, so keys are read in that phase, after the app's own handler.
         */
        const done = () => {
          window.removeEventListener("click", done);
          window.removeEventListener("keydown", onKey, true);
          read();
        };
        const onKey = (e) => {
          if (!["Meta", "Control", "Alt", "Shift"].includes(e.key)) done();
        };
        window.addEventListener("click", done);
        window.addEventListener("keydown", onKey, true);
      }),
  );

const during = async (act) => {
  const seen = motionOf();
  await act();
  return seen;
};
const travels = (motions, target, property = "translate") =>
  motions.some((m) => m.target === target && m.property === property && m.ms > 0 && m.from !== m.to);
const slides = (motions, target) => motions.find((m) => m.target === target && m.property === "translate" && m.ms > 0);
const fades = (motions, target) => motions.some((m) => m.target === target && m.property === "opacity" && m.ms > 0);
const shown = (motions) => JSON.stringify(motions.filter((m) => m.target));

try {
  await open();

  /* The lead */
  const parts = await page.evaluate(() =>
    [...document.querySelector(".titlebar-lead").querySelectorAll("button, .wordmark")].map(
      (el) => el.dataset.act ?? el.className,
    ),
  );
  check("the lead reads toggle, name, back, forward", parts.join() === "sidebar,wordmark,back,forward", parts.join());
  const mark = await page.evaluate(() => {
    const el = document.querySelector(".wordmark");
    const s = getComputedStyle(el);
    return {
      font: s.fontFamily,
      weight: s.fontWeight,
      select: s.webkitUserSelect,
      drag: el.hasAttribute("data-tauri-drag-region"),
    };
  });
  check(
    "the name is set in the reading serif, unselectable, and drags the window",
    mark.font.includes("Source Serif") && mark.weight === "600" && mark.select === "none" && mark.drag,
    JSON.stringify(mark),
  );
  check("the title bar holds no search button", (await page.locator('.titlebar [data-side="search"]').count()) === 0);
  const tools = await page.evaluate(() =>
    [...document.querySelectorAll(".files-actions button")].map((b) => b.dataset.act ?? b.dataset.side),
  );
  check(
    "search sits at the end of the file tools, just before Collapse",
    tools.slice(-2).join() === "search,collapse-folders",
    tools.join(),
  );
  check("with the sidebar open nothing in the lead collides", inOrder(await lead()));

  await page.keyboard.press("Meta+\\");
  await settled();
  const closed = await lead();
  check(
    "with the sidebar closed the lead shrinks to fit and nothing collides",
    inOrder(closed) && closed.lead.right < 300,
    String(closed.lead.right),
  );
  await page.keyboard.press("Meta+Shift+f");
  await settled();
  check(
    "⌘⇧F with the sidebar closed opens it on Search",
    (await page.locator(".sidebar-search input").isVisible()) &&
      (await page.evaluate(() => document.activeElement?.matches(".sidebar-search input"))),
  );
  await page.click('[data-act="search-clear"]');
  check("the X on an empty field returns to Files", await page.locator(".sidebar-inner").isVisible());
  await page.keyboard.press("Meta+Shift+f");
  await page.keyboard.press("Escape");
  check("Escape returns to Files", await page.locator(".sidebar-inner").isVisible());

  await page.evaluate(() => document.querySelector(".shell").style.setProperty("--sidebar-w", "200px"));
  await pause(100);
  const narrow = await lead();
  check("a sidebar dragged to its narrowest drops the name rather than collide", inOrder(narrow) && !narrow.parts[1].shown);
  await page.evaluate(() => document.querySelector(".shell").style.setProperty("--sidebar-w", "268px"));
  await page.setViewportSize({ width: 560, height: 700 });
  await pause(200);
  check("the smallest window keeps the lead clear of the tabs", inOrder(await lead()));
  await page.setViewportSize({ width: 1440, height: 800 });
  await settled();

  /* The docked sidebar */
  const reader = () => page.evaluate(() => document.querySelector(".reader").getBoundingClientRect().left);
  const before = await reader();
  let motion = await during(() => page.click('[data-act="sidebar"]'));
  const after = await reader();
  check("a click closes the sidebar's column at once", after < before, `${before} -> ${after}`);
  if (reduced) {
    check(
      "under Reduce Motion the sidebar fades rather than slides",
      fades(motion, "sidebar") && !travels(motion, "sidebar"),
      shown(motion),
    );
    check("under Reduce Motion the page does not travel", !travels(motion, "doc") && !travels(motion, "crumbs"), shown(motion));
  } else {
    const slide = slides(motion, "sidebar");
    check("a clicked sidebar slides out", slide?.from !== slide?.to && slide?.ms === 240, shown(motion));
    check(
      "the page glides with it",
      travels(motion, "doc") && travels(motion, "crumbs") && travels(motion, "tabs"),
      shown(motion),
    );
  }
  await settled();
  check("a closed sidebar is hidden", !(await page.locator(".sidebar").isVisible()));
  motion = await during(() => page.click('[data-act="sidebar"]'));
  if (!reduced)
    check(
      "a clicked sidebar slides back in, and the page with it",
      travels(motion, "sidebar") && travels(motion, "doc"),
      shown(motion),
    );
  await settled();
  check(
    "an open sidebar rests in place",
    await page.evaluate(() => getComputedStyle(document.querySelector(".sidebar")).translate === "none"),
  );

  motion = await during(() => page.keyboard.press("Meta+\\"));
  check("⌘\\ closes the sidebar at once", motion.filter((m) => m.target).length === 0, shown(motion));
  motion = await during(() => page.keyboard.press("Meta+\\"));
  check("⌘\\ opens it at once", motion.filter((m) => m.target).length === 0, shown(motion));
  await settled();
  if (!reduced) {
    await page.click('[data-act="sidebar"]');
    motion = await during(() => page.keyboard.press("Meta+\\"));
    check("⌘\\ during a clicked slide lands everything at once", motion.filter((m) => m.target).length === 0, shown(motion));
    await settled();
  }

  /* The docked inspector */
  const rail = () => page.evaluate(() => document.querySelector(".reader").getBoundingClientRect().right);
  const railBefore = await rail();
  motion = await during(() => page.click('[data-act="rail"]'));
  check("a click closes the inspector's column at once", (await rail()) > railBefore);
  if (reduced) {
    check("under Reduce Motion the inspector fades", fades(motion, "rail") && !travels(motion, "rail"), shown(motion));
  } else {
    check("a clicked inspector slides out", slides(motion, "rail")?.ms === 240, shown(motion));
    check(
      "the note and the Read/Edit switch glide with it",
      travels(motion, "doc") && travels(motion, "mode-switch"),
      shown(motion),
    );
  }
  await settled();
  motion = await during(() => page.click('[data-act="rail"]'));
  await settled();
  const tabsAt = await page.evaluate(() => {
    const tabs = document.querySelector(".rail-tabs").getBoundingClientRect();
    const toggle = document.querySelector('[data-act="rail"]').getBoundingClientRect();
    return { top: tabs.top, right: tabs.right, toggle: toggle.left };
  });
  check(
    "the inspector's tabs return to the title bar beside its toggle",
    tabsAt.top < 46 && tabsAt.right <= tabsAt.toggle,
    JSON.stringify(tabsAt),
  );
  motion = await during(() => page.keyboard.press("Meta+Alt+\\"));
  check("⌥⌘\\ closes the inspector at once", motion.filter((m) => m.target).length === 0, shown(motion));
  await page.keyboard.press("Meta+Alt+\\");
  await settled();

  /* In a window too narrow for the full measure the lines re-wrap, and the text's left edge is what glides. */
  if (!reduced) {
    await page.setViewportSize({ width: 1000, height: 700 });
    await settled();
    const edge = () => page.evaluate(() => document.querySelector(".doc-title").getBoundingClientRect().left);
    const was = await edge();
    motion = await during(() => page.click('[data-act="sidebar"]'));
    const doc = motion.find((m) => m.target === "doc");
    await settled();
    const moved = was - (await edge());
    check(
      "when the measure changes, the text's left edge glides from where it was",
      Math.abs(Number.parseFloat(doc?.from) - moved) < 1,
      `${doc?.from} vs ${moved}`,
    );
    await page.click('[data-act="sidebar"]');
    await settled();
  }

  check("no page errors", errors.length === 0, errors.slice(0, 2).join("; "));
} finally {
  await browser.close();
  await app.close();
}
const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
