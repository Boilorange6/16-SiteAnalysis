/** 타일 핵심 숫자(keyFigure) — 모델 계약과 A01·A12·D03 정의. 값이 없으면 줄을 빼고, 정의가 없으면 headline 카드로 돌아간다. */
import assert from "node:assert/strict";

const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");

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
const conditions = (radiusM) => ({ address: "a", center, radiusM, analysisDate: "2026-10-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null });

// ── A01 픽스처 ──
// 지표: 도곡역이 두 노선(지물 2개)이라 rail_stations는 6이지만 고유 역명은 5다.
const a01Metrics = ({ walkBusMin = 4, walkRailM = 498 } = {}) => [
  m("nearest_rail_m", "최근접 철도역 출입구", 321, "m"),
  m("rail_stations", "반경 내 운영역", 6, "개"),
  walkBusMin === null ? missing("walk_nearest_bus_min", "보행망 최근접 버스정류장 도보시간", "분") : m("walk_nearest_bus_min", "보행망 최근접 버스정류장 도보시간", walkBusMin, "분"),
  m("bus_stops", "버스 정류장", 106, "개"),
  m("walk_nearest_rail_m", "보행망 최근접 철도역 거리", walkRailM, "m"),
  m("walk_nearest_rail_min", "보행망 최근접 철도역 도보시간", 6, "분"),
];
const station = (name, line) => ({ layer: "rail_station", lng: 127.06, lat: 37.49, name, sublabel: line });
const entrance = (fid, name, highlight = false) => ({ fid, layer: "rail_entrance", lng: 127.06, lat: 37.49, name, label: "8", highlight });
const stationFeatures = [station("개포동역", "수인분당"), station("구룡역", "수인분당"), station("대치역", "3호선"), station("도곡역", "3호선"), station("도곡역", "수인분당"), station("한티역", "수인분당")];
const entranceFeatures = [entrance("1", "도곡역 3번 출구"), entrance("2", "대치역 8번 출구", true)];
const walkLine = (fid) => ({ fid, layer: "walk_route", points: [[127.06, 37.49], [127.061, 37.491]], sublabel: "철도 도보 498m · 6분" });
const a01 = (presentation = {}, { status = "partial", metrics = a01Metrics() } = {}) =>
  result("A01", "analysis", metrics, { features: [...stationFeatures, ...entranceFeatures], ...presentation }, { status });

{
  // 도보 경로가 결과에 없으면 직선 최근접 역을 목적지로 본다(같은 역).
  const kf = toTileView(a01()).keyFigure;
  assert.equal(kf.question, "가장 가까운 지하철역");
  assert.deepEqual(kf.answer, { pre: "도보", value: "6분", target: "대치역", kind: "number" });
  assert.equal(kf.sub, "보행망 498m · 8번 출구까지 직선 321m");
  assert.deepEqual(kf.stats.map((s) => s.label), ["정류장까지 도보", "1km 안 지하철역", "1km 안 정류장"]);
  assert.deepEqual(kf.stats.map((s) => s.value), ["4분", "5곳", "106곳"], "지하철역은 고유 역명 수(지표 6 → 5)");
}
{
  // 도보 경로가 같은 역으로 가면 같은 형태.
  const kf = toTileView(a01({ lines: [walkLine("2")] })).keyFigure;
  assert.equal(kf.answer.target, "대치역");
  assert.equal(kf.sub, "보행망 498m · 8번 출구까지 직선 321m");
}
{
  // 도보 경로가 다른 역(도곡역)으로 가면 큰 답은 도보 쪽, 보조 줄이 직선 최근접 역을 밝힌다.
  const kf = toTileView(a01({ lines: [walkLine("1")] })).keyFigure;
  assert.equal(kf.answer.target, "도곡역");
  assert.equal(kf.sub, "보행망 498m · 직선 최근접 대치역 321m");
}
{
  // 도보 경로는 있는데 그 지물이 지도에 없으면 목적지를 모른다 — 직선 최근접 역 이름으로 대신하지 않는다.
  const kf = toTileView(a01({ lines: [walkLine("999")] })).keyFigure;
  assert.ok(!("target" in kf.answer), "target 없음");
  assert.deepEqual(kf.answer, { pre: "도보", value: "6분", kind: "number" });
  assert.equal(kf.sub, "보행망 498m · 직선 최근접 대치역 321m");
}
{
  // 역 지물이 지도에 없으면 지표 값으로 센다. 직선 최근접 지물도 없으면 이름 없는 직선 거리.
  const kf = toTileView(a01({ features: [] })).keyFigure;
  assert.equal(kf.stats[1].value, "6곳");
  assert.ok(!("target" in kf.answer));
  assert.equal(kf.sub, "보행망 498m · 직선 321m");
}
{
  // 1km 이상 거리는 화면과 같은 서식(`1.3 km`).
  const kf = toTileView(a01({}, { metrics: a01Metrics({ walkRailM: 1300 }) })).keyFigure;
  assert.equal(kf.sub, "보행망 1.3 km · 8번 출구까지 직선 321m");
}
{
  const kf = toTileView(a01({}, { metrics: a01Metrics({ walkBusMin: null }) })).keyFigure;
  assert.ok(!kf.stats.some((s) => s.label === "정류장까지 도보"));
  assert.doesNotMatch(JSON.stringify(kf), /미확인/);
  assert.deepEqual(kf.stats.map((s) => s.label), ["1km 안 지하철역", "1km 안 정류장"]);
}
{
  // 반경 표기: 500 → 500m, 1500 → 1.5km
  const mk = (radiusM) => result("A01", "analysis", a01Metrics(), { features: [...stationFeatures, ...entranceFeatures] }, { conditions: conditions(radiusM) });
  assert.equal(toTileView(mk(500)).keyFigure.stats[1].label, "500m 안 지하철역");
  assert.equal(toTileView(mk(1500)).keyFigure.stats[1].label, "1.5km 안 지하철역");
}
{
  // 철도 자료가 없는 엔진 출력(a01/engine.ts: 철도 지표를 missing으로 내보낸다) — 도보 시간이 없으니 정의를 쓰지 않고 headline 카드로 돌아가되,
  // headline 지표(nearest_rail_m)가 미확인이면 그 글자를 쓰지 않고 같은 정책의 다음 값 있는 지표(nearest_bus_m)로 만든다.
  const noRail = [
    missing("nearest_rail_m", "최근접 철도역 출입구", "m"),
    missing("rail_stations", "반경 내 운영역", "개"),
    m("nearest_bus_m", "최근접 버스정류장", 153, "m"),
    m("bus_stops", "버스 정류장", 106, "개"),
    missing("walk_nearest_rail_m", "보행망 최근접 철도역 거리", "m"),
    missing("walk_nearest_rail_min", "보행망 최근접 철도역 도보시간", "분"),
    m("walk_nearest_bus_m", "보행망 최근접 버스정류장 거리", 180, "m"),
    m("walk_nearest_bus_min", "보행망 최근접 버스정류장 도보시간", 2, "분"),
  ];
  const view = toTileView(result("A01", "analysis", noRail));
  assert.equal(view.headline.value, "미확인", "타일 카드 자체의 headline은 그대로");
  assert.deepEqual(view.keyFigure, { question: "최근접 버스정류장", answer: { value: "153m", kind: "number" }, stats: [] });
  assert.doesNotMatch(JSON.stringify(view.keyFigure), /미확인|비공개|해당 없음/);
  // 값이 있는 headline 지표가 하나도 없으면 카드를 그리지 않는다.
  const none = noRail.map((metric) => metric.id === "nearest_bus_m" ? missing("nearest_bus_m", "최근접 버스정류장", "m") : metric);
  assert.equal(toTileView(result("A01", "analysis", none)).keyFigure, null);
}

// ── A12 ──
const raw = [["제3종일반주거지역", 50], ["제2종일반주거지역", 24.9], ["제1종일반주거지역", 18.5], ["일반상업지역", 5], ["준주거지역", 1.6]];
const a12Metrics = (parts) => [
  m("site_zoning_count", "대지 중심점의 용도지역 지정 수(세분 기준)", 1, "건"),
  m("share_class_1", "구성비: 주거", 95, "%"),
  m("share_class_2", "구성비: 상업", 5, "%"),
  ...parts.map(([name, v], i) => m(`share_raw_${i + 1}`, `세분: ${name}`, v, "%")),
];
const siteFeature = (name) => ({ layer: "zoning_site", lng: 127.06, lat: 37.49, name, highlight: true });
const ring = [[127.06, 37.49], [127.061, 37.49], [127.061, 37.491], [127.06, 37.49]];
const zonePolygon = (layer, name) => ({ layer, rings: [ring], name });
const a12 = (parts, site, polygons = [], status = "partial") => result("A12", "analysis", a12Metrics(parts), { features: [siteFeature(site)], polygons }, { status });
{
  const kf = toTileView(a12(raw, "제3종일반주거지역")).keyFigure;
  assert.equal(kf.question, "대지 용도지역");
  assert.equal(kf.answer.kind, "name");
  assert.equal(kf.answer.value, "제3종일반주거지역");
  assert.ok(kf.parts.length <= 6);
  const site = kf.parts.find((p) => p.site);
  assert.equal(site.label, "제3종일반주거지역");
  assert.equal(site.share, 50.0);
  assert.equal(kf.parts.filter((p) => p.site).length, 1);
  assert.deepEqual(kf.stats.map((s) => s.value), ["50.0%", "95.0%"]);
  assert.equal(kf.parts.find((p) => p.label === "일반상업지역").color, layerStyle("zone:상업").color);
  assert.equal(kf.parts.find((p) => p.label === "준주거지역").color, layerStyle("zone:주거").color);
}
{
  // 항목이 6개를 넘으면 큰 쪽 5개 + 「그 밖」으로 묶는다. 대지 항목은 작아도 남는다.
  const many = [...raw, ["준공업지역", 0.7], ["일반공업지역", 0.3]];
  const parts = toTileView(a12(many, "일반공업지역")).keyFigure.parts;
  assert.ok(parts.length <= 6);
  assert.equal(parts.find((p) => p.site).label, "일반공업지역");
  assert.equal(parts.at(-1).label, "그 밖");
  assert.ok(Math.abs(parts.reduce((a, p) => a + p.share, 0) - many.reduce((a, [, v]) => a + v, 0)) < 0.05, "묶어도 합계는 그대로");
}
{
  // 분류 색은 지도와 같은 `zone:<분류>` 스타일이다: 관리·농림·자연환경보전도 회색 「기타」가 아니다.
  const zones = [["계획관리지역", 40, "zone:관리"], ["농림지역", 30, "zone:농림"], ["자연환경보전지역", 20, "zone:자연환경보전"], ["개발제한구역", 10, "zone:기타"]];
  const parts = zones.map(([name, v]) => [name, v]);
  const expected = (name) => layerStyle(zones.find(([n]) => n === name)[2]).color;
  // 지도 면이 있으면 그 레이어 스타일
  const withPolygons = toTileView(a12(parts, "계획관리지역", zones.map(([name, , layer]) => zonePolygon(layer, name)))).keyFigure.parts;
  // 면이 지도에 없어도(상한으로 잘림) 이름에서 읽은 같은 레이어 스타일
  const byName = toTileView(a12(parts, "계획관리지역")).keyFigure.parts;
  for (const got of [withPolygons, byName]) {
    for (const [name] of zones) assert.equal(got.find((p) => p.label === name).color, expected(name), name);
  }
  assert.equal(withPolygons.find((p) => p.label === "계획관리지역").color, "#A8C66C");
  assert.notEqual(expected("계획관리지역"), layerStyle("zone:기타").color);
  // 지도 면의 분류가 이름 규칙과 다르면(코드로 분류된 도시지역) 지도 쪽을 따른다.
  const coded = toTileView(a12([["도시지역", 100]], "도시지역", [zonePolygon("zone:상업", "도시지역")])).keyFigure.parts;
  assert.equal(coded[0].color, layerStyle("zone:상업").color);
}

// ── D03 ──
const d03 = (status = "partial") => {
  const use = (i, name, n) => m(`share_use_${i}`, `구성비: ${name}`, Math.round((n / 1734) * 1000) / 10, "%", { numerator: n, denominator: 1734 });
  return result("D03", "diagram", [
    m("fill_use_pct", "주용도 확인 동수", 54.6, "%", { numerator: 947, denominator: 1734 }),
    use(1, "주거", 578), use(2, "근린생활", 220), use(3, "업무", 20), use(4, "판매", 15), use(10, "미상", 787),
  ], {}, { status });
};
{
  const kf = toTileView(d03()).keyFigure;
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

// ── 결과가 없는 타일(pending)은 카드가 없다: 같은 지표를 채운 결과로 pending 가드만 시험한다 ──
{
  const filled = { A01: [a01(), a01({}, { status: "pending" })], A12: [a12(raw, "제3종일반주거지역"), a12(raw, "제3종일반주거지역", [], "pending")], D03: [d03(), d03("pending")] };
  for (const [code, [done, pending]] of Object.entries(filled)) {
    assert.ok(toTileView(done).keyFigure, `${code}: 같은 지표로 완료 결과는 카드가 있다`);
    assert.equal(toTileView(pending).keyFigure, null, `${code} pending`);
  }
}

console.log("✓ v2 key figure");
