/** 타일 핵심 숫자(keyFigure) — 모델 계약과 A01·A12·D03 정의. 값이 없으면 줄을 빼고, 정의가 없으면 headline 카드로 돌아간다. */
import assert from "node:assert/strict";

const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { haText } = await import("../../lib/v2/tile/key-figure.ts");

// haText — 천 단위 쉼표, 1 ha 미만은 소수 두 자리, 아주 작은 값은 `0.00 ha`/`0.0 ha`로 보이지 않게
assert.equal(haText(64.56), "64.6 ha");
assert.equal(haText(0.512), "0.51 ha");
assert.equal(haText(1234.56), "1,234.6 ha");
assert.equal(haText(12_345_678), "12,345,678.0 ha");
assert.equal(haText(0.004), "0.01 ha 미만");
assert.equal(haText(0), "0 ha");

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

// ── 나머지 타일: 엔진이 낸 지표·행 모양 그대로(대치동 503, 1 km 실데이터 값) ──
const kfOf = (res, ...rest) => toTileView(res, ...rest).keyFigure;
const junk = /미확인|비공개|해당 없음|NaN|undefined/;
const stat = (value, label) => ({ value, label });
const feature = (layer, name, extra = {}) => ({ layer, lng: 127.06, lat: 37.49, name, highlight: true, ...extra });

// A02 — 가장 가까운 초등학교(이름은 최근접 학교 지물)
const a02 = (zone = 1, features = [feature("school_nearest", "서울대치초등학교")]) => result("A02", "analysis", [
  m("nearest_elem_m", "최근접 초등학교(학교 대표점)", 196, "m"),
  m("elem_schools", "반경 내 초등학교", 5, "개교"),
  m("middle_schools", "반경 내 중학교", 4, "개교"),
  zone === null ? missing("in_school_zone", "대상 주소의 초등 통학구역", "") : m("in_school_zone", "대상 주소의 초등 통학구역", zone, ""),
], { features });
{
  const kf = kfOf(a02());
  assert.equal(kf.question, "가장 가까운 초등학교");
  assert.deepEqual(kf.answer, { value: "196m", target: "서울대치초등학교", kind: "number" });
  assert.deepEqual(kf.stats, [stat("5개교", "1km 안 초등학교"), stat("4개교", "1km 안 중학교"), stat("안", "대지 초등 통학구역")]);
  assert.equal(kfOf(a02(0)).stats[2].value, "밖");
  assert.equal(kfOf(a02(null)).stats.length, 2, "통학구역을 모르면 그 칸을 뺀다");
  assert.doesNotMatch(JSON.stringify(kfOf(a02(null))), junk);
  assert.ok(!("target" in kfOf(a02(1, [])).answer), "최근접 학교 지물이 없으면 이름 없이");
}

// A03 — 반경 상가
{
  const kf = kfOf(result("A03", "analysis", [
    m("basic_groups", "기초 생활시설 확인 군(4군 중)", 4, "군", { numerator: 4, denominator: 4 }),
    m("stores", "반경 내 상가 전체", 3530, "개"),
    m("count_grocery", "식료품 업소", 153, "개"),
    m("count_clinic", "의원 업소", 234, "개"),
  ]));
  assert.equal(kf.question, "반경 1km 상가");
  assert.deepEqual(kf.answer, { value: "3,530곳", kind: "number" });
  assert.equal(kf.sub, "기초 생활시설 4군 중 4군 확인");
  assert.deepEqual(kf.stats, [stat("153곳", "식료품"), stat("234곳", "의원")]);
}

// A04 — 가장 가까운 공원(공원 대표점 직선거리, 이름은 최근접 공원 지물)
{
  const kf = kfOf(result("A04", "analysis", [
    m("parks", "반경 내 공원", 23, "곳"),
    m("nearest_park_point_m", "공원 대표점까지", 338, "m"),
    m("park_area_sum_m2", "반경 내 공원 원천 면적 합", 450365, "㎡", { numerator: 23, denominator: 23 }),
    missing("park_area_in_radius_m2", "반경 안에 든 공원 면적", "㎡"),
  ], { features: [feature("park_nearest", "배밭근린공원")] }));
  assert.equal(kf.question, "가장 가까운 공원");
  assert.deepEqual(kf.answer, { value: "338m", target: "배밭근린공원", kind: "number" });
  assert.equal(kf.sub, "공원 대표점까지 직선거리");
  assert.deepEqual(kf.stats, [stat("23곳", "1km 안 공원"), stat("45.0 ha", "공원 원천 면적 합")]);
}

