// The sync panel in every state that needs its own treatment, with Git faked over a fixture vault.
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { fetchRoute } from "./route-fetch.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? `  (${detail})` : ""}`);
const app = await serveFixture();
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1320, height: 860 } });
const errors = [];
watchPageErrors(page, errors);
const pause = (ms) => page.waitForTimeout(ms);

await page.addInitScript(() => {
  const base = {
    isRepo: true,
    branch: "main",
    head: "a1b2c3d",
    upstream: "origin/main",
    remoteUrl: "https://example.invalid/n.git",
    ahead: 0,
    behind: 0,
    files: [],
    operation: null,
  };
  const edit = (i) => ({ path: `Garden/Bed ${i}.md`, origPath: null, staged: ".", unstaged: "M", conflicted: false });
  window.__states = {
    clean: base,
    incoming: { ...base, behind: 3 },
    outgoing: { ...base, ahead: 2 },
    changedOutgoing: { ...base, ahead: 2, files: [edit(1)] },
    many: { ...base, files: Array.from({ length: 40 }, (_, i) => edit(i)) },
    diverged: { ...base, ahead: 1, behind: 1 },
    detached: { ...base, branch: null, upstream: null },
    noRemote: { ...base, upstream: null, remoteUrl: null },
    notTracking: { ...base, upstream: null },
    notRepo: { ...base, isRepo: false, branch: null, upstream: null, remoteUrl: null },
  };
  window.__state = "clean";
  window.__commits = [
    {
      sha: "a".repeat(40),
      short: "aaaaaaa",
      author: "Field Notes",
      date: "2026-11-02T18:39:06Z",
      subject: "Rework the table",
      path: null,
    },
  ];
  window.__fetches = 0;
  const status = async () => window.__states[window.__state];
  const fetch = async () => {
    window.__fetches++;
    return status();
  };
  window.__fakeGit = {
    status,
    fetch,
    fastForward: status,
    push: status,
    stage: status,
    unstage: status,
    commit: status,
    diff: async () => "",
    log: async () => window.__commits,
    show: async () => "",
    fileAt: async () => "# Old\n",
    diffRevs: async () => "",
  };
});
await page.route(/\/src\/platform\.ts/, async (route) => {
  const response = await fetchRoute(route);
  if (response)
    await route.fulfill({
      response,
      body: `${await response.text()}\n;Object.assign(git, window.__fakeGit ?? {});window.__GitError = GitError;\n`,
    });
});
await page.route(
  /\/src\/ui\/(sync-controller|note-history|settings|note-files|reader-commands|reader|git-panel|base-view)\.ts/,
  async (route) => {
    const response = await fetchRoute(route);
    if (!response) return;
    const body = (await response.text()).replace(
      /import\s*\{([^}]*)\}\s*from\s*"(\/src\/platform\.ts[^"]*)"/,
      (whole, names, from) =>
        /\bisDesktop\b/.test(names)
          ? `import {${names.replace(/\bisDesktop\b/, "isDesktop as __d")}} from "${from}";\nconst isDesktop = true`
          : whole,
    );
    await route.fulfill({ response, body });
  },
);

const stage = async (state, error = null) => {
  await page.evaluate(
    async ([s, err]) => {
      const { panel } = window.waymark.reader.sync;
      panel.close();
      window.__state = s;
      panel.state = err ? { kind: "error", error: new window.__GitError(err, "git said no") } : { kind: "idle" };
      await panel.refresh();
      panel.open();
    },
    [state, error],
  );
  await pause(350);
  /* A slow machine can still be running the sheet's open, and a scaling sheet moves what sits inside it. */
  await page.waitForFunction(() => document.querySelector(".sync-sheet")?.getAnimations().length === 0);
};
const closeAll = () => page.evaluate(() => window.waymark.reader.sync.panel.close());
const text = (selector) => page.locator(selector).first().textContent();
const buttons = () => page.locator(".sync-actions .btn").allTextContents();
const primary = () => page.locator(".sync-actions .btn-primary").allTextContents();
const statusLabel = () => text(".sync-label");
const tab = async (label) => {
  await page.locator(`.sync-sheet [role="tablist"] button:has-text("${label}")`).click();
  await pause(300);
};

