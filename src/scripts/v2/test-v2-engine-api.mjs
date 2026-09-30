import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const A = await import("../../lib/v2/app-db.ts");
const { postAnalysis, getAnalysis } = await import("../../lib/v2/engine/api.ts");

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

  // 정상: 기본 반경 800
  const ok = postAnalysis(appDb, dataDir, { address, analysisDate: "2026-09-30" });
  assert.equal(ok.status, 200);
  assert.deepEqual(Object.keys(ok.body).sort(), ["analysisId", "results", "summary"]);
  assert.equal(ok.body.results.length, 13);
  assert.equal(ok.body.summary.address, address);
  assert.equal(ok.body.results[0].conditions.radiusM, 800);

  // 대지 확정 실패 → 422, 이유별 안내
  const cases = [["경기도 남양주시 다산동", "parse_failed", /지번 주소로 입력/], ["경기도 남양주시 별내동 1", "ambiguous", /동·리까지/], ["경기도 남양주시 다산동 999", "no_point", /필지 위치 미확보/]];
  for (const [a, reason, msg] of cases) {
    const r = postAnalysis(appDb, dataDir, { address: a });
    assert.deepEqual([r.status, r.body.reason], [422, reason]);
    assert.match(r.body.error, msg);
  }

  // 게시된 데이터가 없으면 503
  assert.equal(postAnalysis(appDb, emptyDir, { address }).status, 503);

  // 복원
  const got = getAnalysis(appDb, ok.body.analysisId);
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.summary, ok.body.summary);
  assert.deepEqual(got.body.results.map((t) => t.tileCode), ok.body.results.map((t) => t.tileCode).sort());
  assert.equal(getAnalysis(appDb, "nope").status, 404);
} finally {
  appDb.close();
}

// 인증: 토큰이 없으면 401 (라우트가 분석을 시작하지 않는다)
const { NextRequest } = await import("next/server");
const post = (await import("../../app/api/v2/analyses/route.ts")).POST;
const get = (await import("../../app/api/v2/analyses/[id]/route.ts")).GET;
const noAuth = await post(new NextRequest("http://localhost/site/api/v2/analyses", { method: "POST", body: JSON.stringify({ address }) }));
assert.equal(noAuth.status, 401);
const noAuthGet = await get(new NextRequest("http://localhost/site/api/v2/analyses/x"), { params: Promise.resolve({ id: "x" }) });
assert.equal(noAuthGet.status, 401);

console.log("✓ v2 engine api");
