/** P4 T3 백그라운드 큐·무거운 타일·폴링 응답·보드 결과 교체 회귀. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { cancelAnalysis, postAnalysis, getAnalysis, getAnalysisStatus } = await import("../../lib/v2/engine/api.ts");
const { HEAVY_TILES, DATE_INDEPENDENT, listJobs, recoverRunningJobs, runHeavyTiles, runQueuedJobs, startJobRunner } = await import("../../lib/v2/engine/jobs.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { boardReducer, initBoard } = await import("../../lib/v2/ui/board-state.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-jobs-data-"));
const appDbPath = join(mkdtempSync(join(tmpdir(), "v2-jobs-app-")), "app.sqlite");
const appDb = A.openV2AppDb(appDbPath);
await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true, terrain: true, landuse: true });
const input = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-09-30" };

try {
  const first = postAnalysis(appDb, dataDir, input, 17);
  assert.equal(first.status, 202, "POST는 가벼운 타일 뒤 202");
  assert.ok(Array.isArray(first.body.jobs));
  assert.deepEqual(first.body.jobs.filter((job) => job.status === "queued").map((job) => job.code), [...HEAVY_TILES]);
  for (const code of HEAVY_TILES) assert.equal(first.body.results.find((result) => result.tileCode === code)?.status, "pending", `${code} pending 자리표시`);
  const initialStatus = getAnalysisStatus(appDb, first.body.analysisId, 17);
  assert.equal(initialStatus.status, 200);
  assert.equal(initialStatus.body.revision, first.body.revision);
  assert.ok(initialStatus.body.tiles.every((tile) => tile.status));
  assert.equal(getAnalysisStatus(appDb, first.body.analysisId, 17).body.revision, initialStatus.body.revision, "변경 없는 상태 응답은 revision을 유지");

  // 소유자만 취소할 수 있고, 아직 시작하지 않은 무거운 타일은 즉시 취소된다.
  const queuedCancel = postAnalysis(appDb, dataDir, { ...input, radiusM: 500 }, 17);
  assert.equal(queuedCancel.status, 202);
  assert.equal(cancelAnalysis(appDb, queuedCancel.body.analysisId, 18).status, 404, "남의 분석 취소는 숨긴다");
  const queuedCancelled = cancelAnalysis(appDb, queuedCancel.body.analysisId, 17);
  assert.equal(queuedCancelled.status, 200);
  assert.equal(queuedCancelled.body.status, "cancelled");
  assert.ok(queuedCancelled.body.jobs.every((job) => job.status === "cancelled" && job.retryable), JSON.stringify(queuedCancelled.body.jobs));
  assert.ok(queuedCancelled.body.results === undefined, "취소 응답은 상태·작업만 반환해도 된다");
  const queuedCancelledRead = getAnalysis(appDb, queuedCancel.body.analysisId, 17);
  assert.equal(queuedCancelledRead.status, 200);
  assert.equal(queuedCancelledRead.body.status, "cancelled");
  assert.ok(queuedCancelledRead.body.results.filter((result) => HEAVY_TILES.includes(result.tileCode)).every((result) => result.status === "cancelled"));
  assert.ok(queuedCancelledRead.body.jobs.every((job) => job.status === "cancelled" && job.error.includes("다시 실행")));

  // 실행 중인 행은 요청 시 running을 유지해 현재 타일을 마치고, 재시작 복구 시 cancelled로 확정한다.
  const runningCancel = postAnalysis(appDb, dataDir, { ...input, radiusM: 1000 }, 17);
  const runningCode = runningCancel.body.jobs.find((job) => job.status === "queued")?.code;
  assert.ok(runningCode);
  appDb.prepare("UPDATE analysis_job SET status = 'running', started_at = ? WHERE analysis_id = ? AND tile_code = ?")
    .run(new Date().toISOString(), runningCancel.body.analysisId, runningCode);
  const runningRequested = cancelAnalysis(appDb, runningCancel.body.analysisId, 17);
  assert.equal(runningRequested.status, 200);
  const runningJob = listJobs(appDb, runningCancel.body.analysisId).find((job) => job.code === runningCode);
  assert.equal(runningJob.status, "running");
  assert.ok(runningJob.cancelRequestedAt);
  assert.equal(recoverRunningJobs(appDb), 1);
  const recoveredCancelled = listJobs(appDb, runningCancel.body.analysisId);
  assert.ok(recoveredCancelled.every((job) => job.status === "cancelled" && job.retryable));
  assert.equal(getAnalysis(appDb, runningCancel.body.analysisId, 17).body.results.find((result) => result.tileCode === runningCode)?.status, "cancelled");

  runHeavyTiles(appDb, dataDir, first.body.analysisId);
  const done = getAnalysis(appDb, first.body.analysisId, 17);
  assert.equal(done.status, 200);
  assert.ok(done.body.jobs.every((job) => job.status === "done"));
  assert.ok(done.body.jobs.every((job) => job.elapsedMs > 0));
  assert.ok(done.body.results.filter((result) => HEAVY_TILES.includes(result.tileCode)).every((result) => ["complete", "partial", "not_provided"].includes(result.status)));
  assert.equal(A.getAnalysisRun(appDb, first.body.analysisId).status, "complete");
  assert.notEqual(getAnalysisStatus(appDb, first.body.analysisId, 17).body.revision, initialStatus.body.revision, "타일 완료 시 revision 변경");

  // 같은 조건은 무거운 결과와 래스터 캐시를 재사용해 새 job을 만들지 않는다.
  const reused = postAnalysis(appDb, dataDir, input, 17);
  assert.equal(reused.status, 202);
  assert.deepEqual(reused.body.jobs, [], "재사용 분석은 queued job 없음");
  assert.ok(reused.body.results.filter((result) => HEAVY_TILES.includes(result.tileCode)).every((result) => result.status !== "pending"));

  // 날짜 독립 타일은 날짜가 달라도 재사용한다. 날짜 의존 무거운 타일만 새로 큐에 남는다.
  const otherDate = postAnalysis(appDb, dataDir, { ...input, analysisDate: "2026-10-01" }, 17);
  const independentQueued = otherDate.body.jobs.filter((job) => job.status === "queued").map((job) => job.code);
  for (const code of DATE_INDEPENDENT) assert.ok(!independentQueued.includes(code), `${code} date-independent 재사용`);
  assert.ok(independentQueued.every((code) => !DATE_INDEPENDENT.has(code)));
  runHeavyTiles(appDb, dataDir, otherDate.body.analysisId);

  // 한 무거운 계산이 실패해도 나머지 job은 계속 처리하고 분석은 종료한다.
  const failure = postAnalysis(appDb, dataDir, { ...input, analysisDate: "2026-08-01" }, 17);
  const originalHits = EngineContext.prototype.hits;
  EngineContext.prototype.hits = function (key, kinds, radiusM) {
    if (kinds.includes("building")) throw new Error("synthetic heavy failure");
    return originalHits.call(this, key, kinds, radiusM);
  };
  try {
    runHeavyTiles(appDb, dataDir, failure.body.analysisId);
  } finally {
    EngineContext.prototype.hits = originalHits;
  }
  const failedJobs = listJobs(appDb, failure.body.analysisId);
  assert.ok(failedJobs.some((job) => job.status === "failed"));
  assert.ok(failedJobs.some((job) => job.status === "done"));
  assert.equal(A.getAnalysisRun(appDb, failure.body.analysisId).status, "complete");

  // 게시 버전이 바뀌어도 큐는 분석 시점의 보관 manifest를 사용하고, 한 분석의 실패가 다음 분석을 막지 않는다.
  const pinnedDataDir = mkdtempSync(join(tmpdir(), "v2-jobs-pinned-data-"));
  const pinnedAppDbPath = join(mkdtempSync(join(tmpdir(), "v2-jobs-pinned-app-")), "app.sqlite");
  const pinnedAppDb = A.openV2AppDb(pinnedAppDbPath);
  const fixtureOptions = { buildings: true, parcels: true, terrain: true, landuse: true };
  const pinnedA = await buildEngineFixture(pinnedDataDir, "manifest-a", fixtureOptions);
  const oldAnalysis = postAnalysis(pinnedAppDb, pinnedDataDir, input, 71);
  assert.equal(oldAnalysis.status, 202);
  const pinnedB = await buildEngineFixture(pinnedDataDir, "manifest-b", fixtureOptions);
  const newAnalysis = postAnalysis(pinnedAppDb, pinnedDataDir, { ...input, analysisDate: "2026-10-01" }, 72);
  assert.equal(newAnalysis.status, 202);
  pinnedAppDb.close();
  runQueuedJobs(pinnedAppDbPath, pinnedDataDir);
  const pinnedCheck = A.openV2AppDb(pinnedAppDbPath);
  try {
    assert.ok(listJobs(pinnedCheck, oldAnalysis.body.analysisId).every((job) => job.status === "done"), "old manifest job completes");
    assert.ok(listJobs(pinnedCheck, newAnalysis.body.analysisId).every((job) => job.status === "done"), "new manifest job completes after old one");
    assert.ok(A.loadTileResults(pinnedCheck, oldAnalysis.body.analysisId).filter((result) => HEAVY_TILES.includes(result.tileCode)).every((result) => result.provenance.manifestHash === pinnedA));
    assert.ok(A.loadTileResults(pinnedCheck, newAnalysis.body.analysisId).filter((result) => HEAVY_TILES.includes(result.tileCode)).every((result) => result.provenance.manifestHash === pinnedB));
  } finally {
    pinnedCheck.close();
  }

  const missingDataDir = mkdtempSync(join(tmpdir(), "v2-jobs-missing-data-"));
  const missingAppDbPath = join(mkdtempSync(join(tmpdir(), "v2-jobs-missing-app-")), "app.sqlite");
  const missingAppDb = A.openV2AppDb(missingAppDbPath);
  const missingA = await buildEngineFixture(missingDataDir, "manifest-a", fixtureOptions);
  const staleAnalysis = postAnalysis(missingAppDb, missingDataDir, input, 73);
  const currentB = await buildEngineFixture(missingDataDir, "manifest-b", fixtureOptions);
  const currentAnalysis = postAnalysis(missingAppDb, missingDataDir, { ...input, analysisDate: "2026-10-01" }, 74);
  missingAppDb.close();
  rmSync(join(missingDataDir, "manifests", `${missingA}.json`));
  runQueuedJobs(missingAppDbPath, missingDataDir);
  const missingCheck = A.openV2AppDb(missingAppDbPath);
  try {
    const staleJobs = listJobs(missingCheck, staleAnalysis.body.analysisId);
    assert.ok(staleJobs.every((job) => job.status === "failed"), "missing pinned manifest fails every stale job");
    assert.ok(staleJobs.every((job) => job.error === "데이터 버전이 바뀌어 다시 계산해야 합니다"), "job exposes re-run reason");
    const staleResults = A.loadTileResults(missingCheck, staleAnalysis.body.analysisId).filter((result) => HEAVY_TILES.includes(result.tileCode));
    assert.ok(staleResults.every((result) => result.status === "failed"));
    assert.ok(staleResults.every((result) => result.limitations.some((limitation) => limitation.note === "데이터 버전이 바뀌어 다시 계산해야 합니다")), "tile exposes re-run reason");
    assert.ok(listJobs(missingCheck, currentAnalysis.body.analysisId).every((job) => job.status === "done"), "worker continues with current manifest jobs");
    assert.ok(A.loadTileResults(missingCheck, currentAnalysis.body.analysisId).filter((result) => HEAVY_TILES.includes(result.tileCode)).every((result) => result.provenance.manifestHash === currentB));
  } finally {
    missingCheck.close();
  }

  // 재시작 때 worker가 잡고 있던 running 행은 queued로 되돌린다.
  A.ensureAnalysisJobTable(appDb);
  const restartRun = A.getAnalysisRun(appDb, first.body.analysisId);
  A.createAnalysisRun(appDb, { analysisId: "restart", address: restartRun.address, center: restartRun.center, radiusM: restartRun.radiusM, analysisDate: restartRun.analysisDate, manifestHash: restartRun.manifestHash, engineVersion: restartRun.engineVersion, parameters: {} });
  appDb.prepare("INSERT INTO analysis_job (analysis_id, tile_code, status, priority, enqueued_at, started_at) VALUES (?, ?, 'running', 1, ?, ?)").run("restart", "S02", new Date().toISOString(), new Date().toISOString());
  assert.equal(recoverRunningJobs(appDb), 1);
  assert.equal(listJobs(appDb, "restart")[0].status, "queued");

  // 폴링으로 새 결과를 받아도 보드 배치 상태(순서·포함·면)는 유지한다.
  const original = initBoard(GODEOK_RESULTS);
  let edited = boardReducer(original, { type: "move", id: GODEOK_RESULTS[1].tileId, dir: 1 });
  edited = boardReducer(edited, { type: "include", id: GODEOK_RESULTS[2].tileId, value: false });
  edited = boardReducer(edited, { type: "face", id: GODEOK_RESULTS[3].tileId, face: "both" });
  const refreshed = GODEOK_RESULTS.map((result) => ({ ...result, status: "running" }));
  const replaced = boardReducer(edited, { type: "replaceResults", results: refreshed });
  assert.deepEqual(replaced.order, edited.order);
  assert.deepEqual(replaced.included, edited.included);
  assert.deepEqual(replaced.faces, edited.faces);
  assert.deepEqual(replaced.results, refreshed);
  const partialReplaced = boardReducer(edited, { type: "replaceResults", results: [refreshed[0]] });
  assert.equal(partialReplaced.results.length, edited.results.length, "부분 결과 교체가 기존 타일을 버리지 않음");
  assert.deepEqual(partialReplaced.results.find((result) => result.tileId === refreshed[0].tileId), refreshed[0]);

  // 실제 worker_threads 진입점도 TSX 개발 실행에서 큐를 비운다.
  const workerPost = postAnalysis(appDb, dataDir, { ...input, analysisDate: "2026-07-01" }, 17);
  startJobRunner({ appDbPath, dataDir });
  for (let i = 0; i < 400; i += 1) {
    if (listJobs(appDb, workerPost.body.analysisId).every((job) => job.status === "done" || job.status === "failed")) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(listJobs(appDb, workerPost.body.analysisId).every((job) => job.status === "done" || job.status === "failed"), "worker가 queued job을 처리");
} finally {
  appDb.close();
}

console.log("✓ v2 jobs");