try {
  await page.goto(`${app.url}?note=Welcome`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(700);

  await stage("incoming");
  check("Sync leads when commits are coming in", (await primary()).join() === "Sync");
  await stage("outgoing");
  check("Push leads when commits are waiting to go", (await primary()).join() === "Push 2");
  await stage("changedOutgoing");
  check(
    "Commit & Sync leads when there is something to commit",
    (await primary()).length === 0 && (await page.locator(".commit-actions .btn-primary").count()) === 1,
  );

  await stage("many");
  const stuck = await page.evaluate(() => {
    const body = document.querySelector(".sync-body");
    body.scrollTop = 200;
    const box = document.querySelector(".commit-box").getBoundingClientRect();
    return { gap: body.getBoundingClientRect().bottom - box.bottom };
  });
  check("the commit box sits on the panel's bottom edge, with no row below it", Math.abs(stuck.gap) <= 1, JSON.stringify(stuck));

  await stage("diverged", "diverged");
  check("Open in Terminal appears once", (await page.locator('.sync-sheet button:has-text("Open in Terminal")').count()) === 1);

  await stage("noRemote");
  check("no remote says so", (await text(".sync-uptodate")).includes("no remote"), await text(".sync-uptodate"));
  check("and offers nothing to sync", (await buttons()).length === 0);
  check("the status bar agrees", (await statusLabel()) === "No remote", await statusLabel());
  await stage("notTracking");
  check("a branch with no upstream says so", (await text(".sync-uptodate")).includes("does not track"));
  check("and points to the terminal", (await buttons()).join() === "Open in Terminal", (await buttons()).join());
  check("the status bar agrees", (await statusLabel()) === "Not tracking", await statusLabel());
  await stage("detached");
  check("detached HEAD says so", (await text(".sync-uptodate")).includes("Not on a branch"));
  check("and never claims to be up to date", !(await text(".sync-summary")).includes("Up to date"));
  check("the status bar agrees", (await statusLabel()) === "Detached HEAD", await statusLabel());

  await stage("clean", "rejected");
  check("a rejected push offers the next step", await page.locator('.notice-actions button:has-text("Sync now")').isVisible());
  await stage("clean", "timeout");
  check("a timeout can be retried", await page.locator('.notice-actions button:has-text("Try again")').isVisible());
  const before = await page.evaluate(() => window.__fetches);
  await page.locator('.notice-actions button:has-text("Try again")').click();
  await pause(300);
  check("and retrying really runs", (await page.evaluate(() => window.__fetches)) > before);
  await stage("clean", "other");
  check("a generic problem explains itself", ((await text(".notice p")) ?? "").length > 10);
  check("with Git's output already open", await page.locator(".notice-details").evaluate((d) => d.open));

  await stage("notRepo");
  check(
    "a plain folder gets a panel its own size",
    (await page.locator(".sync-sheet").evaluate((s) => s.getBoundingClientRect().height)) < 200,
  );

  await page.evaluate(() => {
    window.__saved = window.__commits;
    window.__commits = [];
  });
  await stage("clean");
  await tab("History");
  await pause(600);
  check(
    "no commits says so instead of loading forever",
    (await text(".sync-body")).includes("No commits yet"),
    await text(".sync-body"),
  );
  await page.evaluate(() => {
    window.__commits = window.__saved;
  });
  await closeAll();
  await stage("clean");
  await tab("History");
  await page.locator(".commit-row").first().click();
  await pause(400);
  const fromPanel = await page.locator(".sheet").boundingBox();
  const subtitle = await text(".sheet-sub");
  check(
    "a commit shows one date format",
    /[A-Z][a-z]{2} \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2} \d{4}/.test(subtitle) && !/\d+\/\d+\/\d+/.test(subtitle),
    subtitle,
  );
  check("the sheet closes with a close button", (await page.locator('.sheet-head button[aria-label="Close"]').count()) === 1);
  await page.keyboard.press("Escape");
  await pause(300);
  await closeAll();
  await pause(300);
  await page.click('[data-rail="info"]');
  await pause(400);
  await page.locator(".rail-history .rail-commit").first().click();
  await pause(400);
  const fromInfo = await page.locator(".sheet").boundingBox();
  check(
    "the same sheet has the same frame from the panel and from Info",
    JSON.stringify(fromPanel) === JSON.stringify(fromInfo),
    `${JSON.stringify(fromPanel)} ${JSON.stringify(fromInfo)}`,
  );
  await page.keyboard.press("Escape");
  await pause(300);

  await page.evaluate(() => {
    window.__state = "changedOutgoing";
    window.waymark.reader.sync.panel.open();
  });
  await pause(350);
  await tab("Changes");
  const link = await page
    .locator(".sync-sheet .link-btn")
    .first()
    .evaluate((b) => getComputedStyle(b).color);
  const accent = await page.evaluate(() => {
    const p = document.createElement("span");
    p.style.color = "var(--accent)";
    document.body.append(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
  check("text actions are quiet, not accent", link !== accent, `${link} ${accent}`);

  /* A status refresh keeps the keyboard user's place. */
  {
    await stage("many");
    const inBody = () => page.evaluate(() => document.querySelector(".sync-body").scrollTop);
    const focusKey = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return {
          text: a.textContent.trim().slice(0, 24),
          label: a.getAttribute("aria-label"),
          ring: a.matches(":focus-visible"),
          tag: a.className,
        };
      });
    const refreshNow = () => page.evaluate(() => window.waymark.reader.sync.panel.refresh());
    await page.keyboard.press("Tab");
    await page.locator(".change-act").nth(20).focus();
    /* WebKit can leave scrolling to a newly focused control for the next frame, so that frame passes before scrolling away. */
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => {
      document.querySelector(".sync-body").scrollTop = 300;
    });
    const before = await focusKey();
    await refreshNow();
    await pause(60);
    const after = await focusKey();
    check(
      "a refresh keeps focus on the same control",
      after.label === before.label && after.label?.startsWith("Stage Bed 20"),
      JSON.stringify(after),
    );
    check("a refresh keeps the keyboard focus ring", before.ring && after.ring, `${before.ring} ${after.ring}`);
    check("a refresh keeps the scroll position", (await inBody()) === 300, String(await inBody()));
    for (let i = 0; i < 6; i++) void refreshNow();
    await pause(120);
    check("repeated refreshes keep focus", (await focusKey()).label === before.label, JSON.stringify(await focusKey()));

    await page.locator('.seg-btn[role="tab"]', { hasText: "Changes" }).focus();
    await page.evaluate(() => {
      window.__states.fewer = { ...window.__states.many, files: window.__states.many.files.slice(0, 3) };
      window.__state = "fewer";
    });
    await refreshNow();
    await pause(60);
    check("a tab whose count changed keeps focus", /^Changes 3/.test((await focusKey()).text), JSON.stringify(await focusKey()));

    await page.locator(".change-act").nth(2).focus();
    await page.evaluate(() => {
      window.__states.gone = { ...window.__states.many, files: window.__states.many.files.slice(0, 1) };
      window.__state = "gone";
    });
    await refreshNow();
    await pause(60);
    check(
      "when a control goes, the sheet holds focus",
      (await focusKey()).tag.includes("sync-sheet"),
      JSON.stringify(await focusKey()),
    );

    await stage("many");
    await page.locator(".commit-box textarea").focus();
    await page.locator(".commit-box textarea").fill("first line");
    await page.evaluate(() => document.querySelector(".commit-box textarea").setSelectionRange(2, 5));
    await refreshNow();
    await pause(60);
    const field = await page.evaluate(() => {
      const box = document.querySelector(".commit-box textarea");
      return [document.activeElement === box, box.selectionStart, box.selectionEnd, box.value];
    });
    check("the commit box keeps its focus, selection and text", field.join() === "true,2,5,first line", field.join());

    await page.evaluate(() => {
      document.querySelector(".sync-body").scrollTop = 300;
    });
    await tab("History");
    await pause(120);
    check("another tab starts at its top", (await inBody()) === 0, String(await inBody()));
  }
  {
    const labelEdge = (tone) =>
      page.evaluate((t) => {
        const button = document.querySelector(".sync-btn");
        button.dataset.tone = t;
        return document.querySelector(".sync-label").getBoundingClientRect().left;
      }, tone);
    const idle = await labelEdge("ok");
    const working = await labelEdge("busy");
    check("the busy spinner does not move the status label", idle === working, `${idle} ${working}`);
    const spinning = await page.locator(".sync-dot").evaluate((d) => getComputedStyle(d).animationName);
    check("the spinner still spins", spinning === "spin", spinning);
    await labelEdge("ok");
  }
  {
    /* Each pulse is read from the options it starts with, so a slow machine cannot miss a short one. */
    const pulsesDuring = async (act) => {
      await page.evaluate(() => {
        window.pulses = [];
        window.realAnimate ??= Element.prototype.animate;
        Element.prototype.animate = function (keyframes, options) {
          const animation = window.realAnimate.call(this, keyframes, options);
          if (options?.id === "sync-pulse") {
            const frames = animation.effect.getKeyframes();
            window.pulses.push({
              on: options.pseudoElement ?? "dot",
              scale: frames.map((k) => k.scale).join(">"),
              ms: options.duration,
            });
          }
          return animation;
        };
      });
      await act();
      await page.waitForFunction(() => !window.waymark.reader.sync.busy);
      await pause(100);
      return page.evaluate(() => {
        Element.prototype.animate = window.realAnimate;
        return window.pulses;
      });
    };
    await stage("incoming");
    const clicked = await pulsesDuring(() => page.locator(".sync-actions .btn-primary").click());
    check(
      "a clicked sync lands with a pulse on the status dot",
      clicked.some((p) => p.on === "dot" && p.scale === "0.4>1" && p.ms === 200) &&
        clicked.some((p) => p.on === "::after" && p.scale === "1>2.6" && p.ms === 400),
      JSON.stringify(clicked),
    );
    await stage("outgoing");
    const pushed = await pulsesDuring(() => page.locator('.sync-actions .btn-primary:has-text("Push")').click());
    check("a clicked push lands with a pulse", pushed.length === 2, JSON.stringify(pushed));
    await stage("clean");
    await closeAll();
    const fetchesBefore = await page.evaluate(() => window.__fetches);
    const keyed = await pulsesDuring(() => page.keyboard.press("Meta+Shift+s"));
    const fetched = (await page.evaluate(() => window.__fetches)) - fetchesBefore;
    check(
      "a sync from the keyboard lands without a pulse",
      fetched === 1 && keyed.length === 0,
      `${fetched} ${JSON.stringify(keyed)}`,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stage("incoming");
    const still = await pulsesDuring(() => page.locator(".sync-actions .btn-primary").click());
    check("Reduce Motion keeps the dot still when a sync lands", still.length === 0, JSON.stringify(still));
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await closeAll();
  }
  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  check("the suite finished", false, String(error).split("\n")[0]);
} finally {
  await browser.close();
  await app.close();
}
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.join("\n")}\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
