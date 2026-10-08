import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const requestedCodes = process.argv.slice(2);

if (requestedCodes.length === 0 || requestedCodes.some((code) => !/^[A-Z]\d{2}$/.test(code))) {
  console.error("usage: node src/scripts/v2/harness/tile-literals.mjs <code...>");
  process.exit(2);
}

const codes = [...new Set(requestedCodes)];

function collectFiles(relativeRoot, recursive) {
  const absoluteRoot = join(repoRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];
  const files = [];
  const visit = (directory, descend) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && descend) visit(path, true);
      else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  visit(absoluteRoot, recursive);
  return files;
}

const sourceFiles = [
  ...collectFiles("src/lib/v2/ui", true),
  ...collectFiles("src/lib/v2/engine", true),
  ...collectFiles("src/lib/v2/report", true),
  // The top-level tile registry/types are shared; tile/<code> is tile-owned and excluded.
  ...collectFiles("src/lib/v2/tile", false),
  ...collectFiles("src/components/v2", true),
  ...collectFiles("src/app/v2", true),
].sort();

// These are the P1 plan's intentional central owners. Keep each rule narrow enough
// that a new target-code token in another line still fails the ownership gate.
const WHITELIST = [
  {
    file: "src/lib/v2/ui/board-state.ts",
    pattern: /\bD0[567]\b/,
    reason: "saved-board code/layer migration table stays central",
  },
  {
    file: "src/lib/v2/ui/tile-catalog.ts",
    pattern: /\bD0[567]\b/,
    reason: "catalog and user-facing presets stay central",
  },
  {
    file: "src/lib/v2/ui/detail-state.ts",
    pattern: /\bD0[567]\b/,
    reason: "detail-state code list stays central",
  },
  {
    file: "src/lib/v2/engine/detail/buildings.ts",
    pattern: /BUILDING_CODES|\bD0[567]\b/,
    reason: "building detail family code list stays central",
  },
  {
    file: "src/lib/v2/engine/tiles/common.ts",
    pattern: /TILE_CACHE_REVISION|\bD0[567]\b/,
    reason: "per-tile cache engine revision is a shared immutable contract",
  },
  {
    file: "src/lib/v2/engine/tiles/not-provided.ts",
    pattern: /NOT_PROVIDED_CODES|\bD0[567]\b/,
    reason: "global not-provided status list stays central",
  },
];

function withoutComments(source) {
  let output = "";
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < source.length; i += 1) {
    const current = source[i];
    const next = source[i + 1];
    if (lineComment) {
      output += current === "\n" ? "\n" : " ";
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      output += current === "\n" ? "\n" : " ";
      if (current === "*" && next === "/") {
        output += " ";
        i += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "/" && next === "/") {
      output += "  ";
      i += 1;
      lineComment = true;
      continue;
    }
    if (current === "/" && next === "*") {
      output += "  ";
      i += 1;
      blockComment = true;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") quote = current;
    output += current;
  }
  return output;
}

function locationOf(source, offset) {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = source.indexOf("\n", offset);
  return {
    line: source.slice(0, offset).split("\n").length,
    column: offset - lineStart + 1,
    text: source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim(),
  };
}

function ruleFor(file, lineText) {
  const entry = WHITELIST.find((candidate) => candidate.file === file && candidate.pattern.test(lineText));
  return entry?.reason ?? null;
}

const hits = [];
for (const absolutePath of sourceFiles) {
  const source = readFileSync(absolutePath, "utf8");
  const searchable = withoutComments(source);
  const pattern = new RegExp(`\\b(${codes.join("|")})\\b`, "g");
  for (const match of searchable.matchAll(pattern)) {
    const code = match[1];
    const location = locationOf(source, match.index);
    const file = relative(repoRoot, absolutePath).replaceAll("\\", "/");
    const reason = ruleFor(file, location.text);
    hits.push({ code, file, ...location, reason });
  }
}

hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.code.localeCompare(b.code));
for (const code of codes) {
  const codeHits = hits.filter((hit) => hit.code === code);
  console.log(`${code}: ${codeHits.length} occurrence(s)`);
  for (const hit of codeHits) {
    const state = hit.reason ? "WHITELIST" : "VIOLATION";
    console.log(`  ${state} ${hit.file}:${hit.line}:${hit.column} ${hit.reason ?? "no ownership whitelist rule"}`);
  }
}

const violations = hits.filter((hit) => !hit.reason);
if (violations.length > 0) {
  console.error(`tile-literals: FAIL (${violations.length} unwhitelisted occurrence(s))`);
  process.exit(1);
}
console.log(`tile-literals: PASS (${hits.length} occurrence(s), all whitelisted)`);
