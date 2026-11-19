// Runs the end-to-end suites one at a time. With a shard number and a shard count, runs that share of them, so CI can run
// the shares side by side.
// Usage: node scripts/e2e.mjs [shard count]
import { spawnSync } from "node:child_process";

/**
 * Every run, with about how many seconds it takes on a CI runner, from the "took" lines a CI log prints. Shares are dealt
 * from these times, so they finish close together. Update a time when a suite grows or shrinks by much.
 */
const RUNS = [
  [["tables", "2"], 95],
  [["tables", "3"], 95],
  [["tables", "1"], 90],
  [["editing"], 68],
  [["reader"], 66],
  [["note-files"], 58],
  [["reader", "reduced"], 57],
  [["recovery"], 49],
  [["navigation-motion"], 42],
  [["organize"], 39],
  [["navigation-motion", "reduced"], 35],
  [["link-tooltips"], 34],
  [["library"], 30],
  [["list-motion"], 29],
  [["mac-behaviours"], 28],
  [["properties"], 26],
  [["graph"], 25],
  [["panel-motion"], 21],
  [["spatial-motion", "reduced"], 20],
  [["folding"], 17],
  [["folding", "reduced"], 17],
  [["surfaces"], 17],
  [["caret"], 16],
  [["surfaces", "reduced"], 16],
  [["blocks"], 15],
  [["missing-links"], 15],
  [["mentions"], 12],
  [["zen"], 12],
  [["zen", "reduced"], 12],
  [["spatial-motion"], 15],
  [["sync"], 15],
  [["graph", "reduced"], 13],
  [["scrolling"], 13],
  [["edge"], 9],
  [["panel-motion", "reduced"], 9],
  [["dialogs"], 7],
  [["search-motion"], 7],
  [["search-motion", "reduced"], 7],
  [["backup"], 3],
];

/** Longest first, each to the share with the least time so far. The same list and count always give the same shares. */
function share(count) {
  const shares = Array.from({ length: count }, () => ({ seconds: 0, runs: [] }));
  for (const [run, seconds] of [...RUNS].sort((a, b) => b[1] - a[1])) {
    const lightest = shares.reduce((min, s) => (s.seconds < min.seconds ? s : min));
    lightest.seconds += seconds;
    lightest.runs.push(run);
  }
  return shares;
}

const [wanted, total] = process.argv.slice(2).map(Number);
let runs = RUNS.map(([run]) => run);
if (process.argv.length > 2) {
  if (!(Number.isInteger(wanted) && wanted >= 1 && Number.isInteger(total) && total >= wanted)) {
    console.error(
      total
        ? `No shard ${process.argv[2]} of ${total}.`
        : `Give the shard count too: node scripts/e2e.mjs ${process.argv[2]} <count>.`,
    );
    process.exit(2);
  }
  const mine = share(total)[wanted - 1];
  console.log(`Shard ${wanted} of ${total}, about ${mine.seconds}s on CI: ${mine.runs.map((r) => r.join(" ")).join(", ")}`);
  runs = mine.runs;
}

for (const [suite, ...args] of runs) {
  const started = Date.now();
  const { status } = spawnSync("node", [`tests/e2e/${suite}.mjs`, ...args], { stdio: "inherit" });
  console.log(`-- ${suite} ${args.join(" ")} took ${Math.round((Date.now() - started) / 1000)}s`);
  if (status !== 0) process.exit(status ?? 1);
}
