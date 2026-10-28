/** 분석 장 그래프 자료: 구성비·거리(산점/구간)·한 줄 요약. */
import assert from "node:assert/strict";

const { analysisCharts, analysisStatLine } = await import("../../lib/v2/report/analysis-charts.ts");
const { legendItemsForModel } = await import("../../lib/v2/ui/map-layers.ts");

const CENTER = [127, 37.5];
const M_LNG = 88300; // 위도 37.5°에서 경도 1°의 대략 미터
const M_LAT = 111200;
/** 중심에서 동쪽 eastM, 북쪽 northM 미터 떨어진 점 */
const at = (eastM, northM = 0) => [CENTER[0] + eastM / M_LNG, CENTER[1] + northM / M_LAT];
const square = (eastM, northM, halfM = 5) => {
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => at(eastM + x * halfM, northM + y * halfM));
  return [pts];
};
const pt = (layer, eastM, northM, value) => ({ layer, lng: at(eastM, northM)[0], lat: at(eastM, northM)[1], ...(value === undefined ? {} : { value }) });
const poly = (layer, eastM, northM, value) => ({ layer, rings: square(eastM, northM), ...(value === undefined ? {} : { value }) });
const AXIS = { label: "지상 층수", unit: "층", countUnit: "동" };
const model = (parts) => ({ center: CENTER, radiusM: 1000, features: [], total: 0, notes: [], ...parts });

// ── 기본 픽스처: 면 5(+반경 밖 1) · 점 3 · 대지
const base = model({
  valueAxis: AXIS,
  siteParcel: [{ layer: "parcel_site", rings: square(0, 0, 20) }],
  polygons: [
    poly("floors_1_4", 0, 0, 3), // 대지 안
    poly("floors_1_4", 300, 0, 4),
    poly("floors_5_8", 500, 0, 6),
    poly("floors_5_8", 0, 700, 8),
    poly("floors_unknown", 0, -400, null), // 값 없음
    poly("floors_1_4", 1200, 0, 50), // 반경 밖
  ],
  features: [
    pt("floors_26p", 5, 5, 30), // 대지 안
    pt("floors_26p", 0, 600, 40),
    pt("floors_26p", 800, 0), // value 키 없음 → 센다, 값 없음에도 넣지 않는다
  ],
});
const c = analysisCharts(base);
assert.ok(c, "차트 자료");
assert.equal(c.radiusM, 1000);
assert.equal(c.total, 8, "반경 밖 1개 제외, 점·면 합산");
assert.equal(c.countUnit, "동");
assert.equal(c.subject, "건물");
assert.equal(c.missing, 1, "null만 값 없음, undefined는 아님");

// 구성비: 범례 순서·share 합 1
const legendOrder = legendItemsForModel(base).map((item) => item.label);
assert.deepEqual(c.composition.map((item) => item.label), legendOrder.filter((label) => c.composition.some((item) => item.label === label)));
assert.deepEqual(Object.fromEntries(c.composition.map((item) => [item.label, item.count])), { "1~4층": 2, "5~8층": 2, "26층 이상": 3, "층수 미상": 1 });
assert.ok(Math.abs(c.composition.reduce((sum, item) => sum + item.share, 0) - 1) < 1e-9, "share 합 1");
assert.equal(c.composition.find((item) => item.label === "26층 이상").share, 3 / 8);
assert.equal(c.composition.find((item) => item.label === "1~4층").color, legendItemsForModel(base).find((item) => item.label === "1~4층").color);

