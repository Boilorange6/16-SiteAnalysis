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
// 그래프는 세는 대상을 밝힌 타일에만 나온다 — 기본은 D05(건물·동). 레이어 이름은 이 함수가 보는 것이 아니라 범례 항목일 뿐이다.
const model = (parts) => ({ center: CENTER, radiusM: 1000, features: [], total: 0, notes: [], tileCode: "D05", ...parts });

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
assert.equal(noValue.countUnit, "동");
assert.equal(noValue.subject, "건물");
assert.equal(analysisStatLine(noValue), "반경 1 km 안 건물 4동 · 가장 많은 거리 200–300 m");
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

// 동률 처리: 지킬 점의 앞뒤 일반 점이 같은 거리면 앞쪽(낮은 번호)이 대신 빠진다. 건너뛰는 자리 k의 양옆 k-1·k+1은 둘 다 뽑혀 있다.
const tieAt = skipped[10];
assert.ok(evenly.has(tieAt - 1) && evenly.has(tieAt + 1));
const tieFeatures = Array.from({ length: 2500 }, (_, i) => pt(i % 2 ? "floors_1_4" : "floors_5_8", i * EAST_STEP, 0, i === tieAt ? 99 : i === tieAt - 1 ? 55 : i === tieAt + 1 ? 56 : 5));
const tie = analysisCharts(model({ valueAxis: AXIS, features: tieFeatures }));
const tieValues = tie.distance.points.map((point) => point.v);
assert.equal(tie.distance.points.length, 2000);
assert.ok(tieValues.includes(99) && tieValues.includes(56) && !tieValues.includes(55), "앞쪽(k-1)이 빠지고 뒤쪽(k+1)은 남는다");

// 지킬 점이 여러 개 빠진 경우: 대지 안 13개(연속) + 최댓값. 모두 남고 대신 바깥쪽 일반 점이 빠진다.
const runStart = skipped[20];
const runFeatures = Array.from({ length: 2500 }, (_, i) => pt(i % 2 ? "floors_1_4" : "floors_5_8", i * EAST_STEP, 0, i === skipped[60] ? 500 : i >= runStart && i < runStart + 13 ? 100 + (i - runStart) : 5));
const runModel = model({ valueAxis: AXIS, features: runFeatures, siteParcel: [{ layer: "parcel_site", rings: square((runStart + 6) * EAST_STEP, 0, 2.6) }] });
const run = analysisCharts(runModel);
assert.equal(run.distance.points.length, 2000);
assert.equal(run.distance.points.filter((point) => point.v >= 100 && point.v < 113).length, 13, "대지 안 점 13개 모두 유지");
assert.ok(run.distance.points.some((point) => point.v === 500), "최댓값 유지");
assert.deepEqual(run, analysisCharts(structuredClone(runModel)));

// NaN·±Infinity 값은 값 있음도 값 없음도 아니다
const nonFinite = analysisCharts(model({ valueAxis: AXIS, features: [pt("floors_1_4", 10, 0, 3), pt("floors_1_4", 20, 0, NaN), pt("floors_5_8", 30, 0, Infinity), pt("floors_5_8", 40, 0, -Infinity), pt("floors_5_8", 50, 0, 7), pt("floors_5_8", 60, 0, null)] }));
assert.equal(nonFinite.distance.points.length, 2);
assert.equal(nonFinite.distance.max, 7);
assert.equal(nonFinite.distance.median, 5);
assert.equal(nonFinite.missing, 1, "null만 값 없음");
assert.equal(nonFinite.total, 6);

// ── 거리대 폭은 반경에 맞춰 막대가 10개쯤 되게
const radiusBands = (radiusM) => analysisCharts(model({ radiusM, features: [pt("bus_stop", 50), pt("rail_station", radiusM - 10)] })).distance.bands;
const b3 = radiusBands(3000);
assert.equal(b3.length, 10);
assert.deepEqual(b3[0], { from: 0, to: 300, count: 1 });
assert.deepEqual(b3[9], { from: 2700, to: 3000, count: 1 });
const b2 = radiusBands(2000);
assert.equal(b2.length, 10);
assert.deepEqual(b2[1], { from: 200, to: 400, count: 0 });
const b15 = radiusBands(1500);
assert.equal(b15.length, 8);
assert.deepEqual(b15[7], { from: 1400, to: 1500, count: 1 });
assert.equal(radiusBands(500).length, 5, "500 m는 100 m 간격 그대로");
assert.equal(analysisStatLine(analysisCharts(model({ radiusM: 3000, features: [pt("bus_stop", 350), pt("bus_stop", 360), pt("rail_station", 2000)] }))), "반경 3 km 안 건물 3동 · 가장 많은 거리 300–600 m");

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

