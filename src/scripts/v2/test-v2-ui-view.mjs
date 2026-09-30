/**
 * v2 타일 보드 화면 규칙 테스트 (plan 2026-09-30-v2-p1c0-board-ui).
 * 화면 문자열은 전부 toTileView에서 나온다 — 여기서 금지 표현·배지 매핑을 고정한다.
 */
import assert from "node:assert/strict";

const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView, toSummaryView, faceLabel } = await import("../../lib/v2/ui/tile-view.ts");

// ── fixture 계약 ──
for (const r of [...GODEOK_RESULTS, ...Object.values(RECOVERED)]) parseTileResult(r);
// A03·A04·A10은 P1b 엔진이 더한 타일이라 예시 데이터에는 없다(엔진 결과는 test-v2-engine-run.mjs가 카탈로그 전체와 대조한다)
assert.deepEqual(GODEOK_RESULTS.map((r) => r.tileCode).sort(), TILE_CODES.filter((c) => !["A10", "A11"].includes(c)).sort());
const statuses = new Set(GODEOK_RESULTS.map((r) => r.status));
for (const s of ["complete", "partial", "failed", "not_provided"]) assert.ok(statuses.has(s), `status ${s}`);
const lims = GODEOK_RESULTS.flatMap((r) => r.limitations.map((l) => l.kind));
assert.ok(lims.includes("incomplete") && lims.includes("estimated"));
assert.ok(GODEOK_RESULTS.some((r) => r.metrics.some((x) => x.status === "observed" && x.value === 0)), "observed 0");

const views = GODEOK_RESULTS.map(toTileView);
const byCode = Object.fromEntries(views.map((v) => [v.code, v]));
const allStrings = [...views, toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS), ...Object.values(RECOVERED).map(toTileView)].map((v) => JSON.stringify(v));

// 규칙 2·1
for (const s of allStrings) {
  assert.ok(!/도보|\d\s*분/.test(s), `도보/숫자+분 금지: ${s.slice(0, 80)}`);
  assert.ok(!s.includes("종합"), "종합 점수 금지");
}
assert.equal(byCode.A01.headline.value, "480m");
assert.equal(byCode.A01.headline.aux, "직선");

// 규칙 3
const a02 = JSON.stringify(byCode.A02);
assert.ok(a02.includes("배정은 교육청 확인"));
assert.ok(a02.includes("통학구역 안") && a02.includes("학구도 기준일 2026-03-01"));
assert.ok(!/배정\s+\S+초/.test(a02));

// 규칙 4
assert.ok(byCode.A01.grade && byCode.A02.grade);
assert.ok(byCode.A01.grade.criteria.startsWith("내부 제안 기준: "));
assert.equal(byCode.A01.grade.label, "보통", "level = 두 등급 중 나쁜 쪽");
for (const c of ["A05", "A06", "A07", "A09", "A12", "D04"]) assert.equal(byCode[c].grade, null, `${c} 등급 없음`);
// 등급이 실린 결과라도 거리 타일이 아니면 뷰에서 버린다
const graded = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "A07"));
graded.judgment.level = "good";
graded.judgment.criteria = "x";
graded.judgment.basisMetricIds = ["median_price_m2"];
assert.equal(toTileView(parseTileResult(graded)).grade, null);

// 규칙 5: 타일 status
const withStatus = (status) => {
  const r = structuredClone(GODEOK_RESULTS.find((x) => x.tileCode === "A07"));
  r.status = status;
  if (status !== "complete") r.provenance.sources = r.provenance.sources; // 그대로
  return toTileView(parseTileResult(r));
};
const STATUS_TEXT = { partial: "일부 자료만 집계", failed: "계산 실패", cancelled: "취소됨", no_data: "자료 없음", not_provided: "다음 단계에서 제공" };
for (const [k, t] of Object.entries(STATUS_TEXT)) assert.ok(withStatus(k).badges.some((b) => b.text === t), `status ${k}`);
assert.ok(!withStatus("complete").badges.some((b) => Object.values(STATUS_TEXT).includes(b.text)));

// 규칙 5: limitation kind
const LIM_TEXT = { estimated: "추정", incomplete: "지역 자료 불완전", partial: "일부 자료만 집계", unknown: "미확인", suppressed: "비공개", not_provided: "자료 미확보" };
for (const [k, t] of Object.entries(LIM_TEXT)) {
  const r = structuredClone(GODEOK_RESULTS.find((x) => x.tileCode === "A09"));
  r.limitations = [{ kind: k, note: `원문-${k}` }];
  const v = toTileView(parseTileResult(r));
  const b = v.badges.find((x) => x.text === t);
  assert.ok(b, `limitation ${k}`);
  assert.equal(b.note, `원문-${k}`);
}

