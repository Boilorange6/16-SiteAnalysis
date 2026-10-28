import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { HEAVY_TILE_CODES, TILES, DATE_INDEPENDENT_CODES } = await import("../../lib/v2/engine/run.ts");
const { HEAVY_TILES, DATE_INDEPENDENT } = await import("../../lib/v2/engine/jobs.ts");
const { SITE_DEPENDENT_TILE_CODES } = await import("../../lib/v2/engine/site.ts");
const { ENGINE_VERSION, cacheEngineVersion } = await import("../../lib/v2/engine/tiles/common.ts");
const { DETAIL_SPECS } = await import("../../lib/v2/engine/detail/registry.ts");

const EXPECTED_CODES = [
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11", "A12",
  "D01", "D02", "D03", "D04", "D05", "D10", "D11", "D12", "D13", "D15", "D16", "D17", "D18", "D19", "D22", "D28", "D29",
  "S01", "S02", "S03", "S04",
];
const EXPECTED_HEAVY = ["S02", "D29", "D10", "S03", "S04"];
const EXPECTED_DATE_INDEPENDENT = ["S03", "D10", "D29", "D01", "D28"];
const EXPECTED_SITE_DEPENDENT = ["D19", "S02", "A12", "D10", "S01", "S03", "S04"];
const EXPECTED_CUT_CODES = ["S01", "S02", "S03", "S04", "D22"];
const EXPECTED_DETAIL_KEYS = [
  "A01", "A02", "A04", "A05", "A06", "A07", "A09", "A10", "A11", "A12",
  "D02", "D03", "D04", "D05", "D10", "D11", "D12", "D13", "D16", "D17", "D18", "D19", "D22", "D28", "D29", "S02",
];
const EXPECTED_CACHE_VERSIONS = {
  A01: "v2-p4-ext-1+w3-merge-r1+w2b-r1+w3-r1+entrance-color-r1+transit-presentation-r1+rail-data-r3",
  A02: "v2-p4-ext-1+w3-merge-r1+w2b-r1+clip-r1+chart-count-r1+chart-cap-r1",
  A03: "v2-p4-ext-1+w2b-r1+composition-r1",
  A04: "v2-p4-ext-1+w3-merge-r1+w2b-r1+clip-r1",
  A05: "v2-p4-ext-1+w2b-r1+composition-r1+chart-count-r1+chart-cap-r1",
  A06: "v2-p4-ext-1+w2b-r1+composition-r1",
  A07: "v2-p4-ext-1+w3-merge-r1+w2b-r1+w2-trade-modes-r1+price-size-r1+chart-value-r1+chart-count-r1+chart-cap-r1",
  A08: "v2-p4-ext-1+w2b-r1+w2-trade-modes-r1+w6-building-modes-r1",
  A09: "v2-p4-ext-1+w3-merge-r1+w2b-r1+clip-r1+maint-profile-r1+seoulplan-r1+noclip-r1+onezone-r1+chart-count-r1+chart-cap-r1",
  A10: "v2-p4-ext-1+w3-merge-r1+w2b-r1",
  A11: "v2-p4-ext-1+w3-merge-r1+w2b-r1+clip-r1",
  A12: "v2-p4-ext-1+w3-merge-r1+w2b-r1+clip-r1+provenance-r1",
  D01: "v2-p4-ext-1",
  D02: "v2-p4-ext-1+w2b-r1+w4-names-r1+clip-r1",
  D03: "v2-p4-ext-1+w2b-r1+w4-names-r1+clip-r1+chart-count-r1+chart-cap-r1",
  D04: "v2-p4-ext-1+w2b-r1+w4-names-r1+clip-r1+chart-value-r1+chart-cap-r1",
  D05: "v2-p4-ext-1+height3-r1+w3-merge-r1+w2b-r1+w4-names-r1+d05-nearest-cap-r1+clip-r1+chart-value-r1+chart-cap-r1",
  D10: "v2-p4-ext-1+w2b-r1+clip-r1+composition-r1",
  D11: "v2-p4-ext-1+w2b-r1+clip-r1",
  D12: "v2-p4-ext-1+w2b-r1+clip-r1+chart-count-r2+chart-cap-r1",
  D13: "v2-p4-ext-1+w2b-r1",
  D15: "v2-p4-ext-1+w2b-r1+clip-r1+chart-count-r1+chart-cap-r1",
  D16: "v2-p4-ext-1+height3-r1+w2b-r1+clip-r1",
  D17: "v2-p4-ext-1+w2b-r1+clip-r1+terrain-section-r1",
  D18: "v2-p4-ext-1+w2b-r1+clip-r1",
  D19: "v2-p4-ext-1+w3-merge-r1+w2b-r1+clip-r1",
  D22: "v2-p4-ext-1",
  D28: "v2-p4-ext-1+w2b-r1+clip-r1+composition-r1",
  D29: "v2-p4-ext-1+height3-r1+w2b-r1+w4-names-r1",
  S01: "v2-p4-ext-1+height3-r1+w3-r1+composition-r1",
  S02: "v2-p4-ext-1+height3-r1+w3-merge-r1+w3-r1+provenance-r1",
  S03: "v2-p4-ext-1+height3-r1+w2b-r1",
  S04: "v2-p4-ext-1+s04-r2+height3-r1+w2b-r1+clip-r1+provenance-r1",
};
const EXPECTED_ABSORBS = {
  A02: ["D26"],
  A04: ["D09"],
  A07: ["D25"],
  A09: ["D23"],
  A10: ["D24"],
  A11: ["D27"],
  A12: ["D08"],
  D05: ["D06", "D07"],
  D19: ["D20"],
};