// A05 — 필터 뒤 세대수가 큰 답(prepare가 다시 센 지표를 읽는다)
const a05Features = [
  { layer: "apt", lng: 127.06, lat: 37.49, households: 1000, approvalYear: 1995 },
  { layer: "apt", lng: 127.06, lat: 37.49, households: 500, approvalYear: 2010 },
  { layer: "apt", lng: 127.06, lat: 37.49, households: 800, approvalYear: 2005 },
  { layer: "apt", lng: 127.06, lat: 37.49, households: null, approvalYear: 2006 },
  { layer: "other_housing", lng: 127.06, lat: 37.49, households: 10, approvalYear: 2000 },
];
const a05 = () => result("A05", "analysis", [
  m("apartment_complexes", "아파트 단지", 4, "개"),
  m("other_residential", "기타 공동주택(연립·다세대 등)", 1, "개"),
  m("officetels", "오피스텔", 0, "개"),
  m("households", "확인 세대(세대수: 대장, 없으면 K-APT)", 2300, "세대", { numerator: 3, denominator: 4 }),
  m("households_unknown_complexes", "세대 수를 알 수 없는 단지", 1, "개"),
], { features: a05Features });
{
  const kf = kfOf(a05());
  assert.equal(kf.question, "반경 확인 세대");
  assert.deepEqual(kf.answer, { value: "2,300세대", kind: "number" });
  assert.deepEqual(kf.stats, [stat("4곳", "아파트 단지"), stat("1곳", "기타 공동주택"), stat("0곳", "오피스텔")]);
  assert.equal(kf.sub, "세대 수를 알 수 없는 단지 1곳은 합계에서 제외");
  const filtered = kfOf(a05(), null, null, { year: { min: 2000 } });
  assert.equal(filtered.answer.value, "1,300세대", "필터 뒤 세대수");
  assert.equal(filtered.stats[0].value, "3곳", "필터 뒤 아파트 단지");
}

// A06 — 청약 공급 세대
{
  const kf = kfOf(result("A06", "analysis", [
    m("applyhome_units", "청약홈 공급 세대", 0, "세대", { numerator: 0, denominator: 0 }),
    m("applyhome_projects", "청약홈 사업", 0, "곳"),
    m("applyhome_units_m0_12", "청약홈 분석일 기준 0~12개월 세대", 0, "세대", { numerator: 0, denominator: 0 }),
    m("move_in_units", "입주예정 공급 세대", 0, "세대", { numerator: 0, denominator: 0 }),
  ]));
  assert.equal(kf.question, "청약 공급 세대");
  assert.deepEqual(kf.answer, { value: "0세대", kind: "number" });
  assert.deepEqual(kf.stats, [stat("0곳", "청약홈 사업"), stat("0세대", "12개월 안 청약 세대")]);
  assert.equal(kf.sub, "입주예정 공급 0세대는 별도 집계");
}

// A07 — ㎡당 매매가 중앙값
const a07Metrics = [
  m("valid_trades", "유효 매매 거래(최근 12개월)", 342, "건"),
  m("median_price_per_m2", "㎡당 가격 중앙값", 3826.1, "만원/㎡", { numerator: 342 }),
  m("price_q1_per_m2", "㎡당 가격 하위 25% 경계", 3051.2, "만원/㎡"),
  m("price_q3_per_m2", "㎡당 가격 상위 25% 경계", 4474.2, "만원/㎡"),
];
{
  const kf = kfOf(result("A07", "analysis", a07Metrics));
  assert.equal(kf.question, "㎡당 매매가 중앙값");
  assert.equal(kf.answer.value, "3,826만원");
  assert.equal(kf.answer.post, "/㎡");
  assert.deepEqual(kf.stats, [stat("342건", "최근 12개월 거래"), stat("3,051만원", "㎡당 하위 25%"), stat("4,474만원", "㎡당 상위 25%")]);
  const noQuartile = kfOf(result("A07", "analysis", a07Metrics.filter((metric) => !metric.id.startsWith("price_q"))));
  assert.deepEqual(noQuartile.stats.map((s) => s.label), ["최근 12개월 거래"]);
}

