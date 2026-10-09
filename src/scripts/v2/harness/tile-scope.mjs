import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DEFAULT_BASE = "refactor-base";

// Source of truth: virtual-knitting-platypus.md §소유권. These are the legacy
// locations that remain owned by a special tile until the next migration.
const OWNER_RULES = Object.freeze({
  S01: [
    { label: "S01 mass-3d* component", test: (file) => /^src\/components\/v2\/mass-3d[^/]*\.tsx?$/.test(file) },
    { label: "S01 mass-3d* UI module", test: (file) => /^src\/lib\/v2\/ui\/mass-3d[^/]*\.ts$/.test(file) },
    { label: "S01 mass-projection", test: (file) => file === "src/lib/v2/ui/mass-projection.ts" },
    { label: "S01 mass-figure", test: (file) => file === "src/components/v2/mass-figure.tsx" },
  ],
  S03: [
    { label: "S03 wind-panel", test: (file) => file === "src/components/v2/wind-panel.tsx" },
    { label: "S03 wind-upload", test: (file) => file === "src/lib/v2/ui/wind-upload.ts" },
    { label: "S03 wind-api", test: (file) => file === "src/lib/v2/engine/wind-api.ts" },
  ],
  D22: [
    { label: "D22 wind-rose* UI module", test: (file) => /^src\/lib\/v2\/ui\/wind-rose[^/]*\.ts$/.test(file) },
    { label: "D22 rose-season", test: (file) => file === "src/lib/v2/ui/rose-season.ts" },
    { label: "D22 wind-rose-figure", test: (file) => /^src\/components\/v2\/wind-rose[^/]*\.tsx?$/.test(file) },
  ],
  A05: [
    { label: "A05+A06 callout-* UI module", test: (file) => /^src\/lib\/v2\/ui\/callout-[^/]*\.ts$/.test(file) },
    { label: "A05+A06 callout-map", test: (file) => file === "src/components/v2/callout-map.tsx" },
    { label: "A05+A06 a05-filter", test: (file) => file === "src/lib/v2/engine/a05-filter.ts" },
  ],
});

// Board-state migration is the authoritative host mapping for absorbed codes.
// An absorbed code is scoped to its host folder and host-named test files.
const ABSORBED_TO_HOST = Object.freeze({
  D06: "D05",
  D07: "D05",
  D08: "A12",
  D09: "A04",
  D14: "A01",
  D20: "D19",
  D21: "S02",
  D23: "A09",
  D24: "A10",
  D25: "A07",
  D26: "A02",
  D27: "A11",
});

export const normalizePath = (file) => file.replaceAll("\\", "/").replace(/^\.\//, "");
const hostCode = (code) => ABSORBED_TO_HOST[code] ?? code;
const ownershipCodes = (code) => (code === "A05" || code === "A06" ? ["A05", "A06"] : [hostCode(code)]);

function usage() {
  console.error("usage: node src/scripts/v2/harness/tile-scope.mjs <code...> [--base <ref>] [--allow <path> ...] | --self-test");
}

function normalizeAllowPath(file) {
  const normalized = normalizePath(file);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error("--allow requires a repository-relative path");
  }
  return normalized;
}

export function parseArgs(argv) {
  const codes = [];
  let base = DEFAULT_BASE;
  let selfTest = false;
  const allowPaths = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") {
      selfTest = true;
      continue;
    }
    if (arg === "--base") {
      base = argv[i + 1];
      i += 1;
      if (!base) throw new Error("--base requires a git ref");
      continue;
    }
    if (arg === "--allow") {
      const allowPath = argv[i + 1];
      if (!allowPath || allowPath.startsWith("--")) throw new Error("--allow requires a repository-relative path");
      allowPaths.push(normalizeAllowPath(allowPath));
      i += 1;
      continue;
    }
    codes.push(arg);
  }
  return { codes, base, selfTest, allowPaths: [...new Set(allowPaths)] };
}

function assertValidCodes(codes) {
  if (codes.length === 0 || codes.some((code) => !/^[A-Z]\d{2}$/.test(code))) {
    usage();
    process.exit(2);
  }
}

export function allowedPathForCode(file, code) {
  const normalized = normalizePath(file);
  const testCodes = ownershipCodes(code);
  if (testCodes.some((testCode) => normalized.startsWith(`src/lib/v2/tile/${hostCode(testCode).toLowerCase()}/`))) return true;
  if (testCodes.some((testCode) => normalized.startsWith(`src/scripts/v2/test-v2-tile-${testCode.toLowerCase()}`) && normalized.endsWith(".mjs"))) return true;

  const ownerCode = testCodes.find((testCode) => OWNER_RULES[testCode]);
  return OWNER_RULES[ownerCode]?.some((rule) => rule.test(normalized)) ?? false;
}

