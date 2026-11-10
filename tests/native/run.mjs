// Runs the packaged app's self-test against disposable vaults and fails on any failed check.
// Usage: node tests/native/run.mjs [read|git|commit|diverged|blocked ...]
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFixtureVault } from "../e2e/fixture-vault.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP = path.join(ROOT, "src-tauri/target/release/bundle/macos/Waymark.app/Contents/MacOS/waymark");
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

const LIBRARY_BASE = `filters: note.sort-of == "yes"\nviews:\n  - type: table\n    order: [file.name, file.mtime]\n`;

const SETUP = {
  async organize(base) {
    const vault = path.join(base, "vault");
    git(base, "init", "-q", "-b", "main", vault);
    await writeFixtureVault(vault);
    await mkdir(path.join(vault, "Inbox"), { recursive: true });
    await mkdir(path.join(vault, "Archive"), { recursive: true });
    await writeFile(
      path.join(vault, "Plot.md"),
      "# Plot\n\n| Bed | Crop | Sown |\n| --- | --- | ---: |\n| North | Alliums | 12 |\n| East | Legumes | 9 |\n| South | Brassicas | 14 |\n\nAfter.\n",
    );
    await writeFile(path.join(vault, "Inbox/Alpha.md"), "Alpha.\n");
    await writeFile(path.join(vault, "Inbox/Dup.md"), "Inbox copy.\n");
    await writeFile(path.join(vault, "Archive/Dup.md"), "Archive copy.\n");
    await writeFile(path.join(vault, "Refs.md"), "See [[Inbox/Alpha]].\n");
    await commitAll(vault, "fixture");
    return vault;
  },
  async empty(base) {
    const vault = path.join(base, "vault");
    await mkdir(vault, { recursive: true });
    return vault;
  },
  async read(base) {
    const vault = path.join(base, "vault");
    git(base, "init", "-q", "-b", "main", vault);
    await writeFixtureVault(vault);
    await commitAll(vault, "fixture");
    return vault;
  },
  git: vaultBehindRemote,
  commit: vaultBehindRemote,
  async diverged(base) {
    const vault = await vaultBehindRemote(base);
    await writeFile(path.join(vault, "Local.md"), "A local note.\n");
    await commitAll(vault, "local change");
    return vault;
  },
  async restore(base) {
    const vault = path.join(base, "vault");
    git(base, "init", "-q", "-b", "main", vault);
    await writeFixtureVault(vault);
    await writeFile(path.join(vault, "Selftest note.md"), "# Selftest note\n\nThe first text.\n");
    await commitAll(vault, "first version");
    await writeFile(path.join(vault, "Selftest note.md"), "# Selftest note\n\nThe second text.\n");
    await commitAll(vault, "second version");
    return vault;
  },
  backup: vaultBehindRemote,
  async library(base) {
    const vault = path.join(base, "vault");
    git(base, "init", "-q", "-b", "main", vault);
    await writeFixtureVault(vault);
    await mkdir(path.join(vault, ".obsidian"), { recursive: true });
    await writeFile(path.join(vault, ".obsidian/app.json"), JSON.stringify({ userIgnoreFilters: ["Excluded.md"] }));
    await writeFile(path.join(vault, "Excluded.md"), "uniquewordexcluded\n");
    await writeFile(path.join(vault, "Selftest item one.md"), "---\nsort-of: yes\n---\n\nOne.\n");
    await mkdir(path.join(vault, "Views"), { recursive: true });
    await writeFile(path.join(vault, "Views/Items.base"), LIBRARY_BASE);
    await commitAll(vault, "fixture");
    return vault;
  },
  async conflict(base) {
    const vault = path.join(base, "vault");
    git(base, "init", "-q", "-b", "main", vault);
    await writeFixtureVault(vault);
    await commitAll(vault, "fixture");
    return vault;
  },
  async relaunch(base) {
    const vault = path.join(base, "vault");
    git(base, "init", "-q", "-b", "main", vault);
    await writeFixtureVault(vault);
    await writeFile(path.join(vault, "Welcome.md"), "# Welcome\n");
    await writeFile(
      path.join(vault, "Selftest long.md"),
      `${"A long paragraph of reading that fills the page with enough words to wrap.\n\n".repeat(120)}`,
    );
    await commitAll(vault, "fixture");
    return vault;
  },
  async blocked(base) {
    const vault = await vaultBehindRemote(base);
    await writeFile(path.join(vault, "Welcome.md"), "# Welcome\n\nmy local edit\n");
    return vault;
  },
};

