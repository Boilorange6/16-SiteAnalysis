/** 타일 핵심 숫자(keyFigure) — 모델 계약과 A01·A12·D03 정의. 값이 없으면 줄을 빼고, 정의가 없으면 headline 카드로 돌아간다. */
import assert from "node:assert/strict";

const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const center = [127.06, 37.49];
const m = (id, label, value, unit, extra = {}) => ({ id, label, value, unit, formulaVersion: "t@1", numerator: null, denominator: null, status: "observed", ...extra });
const missing = (id, label, unit) => ({ id, label, value: null, unit, formulaVersion: "t@0", numerator: null, denominator: null, status: "missing" });
const result = (tileCode, tileType, metrics, presentation = {}, extra = {}) => parseTileResult({
  tileId: `x-${tileCode}`,
  analysisId: "x",
  tileType,
  tileCode,
  status: "partial",
  engineVersion: "test",
  conditions: { address: "a", center, radiusM: 1000, analysisDate: "2026-10-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics,
  judgment: null,
  presentation: { legend: [], camera: null, layers: [], outputFace: "front", ...presentation },
  provenance: { manifestHash: "a".repeat(64), sources: [] },
  limitations: [],
  ...extra,
});

// ── A01 ──
const a01Metrics = (walkBusMin = 4) => [
  m("nearest_rail_m", "최근접 철도역 출입구", 321, "m"),
  m("rail_stations", "반경 내 운영역", 5, "개"),
  walkBusMin === null ? missing("walk_nearest_bus_min", "보행망 최근접 버스정류장 도보시간", "분") : m("walk_nearest_bus_min", "보행망 최근접 버스정류장 도보시간", walkBusMin, "분"),
  m("bus_stops", "버스 정류장", 106, "개"),
  m("walk_nearest_rail_m", "보행망 최근접 철도역 거리", 498, "m"),
  m("walk_nearest_rail_min", "보행망 최근접 철도역 도보시간", 6, "분"),
];
const entrance = (fid, name, highlight = false) => ({ fid, layer: "rail_entrance", lng: 127.06, lat: 37.49, name, label: "8", highlight });
const a01Features = [entrance("1", "도곡역 1번 출구"), entrance("2", "대치역 8번 출구", true)];
{
  const view = toTileView(result("A01", "analysis", a01Metrics(), { features: a01Features }));
  const kf = view.keyFigure;
  assert.equal(kf.question, "가장 가까운 지하철역");
  assert.deepEqual(kf.answer, { pre: "도보", value: "6분", target: "대치역", kind: "number" });
  assert.equal(kf.sub, "보행망 498m · 직선 321m");
  assert.deepEqual(kf.stats.map((s) => s.label), ["정류장까지 도보", "1km 안 지하철역", "1km 안 정류장"]);
  assert.deepEqual(kf.stats.map((s) => s.value), ["4분", "5곳", "106곳"]);
}
{
  // 도보 최근접 역이 직선 최근접 출입구와 다르면 도보 경로(walk_route)가 가리키는 쪽 이름을 쓴다.
  const lines = [{ fid: "1", layer: "walk_route", points: [[127.06, 37.49], [127.061, 37.491]], sublabel: "철도 도보 498m · 6분" }];
  const view = toTileView(result("A01", "analysis", a01Metrics(), { features: a01Features, lines }));
  assert.equal(view.keyFigure.answer.target, "도곡역");
  assert.equal(view.keyFigure.sub, "보행망 498m", "직선 321m는 대치역 값이라 도곡역 줄에 두지 않는다");
}
{
  const view = toTileView(result("A01", "analysis", a01Metrics(null), { features: a01Features }));
  assert.ok(!view.keyFigure.stats.some((s) => s.label === "정류장까지 도보"));
  assert.doesNotMatch(JSON.stringify(view.keyFigure), /미확인/);
  assert.deepEqual(view.keyFigure.stats.map((s) => s.label), ["1km 안 지하철역", "1km 안 정류장"]);
}
{
  // 반경 표기: 500 → 500m, 1500 → 1.5km
  const mk = (radiusM) => result("A01", "analysis", a01Metrics(), { features: a01Features }, { conditions: { address: "a", center, radiusM, analysisDate: "2026-10-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null } });
  assert.equal(toTileView(mk(500)).keyFigure.stats[1].label, "500m 안 지하철역");
  assert.equal(toTileView(mk(1500)).keyFigure.stats[1].label, "1.5km 안 지하철역");
}
{
  // 도보 시간이 없으면(철도 자료 없음) 정의를 쓰지 않고 headline 카드로 돌아간다.
  const metrics = [m("nearest_bus_m", "최근접 버스정류장", 153, "m"), m("bus_stops", "버스 정류장", 106, "개"), missing("walk_nearest_rail_min", "보행망 최근접 철도역 도보시간", "분")];
  const view = toTileView(result("A01", "analysis", metrics));
  assert.ok(view.headline);
  assert.deepEqual(view.keyFigure, { question: view.headline.label, answer: { value: view.headline.value, kind: "number" }, stats: [] });
}

// ── A12 ──
{
  const raw = [["제3종일반주거지역", 50], ["제2종일반주거지역", 24.9], ["제1종일반주거지역", 18.5], ["일반상업지역", 5], ["준주거지역", 1.6]];
  const metrics = [
    m("site_zoning_count", "대지 중심점의 용도지역 지정 수(세분 기준)", 1, "건"),
    m("share_class_1", "구성비: 주거", 95, "%"),
    m("share_class_2", "구성비: 상업", 5, "%"),
    ...raw.map(([name, v], i) => m(`share_raw_${i + 1}`, `세분: ${name}`, v, "%")),
  ];
  const view = toTileView(result("A12", "analysis", metrics, { features: [{ layer: "zoning_site", lng: 127.06, lat: 37.49, name: "제3종일반주거지역", highlight: true }] }));
  const kf = view.keyFigure;
  assert.equal(kf.question, "대지 용도지역");
  assert.equal(kf.answer.kind, "name");
  assert.equal(kf.answer.value, "제3종일반주거지역");
  assert.ok(kf.parts.length <= 6);
  const site = kf.parts.find((p) => p.site);
  assert.equal(site.label, "제3종일반주거지역");
  assert.equal(site.share, 50.0);
  assert.equal(kf.parts.filter((p) => p.site).length, 1);
  assert.deepEqual(kf.stats.map((s) => s.value), ["50.0%", "95.0%"]);
  // 항목이 6개를 넘으면 큰 쪽 5개 + 「그 밖」으로 묶는다. 대지 항목은 작아도 남는다.
  const many = [...raw, ["준공업지역", 0.7], ["일반공업지역", 0.3]];
  const manyMetrics = [metrics[0], metrics[1], ...many.map(([name, v], i) => m(`share_raw_${i + 1}`, `세분: ${name}`, v, "%"))];
  const manyView = toTileView(result("A12", "analysis", manyMetrics, { features: [{ layer: "zoning_site", lng: 127.06, lat: 37.49, name: "일반공업지역", highlight: true }] }));
  const parts = manyView.keyFigure.parts;
  assert.ok(parts.length <= 6);
  assert.equal(parts.find((p) => p.site).label, "일반공업지역");
  assert.equal(parts.at(-1).label, "그 밖");
  assert.ok(Math.abs(parts.reduce((a, p) => a + p.share, 0) - many.reduce((a, [, v]) => a + v, 0)) < 0.05, "묶어도 합계는 그대로");
}

// ── D03 ──
{
  const use = (i, name, n) => m(`share_use_${i}`, `구성비: ${name}`, Math.round((n / 1734) * 1000) / 10, "%", { numerator: n, denominator: 1734 });
  const metrics = [
    m("fill_use_pct", "주용도 확인 동수", 54.6, "%", { numerator: 947, denominator: 1734 }),
    use(1, "주거", 578), use(2, "근린생활", 220), use(3, "업무", 20), use(4, "판매", 15), use(10, "미상", 787),
  ];
  const view = toTileView(result("D03", "diagram", metrics));
  const kf = view.keyFigure;
  assert.equal(kf.question, "가장 많은 건물 용도");
  assert.deepEqual(kf.answer, { pre: "주거", value: "61.0%", kind: "number" });
  assert.equal(kf.sub, "용도가 확인된 947동 중 578동");
  assert.deepEqual(kf.stats.map((s) => s.value), ["1,734동", "23.2%", "45.4%"]);
  assert.deepEqual(kf.stats.map((s) => s.label), ["1km 안 건물", "근린생활 · 220동", "용도 미상 · 787동"]);
}

// ── D01: headline이 있어도 카드를 그리지 않는다 ──
{
  const view = toTileView(result("D01", "diagram", [m("imagery_zoom_max", "최대 줌", 18, "z")]));
  assert.ok(view.headline, "D01 headline은 그대로 있다");
  assert.equal(view.keyFigure, null);
}

// ── 결과가 없는 타일(pending)은 카드가 없다 ──
{
  for (const code of ["A01", "A12", "D03"]) {
    const pending = toTileView(result(code, "analysis", [], {}, { status: "pending" }));
    assert.equal(pending.keyFigure, null, `${code} pending`);
  }
}

console.log("✓ v2 key figure");
