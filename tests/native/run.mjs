// Runs the packaged app's self-test against disposable vaults and fails on any failed check.
// Usage: node tests/native/run.mjs [read|git|diverged|blocked ...]
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFixtureVault } from "../e2e/fixture-vault.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP = path.join(ROOT, "src-tauri/target/release/bundle/macos/Waymark.app/Contents/MacOS/folio");
const TIMEOUT_MS = 180_000;

const git = (cwd, ...args) =>
  execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdio: "pipe" },
  );

async function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", message);
}

/** A clone whose remote has one more commit than the clone has fetched. */
async function vaultBehindRemote(base) {
  const remote = path.join(base, "remote.git");
  const seed = path.join(base, "seed");
  const local = path.join(base, "vault");
  git(base, "init", "-q", "--bare", "-b", "main", remote);
  git(base, "clone", "-q", remote, seed);
  git(seed, "checkout", "-q", "-b", "main");
  await writeFile(path.join(seed, "Welcome.md"), "# Welcome\n\nThe first version.\n");
  await commitAll(seed, "first");
  git(seed, "push", "-q", "-u", "origin", "main");
  git(base, "clone", "-q", remote, local);
  await writeFile(path.join(seed, "Welcome.md"), "# Welcome\n\nThis was updated remotely.\n");
  await commitAll(seed, "remote change");
  git(seed, "push", "-q");
  return local;
}

const SETUP = {
  async read(base) {
    const vault = path.join(base, "vault");
    git(base, "init", "-q", "-b", "main", vault);
    await writeFixtureVault(vault);
    await commitAll(vault, "fixture");
    return vault;
  },
  git: vaultBehindRemote,
  async diverged(base) {
    const vault = await vaultBehindRemote(base);
    await writeFile(path.join(vault, "Local.md"), "A local note.\n");
    await commitAll(vault, "local change");
    return vault;
  },
  async blocked(base) {
    const vault = await vaultBehindRemote(base);
    await writeFile(path.join(vault, "Welcome.md"), "# Welcome\n\nmy local edit\n");
    return vault;
  },
};

function launch(vault, mode, out) {
  return new Promise((resolve, reject) => {
    const child = spawn(APP, [], {
      env: { ...process.env, FOLIO_SELFTEST_OUT: out, FOLIO_SELFTEST_VAULT: vault, FOLIO_SELFTEST_MODE: mode },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let failed = 0;
for (const mode of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SETUP)) {
  const base = await mkdtemp(path.join(tmpdir(), "waymark-native-"));
  try {
    const out = path.join(base, "report.json");
    await launch(await SETUP[mode](base), mode, out);
    const report = JSON.parse(await readFile(out, "utf8"));
    const bad = report.results.filter((r) => !r.ok);
    failed += bad.length;
    console.log(
      `${bad.length ? "FAIL" : "PASS"}  ${mode}: ${report.results.length - bad.length}/${report.results.length}${report.render ? ` p50=${report.render.p50}ms p95=${report.render.p95}ms` : ""}`,
    );
    for (const r of bad) console.log(`  FAIL ${r.name} ${JSON.stringify(r.detail ?? "")}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${mode}: ${err.message}`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
