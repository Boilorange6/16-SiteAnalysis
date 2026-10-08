/**
 * v2 타일 보드 화면 규칙 테스트 (plan 2026-09-30-v2-p1c0-board-ui).
 * 화면 문자열은 전부 toTileView에서 나온다 — 여기서 금지 표현·배지 매핑을 고정한다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { GODEOK_RESULTS, GODEOK_SUMMARY, RECOVERED } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { HEADLINE_POLICY, toTileView, toSummaryView, faceLabel } = await import("../../lib/v2/ui/tile-view.ts");
const { buildSummary } = await import("../../lib/v2/engine/summary.ts");

// ── fixture 계약 ──
for (const r of [...GODEOK_RESULTS, ...Object.values(RECOVERED)]) parseTileResult(r);
// A03·A04·A10과 P2/P3 새 타일은 예시 데이터에 없다(엔진 결과는 test-v2-engine-run.mjs가 카탈로그 전체와 대조한다)
const NOT_IN_GODEOK = ["A08", "A10", "A11", "D01", "D02", "D03", "D05", "D10", "D11", "D12", "D13", "D15", "D16", "D17", "D18", "D19", "D22", "D28", "D29", "S01", "S04"];
assert.deepEqual(GODEOK_RESULTS.map((r) => r.tileCode).sort(), TILE_CODES.filter((c) => !NOT_IN_GODEOK.includes(c)).sort());
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
// 높이·보행망 거리처럼 단위만 m인 지표에는 "직선"을 붙이지 않는다
{
  const metric = (id, label) => ({ id, label, value: 9, unit: "m", status: "observed", formula: "f" });
  const base = GODEOK_RESULTS.find((r) => r.tileCode === "A01");
  const rows = toTileView({ ...base, metrics: [metric("height_median_m", "확보 높이 중앙값"), metric("walk_nearest_bus_m", "보행망 최근접 정류장 거리"), metric("nearest_bus_m", "최근접 버스정류장")] }).rows;
  const aux = Object.fromEntries(rows.map((r) => [r.label, r.aux]));
  assert.equal(aux["확보 높이 중앙값"], undefined);
  assert.equal(aux["보행망 최근접 정류장 거리"], undefined);
  assert.equal(aux["최근접 버스정류장"], "직선");
}

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
assert.equal(withStatus("cancelled").retryable, true, "취소된 타일은 다시 계산 가능");

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
assert.equal(rowOf(byCode.A05, "30년 이상 건물 비중").value, "38.0%");
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
assert.ok(byCode.S03.badges.some((b) => b.text === "탐색용 · 검증 CFD 아님"));
assert.ok(toTileView(RECOVERED.S03).badges.some((b) => b.text === "탐색용 · 검증 CFD 아님"));
assert.ok(!byCode.A01.badges.some((b) => b.text === "탐색용"));

// 규칙 6
assert.ok(byCode.A05.sourceLine.includes("K-APT 공동주택 관리정보 기준일 미확인"));
assert.equal(byCode.A07.sourceLine, "국토부 아파트 실거래 2026-09-20");
assert.equal(byCode.A01.sourceLine, "OSM 철도(역·출입구·노선) 2026-09-01 · 전국 버스정류장 2026-08-15");
assert.equal(byCode.S02.sourceLine, "출처 없음");

// 규칙 7·8
assert.ok(byCode.A12.sentence.includes("→"));
assert.equal(byCode.D04.chart.length, 7);
assert.ok(byCode.D04.hasFace && byCode.A01.hasFace);
assert.ok(byCode.D04.map.notes.every((note) => !note.includes("건물 도형은 자료 적재 뒤")), "D04 오래된 도형 안내 제거");
assert.deepEqual([faceLabel("front"), faceLabel("back"), faceLabel("both")], ["도판", "구성비", "도판 + 구성비"]);

// 실패 타일은 다시 계산 가능, 값 없는 타일은 headline 없음
assert.ok(byCode.S03.retryable && !byCode.A01.retryable);
assert.equal(byCode.S02.headline, null);
const dialogSource = readFileSync(new URL("../../components/v2/tile-dialog.tsx", import.meta.url), "utf8");
assert.match(dialogSource, /StatusPlate view=\{view\} phase=\{null\} onRetry=\{onRetry\}/, "펼침 상태판도 재계산 콜백을 받아야 한다");
const pageSource = readFileSync(new URL("../../app/v2/page.tsx", import.meta.url), "utf8");
assert.match(pageSource, /method: "DELETE"/, "진행 중 분석 취소는 DELETE API를 사용해야 한다");
assert.match(pageSource, /계산 취소/, "진행 표시 영역에 계산 취소 버튼이 있어야 한다");
assert.match(pageSource, /<details className=\{styles\.notProvidedGroup\}/, "미제공 타일은 보드 끝의 접힌 묶음으로 모아야 한다");
const notProvidedSource = readFileSync(new URL("../../lib/v2/engine/tiles/not-provided.ts", import.meta.url), "utf8");
assert.doesNotMatch(notProvidedSource, /P4 적재|구현 후 제공/, "미제공 기본 카피에서 내부 작업 용어를 제거한다");
const tileCardSource = readFileSync(new URL("../../components/v2/tile-card.tsx", import.meta.url), "utf8");
assert.match(tileCardSource, /aria-expanded=\{open\}/, "배지 설명은 키보드·터치 버튼으로 열어야 한다");
assert.match(tileCardSource, /<BadgeHint text=\{`\+\$\{more\}`\}/, "+N 배지도 설명 팝오버를 가져야 한다");
assert.doesNotMatch(tileCardSource, /title=\{b\.note\}/, "배지 설명을 title 툴팁에만 의존하지 않는다");

// 대지 요약
const sv = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
assert.equal(sv.area, "3,480㎡");
assert.equal(sv.radius, "반경 1km");
assert.equal(sv.facts.length, 3);
assert.equal(sv.asOfLine, "자료 기준일 2026-01-01 ~ 2026-09-20");
assert.equal(sv.incomplete, true);

// R12: A12 도형 면적·지가·지목은 요약으로 승격하고, 추정/부분 안내만으로 불완전 배지를 세지 않는다.
{
  const results = structuredClone(GODEOK_RESULTS);
  const a12 = results.find((r) => r.tileCode === "A12");
  a12.metrics.push({ id: "parcel_area_m2", label: "대상 필지 도형 면적", value: 3210, unit: "㎡", formulaVersion: "test", numerator: null, denominator: null, status: "observed" });
  a12.metrics.push({ id: "land_price", label: "대상 필지 개별공시지가", value: 2_410_000, unit: "원/㎡", formulaVersion: "test", numerator: null, denominator: null, status: "observed" });
  const summary = buildSummary({ address: "테스트", jimok: "대" }, 800, results);
  assert.equal(summary.areaM2, 3210, "A12 도형 면적을 대지 요약으로 승격");
  assert.equal(summary.landPriceM2, 2_410_000, "A12 개별공시지가를 요약으로 승격");
  assert.equal(summary.jimok, "대", "지목을 요약으로 승격");
  const base = structuredClone(results[0]);
  const countView = toSummaryView({ address: "테스트", areaM2: 3210, landPriceM2: 2_410_000, landPriceUnit: "원/㎡", jimok: "대", zoning: null, radiusM: 800, facts: [] }, [
    { ...base, status: "complete", limitations: [{ kind: "estimated", note: "추정" }] },
    { ...base, status: "partial", limitations: [{ kind: "unknown", note: "미확인" }] },
    { ...base, status: "failed", limitations: [] },
    { ...base, status: "not_provided", limitations: [{ kind: "not_provided", note: "미제공" }] },
  ]);
  assert.equal(countView.incompleteCount, 2, "실패·미제공만 일부 자료 불완전 개수에 포함");
  assert.match(countView.areaSource, /도형 면적/);
  assert.equal(countView.jimok, "지목: 대");
  assert.match(countView.landPrice, /공시지가: 2,410,000원\/㎡/);
}

// ── 같은 배지 합치기, 헤드라인은 타일별 결론 정책 ──
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
  assert.equal(v.headlineMetricId, "nearest_rail_m", "A01 결론 지표 정책 유지");
  assert.notEqual(v.headline.value, "미확인", "결론 지표 값이 대표값");
}

assert.deepEqual(new Set(Object.keys(HEADLINE_POLICY)), new Set(TILE_CODES), "33개 타일 모두 헤드라인 선정 정책 보유");
assert.equal(byCode.D04.headlineMetricId, "share_pre2000");
assert.equal(byCode.D04.headline.value, "67.0%", "D04는 확인율이 아니라 1990년대 이전 준공 비율");
assert.ok(byCode.D04.badges.some((badge) => badge.text === "확인율 98.0%"), "D04 확인율은 보조 배지");
assert.equal(HEADLINE_POLICY.D16.ids[0], "dens_max", "D16 KDE 대역폭은 헤드라인이 아님");
assert.equal(HEADLINE_POLICY.D01.ids[0], "imagery_capture_date", "D01 최대 줌은 헤드라인이 아님");
assert.equal(HEADLINE_POLICY.A12.ids[2], "site_zoning_count", "A12 지정 수는 보조 후보");
assert.equal(HEADLINE_POLICY.A09.ids[0], "projects_in_radius", "A09 단계 사업 수");
assert.equal(HEADLINE_POLICY.A10.ids[0], "planned_projects", "A10 계획 사업 수");

// 파라미터만 있는 헤드라인 회귀: 결론은 dens_max/항공영상 제공, 파라미터는 배지로 남긴다.
{
  const base = GODEOK_RESULTS[0];
  const metric = (id, label, value, unit) => ({ ...base.metrics[0], id, label, value, unit, status: "observed" });
  const d16 = toTileView({ ...base, tileCode: "D16", tileId: "test-D16", tileType: "diagram", metrics: [metric("kde_bandwidth_m", "KDE 대역폭", 100, "m"), metric("dens_max", "최대 건물 밀도", 23.4, "동/㎢")], limitations: [], judgment: { ...base.judgment, basisMetricIds: ["buildings_input", "dens_max"] } });
  assert.equal(d16.headlineMetricId, "dens_max");
   assert.equal(d16.headline.value, "23 동/㎢");
  assert.ok(d16.badges.some((badge) => badge.text === "KDE 대역폭 100m"));
  const d01 = toTileView({ ...base, tileCode: "D01", tileId: "test-D01", tileType: "diagram", metrics: [metric("imagery_zoom_max", "항공영상 WMTS 최대 줌", 19, "z")], limitations: [], judgment: { ...base.judgment, basisMetricIds: ["imagery_zoom_max"] } });
  assert.equal(d01.headlineMetricId, "imagery_available");
  assert.equal(d01.headline.value, "항공영상 제공");
  assert.ok(d01.badges.some((badge) => badge.text === "최대 줌 19z"));
}

// R13: 원천 limitation 문구가 반복돼도 상세 창의 li key가 겹치지 않도록 화면 문구를 합친다.
{
  const base = structuredClone(GODEOK_RESULTS.find((x) => x.tileCode === "A09"));
  base.limitations = [
    { kind: "partial", note: "같은 안내" },
    { kind: "unknown", note: "같은 안내" },
    { kind: "estimated", note: "다른 안내" },
  ];
  assert.deepEqual(toTileView(base).notes, ["같은 안내", "다른 안내"]);
}

// ── A05 설명선: 번호·카드는 아파트·오피스텔만, 연립·다세대는 번호 없는 점 ──
{
  const co = byCode.A05.callout;
  assert.ok(co.complexes.length > 0 && co.complexes.every((c) => c.layer === "apt" || c.layer === "officetel"));
  assert.ok(co.others.length > 0, "기타 공동주택 점");
  assert.equal(co.others.length, GODEOK_RESULTS.find((r) => r.tileCode === "A05").presentation.features.filter((f) => f.layer === "other_housing").length);
}

// A05 필터는 원본 TileResult 없이 화면용 지도·설명선·지표를 같은 파생 결과로 바꾼다.
{
  const original = GODEOK_RESULTS.find((r) => r.tileCode === "A05");
  const originalFeatures = original.presentation.features;
  const filtered = toTileView(original, null, null, { types: ["apt"], year: { min: 2010 } });
  assert.equal(filtered.filterChip, "필터 · 유형 아파트, 준공연도 2010년 이상");
  assert.match(filtered.filterLine, /^적용 필터: 유형 아파트, 준공연도 2010년 이상 · 정보 없음 포함 \d+건$/);
  assert.match(filtered.sentence, /필터 적용/);
  assert.ok(filtered.callout.complexes.every((c) => c.layer === "apt"));
  assert.ok(filtered.map.features.every((f) => f.layer === "apt"));
  assert.equal(filtered.a05Counts.total, originalFeatures.filter((f) => ["apt", "other_housing", "officetel"].includes(f.layer)).length);
  assert.deepEqual(original.presentation.features, originalFeatures, "원본 TileResult 불변");
}

console.log("v2 ui view tests passed");

// ── 원천 id 표시 이름: 엔진·예시 보드가 쓰는 모든 원천 id에 사람이 읽는 이름이 있어야 한다 ──
{
  const { SOURCE_NAMES } = await import("../../lib/v2/ui/tile-catalog.ts");
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const ids = new Set(["rail", "bus_stops"]);
  for (const r of [...GODEOK_RESULTS, ...Object.values(RECOVERED)]) for (const s of r.provenance.sources) ids.add(s.sourceId);
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f)) for (const m of readFileSync(p, "utf8").matchAll(/sourceId: *"([a-z0-9_]+)"/g)) ids.add(m[1]);
    }
  };
  walk(new URL("../../lib/v2", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  const missing = [...ids].filter((id) => !SOURCE_NAMES[id]);
  assert.deepEqual(missing, [], `SOURCE_NAMES에 없는 원천 id: ${missing.join(", ")}`);
  console.log(`source names ok (${ids.size} ids)`);
}
