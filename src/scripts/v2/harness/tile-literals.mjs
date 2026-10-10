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

// These are the P1/P2a plan's intentional central owners. Keep each rule narrow enough
// that a new target-code token in another line still fails the ownership gate.
const WHITELIST = [
  {
    file: "src/lib/v2/ui/board-state.ts",
    pattern: /TILE_CODE_RENAMES|LEGACY_LAYER_RENAMES|^D\d{2}:/,
    reason: "saved-board code/layer migration table stays central",
  },
  {
    file: "src/lib/v2/ui/tile-catalog.ts",
    pattern: /TILE_CATALOG|TILE_PRESETS|^[A-Z]\d{2}:|^"[A-Z]\d{2}"/,
    reason: "catalog and user-facing presets stay central",
  },
  {
    file: "src/lib/v2/ui/detail-state.ts",
    pattern: /\b[A-Z]\d{2}\b/,
    reason: "detail-state code list stays central",
  },
  {
    file: "src/lib/v2/engine/detail/housing.ts",
    pattern: /HOUSING_SPECS|\b[A-Z]\d{2}\b/,
    reason: "detail specs remain central by data family",
  },
  {
    file: "src/lib/v2/engine/detail/buildings.ts",
    pattern: /BUILDING_CODES|\b[A-Z]\d{2}\b/,
    reason: "detail specs remain central by data family",
  },
  {
    file: "src/lib/v2/engine/detail/network.ts",
    pattern: /\b[A-Z]\d{2}\b/,
    reason: "detail specs remain central by data family",
  },
  {
    file: "src/lib/v2/engine/detail/zones.ts",
    pattern: /\b[A-Z]\d{2}\b/,
    reason: "detail specs remain central by data family",
  },
  {
    file: "src/lib/v2/engine/detail/raster.ts",
    pattern: /\b[A-Z]\d{2}\b|rasterSpec|RASTER_SPECS/,
    reason: "detail specs remain central by data family",
  },
  {
    file: "src/lib/v2/engine/detail/parcels.ts",
    pattern: /\b[A-Z]\d{2}\b/,
    reason: "detail specs remain central by data family",
  },
  {
    file: "src/lib/v2/engine/detail/weather.ts",
    pattern: /\b[A-Z]\d{2}\b/,
    reason: "detail specs remain central by data family",
  },
  {
    file: "src/lib/v2/engine/tiles/common.ts",
    pattern: /TILE_CACHE_REVISION|^[A-Z]\d{2}:/,
    reason: "per-tile cache engine revision is a shared immutable contract",
  },
  {
    file: "src/lib/v2/engine/tiles/not-provided.ts",
    pattern: /NOT_PROVIDED_CODES|^"[A-Z]\d{2}"/,
    reason: "global not-provided status list stays central",
  },
  {
    file: "src/lib/v2/tile/server.ts",
    pattern: /TILE_SERVER_MODULES|directModule|HEAVY_TILES|DATE_INDEPENDENT|SITE_DEPENDENT/,
    reason: "shared server registry order and heavy/site flags stay central",
  },
  {
    file: "src/lib/v2/tile/client.ts",
    pattern: /CUT_CODES|\bS02\b/,
    reason: "shared client registry cut-code list stays central",
  },
  {
    file: "src/components/v2/mass-3d.tsx",
    pattern: /\bS01\b/,
    reason: "S01 mass renderer remains an owner file because the guard hard-codes its runtime label",
  },
  {
    file: "src/components/v2/mass-figure.tsx",
    pattern: /\bS01\b/,
    reason: "S01 fallback mass renderer remains an owner file",
  },
  {
    file: "src/lib/v2/ui/mass-3d-runtime.ts",
    pattern: /\bS01\b/,
    reason: "S01 runtime renderer remains an owner file",
  },
  {
    file: "src/components/v2/wind-panel.tsx",
    pattern: /\bS03\b/,
    reason: "S03 wind calculation panel remains an owner file",
  },
  {
    file: "src/lib/v2/ui/wind-upload.ts",
    pattern: /\bS03\b/,
    reason: "S03 browser upload and raster naming remain an owner file",
  },
  {
    file: "src/components/v2/wind-rose-figure.tsx",
    pattern: /\bD22\b/,
    reason: "D22 wind-rose figure remains an owner file",
  },
  {
    file: "src/lib/v2/engine/wind-api.ts",
    pattern: /\b(?:S03|S04)\b/,
    reason: "S03 wind upload and its S04 follow-on API remain owner logic",
  },
  {
    file: "src/lib/v2/engine/jobs.ts",
    pattern: /HEAVY_TILE_COMPUTES|^(?:S02|D29|D10|S03|S04):|code === "S04"/,
    reason: "heavy calculation enters the tile module only through the worker dispatch",
  },
  {
    file: "src/lib/v2/ui/fixtures/godeok.ts",
    pattern: /\b[A-Z]\d{2}\b/,
    reason: "shared Godeok fixture keeps the result-code contract central",
  },
  {
    file: "src/lib/v2/engine/summary.ts",
    pattern: /\b[A-Z]\d{2}\b/,
    reason: "common site summary stays central",
  },
  {
    file: "src/lib/v2/ui/site-parcel.ts",
    pattern: /\bD19\b/,
    reason: "shared site-parcel extraction stays central",
  },
  {
    file: "src/lib/v2/engine/wind-metrics.ts",
    pattern: /s03-inflow@1:D22/,
    reason: "cross-tile wind provenance label stays in the shared helper",
  },
  {
    file: "src/lib/v2/engine/run.ts",
    pattern: /\bS03\b|\bS04\b/,
    reason: "shared run cache and heavy-boundary logic stays central",
  },
  {
    file: "src/lib/v2/ui/tile-view.ts",
    pattern: /GRADED_CODES/,
    reason: "common grading eligibility stays central",
  },
  {
    file: "src/lib/v2/ui/tile-view.ts",
    pattern: /D04.*confirmed_share_pct|D16.*kde_bandwidth_m|D01.*imagery_zoom_max|A12.*site_zoning_count/,
    reason: "dynamic parameter badges have no tile-module field and stay central",
  },
  {
    file: "src/lib/v2/engine/tiles/d14.ts",
    pattern: /\bD24\b/,
    reason: "unused d14.ts is retained unchanged per the P2a instruction",
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
