/** W3 공용 지도 범례·래스터 견본·선 불투명도 계약. */
import assert from "node:assert/strict";

const { compactLegendItems, legendItemsForModel, layerStyle, normalizeLegendStripLabels, RASTER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { rasterLegendColor, rasterLegendEntries, rasterLegendTitle } = await import("../../lib/v2/ui/raster-image.ts");

const base = {
  center: [127.15, 37.62],
  radiusM: 1000,
  features: [],
  total: 0,
  notes: [],
};

const a07 = {
  ...base,
  features: [
    { layer: "trade_q1", lng: 127.15, lat: 37.62 },
    { layer: "trade_q2", lng: 127.15, lat: 37.62 },
    { layer: "trade_q3", lng: 127.15, lat: 37.62 },
    { layer: "trade_q4", lng: 127.15, lat: 37.62 },
    { layer: "trade_q5", lng: 127.15, lat: 37.62 },
  ],
  legend: [
    { label: "㎡당 하위 20%", min: null, max: 850 },
    { label: "㎡당 20~40%", min: 850, max: 1200 },
    { label: "㎡당 40~60%", min: 1200, max: 1500 },
    { label: "㎡당 60~80%", min: 1500, max: 1900 },
    { label: "㎡당 상위 20%", min: 1900, max: null },
  ],
};
const a07Legend = legendItemsForModel(a07);
assert.equal(a07Legend.length, 5);
assert.equal(a07Legend[0].label, "㎡당 하위 20% · ~850만원/㎡");
assert.equal(a07Legend[0].highlightLabel, "㎡당 하위 20%", "실제 경계 라벨도 공용 레이어 강조 키를 유지");
assert.equal(a07Legend[0].id, "trade_q1:legend-0", "같은 레이어의 복수 실제 구간도 범례 키가 고유");
assert.equal(a07Legend[1].label, "㎡당 20~40% · 850~1,200만원/㎡");
assert.equal(a07Legend.at(-1).label, "㎡당 상위 20% · 1,900만원/㎡ 이상");

const d16 = {
  ...base,
  polygons: [
    { layer: "dens_0", rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] },
    { layer: "dens_q1", rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] },
    { layer: "dens_q2", rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] },
    { layer: "dens_q3", rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] },
    { layer: "dens_q4", rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] },
    { layer: "dens_q5", rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] },
  ],
  legend: [
    { label: "건물 없음", min: 0, max: 0 },
    { label: "0.5~12동/㎢", min: 0.5, max: 12 },
    { label: "12~25동/㎢", min: 12, max: 25 },
    { label: "25~40동/㎢", min: 25, max: 40 },
    { label: "40~60동/㎢", min: 40, max: 60 },
    { label: "60동/㎢ 이상", min: 60, max: null },
  ],
};
assert.equal(legendItemsForModel(d16)[2].label, "12~25동/㎢");

const fallback = legendItemsForModel({ ...base, features: [{ layer: "trade_q1", lng: 127.15, lat: 37.62 }] });
assert.equal(fallback[0].label, "㎡당 하위 20%");

const rail = legendItemsForModel({
  ...base,
  lines: [
    { layer: "rail_line", points: [[127.14, 37.61], [127.16, 37.63]], color: "#794698" },
    { layer: "rail_line", points: [[127.14, 37.62], [127.16, 37.64]], color: "#D1495B" },
  ],
});
assert.deepEqual(rail[0].colors, ["#794698", "#D1495B"], "철도 범례는 원천 노선색을 모두 보존");
assert.equal(rail[0].color, "#794698", "복수 노선색의 대표 견본은 첫 원천색");

const mixedRaster = legendItemsForModel({
  ...base,
  lines: [{ layer: "wind_inflow", points: [[127.14, 37.61], [127.16, 37.63]] }],
  rasters: [{ name: "wind_ratio", palette: "wind_ratio" }],
  legend: [
    { label: "U/U유입 · 0~0.5", min: 0, max: 0.5 },
    { label: "U/U유입 · 0.5~0.8", min: 0.5, max: 0.8 },
  ],
});
assert.equal(mixedRaster.length, 1, "래스터 구간을 벡터 범례 항목으로 잘못 매핑하지 않음");
assert.equal(mixedRaster[0].label, "유입 방향", "래스터와 섞인 엔진 범례에서도 벡터 항목 유지");

const utciRef = { palette: "utci", label: "UTCI" };
const utciEntries = [
  { label: "UTCI 극한한랭 (< −40°C)", min: -50, max: -40 },
  { label: "바람 입력 없음", min: null, max: null },
  { label: "건물", min: null, max: null },
];
assert.equal(rasterLegendColor(utciRef, RASTER_STYLES.utci, utciEntries[1]), "#C4CAD3");
assert.equal(rasterLegendColor(utciRef, RASTER_STYLES.utci, utciEntries[2]), "#475569");