export function isAllowedPath(file, codes, allowPaths = []) {
  const normalized = normalizePath(file);
  const normalizedAllows = allowPaths.map(normalizePath);
  return normalizedAllows.includes(normalized) || codes.some((code) => allowedPathForCode(normalized, code));
}

export function allowedReason(file, codes, allowPaths = []) {
  const normalized = normalizePath(file);
  if (allowPaths.map(normalizePath).includes(normalized)) return "explicit --allow";
  for (const code of codes) {
    for (const testCode of ownershipCodes(code)) {
      const host = hostCode(testCode);
      if (normalized.startsWith(`src/lib/v2/tile/${host.toLowerCase()}/`)) return `${code} tile/${host.toLowerCase()}`;
      if (normalized.startsWith(`src/scripts/v2/test-v2-tile-${testCode.toLowerCase()}`) && normalized.endsWith(".mjs")) return `${code} tile test ${testCode}`;
      const rule = OWNER_RULES[testCode]?.find((candidate) => candidate.test(normalized));
      if (rule) return `${code} ${rule.label}`;
    }
  }
  return null;
}

export function runSelfTest() {
  assert.equal(hostCode("D06"), "D05");
  assert.equal(hostCode("D14"), "A01");
  assert.equal(allowedPathForCode("src/lib/v2/tile/a06/view.ts", "A05"), true, "A05 permits the shared A06 tile folder");
  assert.equal(allowedPathForCode("src/lib/v2/tile/a05/view.ts", "A06"), true, "A06 permits the shared A05 tile folder");
  assert.equal(allowedPathForCode("src/scripts/v2/test-v2-tile-a06-callout.mjs", "A05"), true, "A05 permits the shared A06 test prefix");
  assert.equal(allowedPathForCode("src/lib/v2/ui/tile-view.ts", "A05"), false, "shared tile-view stays out of tile scope");
  assert.equal(allowedPathForCode("src/lib/v2/tile/d05/d06.ts", "D06"), true, "absorbed engine uses the D05 host folder");
  assert.equal(allowedPathForCode("src/scripts/v2/test-v2-tile-d05-height.mjs", "D06"), true, "absorbed test uses the D05 host prefix");
  assert.equal(allowedPathForCode("src/lib/v2/ui/mass-projection.ts", "S01"), true);
  assert.equal(allowedPathForCode("src/lib/v2/engine/run.ts", "S01"), false);
  assert.deepEqual(parseArgs(["A01", "--allow", ".\\src\\lib\\v2\\ui\\map-layers.ts", "--allow", "src/lib/v2/ui/map-layers.ts"]).allowPaths, ["src/lib/v2/ui/map-layers.ts"]);
  assert.equal(isAllowedPath("src/lib/v2/ui/map-layers.ts", ["A01"], ["src/lib/v2/ui/map-layers.ts"]), true);
  assert.equal(allowedReason("src/lib/v2/ui/map-layers.ts", ["A01"], ["src/lib/v2/ui/map-layers.ts"]), "explicit --allow");
  console.log("tile-scope: PASS (--self-test)");
}

function changedFiles(base) {
  const result = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: repoRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || `git diff exited ${result.status}`).trim());
  return result.stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

export function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.selfTest) {
    if (parsed.codes.length > 0 || parsed.allowPaths.length > 0) {
      usage();
      process.exit(2);
    }
    runSelfTest();
    return;
  }

  assertValidCodes(parsed.codes);
  const codes = [...new Set(parsed.codes)];
  const files = changedFiles(parsed.base);
  const violations = files.filter((file) => !isAllowedPath(file, codes, parsed.allowPaths));
  const allowSummary = parsed.allowPaths.length > 0 ? `, allow=${parsed.allowPaths.join(",")}` : "";
  console.log(`tile-scope: ${files.length} changed path(s), codes=${codes.join(",")}, base=${parsed.base}${allowSummary}`);
  if (violations.length > 0) {
    if (parsed.allowPaths.length > 0) {
      for (const file of files.filter((candidate) => !violations.includes(candidate))) {
        console.log(`  ALLOWED ${file} (${allowedReason(file, codes, parsed.allowPaths)})`);
      }
    }
    console.error(`tile-scope: FAIL (${violations.length} path(s) outside ownership)`);
    for (const file of violations) console.error(`  OUTSIDE ${file}`);
    process.exit(1);
  }
  for (const file of files) console.log(`  ALLOWED ${file} (${allowedReason(file, codes, parsed.allowPaths)})`);
  console.log(`tile-scope: PASS (${files.length} path(s))`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