// A08 — 전세가율
{
  const kf = kfOf(result("A08", "analysis", [
    m("jeonse_count", "전세 계약", 1659, "건"),
    m("monthly_count", "월세 계약", 1570, "건"),
    m("renewal_count", "갱신 계약", 1717, "건"),
    m("jeonse_to_trade_ratio_pct", "대응 전세가율", 41.8, "%", { status: "estimated", numerator: 20 }),
  ]));
  assert.equal(kf.question, "전세가율");
  assert.deepEqual(kf.answer, { value: "41.8%", kind: "number" });
  assert.equal(kf.sub, "대응 20단지 기준 · 갱신 계약 1,717건");
  assert.deepEqual(kf.stats, [stat("1,659건", "전세 계약"), stat("1,570건", "월세 계약")]);
  // 대응 표본이 없으면 전세가율은 미확인이라 큰 답이 없다 → 헤드라인 카드(값 있는 지표)로
  const none = kfOf(result("A08", "analysis", [
    m("jeonse_count", "전세 계약", 1659, "건"),
    missing("jeonse_to_trade_ratio_pct", "대응 전세가율", "%"),
  ]));
  assert.doesNotMatch(JSON.stringify(none), junk);
}

// A09 — 반경 정비사업(단계가 확인된 것 중 상위 2)
{
  const kf = kfOf(result("A09", "analysis", [
    m("zones_in_radius", "반경과 교차하는 정비구역", 20, "곳"),
    m("projects_in_radius", "반경 관련 사업", 17, "건"),
    m("stage_0", "단계: 정비계획", 2, "건"), m("stage_2", "단계: 추진위", 3, "건"), m("stage_3", "단계: 조합", 1, "건"),
    m("stage_4", "단계: 사업시행", 2, "건"), m("stage_5", "단계: 관리처분", 2, "건"), m("stage_7", "단계: 준공", 1, "건"),
    m("stage_8", "단계: 미확인", 6, "건"),
    m("fill_stage_pct", "단계 확인 사업", 64.7, "%", { numerator: 11, denominator: 17 }),
  ]));
  assert.equal(kf.question, "반경 정비사업");
  assert.deepEqual(kf.answer, { value: "17건", kind: "number" });
  assert.equal(kf.sub, "단계가 확인된 11건 중 상위 2");
  assert.deepEqual(kf.stats, [stat("3건", "추진위 단계"), stat("2건", "정비계획 단계"), stat("20곳", "교차 정비구역")]);
  assert.doesNotMatch(JSON.stringify(kf), junk);
  // 단계가 확인된 사업이 0건이면 「0건 중 상위 2」 보조 줄을 뺀다.
  const unknownOnly = kfOf(result("A09", "analysis", [
    m("zones_in_radius", "반경과 교차하는 정비구역", 4, "곳"),
    m("projects_in_radius", "반경 관련 사업", 6, "건"),
    m("stage_8", "단계: 미확인", 6, "건"),
    m("fill_stage_pct", "단계 확인 사업", 0, "%", { numerator: 0, denominator: 6 }),
  ]));
  assert.ok(!("sub" in unknownOnly), "단계 확인 0건이면 보조 줄 없음");
  assert.deepEqual(unknownOnly.stats, [stat("4곳", "교차 정비구역")]);
}

// A10— 계획·공사 사업(계획역 거리는 있을 때만, 개통 예정은 엔진이 항상 미확인이라 싣지 않는다)
{
  const base = [m("planned_projects", "반경 내 계획·공사 사업", 0, "건"), missing("opening_schedule", "개통 예정 시점", "")];
  const kf = kfOf(result("A10", "analysis", [...base, missing("nearest_planned_station_m", "최근접 계획역", "m")]));
  assert.equal(kf.question, "반경 계획·공사 사업");
  assert.deepEqual(kf.answer, { value: "0건", kind: "number" });
  assert.deepEqual(kf.stats, []);
  assert.deepEqual(kfOf(result("A10", "analysis", [...base, m("nearest_planned_station_m", "최근접 계획역", 450, "m")])).stats, [stat("450m", "최근접 계획역(직선)")]);
}

