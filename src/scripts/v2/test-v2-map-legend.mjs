/** W3 공용 지도 범례·래스터 견본·선 불투명도 계약. */
import assert from "node:assert/strict";

const { legendItemsForModel, layerStyle, RASTER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
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

console.log("✓ v2 map legend, raster swatch, and line opacity contracts");
