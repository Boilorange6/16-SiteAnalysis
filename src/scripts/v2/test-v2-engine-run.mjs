import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { runAnalysis, restoreSummary } = await import("../../lib/v2/engine/run.ts");
const { HEAVY_TILES, runHeavyTiles } = await import("../../lib/v2/engine/jobs.ts");
const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-eng-run-"));
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-eng-run-app-")), "app.sqlite"));
const input = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-09-30" };

try {
  assert.throws(() => runAnalysis(appDb, dataDir, input), /no published manifest/);

  const h1 = await buildEngineFixture(dataDir, "v1");

  // 대지 확정 실패는 분석 실행을 만들지 않는다
  const bad = runAnalysis(appDb, dataDir, { ...input, address: "경기도 남양주시 다산동 999" });
  assert.deepEqual(bad, { ok: false, reason: "no_point" });
  assert.equal(appDb.prepare("SELECT count(*) FROM analysis_run").pluck().get(), 0);

  // 1회차: 가벼운 타일만 계산하고 무거운 타일은 작업 큐에 넣는다
  const r1 = runAnalysis(appDb, dataDir, input);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.results.map((t) => t.tileCode).sort(), [...TILE_CODES].sort(), "화면 카탈로그의 모든 타일 코드");
  assert.equal(r1.computed.length, TILE_CODES.length - HEAVY_TILES.length);
  assert.deepEqual(r1.queued, [...HEAVY_TILES]);
  assert.deepEqual(r1.reused, []);
  assert.ok(Object.keys(r1.timingsMs.tiles).length >= r1.computed.length, "경량 타일별 시간 기록");
  assert.ok(r1.results.filter((t) => !HEAVY_TILES.includes(t.tileCode)).every((t) => Number.isFinite(t.elapsedMs)), "경량 결과 elapsedMs");
  assert.ok(r1.results.every((t) => t.provenance.manifestHash === h1 && t.analysisId === r1.analysisId));
  assert.equal(A.getAnalysisRun(appDb, r1.analysisId).status, "running");
  assert.equal(A.getAnalysisRun(appDb, r1.analysisId).parameters.jimok, "대");
  assert.deepEqual(r1.results.filter((t) => t.tileCode.startsWith("A")).map((t) => t.status), ["partial", "not_provided", "complete", "partial", "partial", "partial", "not_provided", "not_provided", "not_provided", "not_provided", "no_data", "not_provided"]);
  // P2 타일은 구현 진행에 따라 상태가 바뀐다 — 오류 없이 계약 상태 중 하나면 된다
  assert.ok(r1.results.slice(11).every((t) => ["complete", "partial", "no_data", "not_provided", "pending"].includes(t.status)), "P2 타일은 계약 상태만 낸다");
  runHeavyTiles(appDb, dataDir, r1.analysisId);
  const r1Final = A.loadTileResults(appDb, r1.analysisId);
  const r1Summary = restoreSummary(A.getAnalysisRun(appDb, r1.analysisId), r1Final);
  r1Final.forEach((t) => toTileView(t)); // 화면 변환이 모든 결과를 받는다

  // 보고서 출처 장: 공백이 든 한글 원천 이름도 기준일과 정확히 나뉜다
  {
    const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
    const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
    const { toSummaryView } = await import("../../lib/v2/ui/tile-view.ts");
    const views = new Map(r1Final.map((t) => [t.tileId, toTileView(t)]));
    const plan = buildReportPlan({ summary: toSummaryView(r1Summary, r1Final), views, board: initBoard(r1Final), analysisDate: "2026-09-30" });
    const rows = plan.find((s) => s.kind === "sources").rows;
    assert.ok(rows.some((r) => r.source === "전국 도시공원" && r.asOf === "2026-09-29"));
    assert.ok(rows.some((r) => r.source === "전국 버스정류장" && r.asOf === "2025-12-09"));
    assert.ok(rows.some((r) => r.source === "건축물대장 총괄표제부" && r.asOf === "2026-08"));
  }

  // 2회차: 같은 조건·manifest → 재계산 없이 재사용, 값은 같고 분석 ID만 새것
  const r2 = runAnalysis(appDb, dataDir, input);
  assert.deepEqual(r2.computed, []);
  assert.equal(r2.reused.length, TILE_CODES.length);
  assert.notEqual(r2.analysisId, r1.analysisId);
  const withoutElapsed = ({ elapsedMs: _elapsedMs, ...tile }) => tile;
  assert.deepEqual(r2.results.map((t) => withoutElapsed({ ...t, tileId: "", analysisId: "" })), r1Final.map((t) => withoutElapsed({ ...t, tileId: "", analysisId: "" })));
  assert.ok(r2.results.every((t) => t.analysisId === r2.analysisId && t.tileId.startsWith(r2.analysisId)));

  // 반경 또는 분석일이 다르면 다시 계산
  const wide = runAnalysis(appDb, dataDir, { ...input, radiusM: 1000 });
  assert.equal(wide.computed.length, TILE_CODES.length - HEAVY_TILES.length);
  runHeavyTiles(appDb, dataDir, wide.analysisId);
  const newDate = runAnalysis(appDb, dataDir, { ...input, analysisDate: "2026-10-01" });
  assert.ok(newDate.computed.length > 0);
  runHeavyTiles(appDb, dataDir, newDate.analysisId);

  // 저장된 분석 복원: 요약도 실행 조건에서 다시 만든다
  const restored = A.loadTileResults(appDb, r1.analysisId);
  assert.deepEqual(restored.map((t) => t.tileCode), [...TILE_CODES].sort());
  assert.deepEqual(restoreSummary(A.getAnalysisRun(appDb, r1.analysisId), restored), r1Summary);
  assert.equal(r1Summary.facts.length, 3);
  const oldSaved = structuredClone(restored);
  const oldSavedD19 = oldSaved.find((tile) => tile.tileCode === "D19");
  if (oldSavedD19) delete oldSavedD19.presentation.polygons;
  const oldSavedSummary = restoreSummary(A.getAnalysisRun(appDb, r1.analysisId), oldSaved);
  assert.equal(oldSavedSummary.siteParcel, null, "옛 저장 분석의 필지 정보 없음은 null");
  assert.doesNotThrow(() => toSummaryView(oldSavedSummary, oldSaved), "옛 저장 분석은 링 폴백으로 복원");

  // 새 manifest → 새 데이터로 재계산, 옛 분석은 그대로
  const h2 = await buildEngineFixture(dataDir, "v2", { extraBus: true });
  const r3 = runAnalysis(appDb, dataDir, input);
  assert.deepEqual([r3.reused, r3.computed.length, r3.queued], [[], TILE_CODES.length - HEAVY_TILES.length, [...HEAVY_TILES]]);
  runHeavyTiles(appDb, dataDir, r3.analysisId);
  assert.ok(r3.results.every((t) => t.provenance.manifestHash === h2));
  assert.equal(r3.results.find((t) => t.tileCode === "A01").metrics.find((m) => m.id === "bus_stops").value, 3);
  assert.deepEqual(A.loadTileResults(appDb, r1.analysisId), [...r1Final].sort((a, b) => (a.tileCode < b.tileCode ? -1 : 1)));

  // 좌표 직접 입력
  const c = runAnalysis(appDb, dataDir, { center: [127.1506, 37.6245], radiusM: 500, analysisDate: "2026-09-30" });
  assert.equal(c.ok, true);
  assert.match(c.results[0].conditions.address, /^좌표 /);
  runHeavyTiles(appDb, dataDir, c.analysisId);

  // 타일 하나가 던져도 분석은 끝나고, 실패 타일은 캐시되지 않는다
  const broken = mkdtempSync(join(tmpdir(), "v2-eng-run-broken-"));
  let failedCodes = [];
  await buildEngineFixture(broken, "v1");
  const brokenInput = { ...input, analysisDate: "2026-08-01" }; // 앞선 실행의 캐시와 겹치지 않게
  const { EngineContext } = await import("../../lib/v2/engine/context.ts");
  const origHits = EngineContext.prototype.hits;
  let brokenAnalysisId = "";
  EngineContext.prototype.hits = function (key, kinds) {
    if (kinds.includes("park")) throw new Error("boom");
    return origHits.call(this, key, kinds);
  };
  try {
    const f = runAnalysis(appDb, broken, brokenInput);
    brokenAnalysisId = f.analysisId;
    const a04 = f.results.find((t) => t.tileCode === "A04");
    assert.deepEqual([a04.status, a04.limitations[0].note], ["failed", "계산 중 오류: boom"]);
    // 공원을 읽는 통합 타일 A04만 실패하고 나머지는 계산된다
    failedCodes = f.results.filter((t) => t.status === "failed").map((t) => t.tileCode);
    assert.ok(failedCodes.includes("A04"), failedCodes.join(","));
    assert.ok(f.results.filter((t) => t.status === "failed").every((t) => t.limitations[0].note === "계산 중 오류: boom"));
  } finally {
    EngineContext.prototype.hits = origHits;
  }
  runHeavyTiles(appDb, broken, brokenAnalysisId);
  assert.equal(A.getAnalysisRun(appDb, brokenAnalysisId).status, "complete");
  const again = runAnalysis(appDb, broken, brokenInput);
  assert.deepEqual([...again.computed].sort(), [...failedCodes].sort(), "실패한 타일만 다시 계산된다");
} finally {
  appDb.close();
}

console.log("✓ v2 engine run");