// A11 — 추정 인구
{
  const kf = kfOf(result("A11", "analysis", [
    m("pop_est", "반경 추정 인구", 82341, "명", { status: "estimated" }),
    m("density_per_km2", "인구밀도(원 면적 기준)", 26210, "명/㎢", { status: "estimated" }),
    m("hh_est", "반경 추정 가구", 28845, "가구", { status: "estimated" }),
  ]));
  assert.equal(kf.question, "반경 추정 인구");
  assert.deepEqual(kf.answer, { value: "82,341명", kind: "number" });
  assert.deepEqual(kf.stats, [stat("26,210명/㎢", "인구밀도"), stat("28,845가구", "가구 수")]);
}

// D02 — 반경 건물
{
  const kf = kfOf(result("D02", "diagram", [
    m("buildings", "반경 안 건물(중심점 기준)", 1734, "동"),
    m("fill_geometry_pct", "유효 건물 도형", 99.9, "%"),
    m("share_footprint_pct", "건물 발자국 구성비", 17.6, "%"),
  ]));
  assert.equal(kf.question, "반경 건물");
  assert.deepEqual(kf.answer, { value: "1,734동", kind: "number" });
  assert.deepEqual(kf.stats, [stat("17.6%", "건물 발자국 구성비"), stat("99.9%", "유효 도형")]);
}

// D04 — 2000년 이전 준공(분모는 반경 전체 건물: 사용승인일 미상이 41.7%라 확인률을 함께 싣는다)
{
  const kf = kfOf(result("D04", "diagram", [
    m("confirmed_share_pct", "사용승인일 확인 건물", 58.3, "%", { numerator: 1011, denominator: 1734 }),
    m("share_pre1980", "1979년 이하", 2.4, "%", { numerator: 41, denominator: 1734 }),
    m("share_1980s", "1980년대", 19.2, "%", { numerator: 333, denominator: 1734 }),
    m("share_1990s", "1990년대", 14.4, "%", { numerator: 250, denominator: 1734 }),
  ]));
  assert.equal(kf.question, "2000년 이전 준공");
  assert.deepEqual(kf.answer, { value: "36.0%", kind: "number" });
  assert.equal(kf.sub, "반경 건물 1,734동 중 624동");
  assert.deepEqual(kf.stats, [stat("58.3%", "사용승인일 확인률"), stat("19.2%", "1980년대"), stat("14.4%", "1990년대")]);
}

// D05 — 가장 많은 층수대 + 1층 가정 비율(저장소 규칙)
const d05Metrics = (withAssumed = true) => [
  m("fill_floors_pct", "층수 확인률", 68.4, "%", { numerator: 1186, denominator: 1734 }),
  m("fill_height_m_pct", "미터 높이 확인률", 35.9, "%", { numerator: 622, denominator: 1734 }),
  m("share_floors_1", "층수 구성: 1~4층", 37.1, "%", { numerator: 644, denominator: 1734 }),
  m("share_floors_2", "층수 구성: 5~8층", 16.7, "%", { numerator: 289, denominator: 1734 }),
  m("share_floors_6", "층수 구성: 층수 미상", 0, "%", { numerator: 0, denominator: 1734 }),
  ...(withAssumed ? [m("share_floors_assumed_1f", "층수 구성: 1층 가정(추정)", 31.6, "%", { status: "estimated", numerator: 548, denominator: 1734 })] : []),
];
{
  const kf = kfOf(result("D05", "diagram", d05Metrics()));
  assert.equal(kf.question, "가장 많은 층수대");
  assert.deepEqual(kf.answer, { pre: "1~4층", value: "37.1%", kind: "number" });
  assert.equal(kf.sub, "반경 건물 1,734동 중 644동");
  assert.deepEqual(kf.stats, [stat("68.4%", "층수 확인률"), stat("35.9%", "미터 높이 확인률"), stat("31.6%", "1층 가정(추정) · 548동")]);
  assert.ok(kf.stats.some((s) => /1층 가정/.test(s.label)), "1층 가정 비율을 함께 보인다");
  // 층수 미상이 가장 커도 1층 가정(추정)은 층수대가 아니다
  const assumedBiggest = d05Metrics().map((metric) => metric.id === "share_floors_assumed_1f" ? { ...metric, value: 90 } : metric);
  assert.equal(kfOf(result("D05", "diagram", assumedBiggest)).answer.pre, "1~4층");
}