// ── 제목: 데이터와 함께 정한다(화면·PPT 공용)
assert.deepEqual(c.titles, { composition: "지상 층수 구성비", distance: "대지에서 거리와 지상 층수" });
const bandsOnly = analysisCharts(model({ features: [pt("bus_stop", 10), pt("rail_station", 20)] }));
assert.deepEqual(bandsOnly.titles, { composition: `${bandsOnly.subject} 구성비`, distance: `대지에서 거리별 ${bandsOnly.subject} 수` }, "값 축이 없으면 구성비는 대상 이름, 거리는 거리별 개수");

// ── 같은 fid의 면(여러 조각으로 나뉜 건물)은 한 번만 센다. 넓이가 가장 큰 조각이 점과 값을 정한다.
const piece = (layer, eastM, halfM, value, fid) => ({ layer, rings: square(eastM, 0, halfM), value, ...(fid === undefined ? {} : { fid }) });
const multipart = analysisCharts(model({
  valueAxis: AXIS,
  polygons: [
    piece("floors_1_4", 600, 5, 3, "a"), // 작은 조각이 먼저 나와도
    piece("floors_1_4", 100, 20, 10, "a"), // 큰 조각이 대표
    piece("floors_5_8", 200, 5, 6, "b"),
    piece("floors_5_8", 300, 5, 7), // fid 없음: 하나씩
    piece("floors_5_8", 310, 5, 8),
  ],
}));
assert.equal(multipart.total, 4, "같은 fid는 한 번 — 조각 5개 → 건물 4동");
assert.deepEqual(multipart.distance.points.map((p) => p.v).sort((x, y) => x - y), [6, 7, 8, 10], "대표 조각의 값(10)을 쓰고 작은 조각의 값(3)은 쓰지 않는다");
assert.ok(Math.abs(multipart.distance.points.find((p) => p.v === 10).d - 100) < 1, "대표 조각의 위치");
assert.equal(multipart.composition.find((item) => item.label === "1~4층").count, 1);
const tied = analysisCharts(model({ valueAxis: AXIS, polygons: [piece("floors_1_4", 50, 5, 1, "t"), piece("floors_1_4", 400, 5, 2, "t"), piece("floors_5_8", 200, 5, 6)] }));
assert.deepEqual(tied.distance.points.map((p) => p.v).sort((x, y) => x - y), [1, 6], "넓이가 같으면 앞선 조각");

// 범례에 없는 층(대지 필지 등)의 더 큰 조각이 같은 fid여도 범례 건물을 가리지 않는다
const withSiteTwin = analysisCharts(model({
  valueAxis: AXIS,
  polygons: [
    piece("parcel_site", 100, 30, null, "x"), // 더 크고 같은 fid인 비범례 조각
    piece("floors_1_4", 100, 5, 3, "x"),
    piece("floors_5_8", 200, 5, 6),
  ],
}));
assert.equal(withSiteTwin.total, 2, "비범례 조각이 같은 fid의 범례 조각을 지우지 않는다");
assert.deepEqual(withSiteTwin.distance.points.map((p) => p.v).sort((x, y) => x - y), [3, 6]);

