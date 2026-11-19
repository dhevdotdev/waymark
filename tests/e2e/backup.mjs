// The schedule and reporting around the opt-in backup. The Git work itself is proven against real
// repositories in src-tauri/src/git/backup_tests.rs and tests/native/run.mjs.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { watchPageErrors } from "./page-errors.mjs";
import { fetchRoute } from "./route-fetch.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
const MINUTE = 60_000;

function installFakeGit() {
  const status = {
    isRepo: true,
    branch: "main",
    head: "abc",
    upstream: "origin/main",
    remoteUrl: "https://example.invalid/v.git",
    ahead: 0,
    behind: 0,
    files: [],
    operation: null,
  };
  window.__git = { runs: [], reply: { outcome: "ran", committed: true, pushed: true, problem: null, status }, delayMs: 0 };
  window.__fakeGit = {
    status: async () => status,
    fetch: async () => status,
    log: async () => [],
    backup: (message) =>
      new Promise((resolve) => {
        window.__git.runs.push(message);
        setTimeout(() => resolve(window.__git.reply), window.__git.delayMs);
      }),
  };
}

const app = await serveFixture();
await writeFile(path.join(app.vault, "Typing.md"), "Some text.\n");
const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.clock.install();
const errors = [];
watchPageErrors(page, errors);
await page.addInitScript(installFakeGit);
await page.route(/\/src\/platform\.ts/, async (route) => {
  const response = await fetchRoute(route);
  if (!response) return;
  await route.fulfill({ response, body: `${await response.text()}\n;Object.assign(git, window.__fakeGit ?? {});\n` });
});
await page.route(/\/src\/ui\/(sync-controller|settings|note-history|reader|reader-commands)\.ts/, async (route) => {
  const response = await fetchRoute(route);
  if (!response) return;
  const body = (await response.text()).replace(
    /import\s*\{([^}]*)\}\s*from\s*"(\/src\/platform\.ts[^"]*)"/,
    (whole, names, from) =>
      /\bisDesktop\b/.test(names)
        ? `import {${names.replace(/\bisDesktop\b/, "isDesktop as __isDesktop")}} from "${from}";\nconst isDesktop = true`
        : whole,
  );
  await route.fulfill({ response, body });
});

const runs = () => page.evaluate(() => window.__git.runs.length);
const tick = async (minutes = 10) => {
  await page.clock.fastForward(minutes * MINUTE);
  await page.clock.runFor(50);
};
const toasts = () => page.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent));
const label = () => page.textContent(".sync-label");
const reply = (change) =>
  page.evaluate((c) => {
    window.__git.reply = { ...window.__git.reply, ...c };
  }, change);

