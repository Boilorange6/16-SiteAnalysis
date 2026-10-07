import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { postAnalysis, getAnalysis, getAnalysisStatus } = await import("../../lib/v2/engine/api.ts");
const { ROAD_ADDRESS_UNSUPPORTED_MESSAGE, isRoadAddress } = await import("../../lib/v2/site.ts");
const { runHeavyTiles } = await import("../../lib/v2/engine/jobs.ts");
const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-eng-api-"));
const emptyDir = mkdtempSync(join(tmpdir(), "v2-eng-api-empty-"));
const appDb = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-eng-api-app-")), "app.sqlite"));
await buildEngineFixture(dataDir, "v1");
const address = "경기도 남양주시 다산동 100";

try {
  // 입력 검증 → 400
  for (const [body, re] of [
    [null, /./],
    [{}, /주소 또는 좌표/],
    [{ address, radiusM: 700 }, /500, 800, 1000, 2000, 3000/],
    [{ address, radiusM: "800" }, /./],
    [{ address, analysisDate: "2026-02-30" }, /올바른 날짜/],
    [{ center: [0, 0] }, /./],
    [{ address: "   " }, /./],
  ]) {
    const r = postAnalysis(appDb, dataDir, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re);
  }
  assert.equal(appDb.prepare("SELECT count(*) FROM analysis_run").pluck().get(), 0, "검증 실패는 실행을 남기지 않는다");

  assert.equal(isRoadAddress("서울특별시 강동구 아리수로 250"), true);
  assert.equal(isRoadAddress("서울특별시 강동구 고덕동 250"), false);

  // 정상: 기본 반경 800
  const ok = postAnalysis(appDb, dataDir, { address, analysisDate: "2026-09-30" }, 17);
  assert.equal(ok.status, 202);
  assert.deepEqual(Object.keys(ok.body).sort(), ["analysisId", "jobs", "results", "revision", "status", "summary", "tiles", "timingsMs"]);
  assert.equal(ok.body.status, "running");
  assert.equal(ok.body.results.length, TILE_CODES.length);
  assert.equal(ok.body.summary.address, address);
  assert.equal(ok.body.results[0].conditions.radiusM, 800);
  assert.ok(ok.body.jobs.some((job) => job.status === "queued"));
  assert.ok(ok.body.timingsMs.light > 0);
  assert.ok(Object.keys(ok.body.timingsMs.tiles).length > 0, "POST가 경량 타일별 시간을 공개");
  assert.ok(ok.body.results.filter((tile) => !["S02", "D21", "D29", "D10", "S03", "S04"].includes(tile.tileCode)).every((tile) => Number.isFinite(tile.elapsedMs)), "경량 결과에 elapsedMs");
  assert.ok(typeof ok.body.revision === "string" && ok.body.revision.length > 0);
  assert.equal(ok.body.tiles.length, ok.body.results.length);
  assert.equal(appDb.prepare("SELECT user_id FROM analysis_run WHERE analysis_id = ?").pluck().get(ok.body.analysisId), "17");

  // 대지 확정 실패 → 422, 이유별 안내
  const cases = [
    ["서울특별시 강동구 아리수로 250", "road_address_unsupported", new RegExp(ROAD_ADDRESS_UNSUPPORTED_MESSAGE)],
    ["경기도 남양주시 다산동", "parse_failed", /지번 주소로 입력/],
    ["경기도 남양주시 별내동 1", "ambiguous", /동·리까지/],
    ["경기도 남양주시 다산동 999", "no_point", /필지 위치 미확보/],
  ];
  for (const [a, reason, msg] of cases) {
    const r = postAnalysis(appDb, dataDir, { address: a });
    assert.deepEqual([r.status, r.body.reason], [422, reason]);
    if (reason === "road_address_unsupported") assert.equal(r.body.error, ROAD_ADDRESS_UNSUPPORTED_MESSAGE);
    else assert.match(r.body.error, msg);
  }

  // 게시된 데이터가 없으면 503
  assert.equal(postAnalysis(appDb, emptyDir, { address }).status, 503);

  // 복원
  const got = getAnalysis(appDb, ok.body.analysisId, 17);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.summary, ok.body.summary);
  assert.deepEqual(
    got.body.results.map((tile) => tile.tileCode).sort(),
    ok.body.results.map((tile) => tile.tileCode).sort(),
    "GET restores the same result set as POST",
  );
  assert.deepEqual(
    got.body.results.map((tile) => JSON.stringify(tile)).sort(),
    ok.body.results.map((tile) => JSON.stringify(tile)).sort(),
    "GET result payload is unchanged after the single parse pass",
  );
  assert.deepEqual(got.body.results.map((t) => t.tileCode), ok.body.results.map((t) => t.tileCode).sort());
  assert.ok(got.body.jobs.some((job) => job.status === "queued"));
  assert.ok(got.body.results.filter((tile) => !["S02", "D21", "D29", "D10", "S03", "S04"].includes(tile.tileCode)).every((tile) => Number.isFinite(tile.elapsedMs)), "복원 결과에도 elapsedMs");
  assert.equal(got.body.revision, ok.body.revision);
  const partial = getAnalysis(appDb, ok.body.analysisId, 17, { tileCodes: ["A01"] });
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.summary, got.body.summary, "partial tile response keeps the full summary");
  assert.deepEqual(partial.body.results.map((tile) => tile.tileCode), ["A01"]);
  const status = getAnalysisStatus(appDb, ok.body.analysisId, 17);
  assert.equal(status.status, 200);
  assert.ok(status.body.revision);
  assert.equal(status.body.tiles.length, ok.body.results.length);
  assert.ok(status.body.tiles.every((tile) => typeof tile.revision === "string" && tile.revision.length > 0));
  assert.ok(!("results" in status.body) && !("summary" in status.body), "상태 응답은 전체 결과를 포함하지 않음");
  assert.ok(Buffer.byteLength(JSON.stringify(status.body)) < 10_000, "상태 응답은 10KB 미만");
  runHeavyTiles(appDb, dataDir, ok.body.analysisId);
  const finished = getAnalysis(appDb, ok.body.analysisId, 17);
  assert.ok(finished.body.jobs.every((job) => ["done", "failed"].includes(job.status)));
  assert.equal(getAnalysis(appDb, ok.body.analysisId, 18).status, 404);
  assert.equal(getAnalysis(appDb, "nope").status, 404);
} finally {
  appDb.close();
}

// 인증: 토큰이 없으면 401 (라우트가 분석을 시작하지 않는다)
const { NextRequest } = await import("next/server");
const post = (await import("../../app/api/v2/analyses/route.ts")).POST;
const get = (await import("../../app/api/v2/analyses/[id]/route.ts")).GET;
const del = (await import("../../app/api/v2/analyses/[id]/route.ts")).DELETE;
const noAuth = await post(new NextRequest("http://localhost/site/api/v2/analyses", { method: "POST", body: JSON.stringify({ address }) }));
assert.equal(noAuth.status, 401);
const noAuthGet = await get(new NextRequest("http://localhost/site/api/v2/analyses/x"), { params: Promise.resolve({ id: "x" }) });
assert.equal(noAuthGet.status, 401);
const noAuthDelete = await del(new NextRequest("http://localhost/site/api/v2/analyses/x", { method: "DELETE" }), { params: Promise.resolve({ id: "x" }) });
assert.equal(noAuthDelete.status, 401);

console.log("✓ v2 engine api");
