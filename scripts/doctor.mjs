// Reports whether this checkout can run its checks and the app, and exits non-zero if it cannot.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { webkit } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 5178;

const version = (cmd, args = ["--version"]) => {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .split("\n")[0];
  } catch {
    return null;
  }
};

const portFree = () =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(PORT, () => probe.close(() => resolve(true)));
  });

const checks = [
  ["node", version("node"), "install Node 24 or newer"],
  ["pnpm", version("pnpm"), "enable pnpm with corepack"],
  ["git", version("git"), "install git"],
  ["cargo", version("cargo"), "install Rust with rustup, then: source $HOME/.cargo/env"],
  ["dependencies", existsSync(path.join(ROOT, "node_modules/.bin/vite")) ? "installed" : null, "run: pnpm bootstrap"],
  ["webkit", existsSync(webkit.executablePath()) ? "installed" : null, "run: pnpm exec playwright install webkit"],
  [`port ${PORT}`, (await portFree()) ? "free" : null, "a dev server is already running; stop the one you started"],
];

let failed = 0;
for (const [name, found, fix] of checks) {
  if (!found) failed += 1;
  console.log(`${found ? "ok  " : "FAIL"}  ${name}: ${found ?? fix}`);
}
const bundle = path.join(ROOT, "src-tauri/target/release/bundle/macos/Waymark.app/Contents/MacOS/waymark");
console.log(`note  packaged app: ${existsSync(bundle) ? "built" : "not built; run: pnpm tauri build --bundles app"}`);
process.exit(failed ? 1 : 0);
