import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateRawSync, inflateRawSync } from "node:zlib";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { runHeavyTiles } = await import("../../lib/v2/engine/jobs.ts");
const { getAnalysisRun } = A;
const { loadTileRaster, saveTileRasters } = await import("../../lib/v2/raster-store.ts");
const { loadTileResults } = A;
const { putWindField, runWindFallbackJob } = await import("../../lib/v2/engine/wind-api.ts");

function uploadBody(ref, overrides = {}) {
  const header = {
    season: "annual",
    model: "lbm-d3q19-les@1",
    cellM: ref.cellM,
    cols: ref.cols,
    rows: ref.rows,
    layersZm: [6],
    dtype: "i16",
    scale: 0.001,
    steps: 6000,
    elapsedMs: 1200,
    adapter: "test-adapter",
    precision: "f32",
    mlups: 12.5,
    planReason: null,
    caseSha256: ref.sha256,
    ...overrides,
  };
  const raw = Buffer.alloc(ref.cols * ref.rows * 4);
  for (let i = 0; i < ref.cols * ref.rows; i += 1) {
    raw.writeInt16LE(overrides.rawU ?? 1000, i * 4);
    raw.writeInt16LE(overrides.rawV ?? 0, i * 4 + 2);
  }
  const json = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(json.length, 0);
  return Buffer.concat([prefix, json, deflateRawSync(raw)]);
}

function s03State(db, analysisId) {
  const row = db.prepare("SELECT cache_key, result_json FROM tile_result WHERE analysis_id = ? AND tile_code = 'S03'").get(analysisId);
  assert.ok(row);
  return { row, tile: JSON.parse(row.result_json) };
}

const dataDir = mkdtempSync(join(tmpdir(), "v2-wind-api-data-"));
await buildEngineFixture(dataDir, "wind", { buildings: true, weather: true });
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-wind-api-app-")), "app.sqlite"));

