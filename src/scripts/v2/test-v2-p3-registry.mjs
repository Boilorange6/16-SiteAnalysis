/** P3 기반 등록: 카탈로그·스텁·레이어·엔진 버전 계약. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { TILE_CATALOG, TILE_CODES, sourceName } = await import("../../lib/v2/ui/tile-catalog.ts");
const { LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { ENGINE_VERSION } = await import("../../lib/v2/engine/tiles/common.ts");
const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");

const P3 = ["D15", "D16", "D17", "D18", "D21", "D22"];
const DS_ORDER = [
  "D02", "D03", "D04", "D05", "D06", "D07", "D08", "D09", "D11", "D12", "D13", "D14",
  "D15", "D16", "D17", "D18", "D19", "D20", "D21", "D22", "D23", "D24", "D25", "D27",
  "S01", "S02", "S03",
];

for (const code of P3) {
  assert.equal(TILE_CATALOG[code].kind, "diagram", `catalog ${code}`);
}
assert.deepEqual(TILE_CODES.filter((code) => code.startsWith("D") || code.startsWith("S")), DS_ORDER);
assert.equal(ENGINE_VERSION, "v2-p3-terrain-1");

const dataDir = mkdtempSync(join(tmpdir(), "v2-p3-reg-"));
await buildEngineFixture(dataDir, "v1");
const appDb = openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-p3-reg-app-")), "app.sqlite"));
try {
  const run = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
  assert.equal(run.ok, true);
  assert.deepEqual(run.results.map((result) => result.tileCode), TILE_CODES, "결과 순서 = 카탈로그 순서");
  for (const code of P3) {
    const result = run.results.find((tile) => tile.tileCode === code);
    assert.ok(result, `result ${code}`);
    assert.equal(result.status, "not_provided", `${code} status`);
    assert.equal(result.tileType, "diagram", `${code} tileType`);
  }
} finally {
  appDb.close();
}

const layerIds = [
  "block_lt05", "block_05_1", "block_1_2", "block_2_5", "block_ge5", "block_open",
  "dens_0", "dens_q1", "dens_q2", "dens_q3", "dens_q4", "dens_q5",
  "relief_lt_m20", "relief_m20_m5", "relief_m5_5", "relief_5_20", "relief_ge20", "dem_nodata", "contour",
  "slope_0_5", "slope_5_10", "slope_10_15", "slope_15_20", "slope_ge20", "slope_nodata",
  "sun_0", "sun_0_2", "sun_2_4", "sun_4_6", "sun_6_8", "sun_ge8", "sun_uncalc", "sun_face",
  "shadow_09", "shadow_12", "shadow_15",
];
for (const id of layerIds) assert.ok(LAYER_STYLES[id], `layer ${id}`);

assert.equal(sourceName("terrain_tiles"), "Terrain Tiles(SRTM 1″ 지표고)");
assert.equal(sourceName("asos"), "기상청 ASOS 시간자료");
assert.equal(sourceName("osm_roads"), "OSM 도로(Geofabrik)");

console.log("✓ v2 P3 registry");
