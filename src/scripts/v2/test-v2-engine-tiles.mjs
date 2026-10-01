import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const Database = (await import("better-sqlite3")).default;
const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { a01, gradeBus } = await import("../../lib/v2/engine/tiles/a01.ts");
const { a03, storeGroup } = await import("../../lib/v2/engine/tiles/a03.ts");
const { a04 } = await import("../../lib/v2/engine/tiles/a04.ts");
const { a05, isAged, isApartment } = await import("../../lib/v2/engine/tiles/a05.ts");
const { a06, bucketOf } = await import("../../lib/v2/engine/tiles/a06.ts");
const { notProvided } = await import("../../lib/v2/engine/tiles/not-provided.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { buildSummary } = await import("../../lib/v2/engine/summary.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-eng-tiles-"));
const hash = await buildEngineFixture(dataDir, "v1");
const manifest = M.readManifest(dataDir);
const ctxFor = (radiusM = 800, analysisDate = "2026-09-30", dir = dataDir, m = manifest) =>
  new EngineContext(dir, m, "an-1", { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM, analysisDate });
const metric = (t, id) => t.metrics.find((m) => m.id === id);
const val = (t, id) => metric(t, id).value;
const FORBIDDEN = /도보|\d\s*분|종합/;
const noForbidden = (t) => {
  const forbidden = t.tileCode === "A01" || t.tileCode === "A04" ? /종합/ : FORBIDDEN;
  assert.doesNotMatch(JSON.stringify(t), forbidden, `${t.tileCode}: 금지 표현`);
  assert.doesNotMatch(JSON.stringify(toTileView(t)), forbidden, `${t.tileCode}: 화면 문자열 금지 표현`);
};

// ── 공통: 데이터 버전·조건·출처 ──
{
  const ctx = ctxFor();
  const t = a01(ctx);
  parseTileResult(t);
  assert.equal(t.provenance.manifestHash, hash);
  assert.equal(t.engineVersion, "v2-p4-ext-1");
  assert.deepEqual(t.provenance.sources.map((s) => [s.sourceId, s.sourceAsOf]), [["bus_stop", "2025-12-09"]]);
  assert.equal(t.conditions.radiusM, 800);
  ctx.close();
}

// ── A01 ──
{
  assert.deepEqual([gradeBus(300), gradeBus(301), gradeBus(600), gradeBus(601)], ["good", "fair", "fair", "caution"], "경계값 300/600");
  const ctx = ctxFor();
  const t = a01(ctx);
  assert.equal(t.status, "partial");
  assert.deepEqual([val(t, "nearest_bus_m"), val(t, "bus_stops")], [250, 2], "반경 800 밖 1500m 정류장은 제외");
  assert.equal(metric(t, "nearest_rail_m").status, "missing");
  assert.equal(metric(t, "rail_stations").status, "missing");
  assert.equal(metric(t, "bus_routes").status, "missing");
  assert.equal(metric(t, "walk_nearest_rail_m").status, "missing");
  assert.equal(metric(t, "walk_nearest_rail_min").status, "missing");
  assert.equal(metric(t, "walk_nearest_bus_m").status, "missing", "보행망이 없으면 버스 도보거리는 missing");
  assert.equal(metric(t, "walk_nearest_bus_min").status, "missing");
  assert.equal(t.judgment.level, "good");
  assert.doesNotMatch(t.judgment.sentence, /도보/, "보행망이 없으면 판단 문장에 도보시간을 쓰지 않음");
  assert.match(t.judgment.sentence, /^최근접 정류장 직선 250m → 버스 접근은 가까운 편 → 철도·실제 보행 경로는 확인 필요$/);
  assert.deepEqual(t.judgment.basisMetricIds, ["nearest_bus_m"]);
  assert.deepEqual(t.judgment.grades.map((g) => [g.metricId, g.level]), [["nearest_bus_m", "good"]], "철도 자료가 없으면 버스 등급만");
  assert.match(t.judgment.criteria, /300m 이하 좋음 · 600m 이하 보통/);
  assert.ok(t.limitations.some((l) => l.kind === "not_provided" && l.note.includes("철도 자료 미적재")));
  noForbidden(t);
  ctx.close();

  // 반경 내 정류장 없음: 0곳은 관측된 0, 거리는 missing, 등급 없음
  const ctxSmall = ctxFor(500);
  const far = new EngineContext(dataDir, manifest, "an-1", { address: "x", center: [127.16, 37.64], radiusM: 500, analysisDate: "2026-09-30" });
  const none = a01(far);
  assert.deepEqual([val(none, "bus_stops"), none.metrics.find((m) => m.id === "nearest_bus_m").status, none.judgment.level], [0, "missing", null]);
  assert.equal(metric(none, "bus_stops").status, "observed");
  far.close();
  ctxSmall.close();
}

// ── A03 ──
{
  const p = (categoryCode, majorCategory = null) => ({ categoryCode, majorCategory });
  assert.deepEqual(
    [p("G20405"), p("G20404"), p("G20506"), p("G20502"), p("G20508"), p("Q10210"), p("G21501"), p("G21502"), p("S20701"), p("S20901"), p("S20301"), p("I21201"), p(null, "음식"), p(null), p("G20910")].map(storeGroup),
    ["grocery", "grocery", "grocery", "other", "other", "clinic", "pharmacy", "other", "life_service", "life_service", "other", "eatery", "eatery", "other", "other"],
    "업종군 매핑표",
  );
  const ctx = ctxFor(800);
  const t = a03(ctx);
  assert.equal(t.status, "complete");
  assert.equal(val(t, "basic_groups"), 3, "약국은 900m라 반경 800 밖");
  assert.deepEqual([val(t, "count_grocery"), val(t, "count_clinic"), val(t, "count_pharmacy"), val(t, "count_life_service"), val(t, "count_eatery"), val(t, "count_other"), val(t, "stores")], [1, 1, 0, 1, 1, 1, 5]);
  assert.equal(metric(t, "count_pharmacy").status, "observed", "0건은 관측된 0");
  assert.equal(metric(t, "nearest_pharmacy_m").status, "missing");
  assert.equal(val(t, "nearest_grocery_m"), 100);
  assert.equal(val(t, "store_density"), Math.round((5 / ((Math.PI * 0.8 * 0.8))) * 10) / 10);
  assert.match(t.judgment.sentence, /^기초 생활시설 4군 중 3군 확인 → .* → 미확인 군\(약국\) 현장 확인$/);
  assert.equal(t.judgment.level, null, "등급 없음");
  noForbidden(t);
  ctx.close();
  const wide = ctxFor(1000);
  assert.equal(val(a03(wide), "basic_groups"), 4);
  wide.close();
}

// ── A04 ──
{
  const ctx = ctxFor(800);
  const t = a04(ctx);
  assert.equal(t.status, "partial");
  assert.deepEqual([val(t, "parks"), val(t, "nearest_park_point_m"), val(t, "park_area_sum_m2")], [3, 300, 15000]);
  assert.match(metric(t, "nearest_park_point_m").label, /대표점/);
  assert.match(metric(t, "park_area_sum_m2").label, /원천 면적 합/);
  assert.deepEqual([metric(t, "park_area_sum_m2").numerator, metric(t, "park_area_sum_m2").denominator], [2, 3]);
  assert.equal(metric(t, "park_area_in_radius_m2").status, "missing");
  assert.equal(metric(t, "walk_nearest_park_m").status, "missing");
  assert.equal(metric(t, "walk_nearest_park_min").status, "missing");
  assert.equal(t.judgment.level, null, "입구 미확인 → 등급 없음");
  assert.doesNotMatch(t.judgment.sentence, /도보/, "보행망이 없으면 판단 문장에 도보시간을 쓰지 않음");
  assert.deepEqual(t.provenance.sources.map((s) => [s.releaseId, s.sourceAsOf]), [["park@2026-09-29", null]], "source_as_of가 없어도 release_id에는 fallback 날짜가 남는다");
  assert.equal(toTileView(t).sourceLine, "전국 도시공원 2026-09-29", "release_id fallback 날짜를 기준일 라벨에 표시");
  assert.ok(t.limitations.some((l) => l.note.includes("면적 미기재 1곳")));
  noForbidden(t);
  ctx.close();
}

// ── A04 보행망 도보시간·경로 ──
{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-tiles-walk-"));
  await buildEngineFixture(dir, "v1", { roads: true });
  const reference = new Database(join(dir, "versions", "v1", "reference.sqlite"));
  const roadRelease = reference.prepare("SELECT release_id FROM source_release WHERE source_id = 'osm_roads'").pluck().get();
  // 기본 격자에는 중심과 0/600m 정점만 있으므로 공원 p1(300m)에 도달하는 정점을 추가한다.
  insertFeature(reference, {
    stableId: "road:park-approach",
    kind: "road",
    sourceKey: "park-approach",
    releaseId: roadRelease,
    geometry: { type: "LineString", coordinates: [at(0, 0), at(300, 0)] },
    properties: { osmId: "park-approach", fclass: "residential", hierarchy: "국지", name: null },
  });
  reference.close();
  const manifest = M.readManifest(dir);
  const ctx = new EngineContext(dir, manifest, "an-walk", { address: "x", center: CENTER, radiusM: 800, analysisDate: "2026-09-30" });
  const t = a04(ctx);
  assert.deepEqual([val(t, "walk_nearest_park_m"), val(t, "walk_nearest_park_min")], [300, 4]);
  assert.equal(metric(t, "walk_nearest_park_m").status, "observed");
  assert.equal(metric(t, "walk_nearest_park_min").status, "observed");
  assert.ok(t.presentation.layers.includes("walk_route"));
  assert.equal(t.presentation.lines.length, 1);
  assert.equal(t.presentation.lines[0].layer, "walk_route");
  assert.match(t.presentation.lines[0].label, /도보/);
  assert.ok(t.presentation.lines[0].points.length >= 2);
  assert.match(t.judgment.sentence, /보행망 도보\(OSM, 80 m\/분, 내부 제안 기준\)/);
  assert.deepEqual(t.provenance.sources.map((s) => s.sourceId), ["park", "osm_roads"]);
  assert.doesNotMatch(JSON.stringify(t), /종합|법적 적합|개발 가능|건강 위험 예측/);
  ctx.close();
}

// ── A05 ──
{
  assert.deepEqual([isAged("1996-09-30", "2026-09-30"), isAged("1996-10-01", "2026-09-30"), isAged("1996-09-29", "2026-09-30")], [true, false, true], "30년 경계");
  const ctx = ctxFor(800);
  const t = a05(ctx);
  assert.deepEqual([val(t, "apartment_complexes"), val(t, "other_residential"), val(t, "officetels")], [3, 5, 2], "유형 분리(아파트 3 / 단독+연립·다세대 5), 반경 밖 단지 제외");
  assert.equal(val(t, "other_residential_households"), 4 + 40 + 6 + 12 + 156, "기타 공동주택 세대는 아파트 세대와 따로");
  assert.deepEqual(t.presentation.features.filter((f) => f.layer === "other_housing").length, 5);
  assert.ok(t.presentation.features.filter((f) => f.layer === "apt").every((f) => ["아파트"].includes(f.type)), "아파트 레이어에는 아파트만");
  assert.deepEqual([isApartment({ otherUse: "다세대주택" }), isApartment({ otherUse: "아파트, 상가" }), isApartment({ otherUse: "공동주택(연립주택)", units: 156 }), isApartment({ otherUse: "공동주택", units: 99 }), isApartment({ otherUse: "공동주택", units: 100 }), isApartment({ otherUse: null, units: null }), isApartment({ otherUse: "근린생활시설, 교육연구시설, 아파트" }), isApartment({ otherUse: "도시형생활주택(단지형다세대)", units: 500 })], [false, true, false, false, true, false, true, false], "분류 규칙 경계");
  assert.equal(val(t, "households"), 800, "가구 수 우선(500), 없으면 세대 수(300)");
  assert.match(metric(t, "households").formulaVersion, /가구 수 우선, 없으면 세대 수/);
  assert.deepEqual([metric(t, "households").numerator, metric(t, "households").denominator], [2, 3]);
  assert.deepEqual([val(t, "households_from_units"), val(t, "households_unknown_complexes")], [1, 1]);
  assert.equal(val(t, "officetel_units"), 100);
  assert.deepEqual([metric(t, "officetel_units").numerator, metric(t, "officetel_units").denominator], [1, 2]);
  assert.equal(val(t, "median_approval_year"), 2010, "아파트·오피스텔만: 1996·2010·2015");
  assert.deepEqual([metric(t, "median_approval_year").numerator, metric(t, "median_approval_year").denominator], [3, 5]);
  assert.deepEqual([val(t, "aged_share_pct"), metric(t, "aged_share_pct").status, metric(t, "aged_share_pct").numerator, metric(t, "aged_share_pct").denominator], [33.3, "estimated", 1, 3]);
  assert.deepEqual([val(t, "parking_per_household"), metric(t, "parking_per_household").numerator, metric(t, "parking_per_household").denominator], [1.2, 600, 500], "주차·세대가 둘 다 있는 단지만");
  assert.equal(t.status, "partial", "세대 수 미상 단지가 있음");
  assert.ok(t.limitations.some((l) => l.kind === "incomplete" && l.note.includes("1곳")));
  assert.ok(t.limitations.some((l) => l.kind === "partial" && l.note.includes("위치를 확인하지 못한 3건") && l.note.includes("형식 오류·중복 1건")), "위치 미확인 recap 2 + title 1; rejected_count는 위치 미확인을 포함해 기록돼(3, 1) 순수 거부는 1");
  assert.equal(t.judgment.level, null);
  assert.deepEqual(t.provenance.sources.map((s) => s.sourceId), ["ledger_recap", "ledger_title"]);
  noForbidden(t);
  ctx.close();

  // 30년 경계가 분석일에 따라 바뀐다
  const later = ctxFor(800, "2040-05-01");
  assert.equal(val(a05(later), "aged_share_pct"), 66.7, "2010-05-01은 2040-05-01에 30년(기타 공동주택은 연식에서 제외)");
  later.close();
}

// ── A06 ──
{
  assert.deepEqual(
    ["2026-09", "2027-09", "2027-10", "2028-09", "2028-10", "2026-08", null, "202612"].map((m) => bucketOf(m, "2026-09-15")),
    ["m0_12", "m0_12", "m13_24", "m13_24", "later", "past", "unscheduled", "unscheduled"],
    "월 단위 버킷 — 일자를 붙이지 않는다",
  );
  const ctx = ctxFor(800);
  const t = a06(ctx);
  assert.equal(t.status, "partial");
  assert.deepEqual([val(t, "applyhome_units"), val(t, "applyhome_projects"), val(t, "move_in_units"), val(t, "move_in_projects")], [1200, 4, 700, 2]);
  assert.deepEqual([metric(t, "applyhome_units").numerator, metric(t, "applyhome_units").denominator], [3, 4], "세대 미상 사업은 합계에서 빠지고 분모에는 남는다");
  assert.deepEqual(
    ["m0_12", "m13_24", "later", "past", "unscheduled"].map((b) => val(t, `applyhome_units_${b}`)),
    [800, 0, 100, 300, 0],
  );
  assert.deepEqual(
    ["m0_12", "m13_24", "later", "past", "unscheduled"].map((b) => val(t, `move_in_units_${b}`)),
    [0, 500, 0, 0, 200],
  );
  assert.ok(!t.metrics.some((m) => /total|sum/.test(m.id)), "합계 지표 없음");
  const f1 = t.presentation.features.find((f) => f.name === "applyhome:1");
  assert.deepEqual([f1.layer, f1.households, f1.plannedMonth, f1.overlap, typeof f1.distanceM, f1.type], ["applyhome", 800, "2026-12", false, "number", "아파트"], "설명선용 사업 필드");
  assert.ok(t.presentation.features.every((f) => f.plannedMonth === null || /^\d{4}-\d{2}$/.test(f.plannedMonth)));
  assert.match(metric(t, "move_in_projects").formulaVersion, /event-link=2\/6/, "development_event 연결 가능 여부만 기록");
  assert.ok(t.limitations.some((l) => l.kind === "partial" && l.note.includes("중복") && l.note.includes("합계를 보류")));
  assert.deepEqual(
    t.provenance.sources.map((s) => [s.releaseId, s.sourceAsOf]),
    [["applyhome@2026-09-29", null], ["move_in@2026-06-30", "2026-06-30"]],
    "청약홈은 release_id fallback, 입주예정은 source_as_of를 사용",
  );
  assert.equal(toTileView(t).sourceLine, "청약홈 2026-09-29 · 입주예정 2026-06-30", "A06 기준일 라벨");
  assert.equal(t.judgment.level, null);
  noForbidden(t);
  ctx.close();
}

// ── 미제공 타일 ──
{
  const ctx = ctxFor();
  for (const [code, type] of [["A02", "analysis"], ["A07", "analysis"], ["A09", "analysis"], ["A10", "analysis"], ["A12", "analysis"], ["D04", "diagram"], ["S02", "simulation"], ["S03", "simulation"]]) {
    const t = notProvided(ctx, code);
    assert.deepEqual([t.status, t.tileType, t.metrics.length, t.judgment, t.limitations[0].kind], ["not_provided", type, 0, null, "not_provided"], code);
    noForbidden(t);
  }
  ctx.close();
}

// ── 자료 없음: market 파일이 게시되지 않으면 A06은 no_data ──
{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-tiles-nomarket-"));
  await buildEngineFixture(dir, "v1", { noMarket: true });
  const ctx = ctxFor(800, "2026-09-30", dir, M.readManifest(dir));
  const t = a06(ctx);
  assert.deepEqual([t.status, t.metrics.length, t.provenance.sources.length], ["no_data", 0, 0]);
  ctx.close();
}

// ── 지역 완전성: 기록된 것만 사용한다 ──
{
  const ctx = ctxFor(3000); // 동쪽에 송파구(시도 11) 걸침, store 적재 이력엔 시도 41뿐
  assert.deepEqual(ctx.sidoCodes(), ["11", "41"]);
  const lim = ctx.coverage("reference", ["store"]);
  assert.ok(lim.some((l) => l.kind === "incomplete" && l.note.includes("11")), "적재되지 않은 시도는 incomplete");
  assert.ok(lim.some((l) => l.kind === "unknown"), "시군구 단위 완전성은 미기록 → unknown (완전 처리 금지)");
  const bus = ctx.coverage("reference", ["bus_stop"]);
  assert.deepEqual(bus.map((l) => l.kind), ["unknown"], "시도 코드로 기록되지 않은 원천은 미확인");
  assert.deepEqual(ctx.coverage("reference", ["nothing"]).map((l) => l.kind), ["unknown"], "이력 없음도 완전 처리하지 않는다");
  ctx.close();
  const small = ctxFor(500);
  assert.deepEqual(small.sidoCodes(), ["41"]);
  assert.ok(!small.coverage("reference", ["store"]).some((l) => l.kind === "incomplete"));
  small.close();
}

// ── 요약: 사실은 타일 결과에서 ──
{
  const ctx = ctxFor(800);
  const results = [a01(ctx), a03(ctx), a05(ctx)];
  const s = buildSummary({ address: "경기도 남양주시 다산동 100", jimok: "대" }, 800, results);
  assert.deepEqual([s.areaM2, s.zoning, s.radiusM], [null, null, 800]);
  assert.deepEqual(s.facts, ["지목 대", "최근접 버스정류장 직선 250m, 반경 안 2곳", "아파트 3개 단지, 확인 세대 800세대"]);
  ctx.close();
}

console.log("✓ v2 engine tiles");
