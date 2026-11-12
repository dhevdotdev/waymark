// Pointer motion that shows where a change comes from: a theme spreads from its swatch, an outline click glides to its
// heading, the first graph opened blooms from the current note, and the graph opens by pulling back from a note and closes
// by diving into one. Keys get the end state at once.
// Each motion is read from what the trigger starts, not from sampled frames, so a slow machine cannot miss it.
// Usage: node tests/e2e/spatial-motion.mjs [reduced]
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: "light",
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await context.newPage();
const errors = [];
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);

await page.addInitScript(() => {
  /* Every animation a View Transition runs on the root's new view, read as it starts. */
  window.__spreads = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = animate.call(this, keyframes, options);
    if (options?.pseudoElement === "::view-transition-new(root)")
      window.__spreads.push({
        properties: Object.keys(keyframes),
        frames: Object.values(keyframes)[0],
        ms: animation.effect.getComputedTiming().duration,
        easing: options.easing,
        old: getComputedStyle(document.documentElement, "::view-transition-old(root)").animationName,
      });
    return animation;
  };
  window.__transitions = 0;
  const start = Document.prototype.startViewTransition;
  if (start)
    Document.prototype.startViewTransition = function (...args) {
      window.__transitions++;
      return start.apply(this, args);
    };
  /* Every bloom the graph starts, and the dots of each frame it draws. */
  window.__blooms = [];
  new MutationObserver((records) => {
    for (const r of records) if (r.target.dataset?.bloom) window.__blooms.push(Number(r.target.dataset.bloom));
  }).observe(document, { attributes: true, attributeFilter: ["data-bloom"], subtree: true });
  window.__frames = [];
  const proto = CanvasRenderingContext2D.prototype;
  const clear = proto.clearRect;
  proto.clearRect = function (...args) {
    if (this.canvas.classList.contains("graph-canvas")) window.__frames.push([]);
    return clear.apply(this, args);
  };
  /* The scale of each frame the graph draws, and every fade the graph view starts. */
  window.__zooms = [];
  const translate = proto.translate;
  proto.translate = function (...args) {
    if (this.canvas.classList.contains("graph-canvas")) window.__shift = args;
    return translate.apply(this, args);
  };
  const scale = proto.scale;
  proto.scale = function (...args) {
    if (this.canvas.classList.contains("graph-canvas")) window.__zooms.push(args[0]);
    return scale.apply(this, args);
  };
  window.__graphFades = [];
  const animateView = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    const animation = animateView.call(this, keyframes, options);
    if (this.classList?.contains("graph-view"))
      window.__graphFades.push({
        from: Number(keyframes.opacity[0]),
        to: Number(keyframes.opacity[1]),
        ms: animation.effect.getComputedTiming().duration,
        leaving: this.classList.contains("is-leaving"),
      });
    return animation;
  };
  const arc = proto.arc;
  proto.arc = function (...args) {
    if (this.canvas.classList.contains("graph-canvas")) window.__frames.at(-1)?.push(`${args[0]},${args[1]}`);
    return arc.apply(this, args);
  };
});

