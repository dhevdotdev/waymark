// Compares every surface pixel by pixel against another commit, on the fixture vault.
// Usage: node tests/e2e/visual.mjs [ref] [outDir]. Exits non-zero if any surface differs.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { webkit } from "playwright";
import { NOTES, writeFixtureVault } from "./fixture-vault.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const URL = "http://localhost:5178/";
const COLOUR_TOLERANCE = 12;
const [ref = "main", outArg] = process.argv.slice(2);
const work = mkdtempSync(path.join(tmpdir(), "waymark-visual-"));
const out = outArg ?? path.join(work, "shots");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function capture(page, dir, scheme) {
  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.mouse.move(2, 450);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(dir, `${scheme}-${name}.png`) });
  };
  await page.goto(`${URL}?note=${encodeURIComponent(NOTES.hero)}`);
  await page.waitForSelector(".diagram-svg svg");
  await page.waitForTimeout(1500);
  await shot("reading");
  await page.evaluate(() => document.querySelector(".scroller").scrollTo({ top: 1400 }));
  await shot("scrolled");
  await page.evaluate(() => document.querySelector(".scroller").scrollTo({ top: 0 }));
  await page.click('[data-rail="links"]');
  await shot("links");
  await page.click('[data-rail="info"]');
  await shot("info");
  await page.click('[data-rail="links"]');
  await page.keyboard.press("Meta+k");
  await shot("palette");
  await page.keyboard.type("tide");
  await shot("palette-query");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+Shift+f");
  await page.keyboard.type("cold retard");
  await shot("search");
  await page.keyboard.press("Escape");
  await page.click('[data-act="settings"]');
  await shot("settings");
  await page.keyboard.press("Escape");
  await page.click(`.doc a.wikilink[data-path$="${NOTES.starter}.md"]`);
  await page.waitForTimeout(300);
  await page.click(`.doc a.wikilink[data-path$="${NOTES.hero}.md"]`);
  await shot("trail");
  await page.keyboard.press("Meta+g");
  await page.waitForTimeout(1600);
  await shot("graph");
}

async function captureFrom(cwd, dir) {
  mkdirSync(dir, { recursive: true });
  const vault = mkdtempSync(path.join(work, "vault-"));
  await writeFixtureVault(vault);
  const server = spawn("npx", ["vite"], {
    cwd,
    env: { ...process.env, WAYMARK_VAULT: vault, FOLIO_VAULT: vault },
    stdio: "ignore",
    detached: true,
  });
  try {
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(URL).then(
          () => true,
          () => false,
        )
      )
        break;
      await pause(200);
    }
    const browser = await webkit.launch();
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: scheme,
        reducedMotion: "reduce",
      });
      await capture(await context.newPage(), dir, scheme);
      await context.close();
    }
    await browser.close();
  } finally {
    process.kill(-server.pid);
    await pause(1000);
  }
}

async function countDifferences(before, after) {
  const browser = await webkit.launch();
  const page = await browser.newPage();
  const results = [];
  for (const file of readdirSync(before).filter((name) => name.endsWith(".png"))) {
    const images = [readFileSync(path.join(before, file)), readFileSync(path.join(after, file))].map((b) => b.toString("base64"));
    const differing = await page.evaluate(
      async ([a, b, tolerance]) => {
        const pixels = async (data) => {
          const image = new Image();
          await new Promise((resolve) => {
            image.onload = resolve;
            image.src = `data:image/png;base64,${data}`;
          });
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, image.width, image.height).data;
        };
        const [p, q] = await Promise.all([pixels(a), pixels(b)]);
        if (p.length !== q.length) return -1;
        let count = 0;
        for (let i = 0; i < p.length; i += 4) {
          if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > tolerance) count++;
        }
        return count;
      },
      [...images, COLOUR_TOLERANCE],
    );
    results.push([file, differing]);
  }
  await browser.close();
  return results;
}

const baseline = path.join(work, "baseline");
try {
  execFileSync("git", ["worktree", "add", "-q", "--detach", baseline, ref], { cwd: ROOT, stdio: "pipe" });
  execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: baseline, stdio: "pipe" });
  await captureFrom(baseline, path.join(out, "before"));
  await captureFrom(ROOT, path.join(out, "after"));
  const results = await countDifferences(path.join(out, "before"), path.join(out, "after"));
  for (const [file, differing] of results) console.log(`${differing === 0 ? "same" : "DIFF"}  ${file}  ${differing}`);
  const changed = results.filter(([, differing]) => differing !== 0).length;
  console.log(`${results.length - changed} identical, ${changed} changed, compared with ${ref}`);
  process.exitCode = changed ? 1 : 0;
} finally {
  execFileSync("git", ["worktree", "remove", "--force", baseline], { cwd: ROOT, stdio: "pipe" });
  if (!outArg) rmSync(work, { recursive: true, force: true });
}
