// The full graph's motion, direct manipulation and keyboard traversal, read from what the canvas actually draws.
// Usage: node tests/e2e/graph.mjs [reduced]
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { watchPageErrors } from "./page-errors.mjs";
import { serveFixture } from "./serve.mjs";

const reduced = process.argv.includes("reduced");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: "light",
  reducedMotion: reduced ? "reduce" : "no-preference",
});
const page = await ctx.newPage();
const errors = [];
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);

/* Every draw of the full graph is one recorded frame: its view, its dots in graph units and how many labels it wrote. */
await page.addInitScript(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const isGraph = (ctx) => ctx.canvas.classList.contains("graph-canvas");
  window.__frames = [];
  const last = () => window.__frames[window.__frames.length - 1];
  const wrap = (name, record) => {
    const original = proto[name];
    proto[name] = function (...args) {
      if (isGraph(this)) record(args);
      return original.apply(this, args);
    };
  };
  wrap("clearRect", () => window.__frames.push({ t: performance.now(), x: 0, y: 0, k: 1, dots: [], fills: [], labels: 0 }));
  wrap("translate", ([x, y]) => last() && Object.assign(last(), { x, y }));
  wrap("scale", ([k]) => last() && Object.assign(last(), { k }));
  wrap("arc", ([x, y]) => last()?.dots.push([x, y]));
  wrap("fillText", () => last() && last().labels++);
  const fill = proto.fill;
  proto.fill = function (...args) {
    if (isGraph(this)) last()?.fills.push(this.fillStyle);
    return fill.apply(this, args);
  };
  window.__entrances = [];
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (keyframes, options) {
    if (this.classList.contains("graph-view"))
      window.__entrances.push({ duration: options.duration, properties: Object.keys(keyframes) });
    return animate.call(this, keyframes, options);
  };
  window.__pointerIds = [];
  window.addEventListener("pointerdown", (e) => window.__pointerIds.push(e.pointerId), true);
});

await page.goto(`${app.url}?note=${encodeURIComponent(NOTES.hero)}`);
await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
await pause(400);

const frames = () => page.evaluate(() => window.__frames.filter((f) => f.dots.length));
const clearFrames = () => page.evaluate(() => (window.__frames = []));
const entrance = () => page.evaluate(() => window.__entrances);
const clearEntrances = () => page.evaluate(() => (window.__entrances = []));
const sameDots = (a, b) =>
  a.dots.length === b.dots.length && a.dots.every(([x, y], i) => x === b.dots[i][0] && y === b.dots[i][1]);
