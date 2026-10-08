import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function usage() {
  console.error("usage: npx tsx src/scripts/v2/harness/pptx-diff.mjs --base <path> --candidate <path>");
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readComparable(path) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const slides = new Map();
  const media = new Map();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) slides.set(name, await entry.async("string"));
    if (/^ppt\/media\//.test(name) && !entry.dir) media.set(name, digest(await entry.async("nodebuffer")));
  }
  return { slides, media };
}

function diffMaps(before, after, label) {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort();
  return names.flatMap((name) => {
    const left = before.get(name) ?? "<missing>";
    const right = after.get(name) ?? "<missing>";
    return left === right ? [] : [label + " " + name];
  });
}

const basePath = option("--base");
const candidatePath = option("--candidate");
if (!basePath || !candidatePath) {
  usage();
  process.exit(2);
}

const [base, candidate] = await Promise.all([readComparable(basePath), readComparable(candidatePath)]);
const differences = [
  ...diffMaps(base.slides, candidate.slides, "slide XML differs:"),
  ...diffMaps(base.media, candidate.media, "media hash differs:"),
];
console.log("pptx-diff: slides " + base.slides.size + "/" + candidate.slides.size + ", media " + base.media.size + "/" + candidate.media.size + ", differences " + differences.length);
if (differences.length > 0) {
  differences.forEach((line) => console.error("  " + line));
  process.exit(1);
}
