// Runs the end-to-end suites one at a time. With a shard number, runs that group, so CI can run the groups side by side.
// Usage: node scripts/e2e.mjs [shard]
import { spawnSync } from "node:child_process";

/** Each group runs on its own CI machine. Every suite belongs to exactly one group, so none can be left out. */
const SHARDS = [
  [["tables"], ["blocks"]],
  [["reader"], ["reader", "reduced"], ["edge"], ["dialogs"]],
  [["editing"], ["organize"], ["properties"]],
  [["note-files"], ["recovery"], ["backup"], ["library"]],
];

const wanted = process.argv[2];
const groups = wanted ? [SHARDS[Number(wanted) - 1]] : SHARDS;
if (groups.includes(undefined)) {
  console.error(`No shard ${wanted}: there are ${SHARDS.length}.`);
  process.exit(2);
}

for (const [suite, ...args] of groups.flat()) {
  const started = Date.now();
  const { status } = spawnSync("node", [`tests/e2e/${suite}.mjs`, ...args], { stdio: "inherit" });
  console.log(`-- ${suite} ${args.join(" ")} took ${Math.round((Date.now() - started) / 1000)}s`);
  if (status !== 0) process.exit(status ?? 1);
}
