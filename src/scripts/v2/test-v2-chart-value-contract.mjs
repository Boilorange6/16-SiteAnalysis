/** 그래프용 지물 값(value)·값 축(valueAxis) 스키마·모델 계약. */
import assert from "node:assert/strict";

const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const center = [127.15, 37.62];
const ring = [[127.15, 37.62], [127.1501, 37.62], [127.1501, 37.6201], [127.15, 37.6201], [127.15, 37.62]];
const result = (feature, polygon, valueAxis) => ({
  tileId: "x-D05",
  analysisId: "x",
  tileType: "diagram",
  tileCode: "D05",
  status: "partial",
  engineVersion: "test",
  conditions: { address: "a", center, radiusM: 500, analysisDate: "2026-10-09", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [],
  judgment: null,
  presentation: {
    legend: [],
    camera: null,
    layers: [],
    outputFace: "front",
    features: [{ layer: "floors_1_4", lng: 127.15, lat: 37.62, ...feature }],
    polygons: [{ layer: "floors_1_4", rings: [ring], ...polygon }],
    ...(valueAxis === undefined ? {} : { valueAxis }),
  },
  provenance: { manifestHash: "a".repeat(64), sources: [] },
  limitations: [],
});
const axis = { label: "지상 층수", unit: "층", countUnit: "동" };

// value: 유한 수·null·없음은 통과, 문자열·NaN은 실패 (점·면 모두)
for (const ok of [{ value: 12 }, { value: null }, {}]) parseTileResult(result(ok, ok, axis));
for (const bad of ["12", Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(() => parseTileResult(result({ value: bad }, {}, axis)), `feature value ${String(bad)}`);
  assert.throws(() => parseTileResult(result({}, { value: bad }, axis)), `polygon value ${String(bad)}`);
}

// valueAxis: 선택, countUnit 필수
parseTileResult(result({}, {}, undefined));
assert.throws(() => parseTileResult(result({}, {}, { label: "지상 층수", unit: "층" })), "countUnit 없음");
assert.throws(() => parseTileResult(result({}, {}, { label: "", unit: "층", countUnit: "동" })), "빈 label");

// 결과 → 모델
const view = toTileView(parseTileResult(result({ value: 4 }, { value: 4 }, axis)));
assert.deepEqual(view.map?.valueAxis, axis);
assert.equal(view.map?.polygons?.[0]?.value, 4, "면 value가 모델까지 간다");
assert.equal(view.map?.features?.[0]?.value, 4, "점 value가 모델까지 간다");
assert.equal(toTileView(parseTileResult(result({}, {}, undefined))).map?.valueAxis, undefined);

console.log("✓ v2 chart value contract");