try {
  const first = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30", userId: 7 });
  assert.equal(first.ok, true);
  runHeavyTiles(appDb, dataDir, first.analysisId);
  const firstState = s03State(appDb, first.analysisId);
  assert.equal(firstState.tile.status, "pending");
  const obstacleRef = firstState.tile.presentation.rasters.find((r) => r.name === "obstacle_height");
  assert.ok(obstacleRef);
  const obstacle = loadTileRaster(appDb, firstState.row.cache_key, "obstacle_height");
  assert.ok(obstacle);

  const goodBody = uploadBody(obstacleRef);
  const started = performance.now();
  const uploaded = putWindField(appDb, dataDir, first.analysisId, "annual", goodBody, 7);
  const uploadMs = performance.now() - started;
  assert.equal(uploaded.status, 200);
  assert.ok(uploadMs <= 2000, `upload validation/metrics exceeded 2s: ${uploadMs.toFixed(1)}ms`);
  const uploadedTile = s03State(appDb, first.analysisId).tile;
  assert.equal(uploadedTile.status, "complete");
  assert.equal(uploadedTile.conditions.simulation.seasons[0], "annual");
  assert.ok(Math.abs(uploadedTile.metrics.find((m) => m.id === "urel_median_annual").value - 1) < 0.01);
  assert.ok(uploadedTile.metrics.every((metric) => metric.unit !== "m/s"));
  assert.ok(uploadedTile.metrics.some((metric) => metric.id === "steps"));
  assert.doesNotMatch(uploadedTile.judgment.sentence, /안전|CFD 동등|건강 위험 예측/);
  assert.equal(uploaded.body.reused, false);

  assert.equal(putWindField(appDb, dataDir, first.analysisId, "annual", goodBody, 8).status, 403);
  assert.equal(putWindField(appDb, dataDir, first.analysisId, "summer", goodBody, 7).status, 400);
  assert.equal(putWindField(appDb, dataDir, first.analysisId, "annual", uploadBody(obstacleRef, { caseSha256: "0".repeat(64) }), 7).status, 400);
  assert.equal(putWindField(appDb, dataDir, first.analysisId, "annual", uploadBody(obstacleRef, { cols: obstacleRef.cols - 1 }), 7).status, 400);
  assert.equal(putWindField(appDb, dataDir, first.analysisId, "annual", uploadBody(obstacleRef, { rawU: 9900 }), 7).status, 400);
  assert.equal(putWindField(appDb, dataDir, first.analysisId, "annual", Buffer.alloc(41 * 1024 * 1024), 7).status, 413);

  const sameUser = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30", userId: 7 });
  assert.equal(sameUser.ok, true);
  runHeavyTiles(appDb, dataDir, sameUser.analysisId);
  assert.equal(s03State(appDb, sameUser.analysisId).tile.status, "pending");
  const reused = putWindField(appDb, dataDir, sameUser.analysisId, "annual", goodBody, 7);
  assert.equal(reused.status, 200);
  assert.equal(reused.body.reused, true);
  assert.deepEqual(s03State(appDb, sameUser.analysisId).tile.conditions.simulation.seasons, ["annual"]);
  assert.ok(loadTileRaster(appDb, s03State(appDb, sameUser.analysisId).row.cache_key, "wind_annual_z06"), "재사용 타일의 바람 래스터도 사용자 범위 키로 복사됨");

  const otherUser = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 800, analysisDate: "2026-09-30", userId: 8 });
  assert.equal(otherUser.ok, true);
  runHeavyTiles(appDb, dataDir, otherUser.analysisId);
  assert.equal(s03State(appDb, otherUser.analysisId).tile.status, "pending", "다른 사용자에게 브라우저 결과를 전역 재사용하지 않음");

  const fallback = runAnalysis(appDb, dataDir, { center: CENTER, radiusM: 100, analysisDate: "2026-09-30", userId: 9 });
  assert.equal(fallback.ok, true);
  runHeavyTiles(appDb, dataDir, fallback.analysisId);
  const fallbackStarted = performance.now();
  runWindFallbackJob(appDb, dataDir, fallback.analysisId, 9, "WebGPU 미지원: 테스트 사유");
  const fallbackMs = performance.now() - fallbackStarted;
  assert.ok(fallbackMs <= 100000, `fallback exceeded 100s: ${fallbackMs.toFixed(1)}ms`);
  const fallbackTile = s03State(appDb, fallback.analysisId).tile;
  assert.equal(fallbackTile.status, "partial");
  assert.equal(fallbackTile.conditions.simulation.model, "lbm-d2q9@1");
  assert.ok(fallbackTile.conditions.simulation.seasons.length >= 1);
  assert.ok(fallbackTile.provenance.sources.some((source) => source.sourceId === "fallback_d2q9"));
  assert.ok(fallbackTile.metrics.every((metric) => metric.unit !== "m/s"));
  assert.match(fallbackTile.limitations.map((item) => item.note).join(" "), /2D 평면 대체 계산/);
  assert.equal(fallbackTile.conditions.simulation.fallbackReason, "WebGPU 미지원: 테스트 사유");

  // S04 캐시 키는 S03 바람 래스터 내용을 따라간다(S03 cache_key는 2D/3D/업로드 교체에도 그대로).
  const s04Key = () => appDb.prepare("SELECT cache_key FROM tile_result WHERE analysis_id = ? AND tile_code = 'S04'").get(fallback.analysisId)?.cache_key;
  runHeavyTiles(appDb, dataDir, fallback.analysisId);
  const s04Before = s04Key();
  assert.ok(s04Before);
  const s03Key = s03State(appDb, fallback.analysisId).row.cache_key;
  const windName = fallbackTile.presentation.rasters.map((ref) => ref.name).find((name) => /^wind_(spring|summer|autumn|winter)_z06$/.test(name));
  assert.ok(windName, "2D 대체 계산이 계절 바람 래스터를 남김");
  const windRaster = loadTileRaster(appDb, s03Key, windName);
  const raw = inflateRawSync(windRaster.blob);
  raw[0] ^= 1;
  const blob = deflateRawSync(raw);
  const ref = { ...windRaster.ref, bytes: blob.length, sha256: createHash("sha256").update(blob).digest("hex") };
  saveTileRasters(appDb, s03Key, [{ ref, blob }]);
  appDb.prepare("UPDATE analysis_job SET status = 'queued' WHERE analysis_id = ? AND tile_code = 'S04'").run(fallback.analysisId);
  runHeavyTiles(appDb, dataDir, fallback.analysisId);
  assert.notEqual(s04Key(), s04Before, "S03 바람이 바뀌면 S04를 캐시에서 재사용하지 않음");

  assert.equal(getAnalysisRun(appDb, first.analysisId).userId, "7");
  assert.ok(loadTileResults(appDb, first.analysisId).some((tile) => tile.tileCode === "S03"));
  console.log(`✓ v2 wind API (upload ${uploadMs.toFixed(1)}ms, fallback ${fallbackMs.toFixed(1)}ms)`);
} finally {
  appDb.close();
}
