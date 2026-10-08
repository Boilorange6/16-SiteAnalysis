import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const { buildEngineFixture } = await import("../engine-fixture.mjs");
const { loadTileResults, openV2AppDb } = await import("../../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../../lib/v2/engine/run.ts");
const { runHeavyTiles } = await import("../../../lib/v2/engine/jobs.ts");
const { TILE_CODES } = await import("../../../lib/v2/ui/tile-catalog.ts");
const { canonicalJson, sha256Hex } = await import("../../../lib/v2/canonical-json.ts");

const FIXTURE_OPTIONS = Object.freeze({
  buildings: true,
  parcels: true,
  terrain: true,
  weather: true,
  roads: true,
  landuse: true,
});
const INPUT = Object.freeze({
  address: "경기도 남양주시 다산동 100",
  radiusM: 800,
  analysisDate: "2026-09-30",
});
const EXCLUDED_FIELDS = Object.freeze({
  tileId: "분석 실행 UUID가 들어가는 저장 식별자",
  analysisId: "분석 실행 UUID가 들어가는 저장 식별자",
  elapsedMs: "실행 시간 측정값",
  presentation: "지도·래스터·카메라·범례·출력면 등 시각 전용 결과; shots 하네스에서 별도 비교",
});

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function usage() {
  console.error("usage: npx tsx src/scripts/v2/harness/golden-engine.mjs --write <path> | --check <path>");
}

function stableEngineResult(tile) {
  const { tileId: _tileId, analysisId: _analysisId, elapsedMs: _elapsedMs, presentation: _presentation, ...engine } = tile;
  return engine;
}

function makeGoldenDocument(results) {
  const byCode = new Map(results.map((tile) => [tile.tileCode, tile]));
  assert.deepEqual([...byCode.keys()].sort(), [...TILE_CODES].sort(), "engine fixture must produce all current tile codes");
  const tiles = Object.fromEntries([...TILE_CODES].map((code) => {
    const tile = byCode.get(code);
    const canonical = canonicalJson(stableEngineResult(tile));
    return [code, { sha256: sha256Hex(canonical) }];
  }));
  return {
    schema: 1,
    fixture: { module: "src/scripts/v2/engine-fixture.mjs", options: FIXTURE_OPTIONS, input: INPUT },
    excludedFields: EXCLUDED_FIELDS,
    tiles,
  };
}

async function calculateOnce() {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-refactor-golden-data-"));
  const appDir = mkdtempSync(join(tmpdir(), "v2-refactor-golden-app-"));
  const appDb = openV2AppDb(join(appDir, "app.sqlite"));
  try {
    await buildEngineFixture(dataDir, "refactor-golden", FIXTURE_OPTIONS);
    const outcome = runAnalysis(appDb, dataDir, INPUT);
    assert.equal(outcome.ok, true, "golden fixture analysis should resolve");
    runHeavyTiles(appDb, dataDir, outcome.analysisId);
    return makeGoldenDocument(loadTileResults(appDb, outcome.analysisId));
  } finally {
    appDb.close();
    for (const path of [dataDir, appDir]) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (error) {
        console.warn("temporary fixture cleanup deferred: " + path + " (" + String(error?.code ?? error) + ")");
      }
    }
  }
}

function compareHashes(expected, actual) {
  const expectedTiles = expected?.tiles ?? {};
  const actualTiles = actual?.tiles ?? {};
  const codes = [...new Set([...Object.keys(expectedTiles), ...Object.keys(actualTiles)])].sort();
  return codes.flatMap((code) => {
    const before = expectedTiles[code]?.sha256 ?? "<missing>";
    const after = actualTiles[code]?.sha256 ?? "<missing>";
    return before === after ? [] : [code + ": expected " + before + ", actual " + after];
  });
}

const writePath = option("--write");
const checkPath = option("--check");
if ((!writePath && !checkPath) || (writePath && checkPath)) {
  usage();
  process.exit(2);
}

const first = await calculateOnce();
const second = await calculateOnce();
const determinismDiff = compareHashes(first, second);
console.log("golden-engine: " + Object.keys(first.tiles).length + " tiles");
if (determinismDiff.length > 0) {
  console.error("determinism: FAIL");
  determinismDiff.forEach((line) => console.error("  " + line));
  process.exit(1);
}
console.log("determinism: PASS (two consecutive fixture runs have identical code hashes)");

if (writePath) {
  mkdirSync(dirname(writePath), { recursive: true });
  writeFileSync(writePath, JSON.stringify(first, null, 2) + "\n", "utf8");
  console.log("wrote " + writePath);
} else {
  const expected = JSON.parse(readFileSync(checkPath, "utf8"));
  const differences = compareHashes(expected, first);
  if (differences.length > 0) {
    console.error("golden check: FAIL");
    differences.forEach((line) => console.error("  " + line));
    process.exit(1);
  }
  console.log("golden check: PASS (0 differences vs " + checkPath + ")");
}