// 규칙 5: 지표 status
const rowOf = (v, label) => v.rows.find((r) => r.label === label);
assert.equal(rowOf(byCode.A01, "경유 버스 노선").value, "미확인");
assert.equal(rowOf(byCode.A07, "소형 면적대 중앙값").value, "비공개");
assert.equal(rowOf(byCode.A05, "30년 이상 건물 비중").value, "38%");
assert.equal(rowOf(byCode.A05, "30년 이상 건물 비중").tag, "추정");
assert.equal(rowOf(byCode.A09, "철거 착수 사업").value, "0곳");
{
  const r = structuredClone(GODEOK_RESULTS.find((x) => x.tileCode === "A09"));
  r.metrics.push({ id: "na", label: "해당 없는 지표", value: null, unit: "곳", formulaVersion: "x@1", numerator: null, denominator: null, status: "not_applicable" });
  assert.equal(rowOf(toTileView(parseTileResult(r)), "해당 없는 지표").value, "해당 없음");
}

// 규칙 5: A06 중복 가능 · 합계 보류, 원천별 줄
assert.ok(byCode.A06.badges.some((b) => b.text === "중복 가능 · 합계 보류"));
assert.ok(!byCode.A06.rows.some((r) => r.label === "합계"));
assert.equal(byCode.A06.rows.length, 3);
assert.ok(!byCode.A05.badges.some((b) => b.text === "중복 가능 · 합계 보류"));

// 규칙 5: 모델 한계는 상태와 무관하게 항상
assert.ok(byCode.S02.badges.some((b) => b.text === "그림자 추정 · 법적 판정 아님"));
assert.ok(byCode.S03.badges.some((b) => b.text === "탐색용"));
assert.ok(toTileView(RECOVERED.S03).badges.some((b) => b.text === "탐색용"));
assert.ok(!byCode.A01.badges.some((b) => b.text === "탐색용"));

// 규칙 6
assert.ok(byCode.A05.sourceLine.includes("kapt 기준일 미확인"));
assert.equal(byCode.A07.sourceLine, "molit_rtms 2026-09-20");
assert.equal(byCode.A01.sourceLine, "rail 2026-09-01 · bus_stops 2026-08-15");
assert.equal(byCode.S02.sourceLine, "출처 없음");

// 규칙 7·8
assert.ok(byCode.A12.sentence.includes("→"));
assert.equal(byCode.D04.chart.length, 7);
assert.ok(byCode.D04.hasFace && !byCode.A01.hasFace);
assert.deepEqual([faceLabel("front"), faceLabel("back"), faceLabel("both")], ["도판", "구성비", "도판 + 구성비"]);

// 실패 타일은 다시 계산 가능, 값 없는 타일은 headline 없음
assert.ok(byCode.S03.retryable && !byCode.A01.retryable);
assert.equal(byCode.S02.headline, null);

// 대지 요약
const sv = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
assert.equal(sv.area, "3,480㎡");
assert.equal(sv.radius, "반경 1km");
assert.equal(sv.facts.length, 3);
assert.equal(sv.asOfLine, "자료 기준일 2026-01-01 ~ 2026-09-20");
assert.equal(sv.incomplete, true);

// ── 같은 배지 합치기, 대표값은 값이 있는 첫 지표 ──
{
  const base = GODEOK_RESULTS.find((r) => r.tileCode === "A01");
  const r = {
    ...base,
    status: "partial",
    metrics: [
      { ...base.metrics[0], id: "rail_x", value: null, status: "missing" },
      ...base.metrics.filter((m) => m.value !== null).slice(0, 1),
    ],
    limitations: [
      { kind: "partial", note: "가" },
      { kind: "partial", note: "나" },
    ],
  };
  const v = toTileView(r);
  const texts = v.badges.map((b) => b.text);
  assert.equal(new Set(texts).size, texts.length, "배지 문구 중복 없음");
  assert.equal(v.badges.find((b) => b.text === "일부 자료만 집계").note, "가 / 나");
  assert.notEqual(v.headline.value, "미확인", "값이 있는 지표가 대표값");
}

// ── A05 설명선: 번호·카드는 아파트·오피스텔만, 연립·다세대는 번호 없는 점 ──
{
  const co = byCode.A05.callout;
  assert.ok(co.complexes.length > 0 && co.complexes.every((c) => c.layer === "apt" || c.layer === "officetel"));
  assert.ok(co.others.length > 0, "기타 공동주택 점");
  assert.equal(co.others.length, GODEOK_RESULTS.find((r) => r.tileCode === "A05").presentation.features.filter((f) => f.layer === "other_housing").length);
}

console.log("v2 ui view tests passed");