const announced = () => page.textContent(".graph-announce");
const parkMouse = () => page.mouse.move(640, 790);
const closeGraph = async () => {
  await page.evaluate(() => document.querySelector(".graph-canvas").focus());
  await page.keyboard.press("Escape");
  await pause(120);
};
const canvasOrigin = () =>
  page.evaluate(() => {
    const r = document.querySelector(".graph-canvas").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
/** A dot near the middle of the canvas, clear of the toolbar and the chips, and where it sits on screen. */
const centralDot = async () => {
  const origin = await canvasOrigin();
  const f = (await frames()).at(-1);
  let best = null;
  f.dots.forEach(([x, y], index) => {
    const sx = f.x + x * f.k;
    const sy = f.y + y * f.k;
    const d = Math.hypot(sx - origin.width / 2, sy - origin.height / 2);
    if (!best || d < best.d) best = { d, index, x: origin.left + sx, y: origin.top + sy };
  });
  return best;
};
const screenOf = (f, index, origin) => ({
  x: origin.left + f.x + f.dots[index][0] * f.k,
  y: origin.top + f.y + f.dots[index][1] * f.k,
});

/* Opening */
await parkMouse();
await clearFrames();
await clearEntrances();
await page.keyboard.press("Meta+g");
await page.waitForSelector(".graph-view");
check("opening from the keyboard plays no entrance", (await entrance()).length === 0);
await pause(reduced ? 300 : 800);
let drawn = await frames();
check("the first frame already has labels", drawn[0]?.labels > 0, drawn[0]?.labels);
check(
  "no note travels into place",
  drawn.every((f) => sameDots(f, drawn[0])),
  `${drawn.length} frames`,
);
check("nothing keeps drawing after the first frame", drawn.length <= 2, drawn.length);
check("the canvas takes the keyboard", (await page.getAttribute(".graph-canvas", "role")) === "application");
await closeGraph();

await clearFrames();
await clearEntrances();
await page.click('[data-act="graph"]');
await page.waitForSelector(".graph-view");
const fade = await entrance();
check(
  "opening with the pointer fades in for 140ms, opacity only",
  fade.length === 1 && fade[0].duration === 140 && fade[0].properties.every((p) => p === "opacity"),
  JSON.stringify(fade),
);
await pause(reduced ? 300 : 500);
drawn = await frames();
check("a pointer open has labels on its first frame too", drawn[0]?.labels > 0, drawn[0]?.labels);
check(
  "the pointer open moves no note either",
  drawn.every((f) => sameDots(f, drawn[0])),
);

const noteTab = page.locator(".tab:not(.is-graph-tab)").first();
await noteTab.click();
await pause(120);
await clearEntrances();
await page.locator(".tab.is-graph-tab").click();
await page.waitForSelector(".graph-view");
check("switching to a graph tab with the pointer is instant", (await entrance()).length === 0);
await pause(150);

await clearFrames();
await page.click('[data-gmode="local"]');
await pause(200);
drawn = await frames();
check("changing the scope draws labels at once", drawn[0]?.labels > 0, drawn[0]?.labels);
check(
  "changing the scope moves no note",
  drawn.every((f) => sameDots(f, drawn[0])),
);
await page.click('[data-gmode="vault"]');
await pause(200);

/* Camera */
await parkMouse();
await pause(100);
const restK = (await frames()).at(-1).k;
await clearFrames();
await page.click('[data-gz="in"]');
await pause(450);
drawn = await frames();
const ks = drawn.map((f) => f.k);
const span = drawn.at(-1).t - drawn[0].t;
const expectedK = restK * 1.3;
check("a zoom lands exactly on its target", Math.abs(ks.at(-1) - expectedK) < 1e-6, `${ks.at(-1)} for ${expectedK}`);
if (reduced) {
  check(
    "Reduce Motion snaps the camera",
    ks.every((k) => Math.abs(k - expectedK) < 1e-6),
    ks.join(","),
  );
} else {
  check(
    "the pointer glides the camera",
    ks.some((k) => k > restK + 1e-6 && k < expectedK - 1e-6),
    `${ks.length} frames`,
  );
  check("the glide takes about 240ms", span > 170 && span < 320, `${Math.round(span)}ms`);
  check(
    "the glide never reverses",
    ks.every((k, i) => i === 0 || k >= ks[i - 1] - 1e-9),
  );
}

await page.locator('[data-gz="out"]').focus();
await clearFrames();
await page.keyboard.press("Enter");
await pause(60);
drawn = await frames();
check(
  "a zoom from the keyboard is drawn once, at its end",
  drawn.length === 1 && Math.abs(drawn[0].k - restK) < 1e-6,
  drawn.map((f) => f.k).join(","),
);

await page.mouse.move(0, 0);
await clearFrames();
const zoomIn = await page.locator('[data-gz="in"]').boundingBox();
await page.mouse.click(zoomIn.x + zoomIn.width / 2, zoomIn.y + zoomIn.height / 2);
await pause(70);
await page.mouse.click(zoomIn.x + zoomIn.width / 2, zoomIn.y + zoomIn.height / 2);
await pause(70);
await page.mouse.click(zoomIn.x + zoomIn.width / 2, zoomIn.y + zoomIn.height / 2);
await pause(450);
drawn = await frames();
const threeSteps = restK * 1.3 ** 3;
check("quick zooms add up to every step", Math.abs(drawn.at(-1).k - threeSteps) < 1e-6, `${drawn.at(-1).k} for ${threeSteps}`);
check(
  "a retarget continues from what is drawn",
  drawn.every((f, i) => i === 0 || f.k >= drawn[i - 1].k - 1e-9),
);
await page.click('[data-gz="fit"]');
await pause(400);

if (!reduced) {
  await page.click('[data-gz="in"]');
  await pause(50);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 40);
  await pause(30);
  const afterWheel = (await frames()).at(-1).k;
  await pause(350);
  check("the wheel takes over from a glide", Math.abs((await frames()).at(-1).k - afterWheel) < 1e-6);
  await page.click('[data-gz="fit"]');
  await pause(400);
}

/* Dragging a note */
await page.mouse.move(640, 790);
await pause(100);
const grabbed = await centralDot();
await page.mouse.move(grabbed.x + 2, grabbed.y + 1);
await page.mouse.down();
const pointerId = await page.evaluate(() => window.__pointerIds.at(-1));
for (const [dx, dy] of [
  [12, 6],
  [40, 22],
  [73, -31],
]) {
  await page.mouse.move(grabbed.x + 2 + dx, grabbed.y + 1 + dy);
  const origin = await canvasOrigin();
  const at = screenOf((await frames()).at(-1), grabbed.index, origin);
  const off = Math.hypot(at.x - (grabbed.x + dx), at.y - (grabbed.y + dy));
  check(`a held note stays under the pointer at ${dx},${dy}`, off < 0.5, `${off.toFixed(2)}px`);
}

const beforeForeign = screenOf((await frames()).at(-1), grabbed.index, await canvasOrigin());
await page.evaluate(
  (id) =>
    document
      .querySelector(".graph-canvas")
      .dispatchEvent(new PointerEvent("pointermove", { pointerId: id + 40, clientX: 20, clientY: 20, bubbles: true })),
  pointerId,
);
await pause(30);
const afterForeign = screenOf((await frames()).at(-1), grabbed.index, await canvasOrigin());
check(
  "a second pointer cannot steal the drag",
  Math.hypot(afterForeign.x - beforeForeign.x, afterForeign.y - beforeForeign.y) < 0.5,
);

await page.evaluate(
  (id) =>
    document.querySelector(".graph-canvas").dispatchEvent(new PointerEvent("pointercancel", { pointerId: id, bubbles: true })),
  pointerId,
);
const heldAt = screenOf((await frames()).at(-1), grabbed.index, await canvasOrigin());
await page.mouse.move(heldAt.x + 150, heldAt.y + 90);
await pause(40);
const released = screenOf((await frames()).at(-1), grabbed.index, await canvasOrigin());
check("a cancelled drag lets go of the note", Math.hypot(released.x - (heldAt.x + 150), released.y - (heldAt.y + 90)) > 60);
await page.mouse.up();
await pause(40);
check("a cancelled drag opens nothing", await page.locator(".graph-view").isVisible());
check(
  "a cancelled drag leaves no grabbing cursor",
  (await page.evaluate(() => document.querySelector(".graph-canvas").style.cursor)) !== "grabbing",
);
await pause(reduced ? 50 : 1600);

await page.mouse.move(640, 790);
await pause(100);
const pressed = await centralDot();
await page.mouse.move(pressed.x, pressed.y);
await page.mouse.down();
await page.mouse.move(pressed.x + 60, pressed.y + 30);
await pause(30);
await page.mouse.up();
await pause(reduced ? 40 : 1600);
check("a released drag does not open the note", await page.locator(".graph-view").isVisible());

/* Refresh */
await page.mouse.move(640, 400);
await page.mouse.wheel(0, -120);
await pause(60);
const chip = page.locator(".graph-chip").first();
await chip.click();
await pause(420);
const beforeRefresh = (await frames()).at(-1);
await page.evaluate(() => window.waymark.reader.rerender());
await pause(200);
const afterRefresh = (await frames()).at(-1);
check(
  "a background refresh leaves the view alone",
  Math.abs(afterRefresh.k - beforeRefresh.k) < 1e-6 && Math.abs(afterRefresh.x - beforeRefresh.x) < 1e-6,
);
check("a background refresh keeps the spotlight", (await page.locator(".graph-chip.is-on").count()) === 1);
await page.locator(".graph-chip").nth(1).focus();
await page.evaluate(() => window.waymark.reader.rerender());
await pause(200);
check(
  "a background refresh leaves focus on a chip",
  await page.evaluate(() => document.activeElement.classList.contains("graph-chip")),
);
await page.locator(".graph-filter input").focus();
await page.evaluate(() => window.waymark.reader.rerender());
await pause(200);
check(
  "a background refresh does not take focus from the field",
  await page.evaluate(() => document.activeElement.matches(".graph-filter input")),
);
await chip.click();
await pause(420);

/* Keyboard */
await parkMouse();
await page.evaluate(() => document.querySelector(".graph-canvas").focus());
await clearFrames();
await page.keyboard.press("ArrowRight");
const first = await announced();
check("the first arrow lands on the open note", first.includes(NOTES.hero.split("/").pop()), first);
check("the focused note is described", /link/.test(first) && / of /.test(first), first);
await pause(250);
drawn = await frames();
check("keyboard focus is drawn once, with no pulses", drawn.length === 1, drawn.length);
check("keyboard focus labels the note", drawn[0]?.labels > 0);
await page.keyboard.press("ArrowDown");
const second = await announced();
check("the next arrow moves on", second !== first && second !== "", second);
const ink = await page.evaluate(() => {
  const c = document.createElement("canvas").getContext("2d");
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
  return c.fillStyle;
});
const brightest = (await frames()).at(-1).fills.filter((color) => color === ink).length;
check("only the focused note is brightest, even beside the open note", brightest === 1, brightest);
await page.keyboard.press("ArrowUp");
check("the previous arrow comes back", (await announced()) === first);

const total = Number(first.match(/ of ([\d,]+)/)[1].replace(",", ""));
for (let i = 0; i < total; i++) await page.keyboard.press("ArrowRight");
check("traversal wraps after every note", (await announced()) === first, String(total));

await clearFrames();
const before = (await frames()).length;
await page.keyboard.press("ArrowLeft");
await pause(30);
drawn = await frames();
const shown = drawn.at(-1);
check("traversal is drawn at once", drawn.length - before === 1);
check(
  "traversal never glides the camera",
  drawn.every((f) => f.k === shown.k),
);

await page.fill(".graph-filter input", "a");
await page.evaluate(() => document.querySelector(".graph-canvas").focus());
await page.keyboard.press("ArrowRight");
const filtered = await announced();
check("traversal follows the highlight", /^[^,]*a/i.test(filtered), filtered);
await page.fill(".graph-filter input", "");
await page.evaluate(() => document.querySelector(".graph-canvas").focus());

await page.keyboard.press("ArrowRight");
const target = (await announced()).split(",")[0];
const tabs = await page.locator(".tab").count();
await page.keyboard.press("Meta+Enter");
await pause(250);
check(
  "Command-Return opens the note in a new tab",
  (await page.locator(".tab").count()) === tabs + 1 && (await page.locator(".graph-view").isVisible()),
);
await page.evaluate(() => document.querySelector(".graph-canvas").focus());
await page.keyboard.press("Enter");
await pause(350);
check(
  "Return opens the focused note",
  (await page.locator(".graph-view").count()) === 0 && (await page.textContent(".doc-title")).trim() === target,
  target,
);

check("the page threw nothing", errors.length === 0, errors[0]);
for (const line of results) console.log(line);
await browser.close();
await app.close();
process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);