// D10 — 수관 면적률
{
  const kf = kfOf(result("D10", "diagram", [
    m("canopy_pct", "반경 수관 면적률", 33.8, "%", { status: "estimated" }),
    m("canopy_site_pct", "대지 수관 면적률", 33.5, "%", { status: "estimated" }),
    m("osm_green_pct", "OSM 녹지 면적률", 13.8, "%"),
  ]));
  assert.equal(kf.question, "반경 수관 면적률");
  assert.deepEqual(kf.answer, { value: "33.8%", kind: "number" });
  assert.equal(kf.sub, "반경 1km 원 면적 기준");
  assert.deepEqual(kf.stats, [stat("33.5%", "대지 수관 면적률"), stat("13.8%", "OSM 녹지")]);
}

// D11 — 대지에 걸친 구역을 결과가 알려 주지 않으니 반경 교차면적(㎡ 7자리를 km²로)
const d11 = (areas) => result("D11", "diagram", [
  ...Object.entries(areas).map(([cls, area]) => m(`back_area_${cls}`, `반경 교차면적: ${cls}`, area, "㎡", { numerator: area })),
  m("fill_code_pct", "유효 구역·지구 코드 채움률", 100, "%", { numerator: 27, denominator: 27 }),
]);
{
  const kf = kfOf(d11({ 기타: 10567076, 지구단위계획: 2394241 }));
  assert.equal(kf.question, "반경 구역·지구 교차면적");
  assert.deepEqual(kf.answer, { pre: "지구단위계획", value: "2.39 km²", kind: "number" });
  assert.deepEqual(kf.stats, [stat("27건", "반경 교차 구역·지구"), stat("2종", "구역·지구 분류")]);
  assert.deepEqual(kfOf(d11({ 지구단위계획: 523000 })).answer, { pre: "지구단위계획", value: "52.3 ha", kind: "number" }, "1 km² 미만은 ha");
}
{
  // 지구단위계획이 없으면 겹침 합 면적(반경 원보다 클 수 있음)을 쓰지 않고 구역·지구 수가 큰 답이다.
  const kf = kfOf(d11({ 기타: 10567076, 개발제한: 523000 }));
  assert.equal(kf.question, "반경 구역·지구");
  assert.deepEqual(kf.answer, { pre: "구역·지구", value: "27건", kind: "number" });
  assert.deepEqual(kf.stats, [stat("2종", "구역·지구 분류")]);
  assert.doesNotMatch(JSON.stringify(kf), /㎡|km²|ha|기타|10\.57|10,567/, "겹침 합 면적이 새지 않는다");
}
{
  // 구역·지구 수도 없으면 카드가 없고 headline(반경 교차면적: 기타 …)으로도 새지 않는다.
  const view = toTileView(result("D11", "diagram", [m("back_area_기타", "반경 교차면적: 기타", 10567076, "㎡"), missing("fill_code_pct", "유효 구역·지구 코드 채움률", "%")]));
  assert.equal(view.keyFigure, null);
}

// D12 — 반경 가장 넓은 시설
{
  const kf = kfOf(result("D12", "diagram", [
    m("back_area_공간", "반경 교차면적: 공간", 311465, "㎡"),
    m("back_area_공공문화체육", "반경 교차면적: 공공문화체육", 423900, "㎡"),
    m("back_area_교통", "반경 교차면적: 교통", 645782, "㎡"),
    m("back_area_방재", "반경 교차면적: 방재", 252618, "㎡"),
  ]));
  assert.equal(kf.question, "반경 가장 넓은 시설");
  assert.deepEqual(kf.answer, { pre: "교통", value: "64.6 ha", kind: "number" });
  assert.deepEqual(kf.stats, [stat("42.4 ha", "공공문화체육"), stat("31.1 ha", "공간")]);
}

