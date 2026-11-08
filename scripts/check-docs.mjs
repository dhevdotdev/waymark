// Fails when AGENTS.md names a command or file that no longer exists, or when the Tauri packages drift apart.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const problems = [];

const pkg = JSON.parse(read("package.json"));
for (const doc of ["AGENTS.md", "ARCHITECTURE.md", "README.md", "docs/runbook.md"]) {
  const text = read(doc);
  for (const [, script] of text.matchAll(/`pnpm (?:run )?([a-z][\w:-]*)/g)) {
    const builtIn = ["install", "tauri", "exec"].includes(script);
    if (!builtIn && !(script in pkg.scripts)) problems.push(`${doc}: pnpm ${script} is not a script in package.json`);
  }
  for (const [, file] of text.matchAll(/`((?:src|tests|scripts|docs|src-tauri|\.agents)\/[\w./-]+\.\w+|[A-Z]+\.md)`/g)) {
    if (!existsSync(path.join(ROOT, file))) problems.push(`${doc}: ${file} does not exist`);
  }
}

const minor = (version) =>
  version
    .replace(/^[^\d]*/, "")
    .split(".")
    .slice(0, 2)
    .join(".");
const lock = read("src-tauri/Cargo.lock");
const rustTauri = /name = "tauri"\nversion = "([^"]+)"/.exec(lock)?.[1];
const jsTauri = pkg.dependencies["@tauri-apps/api"];
if (rustTauri && minor(rustTauri) !== minor(jsTauri)) {
  problems.push(`Tauri versions differ: crate ${rustTauri}, @tauri-apps/api ${jsTauri}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("docs ok");