const s02Ref = { palette: "sun_hours", label: "동지 일조시간" };
const s02Entries = Array.from({ length: 16 }, (_, index) => ({
  label: index === 15 ? "일조시간 · 15시간 이상" : `일조시간 · ${index}시간`,
  min: index,
  max: index === 15 ? null : index + 1,
}));
assert.equal(rasterLegendEntries(s02Ref, RASTER_STYLES.sun_hours, s02Entries).length, 16);
assert.equal(rasterLegendTitle(s02Ref, RASTER_STYLES.sun_hours), "일조시간");
assert.equal(rasterLegendColor(s02Ref, RASTER_STYLES.sun_hours, s02Entries[15]), "#D76835");

assert.equal(layerStyle("walk_net").opacity, 0.55);

// 분위 레이어는 개수가 달라도 낮음→높음 순서를 지킨다(D16 실데이터에서 60~80%가 맨 앞에 오던 문제).
const d16Order = {
  ...base,
  polygons: [
    ...[1, 2, 2, 2, 3].map((q) => ({ layer: `dens_q${q}`, rings: [[[127.15, 37.62], [127.151, 37.62], [127.151, 37.621]]] })),
    ...Array.from({ length: 4 }, () => ({ layer: "dens_q4", rings: [[[127.15, 37.62], [127.151, 37.62], [127.151, 37.621]]] })),
  ],
};
assert.deepEqual(legendItemsForModel(d16Order).map((item) => item.layer), ["dens_q1", "dens_q2", "dens_q3", "dens_q4"], "분위 범례 정의 순서 유지");

const ring = [[[127.15, 37.62], [127.151, 37.62], [127.151, 37.621]]];
const polygons = (layer, count) => Array.from({ length: count }, () => ({ layer, rings: ring }));

// D04/D05 순서형 묶음은 개별 도형 수가 달라도 정의된 낮음→높음 순서를 유지한다.
const d04Order = {
  ...base,
  polygons: [
    ...polygons("bldg_2020s", 4),
    ...polygons("bldg_pre1980", 1),
    ...polygons("bldg_1990s", 3),
    ...polygons("bldg_1980s", 2),
  ],
};
assert.deepEqual(compactLegendItems(d04Order, 99).map((item) => item.layer), [
  "bldg_pre1980", "bldg_1980s", "bldg_1990s", "bldg_2020s",
], "D04 준공연대 범례 정의 순서 유지");

const d05Order = {
  ...base,
  polygons: [
    ...polygons("floors_26p", 4),
    ...polygons("floors_1_4", 1),
    ...polygons("floors_9_14", 3),
    ...polygons("floors_5_8", 2),
  ],
};
assert.deepEqual(compactLegendItems(d05Order, 99).map((item) => item.layer), [
  "floors_1_4", "floors_5_8", "floors_9_14", "floors_26p",
], "D05 층수 범례 정의 순서 유지");

// Regression fixtures (RED before implementation): 엔진 presentation.legend가 도형 첫 등장 순서로 섞여도, 같은 묶음만 정의 순서로 정렬해야 한다.
const d04MappedLegend = {
  ...base,
  features: [
    { layer: "bus_stop", lng: 127.15, lat: 37.62 },
    { layer: "park", lng: 127.151, lat: 37.621 },
  ],
  polygons: [
    ...polygons("bldg_1990s", 1),
    ...polygons("bldg_unknown", 1),
    ...polygons("bldg_2000s", 1),
    ...polygons("bldg_1980s", 1),
    ...polygons("bldg_2010s", 1),
  ],
  legend: [
    { label: "1990년대", min: null, max: null },
    { label: "버스정류장", min: null, max: null },
    { label: "미상", min: null, max: null },
    { label: "지정 공원", min: null, max: null },
    { label: "2000년대", min: null, max: null },
    { label: "1980년대", min: null, max: null },
    { label: "2010년대", min: null, max: null },
  ],
};
assert.deepEqual(legendItemsForModel(d04MappedLegend).map((item) => item.layer), [
  "bldg_1980s", "bus_stop", "bldg_1990s", "park", "bldg_2000s", "bldg_2010s", "bldg_unknown",
], "D04 엔진 범례는 같은 묶음만 정의 순서로 재정렬하고 묶음 밖 상대 순서를 유지");

const d05MappedLegend = {
  ...base,
  polygons: [
    ...polygons("floors_9_14", 1),
    ...polygons("floors_unknown", 1),
    ...polygons("floors_26p", 1),
    ...polygons("floors_1_4", 1),
    ...polygons("floors_5_8", 1),
  ],
  legend: [
    { label: "9~14층", min: null, max: null },
    { label: "층수 미상", min: null, max: null },
    { label: "26층 이상", min: null, max: null },
    { label: "1~4층", min: null, max: null },
    { label: "5~8층", min: null, max: null },
  ],
};
assert.deepEqual(legendItemsForModel(d05MappedLegend).map((item) => item.layer), [
  "floors_1_4", "floors_5_8", "floors_9_14", "floors_26p", "floors_unknown",
], "D05 엔진 범례는 같은 묶음 내부의 정의 순서를 유지");

