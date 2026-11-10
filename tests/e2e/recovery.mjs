// Restoring a past version, comparing both sides of a conflict, and remembering where reading stopped.
// Mutates only the throwaway fixture vault. Git is simulated because the browser build has no backend for it;
// tests/native/run.mjs exercises the same flows against real repositories in the packaged app.
import { existsSync, readdirSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { webkit } from "playwright";
import { NOTES } from "./fixture-vault.mjs";
import { fetchRoute } from "./route-fetch.mjs";
import { serveFixture } from "./serve.mjs";

const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);

function installFakeGit() {
  const clean = {
    isRepo: true,
    branch: "main",
    head: "abc1234",
    upstream: null,
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    files: [],
    operation: null,
  };
  window.__git = { status: clean, older: "The older text.\n", fail: false, calls: [] };
  const record =
    (name, value) =>
    (...args) => {
      window.__git.calls.push(name);
      return Promise.resolve(typeof value === "function" ? value(...args) : value);
    };
  const commit = {
    sha: "a".repeat(40),
    short: "aaaaaaa",
    author: "Fixture",
    date: "2026-10-01T09:00:00Z",
    subject: "An older commit",
    path: null,
  };
  window.__fakeGit = {
    status: record("status", () => window.__git.status),
    fetch: record("fetch", () => window.__git.status),
    log: record("log", (p) => (p ? [commit] : [commit])),
    show: record("show", () => "diff --git a/n.md b/n.md\n--- a/n.md\n+++ b/n.md\n@@ -1 +1 @@\n-a\n+b\n"),
    diff: record("diff", ""),
    diffRevs: record("diffRevs", ""),
    fileAt: () => {
      window.__git.calls.push("fileAt");
      return window.__git.fail
        ? Promise.reject(new Error("fatal: path does not exist in that commit"))
        : Promise.resolve(window.__git.older);
    },
  };
}

const DESKTOP_MODULES = /\/src\/ui\/(sync-controller|note-history|note-files|reader-commands|settings)\.ts/;

