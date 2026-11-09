// Packs the recorded switch sounds into one small WAV per profile, plus a table of where each stroke sits.
//
// Source: the Resources/Sounds folder of https://github.com/gabrimatic/switchtone, whose licences are in
// public/licenses/key-sounds.txt. Needs ffmpeg. Safe to rerun: the output depends only on the input.
//
//   node scripts/make-key-sounds.mjs /path/to/switchtone/Resources/Sounds
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SAMPLE_RATE = 44100;
const BYTES_PER_SAMPLE = 2;
const PROFILES = ["linear", "tactile", "clicky"];
const FILE = /^(key|space|enter|backspace|modifier)-(down|up)-(\d+)\.wav$/;
const OUTPUT = "src/assets/key-sounds";

const source = process.argv[2];
if (!source) throw new Error("Pass the folder holding the linear, tactile and clicky sounds.");

function monoSamples(file) {
  return execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "-"],
    { maxBuffer: 16 * 1024 * 1024 },
  );
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const seconds = (bytes) => Number((bytes / BYTES_PER_SAMPLE / SAMPLE_RATE).toFixed(5));
const table = {};
mkdirSync(OUTPUT, { recursive: true });
for (const profile of PROFILES) {
  const chunks = [];
  let offset = 0;
  const strokes = {};
  const files = readdirSync(path.join(source, profile))
    .map((name) => ({ name, match: FILE.exec(name) }))
    .filter((file) => file.match)
    .sort((a, b) => a.match[1].localeCompare(b.match[1]) || a.match[2].localeCompare(b.match[2]) || a.match[3] - b.match[3]);
  for (const { name, match } of files) {
    const [, family, direction, number] = match;
    const pcm = monoSamples(path.join(source, profile, name));
    strokes[family] ??= { down: [], up: [] };
    strokes[family][direction][Number(number) - 1] = [seconds(offset), seconds(pcm.length)];
    chunks.push(pcm);
    offset += pcm.length;
  }
  writeFileSync(path.join(OUTPUT, `${profile}.wav`), wav(Buffer.concat(chunks)));
  table[profile] = strokes;
}
writeFileSync(path.join(OUTPUT, "strokes.json"), `${JSON.stringify(table)}\n`);