// D13 — 반경 도로 총길이
{
  const kf = kfOf(result("D13", "diagram", [
    m("road_length_in_radius_m", "반경 안 도로 중심선 총길이", 80688, "m"),
    m("share_road_2", "구성비: 간선", 6.8, "%"),
    m("share_road_3", "구성비: 보조간선", 8.2, "%"),
  ]));
  assert.equal(kf.question, "반경 도로 총길이");
  assert.deepEqual(kf.answer, { value: "80.7 km", kind: "number" });
  assert.equal(kf.sub, "OSM 도로 중심선 길이 합");
  assert.deepEqual(kf.stats, [stat("6.8%", "간선 비율"), stat("8.2%", "보조간선 비율")]);
}

// D15 — 블록 면적 중앙값(ha 값 그대로)
{
  const kf = kfOf(result("D15", "diagram", [
    m("blocks", "반경과 교차하는 폐합 블록", 260, "개"),
    m("median_block_ha", "폐합 블록 원래 면적 중앙값", 0.512416650390625, "ha"),
    m("share_count_lt05", "0.5ha 미만 (블록 수)", 48.5, "%", { numerator: 126, denominator: 260 }),
  ]));
  assert.equal(kf.question, "블록 면적 중앙값");
  assert.deepEqual(kf.answer, { value: "0.51 ha", kind: "number" });
  assert.deepEqual(kf.stats, [stat("260개", "폐합 블록 수"), stat("48.5%", "0.5 ha 미만 블록 비율")]);
}

// D16 — 최대 건물 밀도(대지 밀도 지표는 엔진에 없다)
{
  const kf = kfOf(result("D16", "diagram", [
    m("kde_bandwidth_m", "KDE 대역폭", 100, "m"),
    m("buildings_input", "KDE 입력 건물", 3257, "동"),
    m("dens_max", "최대 건물 밀도", 3065.608, "동/㎢", { status: "estimated" }),
  ]));
  assert.equal(kf.question, "최대 건물 밀도");
  assert.deepEqual(kf.answer, { value: "3,066동", post: "/㎢", kind: "number" });
  assert.equal(kf.sub, "건물이 가장 몰린 곳의 밀도");
  assert.deepEqual(kf.stats, [stat("3,257동", "밀도 계산에 쓴 건물(반경 밖 포함)")]);
  assert.doesNotMatch(JSON.stringify(kf), /KDE|대역폭/, "기술 용어를 쓰지 않는다");
}

// D17 — 대지 표고
{
  const kf = kfOf(result("D17", "diagram", [
    m("center_elevation_m", "중심 표고", 16.91112651011869, "m"),
    m("relief_max_m", "중심 대비 최고 고저차", 50.88426492365936, "m", { status: "estimated" }),
    m("relief_median_m", "중심 대비 고저차 중앙값", 5.0503166368306225, "m", { status: "estimated" }),
  ]));
  assert.equal(kf.question, "대지 표고");
  assert.deepEqual(kf.answer, { value: "17m", kind: "number" });
  assert.equal(kf.sub, "대지 중심점의 표면모델(DSM 30m) 표고");
  assert.deepEqual(kf.stats, [stat("51m", "중심 대비 최고 고저차"), stat("5m", "중심 대비 고저차 중앙값")]);
}

// D18 — 경사도 중앙값(소수 한 자리)
{
  const kf = kfOf(result("D18", "diagram", [
    m("slope_median_deg", "경사도 중앙값", 4.1771254522285295, "°", { status: "estimated" }),
    m("slope_max_deg", "경사도 최댓값", 29.307877428276857, "°", { status: "estimated" }),
    m("share_slope_0_5", "경사 0~5° 면적 구성비", 59.6, "%", { status: "estimated" }),
  ]));
  assert.equal(kf.question, "경사도 중앙값");
  assert.deepEqual(kf.answer, { value: "4.2°", kind: "number" });
  assert.deepEqual(kf.stats, [stat("29.3°", "경사도 최댓값"), stat("59.6%", "경사 0~5° 면적")]);
}