try {
  await page.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(400);

  /* Theme */
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const spreads = () => page.evaluate(() => window.__spreads);
  const reset = () => page.evaluate(() => Object.assign(window, { __spreads: [], __transitions: 0 }));
  await page.click('[data-act="settings"]');
  await pause(300);
  const swatch = page.locator(".theme-swatch:not(.is-on)").first();
  const box = await swatch.boundingBox();
  const before = await theme();
  await reset();
  await swatch.click();
  await pause(reduced ? 400 : 600);
  const spread = await spreads();
  check("a swatch clicked with the pointer changes the theme", (await theme()) !== before, `${before} to ${await theme()}`);
  if (reduced) {
    check(
      "under Reduce Motion the new theme fades in instead of spreading",
      spread.length === 1 && spread[0].properties.join() === "opacity" && spread[0].ms === 250,
      JSON.stringify(spread),
    );
  } else {
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    const from = spread[0]?.frames[0] ?? "";
    check(
      "the new theme spreads as a circle for 400ms",
      spread.length === 1 && spread[0].properties.join() === "clipPath" && spread[0].ms === 400,
      JSON.stringify(spread),
    );
    check("the circle starts on the swatch clicked", from === `circle(0px at ${x}px ${y}px)`, `${from} vs ${x},${y}`);
    check("it eases out", spread[0]?.easing.includes("0.23, 1, 0.32, 1"), spread[0]?.easing);
  }
  check("the stock crossfade is off while it plays", spread[0]?.old === "none", spread[0]?.old);
  await reset();
  await page.locator(".theme-swatch:not(.is-on)").first().focus();
  const keyed = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.keyboard.press("Enter");
  check(
    "a swatch chosen from the keyboard changes the theme at once, with no transition",
    (await theme()) !== keyed && (await page.evaluate(() => window.__transitions)) === 0,
  );
  await page.click('[data-appearance="dark"]');
  await pause(100);
  check(
    "the light and dark switch runs no transition",
    (await page.evaluate(() => window.__transitions)) === 0 &&
      (await page.evaluate(() => document.documentElement.dataset.scheme)) === "dark",
  );
  await page.click('[data-appearance="light"]');
  await page.keyboard.press("Escape");
  await pause(300);

  /* Outline */
  const toTop = () => page.evaluate(() => (document.querySelector(".scroller").scrollTop = 0));
  /* What the click left behind, read in the same task as the click so no frame of the glide has run yet. */
  await page.evaluate(() => {
    window.addEventListener("click", (e) => {
      if (!e.target.closest(".floating-outline a")) return;
      const s = document.querySelector(".scroller");
      const heading = document.getElementById(e.target.closest("a").dataset.target);
      window.__glide = {
        gliding: s.dataset.gliding ?? null,
        top: s.scrollTop,
        tint: heading.getAnimations().map((a) => a.effect.getComputedTiming().delay),
      };
    });
  });
  const glide = () => page.evaluate(() => window.__glide);
  const restsOn = (index) =>
    page.evaluate((index) => {
      const s = document.querySelector(".scroller");
      const heading = document.getElementById(document.querySelectorAll(".floating-outline a")[index].dataset.target);
      const offset = heading.getBoundingClientRect().top - s.getBoundingClientRect().top;
      const margin = Number.parseFloat(getComputedStyle(heading).scrollMarginTop);
      const atEnd = s.scrollTop >= s.scrollHeight - s.clientHeight - 1;
      return { ok: Math.abs(offset - margin) < 2 || atEnd, offset, margin, top: s.scrollTop };
    }, index);
  const outline = page.locator(".floating-outline");
  const links = page.locator(".floating-outline a");
  const last = (await links.count()) - 1;
  const screen = await page.evaluate(() => document.querySelector(".scroller").clientHeight);

  await toTop();
  await outline.hover();
  await pause(250);
  await links.nth(last).click();
  const far = await glide();
  await pause(600);
  const landed = await restsOn(last);
  check("an outline click lands on its heading", landed.ok, JSON.stringify(landed));
  if (reduced) {
    check("under Reduce Motion it jumps", far.gliding === null && far.top === landed.top, JSON.stringify(far));
  } else {
    check("an outline click glides for 250ms", far.gliding === "250", JSON.stringify(far));
    check(
      "further than three screens it starts one screen short",
      landed.top > 3 * screen && Math.abs(landed.top - far.top - screen) < 2,
      `${far.top} then ${landed.top}, screen ${screen}`,
    );
    check("the heading's tint waits for the landing", far.tint.length === 1 && far.tint[0] === 250, JSON.stringify(far));
  }

  await links.nth(last - 1).click();
  const near = await glide();
  await pause(600);
  if (!reduced) check("a near heading glides the whole way", near.top === landed.top, JSON.stringify(near));
  check("a near heading lands too", (await restsOn(last - 1)).ok);

  for (const [name, event] of [
    ["a wheel", "new WheelEvent('wheel', { deltaY: 10, bubbles: true })"],
    ["a press", "new PointerEvent('pointerdown', { bubbles: true })"],
  ]) {
    await toTop();
    const stopped = await page.evaluate(async (make) => {
      const s = document.querySelector(".scroller");
      document.querySelectorAll(".floating-outline a")[1].click();
      s.dispatchEvent(new Function(`return ${make}`)());
      const at = s.scrollTop;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      return { gliding: s.dataset.gliding ?? null, at, later: s.scrollTop };
    }, event);
    check(
      `${name} stops the glide where it is`,
      stopped.gliding === null && stopped.at === stopped.later,
      JSON.stringify(stopped),
    );
  }

  await toTop();
  await links.nth(last).focus();
  await page.keyboard.press("Enter");
  const fromKeys = await glide();
  check(
    "from the keyboard the outline jumps, with no glide and no tint",
    fromKeys.gliding === null && fromKeys.tint.length === 0 && (await restsOn(last)).ok,
    JSON.stringify(fromKeys),
  );
  await page.mouse.move(400, 790);
  await pause(200);

  /* Graph: interrupting the first bloom */
  await page.evaluate(() => {
    new MutationObserver((records, observer) => {
      const canvas = records.find((r) => r.target.dataset?.bloom)?.target;
      if (!canvas) return;
      observer.disconnect();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.__heldAt = window.__frames.length;
          canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 0, bubbles: true, cancelable: true }));
          window.__stillBlooming = "bloom" in canvas.dataset;
        }),
      );
    }).observe(document, { attributes: true, attributeFilter: ["data-bloom"], subtree: true });
    window.__frames = [];
  });
  await page.click('[data-act="graph"]');
  await page.waitForSelector(".graph-view");
  await pause(900);
  const bloom = await page.evaluate(() => ({
    blooms: window.__blooms,
    still: window.__stillBlooming ?? null,
    after: window.__frames
      .slice(window.__heldAt)
      .filter((f) => f.length)
      .map((f) => f.join(" ")),
  }));
  if (reduced) check("under Reduce Motion the graph does not bloom", bloom.blooms.length === 0, JSON.stringify(bloom.blooms));
  else {
    check("the first graph opened with the pointer blooms", bloom.blooms.length === 1, JSON.stringify(bloom.blooms));
    check("a wheel ends the bloom", bloom.still === false);
    check(
      "every note is in its place from the frame after the wheel",
      bloom.after.length > 0 && bloom.after.every((f) => f === bloom.after[0]),
      `${bloom.after.length} frames, ${new Set(bloom.after).size} distinct`,
    );
  }

  /* Graph: opening pulls back from the current note, and leaving dives into it */
  const graphMotion = () =>
    page.evaluate(() => ({
      fades: window.__graphFades,
      zooms: window.__zooms,
      views: document.querySelectorAll(".graph-view").length,
      leaving: document.querySelectorAll(".graph-view.is-leaving").length,
    }));
  const resetGraph = () => page.evaluate(() => Object.assign(window, { __graphFades: [], __zooms: [] }));
  const grows = (zooms) => zooms.length > 2 && zooms.at(-1) > zooms[0] * 1.5;
  const shrinks = (zooms) => zooms.length > 2 && zooms[0] > zooms.at(-1) * 1.5;
  const still = (zooms) => zooms.every((k) => Math.abs(k - zooms[0]) < 1e-9);
  await pause(400);
  const graphScale = await page.evaluate(() => window.__zooms.at(-1));
  await resetGraph();
  await page.click(".graph-leave");
  const docEntrance = await page.evaluate(() => {
    const doc = document.querySelector(".scroller > .doc");
    return { animations: doc?.getAnimations().length ?? -1, fades: !!doc?.classList.contains("doc-enter") };
  });
  await pause(120);
  let motion = await graphMotion();
  check(
    "leaving with the pointer fades the graph off the note",
    motion.leaving === 1 && motion.fades.length === 1 && motion.fades[0].to === 0 && motion.fades[0].ms === (reduced ? 140 : 250),
    JSON.stringify(motion.fades),
  );
  if (reduced) check("under Reduce Motion leaving only fades", still([graphScale, ...motion.zooms]), motion.zooms.join());
  else
    check(
      "leaving with the pointer dives into the note",
      grows([graphScale, ...motion.zooms]),
      `${graphScale}: ${motion.zooms.join()}`,
    );
  check(
    "the note under a leaving graph takes no entrance of its own",
    docEntrance.animations === 0 && !docEntrance.fades,
    JSON.stringify(docEntrance),
  );
  await pause(400);
  check("the graph is gone once it has left", (await graphMotion()).views === 0);

  await resetGraph();
  await page.click('[data-act="graph"]');
  await page.waitForSelector(".graph-view");
  await pause(500);
  motion = await graphMotion();
  check(
    "opening with the pointer fades the graph in",
    motion.fades.length === 1 && motion.fades[0].from === 0 && motion.fades[0].to === 1,
    JSON.stringify(motion.fades),
  );
  if (reduced) check("under Reduce Motion opening only fades", still(motion.zooms), motion.zooms.join());
  else check("opening with the pointer pulls back from the note", shrinks(motion.zooms), motion.zooms.join());

  /* Interrupted: leaving mid-open starts from the opacity on screen, and opening mid-leave takes the same graph back */
  await page.click(".graph-leave");
  await pause(400);
  await resetGraph();
  await page.click('[data-act="graph"]');
  await page.evaluate(() => {
    for (const a of document.querySelector(".graph-view").getAnimations()) {
      a.pause();
      a.currentTime = 40;
    }
  });
  await page.click(".graph-leave");
  motion = await graphMotion();
  const midOpen = motion.fades.at(-1);
  check(
    "leaving mid-open fades from the opacity on screen",
    motion.fades.length === 2 && midOpen.leaving && midOpen.from > 0.05 && midOpen.from < 0.95,
    JSON.stringify(motion.fades),
  );
  const departing = await page.evaluate(() => {
    const view = document.querySelector(".graph-view.is-leaving");
    view.__mark = true;
    for (const a of view.getAnimations()) {
      a.pause();
      a.currentTime = 60;
    }
    return getComputedStyle(view).opacity;
  });
  await resetGraph();
  await page.click('[data-act="graph"]');
  motion = await graphMotion();
  const kept = await page.evaluate(() => document.querySelector(".graph-view")?.__mark === true);
  check(
    "opening mid-leave takes the leaving graph back",
    kept && motion.views === 1 && motion.leaving === 0,
    JSON.stringify({ kept, views: motion.views, leaving: motion.leaving }),
  );
  check(
    "and fades it back in from the opacity on screen",
    motion.fades.length === 1 && Math.abs(motion.fades[0].from - Number(departing)) < 0.02 && motion.fades[0].to === 1,
    `${departing} then ${JSON.stringify(motion.fades)}`,
  );
  await pause(500);

  /* Opening a note from the graph dives into its node, and the note takes no entrance of its own */
  const dot = await page.evaluate(() => {
    const rect = document.querySelector(".graph-canvas").getBoundingClientRect();
    const [x, y] = window.__shift;
    const k = window.__zooms.at(-1);
    const middle = [rect.width / 2, rect.height / 2];
    const dots = window.__frames.findLast((f) => f.length).map((d) => d.split(",").map(Number));
    const screen = dots.map(([dx, dy]) => [x + dx * k, y + dy * k]);
    screen.sort((a, b) => Math.hypot(a[0] - middle[0], a[1] - middle[1]) - Math.hypot(b[0] - middle[0], b[1] - middle[1]));
    return { x: rect.left + screen[0][0], y: rect.top + screen[0][1], k };
  });
  const title = () => page.evaluate(() => document.querySelector(".doc-title")?.textContent);
  const titleBefore = await title();
  await resetGraph();
  await page.mouse.click(dot.x, dot.y);
  await page.waitForFunction((t) => document.querySelector(".doc-title")?.textContent !== t, titleBefore);
  const opened = await page.evaluate(() => {
    const doc = document.querySelector(".scroller > .doc");
    return { animations: doc.getAnimations().length, fades: doc.classList.contains("doc-enter") };
  });
  await pause(120);
  motion = await graphMotion();
  check(
    "a note opened from the graph takes no entrance of its own",
    opened.animations === 0 && !opened.fades,
    JSON.stringify(opened),
  );
  if (reduced) check("under Reduce Motion opening a note from the graph only fades", still([dot.k, ...motion.zooms]));
  else
    check(
      "opening a note from the graph dives into its node",
      grows([dot.k, ...motion.zooms]),
      `${dot.k}: ${motion.zooms.join()}`,
    );
  await pause(400);

  /* From the keyboard the graph comes and goes at once */
  await resetGraph();
  await page.keyboard.press("Meta+g");
  await page.waitForSelector(".graph-view");
  await pause(400);
  motion = await graphMotion();
  check("a shortcut shows the graph at once", motion.fades.length === 0 && still(motion.zooms), JSON.stringify(motion));
  await page.locator(".graph-canvas").focus();
  await resetGraph();
  await page.keyboard.press("Escape");
  motion = await graphMotion();
  check("Escape removes the graph at once", motion.views === 0 && motion.fades.length === 0, JSON.stringify(motion));

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