// ── 엔진이 실은 `counted`가 반경 판정을 대신한다(없으면 반경 판정)
const flagged = analysisCharts(model({
  valueAxis: AXIS,
  polygons: [
    { ...piece("floors_5_8", 300, 5, 9), counted: false }, // 중심이 반경 안이어도 counted=false면 뺀다
    { ...piece("floors_1_4", 1200, 5, 4), counted: true }, // 중심이 반경 밖이어도 counted=true면 센다
    piece("floors_5_8", 100, 5, 6), // counted 없음 + 반경 안 → 센다
    piece("floors_1_4", 1300, 5, 8), // counted 없음 + 반경 밖 → 뺀다
    { ...piece("floors_1_4", 400, 20, 1, "z"), counted: false }, // 같은 fid: 넓이가 가장 큰 조각이 대표라 그 표시를 따른다
    { ...piece("floors_1_4", 500, 5, 2, "z"), counted: true },
  ],
}));
assert.equal(flagged.total, 2, "counted=true 하나 + 표시 없는 반경 안 하나");
assert.deepEqual(flagged.distance.points.map((p) => p.v).sort((x, y) => x - y), [4, 6]);

// ── 구성비 이름은 범례 이름의 ` · ` 앞부분(A07 가격대 범례는 지도 범례에 이미 있다)
const f = (layer, i) => ({ layer, lng: CENTER[0] + (i * 40) / M_LNG, lat: CENTER[1], weight: 100 });
const trade = analysisCharts(model({
  features: ["trade_q1", "trade_q2", "trade_q3"].map(f),
  legend: [{ label: "㎡당 하위 20%", min: null, max: 300 }, { label: "㎡당 20~40%", min: 300, max: 500 }, { label: "㎡당 40~60%", min: 500, max: 700 }, { label: "㎡당 60~80%", min: 700, max: 900 }, { label: "㎡당 상위 20%", min: 900, max: null }],
}));
assert.ok(legendItemsForModel(model({ features: ["trade_q1", "trade_q2", "trade_q3", "trade_q4", "trade_q5"].map(f), legend: [{ label: "㎡당 하위 20%", min: null, max: 300 }, { label: "㎡당 20~40%", min: 300, max: 500 }, { label: "㎡당 40~60%", min: 500, max: 700 }, { label: "㎡당 60~80%", min: 700, max: 900 }, { label: "㎡당 상위 20%", min: 900, max: null }] })).every((item) => item.label.includes(" · ")), "전제: 범례 이름에 가격대가 붙는다");
assert.deepEqual(trade.composition.map((item) => item.label), ["㎡당 하위 20%", "㎡당 20~40%", "㎡당 40~60%"], "구성비 이름은 가격대를 뗀 앞부분");
// 앞부분이 같아 구별되지 않으면 전체 이름을 쓴다(지목 · 대지 / 지목 · 도로)
const jimok = analysisCharts(model({ features: [f("jimok:대", 1), f("jimok:도로", 2)] }));
assert.deepEqual(jimok.composition.map((item) => item.label), ["지목 · 대지", "지목 · 도로"]);

// ── 그래프는 타일이 세는 대상을 밝혀야만 나온다(선택 참여, 대체값 없음)
const twoItems = { features: [pt("bus_stop", 10), pt("rail_station", 20), pt("bus_stop", 30)] };
assert.ok(analysisCharts(model(twoItems)), "전제: 밝힌 타일(D05)은 그래프가 나온다");
for (const code of ["A01", "A03", "A04", "A08", "D19", "A11", "A12", "D10", "D11", "D16", "D17", "D18", "D28"]) {
  assert.equal(analysisCharts(model({ ...twoItems, tileCode: code })), null, `${code}: 밝히지 않은 타일은 null`);
}
assert.equal(analysisCharts(model({ ...twoItems, tileCode: "Z99" })), null, "없는 타일 코드는 null");
const { tileCode: _omitted, ...withoutCode } = model(twoItems);
assert.equal(analysisCharts(withoutCode), null, "tileCode 없는 모델은 null");
assert.equal(analysisCharts({ ...withoutCode, valueAxis: AXIS }), null, "valueAxis가 있어도 tileCode가 없으면 null");

