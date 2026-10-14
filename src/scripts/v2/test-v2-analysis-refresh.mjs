import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { postAnalysis, getAnalysis, getAnalysisRefreshSummary, refreshAnalysis } = await import("../../lib/v2/engine/api.ts");
const { listJobs, runHeavyTiles } = await import("../../lib/v2/engine/jobs.ts");
const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { ENGINE_VERSION } = await import("../../lib/v2/engine/tiles/common.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-analysis-refresh-data-"));
const emptyDir = mkdtempSync(join(tmpdir(), "v2-analysis-refresh-empty-"));
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-analysis-refresh-app-")), "app.sqlite"));
const fixtureOptions = { buildings: true, parcels: true, terrain: true, landuse: true, roads: true };
const address = "경기도 남양주시 다산동 100";
const input = { address, radiusM: 800, analysisDate: "2026-09-30" };

const rowFor = (analysisId, code) => appDb.prepare("SELECT cache_key, result_json, status FROM tile_result WHERE analysis_id = ? AND tile_code = ?").get(analysisId, code);
const allCodes = (jobs) => jobs.map((job) => job.code).sort();
const assertAllCodes = (codes, message) => assert.deepEqual([...codes].sort(), [...TILE_CODES].sort(), message);

await buildEngineFixture(dataDir, "refresh-v1", fixtureOptions);