async function routeGit(page) {
  await page.route(/\/src\/platform\.ts/, async (route) => {
    const response = await fetchRoute(route);
    if (!response) return;
    await route.fulfill({ response, body: `${await response.text()}\n;Object.assign(git, window.__fakeGit ?? {});\n` });
  });
  await page.route(DESKTOP_MODULES, async (route) => {
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
}

const browser = await webkit.launch();
const app = await serveFixture();
const file = (name) => path.join(app.vault, name);
const disk = (name) => readFile(file(name), "utf8");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LONG = `${Array.from({ length: 90 }, (_, i) => `Paragraph number ${i} has enough words in it to take up a real line of the page.`).join("\n\n")}\n`;

const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(installFakeGit);
await routeGit(page);

const load = async (note) => {
  await page.goto(`${app.url}?note=${encodeURIComponent(note)}`);
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  await pause(350);
};
const lastToast = () => page.evaluate(() => [...document.querySelectorAll(".toast")].at(-1)?.textContent ?? "");
const setStatus = (files) =>
  page.evaluate((list) => {
    window.__git.status = { ...window.__git.status, files: list };
  }, files);
const openHistorySheet = async () => {
  await page.click('[data-rail="info"]');
  await page.waitForSelector(".rail-commit");
  await page.locator(".rail-commit", { hasText: "An older commit" }).first().click();
  await page.waitForSelector(".sheet");
};
const restoreClick = async () => {
  await openHistorySheet();
  await page.locator('.sheet button:has-text("Restore this version")').click();
  await pause(350);
};
const typeInEditor = async (text) => {
  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
  await page.keyboard.type(text);
};

try {
  /* ---- Restore a past version ---- */
  await writeFile(file("Restore.md"), "The current text.\n");
  await load("Restore");
  await restoreClick();
  check("a committed note restores without asking", (await page.locator(".prompt, .confirm").count()) === 0);
  check("the old text is written to the working file", (await disk("Restore.md")) === "The older text.\n");
  check("the sheet closes", (await page.locator(".sheet").count()) === 0);
  check("Read shows the restored text", (await page.textContent(".doc")).includes("The older text."));
  check("it says the change is uncommitted", (await lastToast()).includes("uncommitted"), await lastToast());
  const calls = await page.evaluate(() => window.__git.calls);
  check(
    "no Git command that changes history ran",
    !calls.some((c) => /reset|checkout|stash|commit|fastForward|push/.test(c)),
    calls.join(),
  );

  await writeFile(file("Restore edit.md"), "Editing this text.\n");
  await load("Restore edit");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(200);
  await restoreClick();
  check("an open editor follows the restore", (await page.locator(".cm-content").textContent()).includes("The older text."));
  await pause(700);
  check("the editor holds no leftover save", (await disk("Restore edit.md")) === "The older text.\n");
  await page.keyboard.press("Meta+e");
  await pause(300);

  await writeFile(file("Dirty.md"), "Work not committed.\n");
  await load("Dirty");
  await setStatus([{ path: "Dirty.md", origPath: null, staged: ".", unstaged: "M", conflicted: false }]);
  await restoreClick();
  check("uncommitted work asks first", await page.locator('button:has-text("Save a copy and restore")').isVisible());
  await page.keyboard.press("Escape");
  await pause(300);
  check("cancelling changes nothing", (await disk("Dirty.md")) === "Work not committed.\n");
  check("cancelling leaves no copy", !readdirSync(app.vault).some((f) => f.startsWith("Dirty (before restore")));
  await restoreClick();
  await page.locator('button:has-text("Save a copy and restore")').click();
  await pause(400);
  const copies = readdirSync(app.vault).filter((f) => f.startsWith("Dirty (before restore"));
  check(
    "the uncommitted text is kept as a copy",
    copies.length === 1 && (await disk(copies[0])) === "Work not committed.\n",
    copies.join(),
  );
  check("then the older text is in place", (await disk("Dirty.md")) === "The older text.\n");
  check("the toast names the copy", (await lastToast()).includes("before restore"), await lastToast());
  await setStatus([]);

  await writeFile(file("Unsaved.md"), "Saved base.\n");
  await load("Unsaved");
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(200);
  await page.route("**/@vault/write", (route) => route.abort());
  await typeInEditor(" typed but not saved");
  await pause(600);
  await restoreClick();
  check("an unsaved editor asks first", await page.locator('button:has-text("Save a copy and restore")').isVisible());
  await page.unroute("**/@vault/write");
  await page.locator('button:has-text("Save a copy and restore")').click();
  await pause(500);
  const unsavedCopies = readdirSync(app.vault).filter((f) => f.startsWith("Unsaved (before restore"));
  check(
    "the unsaved typing is in the copy",
    unsavedCopies.length === 1 && (await disk(unsavedCopies[0])).includes("typed but not saved"),
  );
  check("the editor shows the restored text", (await page.locator(".cm-content").textContent()).includes("The older text."));
  await page.keyboard.press("Meta+e");
  await pause(300);

  await writeFile(file("Binary.md"), "Plain now.\n");
  await load("Binary");
  await page.evaluate(() => {
    window.__git.older = "bad\u0000bytes";
  });
  await restoreClick();
  check("a binary revision is refused", (await disk("Binary.md")) === "Plain now.\n");
  check("it explains why", (await lastToast()).includes("not plain text"), await lastToast());
  await page.evaluate(() => {
    window.__git.older = "The older text.\n";
    window.__git.fail = true;
  });
  await restoreClick();
  check("a revision that cannot be read changes nothing", (await disk("Binary.md")) === "Plain now.\n");
  check("the failure is reported", (await lastToast()).includes("could not be read"), await lastToast());
  check("the sheet stays open so another version can be tried", await page.locator(".sheet").isVisible());
  await page.keyboard.press("Escape");
  await pause(300);
  await page.evaluate(() => {
    window.__git.fail = false;
    window.__git.older = "Plain now.\n";
  });
  await restoreClick();
  check("a version that already matches writes nothing", (await lastToast()).includes("already matches"), await lastToast());

  await writeFile(file("Gone.md"), "About to vanish.\n");
  await load("Gone");
  await page.evaluate(() => {
    window.__git.older = "The older text.\n";
  });
  await openHistorySheet();
  await unlink(file("Gone.md"));
  await page.locator('.sheet button:has-text("Restore this version")').click();
  await pause(400);
  check("a note deleted meanwhile comes back with the old text", (await disk("Gone.md")) === "The older text.\n");

  /* ---- Compare both sides of a conflict ---- */
  const startConflict = async (name, mine = "mine ") => {
    await writeFile(file(`${name}.md`), `# ${name}\n\nbase text\n\nsecond paragraph\n`);
    await load(name);
    await page.keyboard.press("Meta+e");
    await page.waitForSelector(".cm-content");
    await pause(200);
    await writeFile(file(`${name}.md`), `# ${name}\n\ntheirs text\n\nsecond paragraph\n`);
    await page.locator(".cm-line", { hasText: "base text" }).click();
    await page.keyboard.type(mine);
    await page.waitForFunction(() => document.querySelector(".edit-state")?.dataset.state === "conflict", null, {
      timeout: 5000,
    });
    await pause(100);
  };
  const trashed = (needle) => {
    const dir = file(".dev-trash");
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.includes(needle)) : [];
  };

  await startConflict("Compare one");
  await page.click('.edit-banner button:has-text("Compare")');
  await page.waitForSelector(".sheet .diff-line");
  const removed = await page.locator(".sheet .diff-line.is-del").allTextContents();
  const added = await page.locator(".sheet .diff-line.is-add").allTextContents();
  check("the other side is shown as removed", removed.join().includes("theirs text"), removed.join());
  check("my side is shown as added", added.join().includes("mine"), added.join());
  check(
    "the comparison cannot be edited",
    (await page.locator(".sheet [contenteditable=true], .sheet textarea, .sheet input").count()) === 0,
  );
  check("it labels which side is which", (await page.textContent(".compare-key")).includes("Only in yours"));
  await page.keyboard.press("Escape");
  await pause(300);
  check("closing the comparison decides nothing", (await disk("Compare one.md")).includes("theirs text"));
  check("the editor still has my text", (await page.locator(".cm-content").textContent()).includes("mine"));
  await page.click('.edit-banner button:has-text("Compare")');
  await page.waitForSelector(".sheet .diff-line");
  await page.click('.sheet button:has-text("Use other version")');
  await pause(500);
  check("using the other version leaves the file alone", (await disk("Compare one.md")).includes("theirs text"));
  check("the editor shows the other version", (await page.locator(".cm-content").textContent()).includes("theirs text"));
  const mineInTrash = trashed("Compare one (my version");
  check(
    "my version went to the Trash",
    mineInTrash.length === 1 && (await readFile(path.join(file(".dev-trash"), mineInTrash[0]), "utf8")).includes("mine"),
  );
  check("the conflict is over", !(await page.locator(".edit-banner").isVisible()));
  await page.keyboard.press("Meta+e");
  await pause(300);

  await startConflict("Compare two");
  await page.click('.edit-banner button:has-text("Keep mine")');
  await pause(500);
  check("keep mine writes my text", (await disk("Compare two.md")).includes("mine"));
  const otherInTrash = trashed("Compare two (other version");
  check(
    "the replaced version went to the Trash",
    otherInTrash.length === 1 && (await readFile(path.join(file(".dev-trash"), otherInTrash[0]), "utf8")).includes("theirs text"),
  );
  await page.keyboard.press("Meta+e");
  await pause(300);

  await startConflict("Compare three");
  await page.click('.edit-banner button:has-text("Compare")');
  await page.waitForSelector(".sheet .diff-line");
  await page.click('.sheet button:has-text("Keep both")');
  await pause(500);
  const both = readdirSync(app.vault).filter((f) => f.startsWith("Compare three (conflict"));
  check("keep both from the comparison saves my copy", both.length === 1 && (await disk(both[0])).includes("mine"));
  check("keep both leaves the other version in place", (await disk("Compare three.md")).includes("theirs text"));
  await page.keyboard.press("Meta+e");
  await pause(300);

  await startConflict("Compare four");
  await page.route("**/@vault/keep-in-trash", (route) => route.fulfill({ status: 500, body: "no" }));
  await page.click('.edit-banner button:has-text("Keep mine")');
  await pause(500);
  check("if the replaced text cannot be kept, nothing is overwritten", (await disk("Compare four.md")).includes("theirs text"));
  check("and the conflict stays open", await page.locator(".edit-banner").isVisible());
  await page.click('.edit-banner button:has-text("Compare")');
  await page.waitForSelector(".sheet .diff-line");
  await page.click('.sheet button:has-text("Use other version")');
  await pause(500);
  check(
    "using the other side keeps my text when the Trash fails",
    (await page.locator(".cm-content").textContent()).includes("mine"),
  );
  await page.unroute("**/@vault/keep-in-trash");
  await page.keyboard.press("Meta+e");
  await pause(500);

  await startConflict("Compare five");
  await unlink(file("Compare five.md"));
  await page.click('.edit-banner button:has-text("Compare")');
  await pause(400);
  check(
    "comparing a deleted note says so",
    (await page.textContent(".edit-banner")).includes("moved or deleted"),
    await page.textContent(".edit-banner"),
  );
  check("my text survives the deletion", (await page.locator(".cm-content").textContent()).includes("mine"));
  await page.click('.edit-banner button:has-text("Save it here again")');
  await pause(500);
  check("it can be saved back", (await disk("Compare five.md")).includes("mine"));
  await page.keyboard.press("Meta+e");
  await pause(300);

  /* ---- Remember where reading stopped ---- */
  await writeFile(file("Long read.md"), LONG);
  await load("Long read");
  const before = await disk("Long read.md");
  const openByPalette = async (query) => {
    await page.keyboard.press("Meta+k");
    await pause(120);
    await page.keyboard.type(query);
    await pause(150);
    await page.keyboard.press("Enter");
    await pause(100);
  };
  const scrollTo = (top) => page.evaluate((v) => document.querySelector(".scroller").scrollTo({ top: v }), top);
  const topBlock = () =>
    page.evaluate(() => {
      const scroller = document.querySelector(".scroller");
      const edge = scroller.getBoundingClientRect().top;
      const block = [...document.querySelectorAll(".doc [data-line]")].find((b) => b.getBoundingClientRect().bottom > edge);
      return {
        line: Number(block?.dataset.line),
        top: Math.round(block?.getBoundingClientRect().top ?? 0),
        scroll: scroller.scrollTop,
      };
    });
  await scrollTo(2400);
  await pause(450);
  const stopped = await topBlock();
  await openByPalette("Starter feeding");
  await pause(300);
  await page.evaluate(() => {
    window.__seen = [];
    new MutationObserver(() => {
      const scroller = document.querySelector(".scroller");
      const tick = () => {
        window.__seen.push(scroller.scrollTop);
        if (window.__seen.length < 40) requestAnimationFrame(tick);
      };
      if (!window.__seen.length && document.querySelector(".doc-title")?.textContent.includes("Long read")) tick();
    }).observe(document.querySelector(".scroller"), { childList: true });
  });
  await openByPalette("Long read");
  await pause(800);
  const back = await topBlock();
  check("reopening a note goes back to where reading stopped", back.line === stopped.line, `${stopped.line} vs ${back.line}`);
  check("to the same height", Math.abs(back.top - stopped.top) <= 2, `${stopped.top} vs ${back.top}`);
  const seen = await page.evaluate(() => window.__seen);
  check(
    "the view never shows the top of the note first",
    seen.length > 0 && seen.every((v) => Math.abs(v - seen[0]) <= 1),
    seen.slice(0, 6).join(),
  );

  const prefsText = await page.evaluate(() => localStorage.getItem("waymark.prefs"));
  check("the place is kept in the app's own storage", prefsText.includes('"Long read.md"') && prefsText.includes('"spots"'));
  check("the note's file is untouched", (await disk("Long read.md")) === before);

  await page.evaluate(() => window.waymark.reader.spots.record());
  await page.evaluate(() => window.waymark.prefs.flush());
  await page.reload();
  await page.waitForFunction(() => window.waymark?.metrics.indexMs > 0);
  const settledOn = async (line) => {
    for (let i = 0; i < 40 && (await topBlock()).line !== line; i++) await pause(150);
    return topBlock();
  };
  const relaunched = await settledOn(stopped.line);
  check("the place survives a relaunch", relaunched.line === stopped.line, `${stopped.line} vs ${relaunched.line}`);

  await page.click('[data-act="new-tab"]');
  await pause(120);
  await page.keyboard.type("Long read");
  await pause(150);
  await page.keyboard.press("Enter");
  check("a note closed and opened in a new tab returns there", (await settledOn(stopped.line)).line === stopped.line);

  await writeFile(file("Anchored.md"), `${LONG}\n## Target heading\n\nEnd of the note.\n\n${LONG}`);
  await writeFile(file("Links in.md"), "Go to [[Anchored#Target heading]].\n");
  await load("Anchored");
  await pause(200);
  await scrollTo(1500);
  await pause(450);
  await load("Links in");
  await page.click(".doc a.wikilink");
  await pause(700);
  const headingTop = await page.evaluate(() => {
    const heading = [...document.querySelectorAll(".doc h2")].find((h) => h.textContent.includes("Target heading"));
    return Math.round(heading.getBoundingClientRect().top - document.querySelector(".scroller").getBoundingClientRect().top);
  });
  check("a heading link still goes to the heading", headingTop >= 0 && headingTop < 200, String(headingTop));

  await load("Long read");
  await scrollTo(1800);
  await pause(450);
  await load("Links in");
  await page.keyboard.press("Meta+Shift+f");
  await pause(150);
  await page.keyboard.type("Paragraph number 77");
  await pause(500);
  await page.locator(".search-hit", { hasText: "Long read" }).first().click();
  await pause(700);
  const matchShown = await page.evaluate(() => {
    const scroller = document.querySelector(".scroller").getBoundingClientRect();
    const hit = [...document.querySelectorAll(".doc p")].find((p) => p.textContent.includes("Paragraph number 77"));
    const box = hit.getBoundingClientRect();
    return box.top >= scroller.top && box.bottom <= scroller.bottom;
  });
  check("a search match still goes to the match", matchShown);

  await writeFile(file("Shrinks.md"), LONG);
  await load("Shrinks");
  await scrollTo(3200);
  await pause(450);
  await openByPalette("Starter feeding");
  await pause(300);
  await writeFile(file("Shrinks.md"), "Only one short paragraph is left.\n\nAnd one more.\n");
  await page.evaluate(() => window.waymark.reader.onVaultChanged(["Shrinks.md"]));
  await pause(200);
  await openByPalette("Shrinks");
  await pause(500);
  const shrunk = await page.evaluate(() => {
    const scroller = document.querySelector(".scroller");
    return {
      top: scroller.scrollTop,
      max: scroller.scrollHeight - scroller.clientHeight,
      text: document.querySelector(".doc").textContent,
    };
  });
  check(
    "a note that got shorter opens without error",
    shrunk.top <= shrunk.max + 1 && shrunk.text.includes("And one more"),
    JSON.stringify([shrunk.top, shrunk.max]),
  );

  await load("Long read");
  await scrollTo(0);
  await pause(450);
  await page.evaluate(() => window.waymark.reader.spots.record());
  check(
    "reading back to the top forgets the place",
    !(await page.evaluate(() => JSON.stringify(window.waymark.prefs.value))).includes('"Long read.md":{"line"'),
  );

  await scrollTo(1500);
  await pause(450);
  await page.keyboard.press("Meta+e");
  await page.waitForSelector(".cm-content");
  await pause(400);
  await page.evaluate(() => document.querySelector(".scroller").scrollBy({ top: 600 }));
  await pause(500);
  const editStop = await page.evaluate(() => JSON.parse(JSON.stringify(window.waymark.prefs.value)));
  const stored = Object.values(editStop.vaults)[0].spots?.["Long read.md"];
  check("scrolling in Edit moves the place too", Number.isFinite(stored?.line) && stored.line > 0, JSON.stringify(stored));
  await page.keyboard.press("Meta+e");
  await pause(300);

  await writeFile(file("Moved spot.md"), LONG);
  await load("Moved spot");
  await scrollTo(1500);
  await pause(450);
  await page.evaluate(() => window.waymark.reader.files.renameTo("Moved spot.md", "Renamed spot"));
  await pause(400);
  const movedPrefs = await page.evaluate(() => JSON.stringify(window.waymark.prefs.value));
  check("a renamed note keeps its place", movedPrefs.includes('"Renamed spot.md":{"line"'));
  check("no status property was added to any note", !(await disk("Long read.md")).includes("status:"));

  check("hero fixture note still opens", Boolean(NOTES.hero));
  check("nothing threw", errors.length === 0, errors[0]);
} catch (error) {
  results.push(`FAIL  the run stopped: ${String(error).split("\n").slice(0, 8).join(" | ").slice(0, 700)}`);
} finally {
  await browser.close();
  await app.close();
}

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
