// Writes a synthetic vault for tests. Nothing here comes from a real notes collection.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const TOPICS = [
  ["Apiary", "Beekeeping"],
  ["Atlas", "Cartography"],
  ["Crafts/Clay", "Ceramic glazing"],
  ["Night sky", "Telescope collimation"],
  ["Crafts/Rope", "Knot tying"],
  ["Crafts/Wood", "Wood joinery"],
  ["Outdoors", "Foraging"],
  ["Press room", "Letterpress printing"],
  ["Workshop", "Bicycle repair"],
  ["Pantry", "Cheese aging"],
  ["Outdoors/River", "Fly fishing"],
  ["Crafts/Glass", "Stained glass"],
  ["Outdoors/Sky", "Weather reading"],
  ["Garden", "Seed saving"],
];
const ASPECTS = [
  "basics",
  "tools",
  "common mistakes",
  "seasonal schedule",
  "safety notes",
  "glossary",
  "field log",
  "further reading",
  "troubleshooting",
];

const MERMAID = "```mermaid\nflowchart LR\n  A[Mix] --> B[Rest]\n  B --> C{Ready?}\n  C -->|yes| D[Shape]\n  C -->|no| B\n```";
const FILLER = [
  "Work slowly at first and write down what changed between attempts, because the second try teaches more than the first.",
  "Small differences in temperature show up a day later, so keep the log close and date every entry.",
  "A cheap tool kept clean beats an expensive one left in a drawer, and the habit matters more than the purchase.",
  "When the result surprises you, change one thing at a time until the surprise has a name.",
];
const paragraph = (seed) => [0, 1, 2].map((i) => FILLER[(seed + i) % FILLER.length]).join(" ");

const hero = {
  "Baking/Sourdough/Crumb structure and the overproofing problem.md": `---
aliases: [Open crumb]
tags: [bread, fermentation]
difficulty: medium
---

Dense loaves usually come from timing, not flour. Jump straight to the [[#Fixes]] if the loaf is already baked.

## The problem

${paragraph(0)}

A cold retard slows the yeast more than the bacteria, so a cold retard changes flavour as well as timing. See [[Starter feeding - float test, peak and discard]] and [[Proofing baskets and banneton care]].

${MERMAID}

- Weigh the salt separately
- Mix until no dry flour remains
  - Rest for thirty minutes
- Shape on an unfloured bench

## Measurements

| Stage | Temperature | Hours |
|---|---|---|
| Bulk | 24 °C | 5 |
| Cold retard | 4 °C | 14 |

\`\`\`python
def hydration(water, flour):
    if flour == 0:
        raise BannetonSeamDriftError("no flour weighed")
    return water / flour
\`\`\`

\`\`\`text
┌────────┐    ┌────────┐
│  mix   │───▶│  bulk  │
└────────┘    └────────┘
\`\`\`

> [!warning] Hot steel
> The ==dutch oven lid== stays hot long after the loaf comes out.

${Array.from({ length: 8 }, (_, i) => paragraph(i)).join("\n\n")}

## Fixes

Shorten the bulk by an hour, then extend the cold retard. %%private margin note%% The expansion follows $V = V_0 \\cdot 2^{t/d}$.

${Array.from({ length: 14 }, (_, i) => paragraph(i + 2)).join("\n\n")}
`,
  "Baking/Sourdough/Starter feeding - float test, peak and discard.md": `Feed the starter at the same hour each day. Return to [[Crumb structure and the overproofing problem]] once it doubles.\n\n## Float test\n\n${paragraph(1)}\n\n${paragraph(2)}\n`,
  "Baking/Tools/Proofing baskets and banneton care.md": `Dry the basket fully between bakes. Compare with [[Crumb structure and the overproofing problem]].\n\n## Care\n\n${paragraph(3)}\n`,
  "Sailing/Navigation/Compass declination and magnetic north.md": `Correct every bearing before plotting it.\n\n1. Read the chart rose\n2. Apply [[Tide charts, datums and harbour approach]]\n3. Check against [[Dead reckoning with a paper log]]\n\nAlso useful are [[Leading lines and transit bearings]] and [[Beekeeping basics]].\n\n> [!note]- Why the rose changes\n> The magnetic pole drifts, so old charts need adjusting.\n\n## Deviation\n\n${paragraph(0)}\n\n![[kiln-diagram.png]]\n`,
  "Sailing/Navigation/Tide charts, datums and harbour approach.md": `Heights are measured from chart datum. Plot the [[Compass declination and magnetic north]] first.\n\n## Approach\n\n${paragraph(1)}\n`,
  "Sailing/Navigation/Dead reckoning with a paper log.md": `Log speed and heading every half hour. See [[Compass declination and magnetic north]].\n\n## Log\n\n${paragraph(2)}\n`,
  "Sailing/Navigation/Leading lines and transit bearings.md": `Keep the two marks in line. See [[Compass declination and magnetic north]].\n\n## Marks\n\n${paragraph(3)}\n`,
  "Untrusted content.md": `<script>window.pwned = "script"</script>

<img src="x" onerror="window.pwned = 'img'">

<a href="javascript:window.pwned='link'" id="js-link">a javascript link</a>

<iframe src="https://example.invalid/frame"></iframe>

<video src="https://example.invalid/v.mp4"></video>

<span data-act="close-vault" id="forged">a forged app action</span>

![remote](https://example.invalid/picture.png)

[[A file ../../../etc/passwd]]
`,
  "Welcome.md": `# Welcome\n\nThis vault exists for automated tests. Start at [[Crumb structure and the overproofing problem]].\n\nA link to [[A note that does not exist]] stays visibly missing, and [[Duplicate name]] asks which one you meant.\n`,
  "Baking/Duplicate name.md": "The baking one.\n",
  "Sailing/Duplicate name.md": "The sailing one.\n",
  "A very long note title that keeps going well past the width of any sidebar so that truncation has something to do.md": `${paragraph(0)}\n`,
};

