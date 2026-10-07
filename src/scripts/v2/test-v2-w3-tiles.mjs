import assert from "node:assert/strict";

const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { HEAVY_TILE_CODES, TILES } = await import("../../lib/v2/engine/run.ts");
const { MAX_MAP_POLYGONS, parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { mergeTileResults } = await import("../../lib/v2/engine/tiles/merge.ts");
const { layerOptionsForResult } = await import("../../lib/v2/ui/tile-layers.ts");
const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");

const expected = [
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A11", "A12",
  "D01", "D02", "D03", "D04", "D05", "D10", "D11", "D12", "D13", "D15", "D16", "D17", "D18", "D19", "D22", "D28", "D29",
  "S01", "S02", "S03", "S04",
];
const deleted = ["D06", "D07", "D08", "D09", "D14", "D20", "D21", "D23", "D24", "D25", "D26", "D27"];
assert.deepEqual(TILE_CODES, expected, "W3 registry has 33 current tile codes");
assert.deepEqual(TILES.map(([code]) => code), expected, "engine order follows the 33-tile catalog");
for (const code of deleted) assert.equal(TILE_CODES.includes(code), false, `${code} is not a current tile`);
assert.deepEqual([...HEAVY_TILE_CODES], ["S02", "D29", "D10", "S03", "S04"]);

const base = {
  analysisId: "w3-layer-test",
  status: "complete",
  engineVersion: "test",
  conditions: {
    address: "테스트",
    center: [127.15, 37.62],
    radiusM: 800,
    analysisDate: "2026-10-01",
    timezone: "Asia/Seoul",
    filters: {},
    simulation: null,
    parcelSnapshotHash: null,
  },
  metrics: [],
  judgment: null,
  provenance: { manifestHash: "a".repeat(64), sources: [{ sourceId: "test", releaseId: "test@1", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z" }] },
  limitations: [],
};

function result(code, features, polygons = [], lines = []) {
  return parseTileResult({
    ...base,
    tileId: `${base.analysisId}-${code}`,
    tileType: code.startsWith("D") ? "diagram" : "analysis",
    tileCode: code,
    presentation: {
      legend: [],
      camera: null,
      layers: [...new Set([...features.map((item) => item.layer), ...polygons.map((item) => item.layer), ...lines.map((item) => item.layer)])],
      outputFace: "front",
      ...(features.length > 0 ? { features, featuresTotal: features.length } : {}),
      ...(polygons.length > 0 ? { polygons, polygonsTotal: polygons.length } : {}),
      ...(lines.length > 0 ? { lines, linesTotal: lines.length } : {}),
    },
  });
}

const feature = (layer, fid) => ({ layer, fid, lng: 127.15, lat: 37.62 });
const polygon = (layer, fid) => ({ layer, fid, rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] });
const line = (layer, fid) => ({ layer, fid, points: [[127.149, 37.62], [127.151, 37.62]] });

const a01 = result("A01", [feature("bus_stop", "bus"), feature("rail_station", "rail"), feature("store", "other")], [], [line("rail_line", "line")]);
assert.deepEqual(layerOptionsForResult(a01).map((option) => option.id), ["all", "transit"]);
const a01Transit = viewWithLayer(toTileView(a01), "transit");
assert.deepEqual(a01Transit.map.features.map((item) => item.layer).sort(), ["bus_stop", "rail_station"]);
assert.deepEqual(a01Transit.map.lines.map((item) => item.layer), ["rail_line"]);
assert.equal(a01Transit.defaultLayer, "transit");

const d05 = result("D05", [feature("floors_1_4", "floor"), feature("tall_ge35", "tall"), feature("low_le12", "low")]);
assert.deepEqual(layerOptionsForResult(d05).map((option) => option.id), ["all", "height_tall", "height_low"]);
const tall = viewWithLayer(toTileView(d05), "height_tall");
assert.deepEqual(tall.map.features.map((item) => item.layer), ["tall_ge35"]);

const a12 = result("A12", [feature("zoning_site", "zone"), feature("store", "other")], [polygon("zone_residential", "zone-poly")], [line("road", "road")]);
const zoning = viewWithLayer(toTileView(a12), "zoning_detail");
assert.deepEqual(zoning.map.features.map((item) => item.layer), ["zoning_site"]);
assert.deepEqual(zoning.map.polygons.map((item) => item.layer), ["zone_residential"]);
assert.deepEqual(zoning.map.lines, []);

const many = (layer, prefix) => Array.from({ length: 2000 }, (_, index) => polygon(layer, `${prefix}-${index}`));
const merged = mergeTileResults(result("D05", [], many("floors_1_4", "floor")), result("D05", [], many("height_tall", "height")));
assert.equal(merged.presentation.polygons.length, MAX_MAP_POLYGONS, "흡수 결과도 최종 지도 면 상한을 지킨다");
assert.equal(merged.presentation.polygonsTotal, 4000, "흡수 결과의 전체 면 개수를 보존한다");
assert.deepEqual(new Set(merged.presentation.polygons.map((item) => item.layer)), new Set(["floors_1_4", "height_tall"]), "상한에서도 흡수 레이어별 면을 남긴다");

console.log("✓ v2 W3 tile registry, merge layer options, and map filtering");
