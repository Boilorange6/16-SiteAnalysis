/** P4 T3 백그라운드 큐·무거운 타일·폴링 응답·보드 결과 교체 회귀. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { postAnalysis, getAnalysis } = await import("../../lib/v2/engine/api.ts");
const { HEAVY_TILES, DATE_INDEPENDENT, listJobs, recoverRunningJobs, runHeavyTiles, startJobRunner } = await import("../../lib/v2/engine/jobs.ts");
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

  runHeavyTiles(appDb, dataDir, first.body.analysisId);
  const done = getAnalysis(appDb, first.body.analysisId, 17);
  assert.equal(done.status, 200);
  assert.ok(done.body.jobs.every((job) => job.status === "done"));
  assert.ok(done.body.jobs.every((job) => job.elapsedMs > 0));
  assert.ok(done.body.results.filter((result) => HEAVY_TILES.includes(result.tileCode)).every((result) => ["complete", "partial", "not_provided"].includes(result.status)));
  assert.equal(A.getAnalysisRun(appDb, first.body.analysisId).status, "complete");

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

  // 재시작 때 worker가 잡고 있던 running 행은 queued로 되돌린다.
  A.ensureAnalysisJobTable(appDb);
  const restartRun = A.getAnalysisRun(appDb, first.body.analysisId);
  A.createAnalysisRun(appDb, { analysisId: "restart", address: restartRun.address, center: restartRun.center, radiusM: restartRun.radiusM, analysisDate: restartRun.analysisDate, manifestHash: restartRun.manifestHash, engineVersion: restartRun.engineVersion, parameters: {} });
  appDb.prepare("INSERT INTO analysis_job (analysis_id, tile_code, status, priority, enqueued_at, started_at) VALUES (?, ?, 'running', 1, ?, ?)").run("restart", "S02", new Date().toISOString(), new Date().toISOString());
  assert.equal(recoverRunningJobs(appDb), 1);
  assert.equal(listJobs(appDb, "restart")[0].status, "queued");

  // 폴링으로 새 결과를 받아도 보드 편집(순서·포함·면)은 유지한다.
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