// D16은 dens_0 도형이 없어도 엔진의 6개 경계를 전체 표시하고 실제 경계값을 보존한다.
const d16MissingDens0 = {
  ...base,
  polygons: [
    ...polygons("dens_q1", 1),
    ...polygons("dens_q2", 2),
    ...polygons("dens_q3", 3),
    ...polygons("dens_q4", 4),
    ...polygons("dens_q5", 5),
  ],
  legend: [
    { label: "건물 없음", min: 0, max: 0 },
    { label: "0.5~12동/㎢", min: 0.5, max: 12 },
    { label: "12~25동/㎢", min: 12, max: 25 },
    { label: "25~40동/㎢", min: 25, max: 40 },
    { label: "40~60동/㎢", min: 40, max: 60 },
    { label: "60동/㎢ 이상", min: 60, max: null },
  ],
};
const d16MissingLegend = legendItemsForModel(d16MissingDens0);
assert.deepEqual(d16MissingLegend.map((item) => item.layer), ["dens_0", "dens_q1", "dens_q2", "dens_q3", "dens_q4", "dens_q5"], "D16 dens_0 누락 시에도 엔진 순서로 레이어 연결");
assert.deepEqual(d16MissingLegend.map((item) => item.label), ["건물 없음", "0.5~12동/㎢", "12~25동/㎢", "25~40동/㎢", "40~60동/㎢", "60동/㎢ 이상"], "D16 실제 경계값을 범례에 유지");
assert.deepEqual(d16MissingLegend.map((item) => item.highlightLabel), ["건물 없음", "하위 20%", "20~40%", "40~60%", "60~80%", "상위 20%"], "D16 강조 라벨은 실제 지도 레이어 라벨 유지");

// D10의 수관은 벡터 면과 canopy 래스터가 같은 표시 라벨을 공유하므로 표시 범례는 한 칸이어야 한다.
const d10Raster = {
  ...base,
  polygons: polygons("canopy", 1),
  rasters: [{ name: "canopy", palette: "canopy", label: "수관 · 1m 격자" }],
};
assert.equal(legendItemsForModel(d10Raster).filter((item) => item.label === "수관").length, 0, "D10 canopy 래스터가 있으면 중복 벡터 범례를 만들지 않음");
const d10DuplicateEngine = {
  ...base,
  polygons: polygons("canopy", 1),
  legend: [
    { label: "수관", min: null, max: null },
    { label: "수관", min: null, max: null },
  ],
};
assert.equal(legendItemsForModel(d10DuplicateEngine).filter((item) => item.label === "수관").length, 1, "D10 동일 엔진 라벨을 한 번만 표시");

// 공통 접두는 범례 띠의 leadingLabel로 한 번만 올리고 값 라벨은 순수하게 분리한다.
const d19 = {
  ...base,
  polygons: [
    ...polygons("jimok:site", 1),
    ...polygons("jimok:road", 2),
    ...polygons("jimok:field", 3),
  ],
  legend: [
    { label: "지목 · 대지", min: null, max: null },
    { label: "지목 · 도로", min: null, max: null },
    { label: "지목 · 전답", min: null, max: null },
  ],
};
const d19Legend = normalizeLegendStripLabels(legendItemsForModel(d19));
assert.equal(d19Legend.leadingLabel, "지목", "D19 공통 접두는 범례 띠 제목으로 이동");
assert.deepEqual(d19Legend.items.map((item) => item.label), ["대지", "도로", "전답"], "D19 항목 라벨은 값만 표시");
assert.deepEqual(d19Legend.items.map((item) => item.highlightLabel), ["지목 · 대지", "지목 · 도로", "지목 · 전답"], "D19 highlightLabel은 실제 지도 레이어 라벨 유지");
const d19WithoutHighlight = normalizeLegendStripLabels([
  { layer: "jimok:site", label: "지목 · 대지", color: "#E3B65C" },
  { layer: "jimok:road", label: "지목 · 도로", color: "#8C939E" },
]);
assert.deepEqual(d19WithoutHighlight.items.map((item) => item.highlightLabel), ["지목 · 대지", "지목 · 도로"], "접두 분리 시 누락된 강조 키도 실제 라벨로 보강");
const tightDots = normalizeLegendStripLabels([
  { layer: "a", label: "임야·공원 지목", color: "#000000" },
  { layer: "b", label: "임야·하천 지목", color: "#000000" },
]);
assert.equal(tightDots.leadingLabel, null, "공백 없는 가운뎃점은 이름의 일부라 접두로 자르지 않음");

const s02Legend = normalizeLegendStripLabels(s02Entries.map((entry, index) => ({
  layer: `sun_${index}`,
  color: "#43566B",
  highlightLabel: `sun_${index}`,
  ...entry,
  label: entry.label.replace(/^일조시간/, "동지 일조시간(시간)"),
})));
assert.equal(s02Legend.leadingLabel, "동지 일조시간(시간)", "S02 raster style 접두는 범례 띠 제목으로 이동");
assert.equal(s02Legend.items[0].label, "0시간");
assert.equal(s02Legend.items.at(-1).label, "15시간 이상");
assert.equal(s02Legend.items[0].highlightLabel, "sun_0", "S02 값 라벨 정리 시 지도 레이어 강조 키를 보존");

console.log("✓ v2 map legend, raster swatch, and line opacity contracts");