// 거리 산점: 값 3,4,6,8,30,40
assert.equal(c.distance.kind, "scatter");
assert.deepEqual(c.distance.axis, { label: "지상 층수", unit: "층" });
assert.equal(c.distance.points.length, 6);
assert.equal(c.distance.median, 7);
assert.ok(Math.abs(c.distance.mean - 91 / 6) < 1e-9);
assert.equal(c.distance.max, 40);
assert.equal(c.distance.site, 17, "대지 안 지물(3, 30) 평균 16.5 → 17");
assert.equal(c.distance.sampled, false);
const p300 = c.distance.points.find((point) => point.v === 4);
assert.ok(Math.abs(p300.d - 300) < 6, `거리(m) ${p300.d}`);
assert.equal(p300.color, legendItemsForModel(base).find((item) => item.label === "1~4층").color);
assert.ok(c.distance.points.every((point) => point.d <= 1000));
assert.equal(analysisStatLine(c), "반경 1 km 안 건물 8동 · 중앙값 7층 · 최고 40층 · 1층 가정 1동");

// 대지가 없으면 site null
assert.equal(analysisCharts({ ...base, siteParcel: null }).distance.site, null);

// ── 상위 5 + 그 밖
const stores = ["store:grocery", "store:clinic", "store:pharmacy", "store:life_service", "store:eatery", "store:other", "bus_stop"];
const many = analysisCharts(model({
  features: stores.flatMap((layer, i) => Array.from({ length: i + 1 }, (_, k) => pt(layer, 10 + k * 20, 10 * i))),
}));
assert.equal(many.composition.length, 6);
assert.deepEqual(many.composition.slice(0, 5).map((item) => item.count), [7, 6, 5, 4, 3], "수 많은 상위 5개, 범례 순서(많은 순) 유지");
assert.deepEqual(many.composition[5], { label: "그 밖", color: "#B9BDC6", count: 3, share: 3 / 28 });
assert.ok(Math.abs(many.composition.reduce((sum, item) => sum + item.share, 0) - 1) < 1e-9);
assert.equal(many.total, 28);

// ── 값이 하나도 없으면 bands (100 m 간격)
const noValue = analysisCharts(model({
  features: [pt("bus_stop", 50), pt("bus_stop", 250), pt("bus_stop", 260), pt("rail_station", 990), pt("bus_stop", 2000)],
}));
assert.equal(noValue.distance.kind, "bands");
assert.equal(noValue.distance.bands.length, 10);
assert.deepEqual(noValue.distance.bands[0], { from: 0, to: 100, count: 1 });
assert.deepEqual(noValue.distance.bands[2], { from: 200, to: 300, count: 2 });
assert.deepEqual(noValue.distance.bands[9], { from: 900, to: 1000, count: 1 });
assert.equal(noValue.missing, 0);
assert.equal(noValue.countUnit, "개");
assert.equal(noValue.subject, "버스정류장");
assert.equal(analysisStatLine(noValue), "반경 1 km 안 버스정류장 4개 · 가장 많은 거리 200–300 m");
// 값 키가 전부 undefined(다른 모드 면)여도 bands
assert.equal(analysisCharts(model({ valueAxis: AXIS, features: [pt("floors_1_4", 10), pt("floors_5_8", 20)] })).distance.kind, "bands");

// ── 2,500점 → 2,000점·sampled·결정적
const big = model({
  valueAxis: AXIS,
  features: Array.from({ length: 2500 }, (_, i) => pt(i % 2 ? "floors_1_4" : "floors_5_8", (i * 7) % 700, Math.floor(i / 5) % 400,(i % 40) + 1)),
});
const bigA = analysisCharts(big);
const bigB = analysisCharts(structuredClone(big));
assert.equal(bigA.distance.points.length, 2000);
assert.equal(bigA.distance.sampled, true);
assert.equal(bigA.total, 2500);
assert.deepEqual(bigA, bigB);
assert.equal(bigA.distance.max, 40);
const ds = bigA.distance.points.map((point) => point.d);
assert.deepEqual(ds, [...ds].sort((a, b) => a - b), "거리순");

