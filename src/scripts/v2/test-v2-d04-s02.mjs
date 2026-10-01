/**
 * D04/S02 엔진 연결 테스트.
 * 실제 buildings 파일을 만들지 않고 기존 데이터 파일 스키마·feature 적재 헬퍼로 작은 SQLite를 게시한다.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const A = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { runHeavyTiles } = await import("../../lib/v2/engine/jobs.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
const at = (x, y) => toLngLat([cx + x, cy + y]);
const box = (x, y, size = 10) => ({
  type: "Polygon",
  coordinates: [[at(x, y), at(x + size, y), at(x + size, y + size), at(x, y + size), at(x, y)]],
});
const relInput = { provider: "테스트", sourceUrl: "https://example.invalid", sourceAsOf: "2026-08-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "test", licenseCode: "TEST" };

async function makeData({ buildings = true, brokenBuildings = false } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-d04-s02-data-"));
  const versionDir = join(dataDir, "versions", "test");
  mkdirSync(versionDir, { recursive: true });
  const files = {};

  const core = new Database(join(versionDir, "core.sqlite"));
  initDataFileSchema(core, "core");
  core.close();
  files.core = { path: "versions/test/core.sqlite", kind: "core", schemaVersion: 2 };

  if (buildings) {
    const db = new Database(join(versionDir, "buildings.sqlite"));
    initDataFileSchema(db, "buildings");
    const releaseId = insertRelease(db, { sourceId: "building", ...relInput });
    const fact = db.prepare(`INSERT INTO building_fact
      (feature_id, ledger_pk, complex_id, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rows = [
      ["pre", 0, 0, 1979, 10],
      ["eighties", 70, 0, 1985, 12],
      ["nineties", -70, 0, 1995, 15],
      ["noughties", 0, 70, 2005, 20],
      ["tens", 0, -70, 2015, 25],
      ["unknown", 120, 0, null, null],
    ];
    for (const [id, x, y, year, height] of rows) {
      const featureId = insertFeature(db, { stableId: `building:${id}`, kind: "building", sourceKey: id, releaseId, geometry: box(x, y), name: id });
      fact.run(featureId, id, null, height, height === null ? "unknown" : "source", null, null, "01000", year === null ? null : `${year}-01-01`, 100, 100, "{}");
    }
    if (brokenBuildings) db.exec("DROP TABLE building_fact");
    db.close();
    files.buildings = { path: "versions/test/buildings.sqlite", kind: "buildings", schemaVersion: 2 };
  }

  for (const file of Object.values(files)) file.sha256 = await M.sha256File(join(dataDir, file.path));
  const manifest = { version: "test", createdAt: "2026-09-30T00:00:00Z", files };
  const published = await M.publishManifest(dataDir, manifest, () => ({ ok: true, failures: [] }));
  assert.equal(published.published, true);
  return dataDir;
}

function tile(result, code) {
  assert.equal(result.ok, true);
  const found = result.results.find((t) => t.tileCode === code);
  assert.ok(found, `${code} result`);
  return found;
}
/** 무거운 타일: 백그라운드 작업을 돌린 뒤 저장된 결과를 읽는다. */
function heavyTile(db, dir, result, code) {
  assert.equal(tile(result, code).status, "pending");
  runHeavyTiles(db, dir, result.analysisId);
  return A.loadTileResults(db, result.analysisId).find((t) => t.tileCode === code);
}

// 1) buildings 파일이 있는 분석: D04 연대 분포와 S02 연결을 함께 확인한다.
const dataDir = await makeData();
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-d04-s02-app-")), "app.sqlite"));
const run = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
const d04 = tile(run, "D04");
const s02Tile = heavyTile(appDb, dataDir, run, "S02");
const metric = (result, id) => result.metrics.find((m) => m.id === id);

assert.equal(d04.status, "complete");
assert.equal(metric(d04, "confirmed_share_pct").value, 83.3);
assert.equal(metric(d04, "confirmed_share_pct").numerator, 5);
assert.equal(metric(d04, "confirmed_share_pct").denominator, 6);
assert.equal(metric(d04, "share_unknown").value, 16.7);
assert.equal(metric(d04, "share_unknown").numerator, 1);
assert.equal(d04.judgment.ruleId, "D04-decades@1");
assert.deepEqual(d04.judgment.basisMetricIds, ["confirmed_share_pct"]);
assert.equal(d04.judgment.level, null);
assert.equal(d04.presentation.featuresTotal, 6);
assert.ok(d04.presentation.features.some((f) => f.layer === "bldg_unknown"));
assert.equal(d04.provenance.sources[0].sourceId, "building");
const d04View = toTileView(d04);
assert.equal(d04View.hasFace, true);
assert.equal(d04View.chart.length, 7);

assert.equal(s02Tile.tileType, "simulation");
assert.equal(s02Tile.status, "partial");
assert.equal(s02Tile.conditions.simulation.model, "sun-raster@1");
assert.equal(s02Tile.conditions.simulation.cellM, 2);
assert.equal(s02Tile.conditions.simulation.influenceM, 400);
assert.equal(s02Tile.conditions.simulation.dates.analysis.date, "2026-09-30");
assert.ok(metric(s02Tile, "mean_sun_h_winter").value >= 0);
assert.ok(s02Tile.presentation.rasters.some((ref) => ref.name === "sun_hours_winter"));
assert.ok(s02Tile.limitations.some((l) => l.note.includes("높이 미상")));
assert.ok(!s02Tile.judgment.sentence.includes("법적 일조권 충족"));


// 2) buildings 파일 자체가 없는 게시 버전은 not_provided.
const absentDir = await makeData({ buildings: false });
const absentDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-d04-s02-absent-app-")), "app.sqlite"));
const absent = runAnalysis(absentDb, absentDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
assert.equal(tile(absent, "D04").status, "not_provided");
assert.equal(heavyTile(absentDb, absentDir, absent, "S02").status, "not_provided");
absentDb.close();

// 3) 건물 파일이 있어도 필요한 building_fact 열이 없으면 예외 대신 not_provided.
const brokenDir = await makeData({ brokenBuildings: true });
const brokenDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-d04-s02-broken-app-")), "app.sqlite"));
const broken = runAnalysis(brokenDb, brokenDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
assert.equal(tile(broken, "D04").status, "not_provided");
assert.equal(heavyTile(brokenDb, brokenDir, broken, "S02").status, "not_provided");
brokenDb.close();
appDb.close();

console.log("✓ v2 D04/S02 engine tiles");
