// Waits for the app to come to rest instead of sleeping a fixed time. At rest means, for two frames running: no finite
// animation or view transition playing, no short timer or animation frame pending, no request in flight, no scroll moving
// and no font loading.

/*
 * Timers of 400 ms or more are deliberate delays, not work in progress: autosave and preference debounces, hover intent
 * before a tooltip or link preview, a toast staying up, scrollbars fading. A step that needs one to fire waits for what
 * it leads to by its own condition, such as the save state reading saved or the tooltip being on screen.
 */
const LONGEST_SHORT_TIMER_MS = 399;

function track(longestShort) {
  const timers = new Set();
  const frames = new Set();
  let requests = 0;
  let transitions = 0;
  let scrolledAt = Number.NEGATIVE_INFINITY;
  const { setTimeout: set, clearTimeout: clear, requestAnimationFrame: frame, cancelAnimationFrame: cancelFrame, fetch } = window;

  window.setTimeout = (handler, ms, ...rest) => {
    const id = set.call(
      window,
      (...args) => {
        timers.delete(id);
        return handler(...args);
      },
      ms,
      ...rest,
    );
    if (!(Number(ms) > longestShort)) timers.add(id);
    return id;
  };
  window.clearTimeout = (id) => {
    timers.delete(id);
    clear.call(window, id);
  };
  window.requestAnimationFrame = (callback) => {
    const id = frame.call(window, (time) => {
      frames.delete(id);
      callback(time);
    });
    frames.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    frames.delete(id);
    cancelFrame.call(window, id);
  };
  window.fetch = function (...args) {
    requests++;
    return fetch.apply(this, args).finally(() => requests--);
  };
  const startTransition = document.startViewTransition?.bind(document);
  if (startTransition)
    document.startViewTransition = (...args) => {
      const transition = startTransition(...args);
      transitions++;
      transition.finished.finally(() => transitions--);
      return transition;
    };
  addEventListener("scroll", () => (scrolledAt = performance.now()), { capture: true, passive: true });

  const busy = () => {
    const why = [];
    const playing = document
      .getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY);
    if (playing.length) why.push(`${playing.length} animations`);
    if (timers.size) why.push(`${timers.size} timers`);
    if (frames.size) why.push(`${frames.size} frames`);
    if (requests) why.push(`${requests} requests`);
    if (transitions) why.push(`${transitions} view transitions`);
    if (performance.now() - scrolledAt < 50) why.push("scrolling");
    if (document.fonts.status === "loading") why.push("fonts");
    return why;
  };

  window.__e2eIdle = (timeout) =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      let calm = 0;
      const tick = () => {
        const why = busy();
        calm = why.length ? 0 : calm + 1;
        if (calm >= 2) resolve(performance.now() - started);
        else if (performance.now() - started > timeout) reject(new Error(`not at rest after ${timeout} ms: ${why.join(", ")}`));
        else frame.call(window, tick);
      };
      frame.call(window, tick);
    });
}

/** Installs the tracking on a page or a browser context, before anything loads. */
export const watchIdle = (target) => target.addInitScript(track, LONGEST_SHORT_TIMER_MS);

/** Resolves once the page is at rest. CI machines are slower than a laptop, so the default timeout is generous. */
export const idle = (page, timeout = 15000) => page.evaluate((ms) => window.__e2eIdle(ms), timeout);

/**
 * Waits out a save, then rest. An edit marks the note unsaved at once and autosave writes it 400 ms later, so once the
 * note reads unsaved this waits for that write to end, however it ends. When nothing reads unsaved within `ms`, the step
 * changed nothing or wrote some other way, and the full `ms` has still passed for a stray write to show.
 */
export async function writesSettled(page, ms = 650) {
  await page
    .waitForFunction(() => document.querySelector(".edit-state")?.dataset.state !== "saved", null, { timeout: ms })
    .catch(() => {});
  await page.waitForFunction(() => !["unsaved", "saving"].includes(document.querySelector(".edit-state")?.dataset.state), null, {
    timeout: 15000,
  });
  await idle(page);
}