assert.deepEqual(TILE_CODES, EXPECTED_CODES, "catalog order");
assert.deepEqual(TILES.map(([code]) => code), EXPECTED_CODES, "engine order");
assert.deepEqual([...HEAVY_TILE_CODES], EXPECTED_HEAVY, "run heavy order");
assert.deepEqual([...HEAVY_TILES], EXPECTED_HEAVY, "job heavy order");
assert.deepEqual([...DATE_INDEPENDENT_CODES], EXPECTED_DATE_INDEPENDENT, "run date-independent set");
assert.deepEqual([...DATE_INDEPENDENT], EXPECTED_DATE_INDEPENDENT, "job date-independent set");
assert.deepEqual([...SITE_DEPENDENT_TILE_CODES], EXPECTED_SITE_DEPENDENT, "site-dependent set");
assert.equal(ENGINE_VERSION, "v2-p4-ext-1", "global engine version");
assert.deepEqual(Object.fromEntries(EXPECTED_CODES.map((code) => [code, cacheEngineVersion(code)])), EXPECTED_CACHE_VERSIONS, "per-code cache engine versions");
assert.deepEqual(Object.keys(DETAIL_SPECS).sort(), [...EXPECTED_DETAIL_KEYS].sort(), "detail spec keys");

const serverPath = fileURLToPath(new URL("../../lib/v2/tile/server.ts", import.meta.url));
if (existsSync(serverPath)) {
  const server = await import("../../lib/v2/tile/server.ts");
  assert.deepEqual(server.TILE_SERVER_MODULES.map((module) => module.code), EXPECTED_CODES, "server registry order");
  assert.deepEqual(Object.fromEntries(server.TILE_SERVER_MODULES.filter((module) => module.absorbs).map((module) => [module.code, [...module.absorbs]])), EXPECTED_ABSORBS, "server absorbs map");
  assert.deepEqual([...server.HEAVY_TILES], EXPECTED_HEAVY, "server heavy order");
  assert.deepEqual([...server.DATE_INDEPENDENT], EXPECTED_DATE_INDEPENDENT, "server date-independent set");
  assert.deepEqual([...server.SITE_DEPENDENT_TILE_CODES], EXPECTED_SITE_DEPENDENT, "server site-dependent set");
} else {
  // First red-green checkpoint: before the registry exists, lock the current merged wrappers.
  const source = readFileSync(fileURLToPath(new URL("../../lib/v2/engine/run.ts", import.meta.url)), "utf8");
  for (const [host, absorbed] of Object.entries(EXPECTED_ABSORBS)) {
    assert.match(source, new RegExp(host.toLowerCase() + "With"), host + " merged wrapper");
    for (const code of absorbed) assert.match(source, new RegExp("\\b" + code.toLowerCase() + "\\b"), host + " absorbs " + code);
  }
}

const clientPath = fileURLToPath(new URL("../../lib/v2/tile/client.ts", import.meta.url));
if (existsSync(clientPath)) {
  const { CUT_CODES } = await import("../../lib/v2/tile/client.ts");
  assert.deepEqual([...CUT_CODES], EXPECTED_CUT_CODES, "client cut code registry");
} else {
  const consumers = [
    "src/lib/v2/ui/board-state.ts",
    "src/lib/v2/report/report-plan.ts",
    "src/components/v2/tile-dialog.tsx",
  ].map((path) => readFileSync(new URL("../../../" + path, import.meta.url), "utf8"));
  for (const source of consumers) for (const code of EXPECTED_CUT_CODES) assert.ok(source.includes(code), "pre-registry CUT_CODES value " + code);
}

console.log("✓ v2 tile registry values");