// ── 표본 추출은 최댓값·대지 안 점을 지킨다 (거리순 j번째 = 2,500점 중 floor(j×1.25) 근처, 건너뛰는 자리를 일부러 쓴다)
const evenly = new Set(Array.from({ length: 2000 }, (_, j) => Math.floor((j * 2499) / 1999)));
const skipped = Array.from({ length: 2500 }, (_, i) => i).filter((i) => !evenly.has(i) && i > 200);
const [maxAt, siteAt] = [skipped[0], skipped[40]];
const EAST_STEP = 0.39; // m — 거리순이 곧 i순
const keyFeatures = Array.from({ length: 2500 }, (_, i) => pt(i % 2 ? "floors_1_4" : "floors_5_8", i * EAST_STEP, 0, i === maxAt ? 99 : i === siteAt ? 77 : 5));
const keyModel = model({ valueAxis: AXIS, features: keyFeatures, siteParcel: [{ layer: "parcel_site", rings: square(siteAt * EAST_STEP, 0, 0.15) }] });
const keyA = analysisCharts(keyModel);
assert.equal(keyA.distance.sampled, true);
assert.equal(keyA.distance.points.length, 2000);
assert.ok(keyA.distance.points.some((point) => point.v === 99), "최댓값 점 유지");
assert.ok(keyA.distance.points.some((point) => point.v === 77), "대지 안 점 유지");
assert.equal(keyA.distance.site, 77);
assert.deepEqual(keyA, analysisCharts(structuredClone(keyModel)), "결정적");
const keyDs = keyA.distance.points.map((point) => point.d);
assert.deepEqual(keyDs, [...keyDs].sort((a, b) => a - b), "거리순 유지");

// ── null 경우
assert.equal(analysisCharts(model({ features: [pt("floors_1_4", 10), pt("floors_1_4", 20)] })), null, "범례 1개");
assert.equal(analysisCharts(model({ features: [pt("floors_1_4", 10), pt("floors_1_4", 20), pt("floors_5_8", 1500)] })), null, "범례는 2개여도 반경 안은 한 항목뿐");
assert.equal(analysisCharts(model({ features: [pt("floors_1_4", 1500), pt("floors_5_8", 1600)] })), null, "반경 안 지물 0");
assert.equal(analysisCharts(model({})), null, "빈 모델");

// ── 한 줄 요약 형식
const sample = { radiusM: 1000, total: 1735, countUnit: "동", subject: "건물", missing: 548, composition: [], distance: { kind: "scatter", axis: { label: "지상 층수", unit: "층" }, points: [], median: 4, mean: 6, max: 69, site: null, sampled: false } };
assert.equal(analysisStatLine(sample), "반경 1 km 안 건물 1,735동 · 중앙값 4층 · 최고 69층 · 1층 가정 548동");
const general = { ...sample, radiusM: 500, missing: 0, countUnit: "단지", subject: "아파트 단지", total: 42, distance: { ...sample.distance, axis: { label: "㎡당 가격", unit: "만원" }, median: 1234, max: 4321 } };
assert.equal(analysisStatLine(general), "반경 500 m 안 아파트 단지 42단지 · 중앙값 1,234만원 · 최고 4,321만원");
assert.equal(analysisStatLine({ ...general, missing: 3 }), "반경 500 m 안 아파트 단지 42단지 · 중앙값 1,234만원 · 최고 4,321만원 · 값 없음 3단지");
const year = { ...general, distance: { ...general.distance, axis: { label: "사용승인 연도", unit: "년" }, median: 1995, max: 2024 } };
assert.equal(analysisStatLine(year), "반경 500 m 안 아파트 단지 42단지 · 중앙값 1995년 · 최고 2024년");
const bands = { radiusM: 1000, total: 42, countUnit: "개", subject: "버스정류장", missing: 0, composition: [], distance: { kind: "bands", bands: [{ from: 0, to: 100, count: 1 }, { from: 100, to: 200, count: 9 }, { from: 200, to: 300, count: 9 }] } };
assert.equal(analysisStatLine(bands), "반경 1 km 안 버스정류장 42개 · 가장 많은 거리 100–200 m");

console.log("✓ v2 analysis charts");