/** What must be true on disk afterwards, read with Git itself rather than through the app. */
const VERIFY = {
  async library(base) {
    const vault = path.join(base, "vault");
    if ((await readFile(path.join(vault, "Views/Items.base"), "utf8")) !== LIBRARY_BASE)
      throw new Error("the .base file changed");
    const settings = JSON.parse(await readFile(path.join(vault, ".obsidian/app.json"), "utf8"));
    if (settings.userIgnoreFilters?.[0] !== "Excluded.md") throw new Error("Obsidian's settings changed");
  },
  backup(base) {
    const remote = path.join(base, "remote.git");
    const subjects = execFileSync("git", ["-C", remote, "log", "--format=%s", "main"]).toString().trim().split("\n");
    if (!/^vault backup: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(subjects[0]))
      throw new Error(`remote holds: ${subjects.join(" | ")}`);
    if (!subjects.includes("remote change")) throw new Error("incoming work was lost");
    const merges = execFileSync("git", ["-C", remote, "rev-list", "--merges", "--count", "main"]).toString().trim();
    if (merges !== "0") throw new Error("the backup created a merge");
    const text = execFileSync("git", ["-C", remote, "show", "main:Selftest backup.md"]).toString();
    if (!text.includes("typed just before the run")) throw new Error(`the note on the remote: ${text}`);
  },
  restore(base) {
    const vault = path.join(base, "vault");
    const run = (...args) => execFileSync("git", ["-C", vault, ...args]).toString();
    if (run("rev-list", "--count", "HEAD").trim() !== "2") throw new Error("the history changed");
    if (run("stash", "list").trim()) throw new Error("a stash was created");
    const status = run("status", "--porcelain");
    if (!/ M "?Selftest note\.md/.test(status) || !status.includes("before restore")) throw new Error(`status: ${status}`);
  },
  commit(base) {
    const remote = path.join(base, "remote.git");
    const subject = execFileSync("git", ["-C", remote, "log", "-1", "--format=%s", "main"]).toString().trim();
    const files = execFileSync("git", ["-C", remote, "ls-tree", "--name-only", "main"]).toString();
    if (subject !== "From Waymark" || !files.includes("Written here.md")) throw new Error(`remote holds: ${subject}`);
    const parents = execFileSync("git", ["-C", remote, "log", "-1", "--format=%p", "main"]).toString().trim().split(" ");
    if (parents.length !== 1) throw new Error("the push created a merge");
  },
};

function launch(vault, mode, out, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(APP, [], {
      env: {
        ...process.env,
        ...(home ? { HOME: home } : {}),
        WAYMARK_SELFTEST_OUT: out,
        WAYMARK_SELFTEST_VAULT: vault,
        WAYMARK_SELFTEST_MODE: mode,
      },
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
    const vault = await SETUP[mode](base);
    if (mode === "relaunch") {
      const home = path.join(base, "home");
      await mkdir(home, { recursive: true });
      await launch(vault, "relaunch-1", out, home);
      const first = JSON.parse(await readFile(out, "utf8"));
      if (!first.passed) throw new Error(`first launch failed: ${JSON.stringify(first.results.filter((r) => !r.ok))}`);
      await launch(vault, "relaunch-2", out, home);
    } else {
      await launch(vault, mode, out);
    }
    const report = JSON.parse(await readFile(out, "utf8"));
    await VERIFY[mode]?.(base);
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
