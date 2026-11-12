// Search in the sidebar: a click grows the field out of the search button and the X shrinks it back, a key lands at once.
// Usage: node tests/e2e/search-motion.mjs [reduced]
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const app = await serveFixture();
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 760 },
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await context.newPage();
const errors = [];
watchPageErrors(page, errors);
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const pause = (ms) => page.waitForTimeout(ms);
const settled = async () => {
  await pause(350);
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((a) => a.finished)));
};

/** The sidebar's running transitions, read in the same task as the click or key that started them. */
const motionAfter = (act) =>
  page.evaluate((act) => {
    const target = act === "open" ? '.files-actions [data-side="search"]' : '[data-act="search-clear"]';
    if (act === "key-open" || act === "key-close") {
      const key =
        act === "key-open" ? { key: "f", code: "KeyF", metaKey: true, shiftKey: true } : { key: "Escape", code: "Escape" };
      const into = act === "key-open" ? document.body : document.querySelector(".sidebar-search input");
      into.dispatchEvent(new KeyboardEvent("keydown", { ...key, bubbles: true, cancelable: true }));
    } else {
      const el = document.querySelector(target);
      el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      el.click();
    }
    const sidebar = document.querySelector(".sidebar");
    return sidebar.getAnimations({ subtree: true }).map((a) => ({
      property: a.transitionProperty,
      cls: a.effect.target.className?.baseVal ?? a.effect.target.className,
      ms: a.effect.getComputedTiming().duration,
    }));
  }, act);

const rect = (selector) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, selector);
const near = (a, b, tolerance = 0.6) => Math.abs(a - b) <= tolerance;
/**
 * Starts a motion and, on the first frame the field's width is strictly between the bounds, clicks the control inside that
 * frame's callback, so the width read and the click share one moment of the transition. A slow machine can draw no frame
 * mid-way, so a missed motion is started again.
 */
const clickMidway = async (start, selector, [low, high]) => {
  for (let attempt = 1; ; attempt++) {
    await start();
    const handle = await page
      .waitForFunction(
        ([selector, low, high]) => {
          const width = () => document.querySelector(".search-field").getBoundingClientRect().width;
          const before = width();
          if (before <= low || before >= high) return false;
          const control = document.querySelector(selector);
          const box = control.getBoundingClientRect();
          const reachable = control.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          control.click();
          return { before, after: width(), reachable };
        },
        [selector, low, high],
        { polling: "raf", timeout: 1000 },
      )
      .catch((error) => {
        if (attempt === 5) throw error;
      });
    if (handle) return handle.jsonValue();
    await settled();
  }
};
const travels = (motion) => motion.some((m) => m.property.startsWith("margin") && m.ms > 0);
const fades = (motion) => motion.some((m) => m.property === "opacity" && m.ms > 0);

try {
  await page.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await page.waitForSelector(".doc-title");
  await pause(400);

  const icon = await rect('.files-actions [data-side="search"]');
  const folded = await rect(".search-field");
  if (reduced) {
    check("under Reduce Motion the hidden field keeps its full size", folded.w > 200, JSON.stringify(folded));
  } else {
    check(
      "the hidden field is folded into the search button's box",
      near(folded.x, icon.x) && near(folded.y, icon.y) && near(folded.w, icon.w) && near(folded.h, icon.h),
      `${JSON.stringify(folded)} vs ${JSON.stringify(icon)}`,
    );
  }
  check("Files takes clicks while Search is hidden", !(await page.locator(".sidebar-search input").isVisible()));

  const readerBefore = await rect(".reader");
  let motion = await motionAfter("open");
  check(
    "a click on Search focuses the field at once",
    await page.evaluate(() => document.activeElement?.matches(".sidebar-search input")),
  );
  if (reduced) check("under Reduce Motion a click fades Search in without travel", fades(motion) && !travels(motion));
  else check("a click grows the field out of the button", travels(motion) && fades(motion), JSON.stringify(motion));
  check("every change stays inside the sidebar", JSON.stringify(await rect(".reader")) === JSON.stringify(readerBefore));
  await page.keyboard.type("crumb");
  check("typing during the open lands in the field", (await page.inputValue(".sidebar-search input")) === "crumb");
  await settled();
  const open = await rect(".search-field");
  check("the open field spans the panel", open.w > 200 && near(open.h, 32), JSON.stringify(open));
  await page.fill(".sidebar-search input", "");

  motion = await motionAfter("close");
  check("the X on an empty field returns to Files", await page.locator(".sidebar-inner").isVisible());
  if (reduced) check("under Reduce Motion the X fades Search out without travel", fades(motion) && !travels(motion));
  else check("the X shrinks the field back into the button", travels(motion), JSON.stringify(motion));
  await settled();
  check(
    "the search button is back once the field has folded away",
    (await page.evaluate(() => getComputedStyle(document.querySelector('.files-actions [data-side="search"]')).opacity)) === "1",
  );

  if (!reduced) {
    const closing = await clickMidway(
      async () => {
        if (await page.locator(".sidebar.is-searching").count()) {
          await page.fill(".sidebar-search input", "");
          await motionAfter("close");
        }
        await settled();
        await motionAfter("open");
      },
      '[data-act="search-clear"]',
      [icon.w + 4, open.w - 4],
    );
    await pause(40);
    const after = await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => done(document.querySelector(".search-field").getBoundingClientRect().width)),
          ),
        ),
    );
    check(
      "an X mid-open shrinks the field from where it had got to",
      Math.abs(closing.after - closing.before) < 30 && after < closing.after,
      `${closing.before} -> ${closing.after} -> ${after}`,
    );
    await settled();
    const reopen = await clickMidway(
      async () => {
        if (!(await page.locator(".sidebar.is-searching").count())) await motionAfter("open");
        await settled();
        await page.fill(".sidebar-search input", "");
        await motionAfter("close");
      },
      '.files-actions [data-side="search"]',
      [icon.w + 4, open.w - 4],
    );
    check(
      "the search button mid-close takes the click and grows the field again from where it was",
      reopen.reachable && Math.abs(reopen.after - reopen.before) < 30,
      JSON.stringify(reopen),
    );
    await settled();
    await page.click('[data-act="search-clear"]');
    await settled();
  }

  motion = await motionAfter("key-open");
  check(
    "⌘⇧F opens Search with nothing moving or fading",
    motion.every((m) => m.ms === 0),
    JSON.stringify(motion),
  );
  check("⌘⇧F leaves the field at full width", (await rect(".search-field")).w > 200);
  motion = await motionAfter("key-close");
  check(
    "Escape returns to Files with nothing moving or fading",
    motion.every((m) => m.ms === 0),
    JSON.stringify(motion),
  );
  check("Escape shows Files at once", await page.locator(".sidebar-inner").isVisible());

  await page.setViewportSize({ width: 760, height: 700 });
  await page.click('[data-act="sidebar"]');
  await settled();
  if (!reduced) {
    const narrowIcon = await rect('.files-actions [data-side="search"]');
    const narrowFolded = await rect(".search-field");
    check(
      "in a narrow window the hidden field still folds into the button",
      near(narrowFolded.x, narrowIcon.x) && near(narrowFolded.w, narrowIcon.w),
      `${JSON.stringify(narrowFolded)} vs ${JSON.stringify(narrowIcon)}`,
    );
  }
  await page.click('.files-actions [data-side="search"]');
  await settled();
  check("in a narrow window a click opens Search", await page.locator(".sidebar-search input").isVisible());
} finally {
  check("no page errors", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  await app.close();
  process.exitCode = results.some((r) => r.startsWith("FAIL")) ? 1 : 0;
}