function topicNote(topicIndex, aspectIndex) {
  const [, topic] = TOPICS[topicIndex];
  const name = (a) => `${topic} ${ASPECTS[a]}`;
  const prev = (aspectIndex + ASPECTS.length - 1) % ASPECTS.length;
  const next = (aspectIndex + 1) % ASPECTS.length;
  const seed = topicIndex * 9 + aspectIndex;
  const parts = [
    `See [[${name(prev)}]] and [[${name(next)}]].`,
    `## Notes\n\n${paragraph(seed)}`,
    `- First pass\n- Second pass with [[${name(0)}]]\n- Third pass`,
  ];
  if (aspectIndex === 0) parts.push(`Related craft is [[${TOPICS[(topicIndex + 1) % TOPICS.length][1]} basics]].`);
  if (seed % 5 === 0) parts.push(MERMAID);
  if (seed % 7 === 0) parts.push("```js\nconst batch = { day: 1, grams: 500 };\nconsole.log(batch);\n```");
  if (seed % 6 === 0) parts.push("> [!tip] Keep a log\n> Write the date first.");
  if (seed % 11 === 0) parts.push("The ratio is $a^2 + b^2 = c^2$ and ==worth remembering==.");
  return `${parts.join("\n\n")}\n`;
}

export async function writeFixtureVault(root) {
  const files = new Map(Object.entries(hero));
  TOPICS.forEach(([folder, topic], t) => {
    ASPECTS.forEach((aspect, a) => {
      files.set(`${folder}/${topic} ${aspect}.md`, topicNote(t, a));
    });
  });
  for (const [rel, text] of files) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, text);
  }
  await mkdir(path.join(root, "Attachments"), { recursive: true });
  await writeFile(path.join(root, "Attachments", "kiln-diagram.png"), PNG_1X1);
  return files.size;
}

export const NOTES = {
  hero: "Crumb structure and the overproofing problem",
  starter: "Starter feeding - float test, peak and discard",
  baskets: "Proofing baskets and banneton care",
  compass: "Compass declination and magnetic north",
  tide: "Tide charts, datums and harbour approach",
};
