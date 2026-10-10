/** P4 G0 등록 계약: 카탈로그·상태·스텁·레이어·엔진 버전. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { TILE_CATALOG, TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { RASTER_STYLES, LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { ENGINE_VERSION } = await import("../../lib/v2/engine/tiles/common.ts");
const { parseTileResult, tileCacheKey } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");

const expected = [
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11", "A12",
  "D01", "D02", "D03", "D04", "D05", "D10", "D11", "D12", "D13", "D15", "D16", "D17", "D18", "D19", "D22", "D28", "D29",
  "S01", "S02", "S03", "S04",
];
assert.deepEqual(TILE_CODES, expected, "P4 catalog order");
for (const code of ["A08", "D01", "D10", "D28", "D29", "S04"]) assert.ok(TILE_CATALOG[code], `catalog ${code}`);
assert.equal(ENGINE_VERSION, "v2-p4-ext-1");

const dataDir = mkdtempSync(join(tmpdir(), "v2-p4-reg-data-"));
await buildEngineFixture(dataDir, "v1");
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-p4-reg-app-")), "app.sqlite"));
try {
  const run = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
  assert.equal(run.ok, true);
  assert.deepEqual(run.results.map((result) => result.tileCode), expected, "run result order");
  // 아직 스텁인 P4 타일만 확인한다 — 구현한 작업은 여기서 자기 코드를 뺀다(D01: T20).
  const STUBS = { A08: "not_provided", D28: "not_provided", D10: "pending", D29: "pending", S04: "pending" };
  for (const [code, status] of Object.entries(STUBS)) {
    const tile = run.results.find((result) => result.tileCode === code);
    assert.equal(tile?.status, status, `${code} stub status`);
  }

  const base = run.results[0];
  const pending = parseTileResult({ ...base, tileId: `${run.analysisId}-pending`, tileCode: "A01", status: "pending" });
  const pendingKey = tileCacheKey({ tileCode: "A01", manifestHash: pending.provenance.manifestHash, engineVersion: pending.engineVersion, conditions: pending.conditions });
  A.saveTileResult(appDb, pending, pendingKey);
  assert.equal(A.findCachedTileResult(appDb, pendingKey), null, "pending results are not cache hits");
  assert.ok(toTileView(pending).badges.some((badge) => badge.text === "계산 대기"));
} finally {
  appDb.close();
}

for (const id of ["rent_jeonse", "rent_monthly", "walk_route", "canopy", "osm_green", "osm_water", "walk_5", "walk_10", "walk_15", "walk_net", "wind_inflow"]) {
  assert.ok(LAYER_STYLES[id], `layer ${id}`);
}
for (const name of ["sun_hours", "shade_mask", "shade_flow", "wind_ratio", "utci", "svf", "canopy"]) {
  assert.ok(RASTER_STYLES[name], `raster style ${name}`);
}

console.log("✓ v2 P4 registry");
