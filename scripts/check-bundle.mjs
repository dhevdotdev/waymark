// Fails when the code a reader loads at startup grows past its budget. Run after a Vite build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../dist");
const ENTRY_BUDGET_KB = 1100;
const TOTAL_BUDGET_MB = 14;

const html = readFileSync(path.join(DIST, "index.html"), "utf8");
const entry = /src="\/?(assets\/index-[^"]+\.js)"/.exec(html)?.[1];
if (!entry) throw new Error("No entry script found in dist/index.html");
const entryKb = statSync(path.join(DIST, entry)).size / 1024;

const totalBytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((sum, item) => {
    const full = path.join(dir, item.name);
    return sum + (item.isDirectory() ? totalBytes(full) : statSync(full).size);
  }, 0);
const totalMb = totalBytes(DIST) / 1024 / 1024;

console.log(`entry ${entryKb.toFixed(0)} KB of ${ENTRY_BUDGET_KB}, total ${totalMb.toFixed(1)} MB of ${TOTAL_BUDGET_MB}`);
if (entryKb > ENTRY_BUDGET_KB || totalMb > TOTAL_BUDGET_MB) process.exit(1);
