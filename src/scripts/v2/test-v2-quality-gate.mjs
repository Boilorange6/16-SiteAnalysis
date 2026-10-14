/**
 * 적재 품질 검사 테스트 (spec §3.5).
 * 2026-08-05 사고: 상류 포맷이 바뀌어 HTTP 200에 0건 — 전국 합계만 보면 못 잡는 실패들이 있다.
 */
import assert from "node:assert/strict";

const { evaluateIngest, checkExpectations, FILL_RATE_DROP_THRESHOLD } = await import("../../lib/v2/data/quality-gate.ts");

const snap = (over = {}) => ({
  total: 1000,
  byRegion: { "11": 500, "26": 300, "41": 200 },
  byType: { apartment: 800, officetel: 200 },
  fillRates: { height_m: 0.8, approval_date: 0.95 },
  ...over,
});
const obs = (over = {}) => ({
  responseRowsReported: 1000, parsedRows: 1000, pageLimitHit: false, totalCountReported: 1000,
  next: snap(), previous: snap(), ...over,
});
const codes = (r) => r.failures.map((f) => f.code).sort();

// 정상
assert.deepEqual(evaluateIngest(obs()), { ok: true, failures: [] });

// 행은 왔는데 파싱 0건
assert.deepEqual(codes(evaluateIngest(obs({ parsedRows: 0, next: snap({ total: 0, byRegion: {}, byType: {} }) }))).includes("PARSED_ZERO_WITH_ROWS"), true);

// 전량 0건
assert.ok(codes(evaluateIngest(obs({ responseRowsReported: 0, parsedRows: 0, totalCountReported: 0, previous: null, next: snap({ total: 0, byRegion: {}, byType: {} }) }))).includes("EMPTY"));

// 30% 초과 급감 / 경계 30%는 통과
assert.ok(codes(evaluateIngest(obs({ parsedRows: 650, totalCountReported: 650, next: snap({ total: 650 }) }))).includes("TOTAL_DROP"));
assert.ok(!codes(evaluateIngest(obs({ parsedRows: 700, totalCountReported: 700, next: snap({ total: 700 }) }))).includes("TOTAL_DROP"));
assert.deepEqual(
  codes(evaluateIngest(obs({ parsedRows: 650, totalCountReported: 650, next: snap({ total: 650 }), expectedMinimumTotal: 650 }))),
  [],
  "정규화된 원천은 선언한 최소 행 수 이상이면 역사적 급감을 허용한다",
);
assert.ok(
  codes(evaluateIngest(obs({ parsedRows: 649, totalCountReported: 649, next: snap({ total: 649 }), expectedMinimumTotal: 650 }))).includes("TOTAL_DROP"),
  "선언한 source별 최소 행 수 아래는 계속 차단한다",
);

// 전국 합계는 정상인데 부산(26)이 통째로 사라짐
assert.deepEqual(
  codes(evaluateIngest(obs({ next: snap({ byRegion: { "11": 800, "41": 200 } }) }))),
  ["REGION_MISSING"],
);
assert.deepEqual(
  codes(evaluateIngest(obs({ next: snap({ byRegion: { "11": 500, "41": 200 } }), allowedMissingRegions: ["26"] }))),
  [],
  "허용 목록에 있는 과거 지역만 제거할 수 있다",
);

// 첫 적재라도 기대 지역이 빠지면 차단
assert.deepEqual(
  codes(evaluateIngest(obs({ previous: null, expectedRegions: ["11", "26", "41", "50"] }))),
  ["REGION_MISSING"],
);

// 유형 소실
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ byType: { apartment: 1000 } }) }))), ["TYPE_MISSING"]);

// 채움률 급락(10%p 초과) / 정확히 10%p는 통과
assert.equal(FILL_RATE_DROP_THRESHOLD, 0.1);
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ fillRates: { height_m: 0.65, approval_date: 0.95 } }) }))), ["FILL_RATE_DROP"]);
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ fillRates: { height_m: 0.7, approval_date: 0.95 } }) }))), []);
// 이전에 있던 필드가 통째로 빠진 것도 급락
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ fillRates: { approval_date: 0.95 } }) }))), ["FILL_RATE_DROP"]);
assert.deepEqual(codes(evaluateIngest(obs({ next: snap({ fillRates: { height_m: Number.NaN, approval_date: 0.95 } }) }))), ["FILL_RATE_DROP"], "NaN 채움률은 하락");

// 페이지 상한·totalCount 불일치
assert.deepEqual(codes(evaluateIngest(obs({ pageLimitHit: true }))), ["INCOMPLETE_FETCH"]);
assert.deepEqual(codes(evaluateIngest(obs({ totalCountReported: 1200 }))), ["INCOMPLETE_FETCH"]);
assert.deepEqual(codes(evaluateIngest(obs({ totalCountReported: null }))), [], "totalCount를 안 주는 원천은 비교하지 않는다");

// 고정 지점 기대치
{
  const counts = { "guryong:building": 120, "dasan:apartment": 50 };
  const count = (s, k) => counts[`${s}:${k}`] ?? 0;
  assert.deepEqual(checkExpectations([{ siteId: "guryong", kind: "building", minCount: 100 }], count), { ok: true, failures: [] });
  const r = checkExpectations([{ siteId: "dasan", kind: "apartment", minCount: 56 }], count);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].code, "EXPECTATION_BELOW");
  assert.match(r.failures[0].detail, /dasan.*apartment.*50.*56/);
}

console.log("✓ v2 quality gate");
