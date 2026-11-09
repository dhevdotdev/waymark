// Fails when a source file outgrows its budget or a module imports across a layer it must not depend on.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAX_LINES = Number(process.env.WAYMARK_MAX_LINES ?? 650);
const OVERSIZE_ALLOWED = new Set(JSON.parse(process.env.WAYMARK_OVERSIZE ?? "[]"));

/** A layer may import only itself and the layers listed for it. */
const LAYERS = {
  vault: [],
  render: ["vault"],
  platform: ["vault"],
  prefs: ["platform"],
  themes: [],
  ui: ["vault", "render", "platform", "prefs", "themes"],
  selftest: ["ui", "platform", "vault", "selftest-recovery"],
  "selftest-recovery": ["ui", "platform", "vault"],
  main: ["ui", "vault", "platform", "selftest"],
};

const DOM_FREE = ["vault"];
const DOM_GLOBAL = /\b(document|window|localStorage|navigator)\./;

const layerOf = (rel) => {
  const first = rel.split("/")[0].replace(/\.ts$/, "");
  return first in LAYERS ? first : null;
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : /\.(ts|rs)$/.test(e.name) ? [full] : [];
  });

const problems = [];
const sources = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "src-tauri/src"))];

for (const file of sources) {
  const text = readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  const lines = text.split("\n").length;
  for (const [index, line] of text.split("\n").entries()) {
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line) && !/\b(TODO|FIXME|HACK|XXX)\(#\d+\)/.test(line)) {
      problems.push(`${rel}:${index + 1}: cite an issue, as in TODO(#12)`);
    }
  }
  if (lines > MAX_LINES && !OVERSIZE_ALLOWED.has(rel)) problems.push(`${rel}: ${lines} lines, over the budget of ${MAX_LINES}`);
  if (!rel.startsWith("src/") || rel.endsWith(".d.ts")) continue;

  const inner = rel.slice("src/".length);
  const layer = layerOf(inner);
  if (!layer) {
    problems.push(`${rel}: not in a known layer; add it to LAYERS in scripts/check-architecture.mjs`);
    continue;
  }
  if (DOM_FREE.includes(layer) && DOM_GLOBAL.test(text)) problems.push(`${rel}: the ${layer} layer must not touch the DOM`);
  for (const m of text.matchAll(/from "(\.[^"]+)"|import\("(\.[^"]+)"\)/g)) {
    const target = path.relative(path.join(ROOT, "src"), path.resolve(path.dirname(file), m[1] ?? m[2]));
    const to = layerOf(target);
    if (to && to !== layer && !LAYERS[layer].includes(to))
      problems.push(`${rel}: ${layer} must not import ${to} (${m[1] ?? m[2]})`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`architecture ok: ${sources.length} files`);