// D19 — 반경 필지
{
  const kf = kfOf(result("D19", "diagram", [
    m("parcels", "교차 필지", 1297, "필지"),
    m("share_jimok_1", "지목: 대지", 68.1, "%", { numerator: 883, denominator: 1297 }),
    m("share_jimok_2", "지목: 도로", 18.7, "%", { numerator: 243, denominator: 1297 }),
    m("median_parcel_m2", "필지 도형 면적 중앙값", 267.7, "㎡"),
  ]));
  assert.equal(kf.question, "반경 필지");
  assert.deepEqual(kf.answer, { value: "1,297필지", kind: "number" });
  assert.deepEqual(kf.stats, [stat("268㎡", "필지 면적 중앙값"), stat("68.1%", "지목 대지 필지")]);
}

// D22 — 가장 잦은 바람(최빈 풍향의 몫)
{
  const kf = kfOf(result("D22", "diagram", [
    m("station_distance_m", "최근접 ASOS 관측소 거리", 12180, "m", { numerator: 12180 }),
    m("period_years", "관측 기간", 10, "년"),
    m("prevailing_dir_deg", "최빈 풍향 중심각(W)", 270, "도", { numerator: 13966, denominator: 85021 }),
  ]));
  assert.equal(kf.question, "가장 잦은 바람");
  assert.deepEqual(kf.answer, { pre: "서(W)", value: "16.4%", kind: "number" });
  assert.equal(kf.sub, "정온 제외 풍향 관측 85,021시간 중 13,966시간");
  assert.deepEqual(kf.stats, [stat("12.2 km", "최근접 관측소 거리"), stat("10년", "관측 기간")]);
}

// D28 — 도보 10분 도달 면적(화면과 같은 소수 한 자리 km²)
{
  const kf = kfOf(result("D28", "diagram", [
    m("area_5min_km2", "도보 5분 도달 면적", 0.128, "km²", { status: "estimated" }),
    m("area_10min_km2", "도보 10분 도달 면적", 0.464, "km²", { status: "estimated" }),
    m("area_15min_km2", "도보 15분 도달 면적", 1.237, "km²", { status: "estimated" }),
    m("reach_ratio_10min_pct", "10분 도달 면적 / 직선 반경 원 면적", 14.8, "%", { status: "estimated" }),
  ]));
  assert.equal(kf.question, "도보 10분 도달 면적");
  assert.deepEqual(kf.answer, { value: "0.5 km²", kind: "number" });
  assert.equal(kf.sub, "직선 반경 원 면적의 14.8%");
  assert.deepEqual(kf.stats, [stat("0.1 km²", "도보 5분 도달"), stat("1.2 km²", "도보 15분 도달")]);
}

// D29 — 대지 하늘열림(비율 → %)
{
  const kf = kfOf(result("D29", "diagram", [
    m("svf_median", "하늘열림 중앙값", 0.812, "비율", { status: "estimated" }),
    m("back_nodata_pct", "SVF 결측·건물 지붕 면적률", 17.5, "%", { status: "estimated" }),
    m("svf_site_median", "대지 하늘열림 중앙값", 0.706, "비율", { status: "estimated" }),
  ]));
  assert.equal(kf.question, "대지 하늘열림");
  assert.equal(kf.answer.value, "71%");
  assert.deepEqual(kf.stats, [stat("81%", "반경 하늘열림 중앙값"), stat("17.5%", "결측·지붕 면적률")]);
}