try {
  const created = postAnalysis(appDb, dataDir, input, 17);
  assert.equal(created.status, 202);
  const analysisId = created.body.analysisId;
  assert.equal(typeof analysisId, "string");

  runHeavyTiles(appDb, dataDir, analysisId);
  let first = getAnalysis(appDb, analysisId, 17, { dataDir });
  assert.equal(first.status, 200);
  assert.equal(first.body.refresh.available, true);
  assert.equal(first.body.refresh.state, "fresh", JSON.stringify(first.body.refresh));
  assert.equal(first.body.refresh.stale, false);
  assert.equal(first.body.refresh.dataChanged, false);
  assert.equal(first.body.refresh.engineChanged, false);
  assert.deepEqual(first.body.refresh.staleCodes, []);
  assert.deepEqual(first.body.refresh.staleTiles, [], "refresh API exposes stale tile codes");
  assert.equal(first.body.refresh.tiles.length, TILE_CODES.length);
  assertAllCodes(first.body.refresh.tiles.map((tile) => tile.code), "GET refresh summary covers every catalog tile");

  // S03 may intentionally remain pending while waiting for the browser wind
  // case; with the current key and no active job it is not an old result.
  const pendingS03 = rowFor(analysisId, "S03");
  const pendingS03Json = JSON.parse(pendingS03.result_json);
  pendingS03Json.status = "pending";
  appDb.prepare("UPDATE tile_result SET status = 'pending', result_json = ? WHERE analysis_id = ? AND tile_code = 'S03'").run(JSON.stringify(pendingS03Json), analysisId);
  const currentPending = getAnalysis(appDb, analysisId, 17, { dataDir });
  assert.ok(!currentPending.body.refresh.staleCodes.includes("S03"), "current pending result is not an old engine/data result");
  appDb.prepare("UPDATE tile_result SET status = ?, result_json = ? WHERE analysis_id = ? AND tile_code = 'S03'").run(pendingS03.status, pendingS03.result_json, analysisId);

  await A.saveProject(appDb, dataDir, {
    projectId: "refresh-board",
    name: "보존 보드",
    analysisId,
    board: { order: ["keep"], included: { A01: false }, faces: { A01: "both" } },
    userId: 17,
  });
  const boardBefore = appDb.prepare("SELECT board_json FROM saved_project WHERE project_id = ?").pluck().get("refresh-board");
  const beforeKey = rowFor(analysisId, "A03").cache_key;

  // ENGINE_VERSION 변경만 있는 stale 판정과 같은 analysisId refresh.
  appDb.prepare("UPDATE analysis_run SET engine_version = ? WHERE analysis_id = ?").run("v2-engine-before-refresh", analysisId);
  const engineStale = getAnalysis(appDb, analysisId, 17, { dataDir });
  assert.equal(engineStale.body.refresh.engineChanged, true);
  assert.equal(engineStale.body.refresh.stale, true);
  assertAllCodes(engineStale.body.refresh.staleCodes, "engine revision bump stales all catalog codes");
  const engineRefresh = refreshAnalysis(appDb, dataDir, analysisId, 17);
  assert.equal(engineRefresh.status, 202);
  assert.equal(engineRefresh.body.analysisId, analysisId);
  assertAllCodes(allCodes(listJobs(appDb, analysisId)), "engine refresh queues all stale codes");
  runHeavyTiles(appDb, dataDir, analysisId);
  first = getAnalysis(appDb, analysisId, 17, { dataDir });
  assert.equal(first.body.refresh.stale, false, JSON.stringify(first.body.refresh));
  assert.deepEqual(first.body.refresh.staleCodes, []);
  assert.deepEqual(first.body.refresh.staleTiles, []);
  assert.equal(A.getAnalysisRun(appDb, analysisId).engineVersion, ENGINE_VERSION);

  // Current manifest 변경은 dataChanged로 분리하고, archive 확인 뒤 동일 ID를 갱신한다.
  const manifestV2 = await buildEngineFixture(dataDir, "refresh-v2", { ...fixtureOptions, extraBus: true });
  const changed = getAnalysisRefreshSummary(appDb, analysisId, dataDir);
  assert.equal(changed.dataChanged, true);
  assert.equal(changed.currentManifestHash, manifestV2);
  assert.equal(changed.engineChanged, false);
  assert.equal(changed.stale, true);
  assertAllCodes(changed.staleCodes, "manifest change stales all catalog codes");
  const refresh = refreshAnalysis(appDb, dataDir, analysisId, 17);
  assert.equal(refresh.status, 202);
  assert.equal(refresh.body.analysisId, analysisId, "refresh keeps analysisId");
  assert.equal(A.getAnalysisRun(appDb, analysisId).manifestHash, manifestV2, "refresh pins current manifest");
  assert.equal(A.getAnalysisRun(appDb, analysisId).engineVersion, ENGINE_VERSION);
  assertAllCodes(allCodes(listJobs(appDb, analysisId)), "manifest refresh queues every stale code");
  assert.equal(appDb.prepare("SELECT board_json FROM saved_project WHERE project_id = ?").pluck().get("refresh-board"), boardBefore, "refresh does not mutate saved board");
  runHeavyTiles(appDb, dataDir, analysisId);
  const refreshed = getAnalysis(appDb, analysisId, 17, { dataDir });
  assert.equal(refreshed.body.refresh.stale, false, JSON.stringify(refreshed.body.refresh));
  assert.equal(refreshed.body.refresh.dataChanged, false);
  assert.equal(refreshed.body.refresh.engineChanged, false);
  assert.deepEqual(refreshed.body.refresh.staleCodes, []);
  assert.deepEqual(refreshed.body.refresh.staleTiles, []);
  for (const tile of refreshed.body.refresh.tiles) {
    const row = rowFor(analysisId, tile.code);
    assert.equal(row.cache_key, tile.currentCacheKey, `${tile.code} cache key matches worker key`);
  }
  assert.ok(listJobs(appDb, analysisId).every((job) => job.status === "done"), JSON.stringify(listJobs(appDb, analysisId)));

  // No-op refresh does not enqueue jobs and reports a stable 200 response.
  const unchanged = refreshAnalysis(appDb, dataDir, analysisId, 17);
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.analysisId, analysisId);
  assert.deepEqual(unchanged.body.queued, []);
  assert.equal(unchanged.body.refresh.stale, false);

  // Active and owner checks: do not reveal another user's or a missing analysis.
  appDb.prepare("UPDATE analysis_run SET status = 'running' WHERE analysis_id = ?").run(analysisId);
  assert.equal(refreshAnalysis(appDb, dataDir, analysisId, 17).status, 409);
  appDb.prepare("UPDATE analysis_run SET status = 'complete' WHERE analysis_id = ?").run(analysisId);
  assert.equal(refreshAnalysis(appDb, dataDir, analysisId, 18).status, 404);
  assert.equal(refreshAnalysis(appDb, dataDir, "does-not-exist", 17).status, 404);

  // A refresh failure keeps the prior stale JSON/cache key; only the job records the error.
  await buildEngineFixture(dataDir, "refresh-v3", { ...fixtureOptions, extraBus: true });
  const oldA03 = rowFor(analysisId, "A03");
  const failedRefresh = refreshAnalysis(appDb, dataDir, analysisId, 17);
  assert.equal(failedRefresh.status, 202);
  assertAllCodes(allCodes(listJobs(appDb, analysisId)), "failure refresh queues all stale codes");
  const originalHits = EngineContext.prototype.hits;
  EngineContext.prototype.hits = function (key, kinds, radiusM) {
    if (kinds.includes("store")) throw new Error("synthetic refresh failure");
    return originalHits.call(this, key, kinds, radiusM);
  };
  try {
    runHeavyTiles(appDb, dataDir, analysisId);
  } finally {
    EngineContext.prototype.hits = originalHits;
  }
  const keptA03 = rowFor(analysisId, "A03");
  assert.equal(keptA03.cache_key, oldA03.cache_key, "failed refresh keeps old cache key");
  assert.equal(keptA03.result_json, oldA03.result_json, "failed refresh keeps old tile JSON");
  assert.equal(listJobs(appDb, analysisId).find((job) => job.code === "A03").status, "failed");
  assert.ok(listJobs(appDb, analysisId).find((job) => job.code === "A03").error);
  assert.ok(listJobs(appDb, analysisId).every((job) => job.status !== "queued" && job.status !== "running"));
  const afterFailure = getAnalysis(appDb, analysisId, 17, { dataDir });
  assert.equal(afterFailure.body.refresh.stale, true);
  assert.ok(afterFailure.body.refresh.staleCodes.includes("A03"));

  // Missing current manifest must be an explicit GET summary error, not a GET failure.
  const unavailable = getAnalysis(appDb, analysisId, 17, { dataDir: emptyDir });
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.body.refresh.available, false);
  assert.equal(unavailable.body.refresh.state, "unavailable");
  assert.equal(typeof unavailable.body.refresh.error, "string");
  assert.equal(refreshAnalysis(appDb, emptyDir, analysisId, 17).status, 503);
} finally {
  appDb.close();
}

// Route follows the existing auth convention and does not mutate the DB without auth.
const { NextRequest } = await import("next/server");
const { POST } = await import("../../app/api/v2/analyses/[id]/refresh/route.ts");
const noAuth = await POST(new NextRequest("http://localhost/site/api/v2/analyses/nope/refresh", { method: "POST" }), { params: Promise.resolve({ id: "nope" }) });
assert.equal(noAuth.status, 401);

console.log("✓ v2 analysis refresh");