try {
  await page.goto(`${app.url}?note=Typing`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await page.clock.runFor(800);
  await page.evaluate(() => window.waymark.reader.sync.panel.refresh());
  await page.clock.runFor(50);

  await tick(35);
  check("turned off, nothing ever runs", (await runs()) === 0, String(await runs()));

  await page.click('[data-act="settings"]');
  await page.clock.runFor(300);
  const toggle = page.locator('input[data-pref="backup"]');
  check("there is one control for it", (await toggle.count()) === 1);
  check("it starts off", !(await toggle.isChecked()));
  await toggle.check({ force: true });
  await page.keyboard.press("Escape");
  await page.clock.runFor(300);
  await page.mouse.click(700, 500);
  check("turning it on picks 10 minutes", (await page.evaluate(() => window.waymark.prefs.value.backupMinutes)) === 10);

  await tick(9);
  check("nothing runs before the interval", (await runs()) === 0);
  await tick(1);
  check("the first run comes at 10 minutes", (await runs()) === 1, String(await runs()));
  const message = await page.evaluate(() => window.__git.runs[0]);
  check("the message is in the expected form", /^vault backup: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(message), message);
  check("a routine run is silent", (await toasts()).length === 0, (await toasts()).join());
  await page.click('[data-act="sync-panel"]');
  await page.clock.runFor(400);
  check(
    "the panel says when it ran and that it arrived",
    (await page.textContent(".sync-backup")).includes("on the remote"),
    await page.textContent(".sync-backup"),
  );
  await page.keyboard.press("Escape");
  await page.clock.runFor(300);

  await page.evaluate(() => {
    window.__git.delayMs = 15 * 60_000;
  });
  await tick();
  const during = await runs();
  await tick(1);
  await page.clock.fastForward(9 * MINUTE);
  await page.clock.runFor(50);
  check("only one run happens at a time", (await runs()) === during, `${during} then ${await runs()}`);
  await page.evaluate(() => {
    window.__git.delayMs = 0;
  });
  await page.clock.fastForward(16 * MINUTE);
  await page.clock.runFor(100);

  await reply({ committed: false, pushed: false, outcome: "locked" });
  const lockedBefore = await page.evaluate(() => JSON.stringify(Object.values(window.waymark.prefs.value.vaults)[0]?.lastBackup));
  await tick();
  check("a locked index skips quietly", (await toasts()).length === 0, (await toasts()).join());
  check(
    "a skipped run does not count as a backup",
    (await page.evaluate(() => JSON.stringify(Object.values(window.waymark.prefs.value.vaults)[0]?.lastBackup))) === lockedBefore,
  );
  await reply({ outcome: "ran" });

  const authError = { kind: "auth", message: "Permission denied (publickey)." };
  const status = await page.evaluate(() => window.__git.reply.status);
  await reply({ committed: true, pushed: false, problem: authError, status: { ...status, ahead: 1 } });
  await tick();
  check("a problem shows in the sync indicator", (await label()) === "Sign-in needed", await label());
  const first = await toasts();
  check("a problem is announced", first.length === 1 && first[0].includes("Backup stopped"), first.join());
  await page.clock.runFor(6000);
  await tick();
  await page.clock.runFor(100);
  check("the same problem is not announced again", (await toasts()).length === 0, (await toasts()).join());
  await page.click('[data-act="sync-panel"]');
  await page.clock.runFor(400);
  check(
    "the panel uses the same explanation as manual sync",
    (await page.textContent(".sync-sheet")).includes("The remote refused access"),
  );
  check(
    "the panel says it has not reached the remote",
    (await page.textContent(".sync-backup")).includes("not on the remote yet"),
    await page.textContent(".sync-backup"),
  );
  await page.keyboard.press("Escape");
  await page.clock.runFor(300);

  await reply({ problem: { kind: "offline", message: "Could not resolve host" } });
  await page.clock.runFor(6000);
  await tick();
  check("offline changes the indicator", (await label()) === "Offline", await label());
  check("offline makes no announcement", (await toasts()).length === 0, (await toasts()).join());

  await reply({ committed: false, pushed: true, problem: null, status });
  await tick();
  check("a later good run clears the problem", (await label()) !== "Offline", await label());

  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await page.clock.runFor(300);
  await page.locator(".cm-content").click();
  await page.keyboard.type("typed");
  const beforeTyping = await runs();
  await page.clock.fastForward(10 * MINUTE);
  await page.clock.runFor(50);
  await page.keyboard.type(" more");
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.clock.runFor(800);
  check("a run happens while typing", (await runs()) === beforeTyping + 1, `${beforeTyping} to ${await runs()}`);
  check("typing carries on across a run", (await page.locator(".cm-content").textContent()).includes("typed more"));
  check(
    "a pending edit is saved before the run",
    (await page.evaluate(() => window.waymark.reader.vault.texts.get("Typing.md"))).includes("typed"),
  );

  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  results.push(`FAIL  the run stopped: ${String(error).split("\n").slice(0, 6).join(" | ").slice(0, 600)}`);
} finally {
  await browser.close();
  await app.close();
}

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