// S01 — 주변 건물 높이 중앙값(중앙값은 1층 가정 건물을 뺀 값이라 그 비율을 함께 싣는다)
const s01Metrics = () => [
  m("height_known_pct", "높이 확인 건물 비율", 68.4, "%", { status: "estimated", numerator: 1186, denominator: 1734 }),
  m("height_assumed_one_floor_count", "1층 가정(추정) 건물", 548, "동", { status: "estimated", numerator: 548, denominator: 1734 }),
  m("height_median_m", "확보 높이 중앙값", 13.4, "m", { status: "estimated" }),
];
{
  const kf = kfOf(result("S01", "simulation", s01Metrics()));
  assert.equal(kf.question, "주변 건물 높이 중앙값");
  assert.deepEqual(kf.answer, { value: "13m", kind: "number" });
  assert.equal(kf.sub, "높이 확인 1,186동 기준 · 1층 가정 건물은 제외");
  assert.deepEqual(kf.stats, [stat("68.4%", "높이 확인(원천+층수 추정)"), stat("31.6%", "1층 가정(추정) · 548동")]);
  assert.ok(kf.stats.some((s) => /1층 가정/.test(s.label)));
}

// S02 — 동지 평균 일조
{
  const kf = kfOf(result("S02", "simulation", [
    m("mean_sun_h_winter", "동지 평균 일조시간", 3.5, "시간", { status: "estimated" }),
    m("mean_sun_h_spring", "춘분 평균 일조시간", 6.5, "시간", { status: "estimated" }),
    m("share_cont2h_0915_pct_winter", "동지 진태양시 09~15 연속 2시간 확보", 50.7, "%", { status: "estimated" }),
  ]));
  assert.equal(kf.question, "동지 평균 일조");
  assert.deepEqual(kf.answer, { value: "3.5시간", kind: "number" });
  assert.deepEqual(kf.stats, [stat("6.5시간", "춘분 평균 일조"), stat("50.7%", "동지 연속 2시간 확보")]);
}

// S03·S04 — 정의 없음: 결과가 없는(pending) 동안 카드도 없고, 결과가 있으면 headline 카드(첫 지표가 미확인이면 값 있는 다음 지표)
for (const [code, missingId, valuedId, value] of [["S03", "urel_median_annual", "share_wind_3_annual", 12.5], ["S04", "utci_median_summer_h14", "shade_pct_summer_h14", 41.2]]) {
  assert.equal(toTileView(result(code, "simulation", [], {}, { status: "pending" })).keyFigure, null, code);
  const kf = kfOf(result(code, "simulation", [missing(missingId, missingId, ""), m(valuedId, `${valuedId} 라벨`, value, "%")]));
  assert.ok(kf, `${code}: 값 있는 다음 지표로 카드를 만든다`);
  assert.equal(kf.question, `${valuedId} 라벨`, code);
  assert.match(kf.answer.value, new RegExp(`^${value}`), code);
  assert.doesNotMatch(JSON.stringify(kf), junk, code);
}

// 값이 없는 지표는 줄을 뺀다: 큰 답이 없으면 정의 대신 헤드라인 카드로(미확인 글자 없이)
{
  // 값 있는 다음 지표가 있으면 그 지표로 카드를 만든다 — 빈 검사가 되지 않게 카드가 실제로 있는지 단언한다.
  let cards = 0;
  for (const [code, type, ids, next] of [["A07", "analysis", ["median_price_per_m2"], m("valid_trades", "유효 거래", 342, "건")], ["D29", "diagram", ["svf_site_median"], m("svf_median", "반경 하늘열림 중앙값", 0.81, "")]]) {
    const view = toTileView(result(code, type, [...ids.map((id) => missing(id, id, "")), next]));
    assert.ok(view.keyFigure, `${code}: 다음 값 있는 지표로 카드`);
    assert.equal(view.keyFigure.question, next.label, code);
    assert.doesNotMatch(JSON.stringify(view.keyFigure), junk, code);
    cards += 1;
  }
  assert.equal(cards, 2, "headline 카드 경로를 실제로 검사했다");
  // 값이 있는 지표가 하나도 없으면 카드가 없다(미확인 글자도 없다).
  for (const [code, type, ids] of [["A07", "analysis", ["median_price_per_m2", "valid_trades"]], ["D12", "diagram", []], ["D29", "diagram", ["svf_site_median"]], ["D22", "diagram", ["prevailing_dir_deg"]]]) {
    const view = toTileView(result(code, type, ids.map((id) => missing(id, id, ""))));
    assert.doesNotMatch(JSON.stringify(view.keyFigure), junk, code);
  }
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