// 밝힌 대상·단위가 제목과 한 줄 요약에 그대로 흐른다
for (const [code, subject, unit] of [["D03", "건물", "동"], ["D04", "건물", "동"], ["D05", "건물", "동"], ["A07", "아파트", "단지"], ["A02", "학교", "곳"], ["A05", "주거 건물·단지", "곳"], ["A09", "정비구역", "곳"], ["D12", "도시계획시설", "건"], ["D15", "폐합 블록", "개"]]) {
  const declared = analysisCharts(model({ ...twoItems, tileCode: code }));
  assert.ok(declared, `${code}: 밝힌 타일`);
  assert.equal(declared.subject, subject, `${code} 대상`);
  assert.equal(declared.countUnit, unit, `${code} 단위`);
  assert.deepEqual(declared.titles, { composition: `${subject} 구성비`, distance: `대지에서 거리별 ${subject} 수` }, `${code} 제목`);
  assert.equal(analysisStatLine(declared), `반경 1 km 안 ${subject} 3${unit} · 가장 많은 거리 0–100 m`, `${code} 한 줄 요약`);
  assert.ok(!JSON.stringify(declared).includes("지물"), `${code}: 어디에도 「지물」이 없다`);
}
// 값 축이 있어도 세는 단위는 밝힌 쪽을 따른다(valueAxis.countUnit이 달라도)
const unitFromDeclaration = analysisCharts(model({ valueAxis: { ...AXIS, countUnit: "개" }, features: [pt("floors_1_4", 10, 0, 3), pt("floors_5_8", 20, 0, 5)] }));
assert.equal(unitFromDeclaration.countUnit, "동");
assert.equal(analysisStatLine(unitFromDeclaration), "반경 1 km 안 건물 2동 · 중앙값 4층 · 최고 5층");
assert.ok(!/지물/.test(analysisStatLine(c)) && !/지물/.test(JSON.stringify(c)), "기본 모델 출력에도 「지물」 없음");

// ── 점·선 지물의 `counted`도 반경 판정을 대신한다(엔진은 UTM-K, 그래프는 웹 메르카토르라 경계에서 판정이 갈린다)
const flaggedPoints = analysisCharts(model({
  features: [
    { ...pt("bus_stop", 1004), counted: true }, // 반경 밖으로 보이지만 엔진은 셌다
    { ...pt("bus_stop", 500), counted: false }, // 안이지만 엔진이 세지 않았다
    pt("rail_station", 100), // 표시 없음 → 반경 판정
    pt("rail_station", 1004), // 표시 없음 + 밖 → 뺀다
  ],
}));
assert.equal(flaggedPoints.total, 2);
const flaggedLines = analysisCharts(model({
  features: [pt("bus_stop", 100)],
  lines: [
    { layer: "rail_line", fid: "1", points: [at(100, 0), at(200, 0), at(300, 0)], counted: true },
    { layer: "rail_line", fid: "1", points: [at(400, 0), at(500, 0)], counted: true }, // 같은 fid는 한 번
    { layer: "rail_line", fid: "2", points: [at(1500, 0), at(1600, 0)], counted: true }, // 밖이어도 counted면 센다
    { layer: "rail_line", fid: "3", points: [at(600, 0), at(700, 0)], counted: false },
    { layer: "rail_line", points: [at(800, 0), at(900, 0)] }, // fid·표시 없음 → 반경 판정(안)
  ],
}));
assert.equal(flaggedLines.total, 4, "점 1 + 선 fid 1·2 + fid 없는 선");

// 범례에서 빠지는 「최근접 …」 강조 층도 같은 종류의 지물이라 센다(A02 최근접 초등학교): 본 층이 있으면 그 항목에 합치고, 없으면 항목을 만든다.
const withBase = analysisCharts(model({ tileCode: "A02", features: [pt("school_nearest", 100), pt("school_elem", 200), pt("school_middle", 300)] }));
assert.equal(withBase.total, 3);
assert.deepEqual(Object.fromEntries(withBase.composition.map((item) => [item.label, item.count])), { 초등학교: 2, 중학교: 1 }, "최근접 초등학교는 초등학교 항목에 합친다");
const nearestOnly = analysisCharts(model({ tileCode: "A02", features: [pt("school_nearest", 100), pt("school_middle", 300)] }));
assert.equal(nearestOnly.total, 2, "본 층이 없어도 최근접 학교를 센다");
assert.deepEqual(nearestOnly.composition.map((item) => item.label), ["초등학교", "중학교"]);
assert.equal(analysisStatLine(nearestOnly), "반경 1 km 안 학교 2곳 · 가장 많은 거리 100–200 m");

console.log("✓ v2 analysis charts");
