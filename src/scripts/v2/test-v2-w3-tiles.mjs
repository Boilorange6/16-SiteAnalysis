import assert from "node:assert/strict";

const { TILE_CODES } = await import("../../lib/v2/ui/tile-catalog.ts");
const { HEAVY_TILE_CODES, TILES } = await import("../../lib/v2/engine/run.ts");
const { MAX_D05_BUILDING_POLYGONS, MAX_MAP_POLYGONS, parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { mergeTileResults } = await import("../../lib/v2/engine/tiles/merge.ts");
const { capD05BuildingCandidates, makeTile } = await import("../../lib/v2/engine/tiles/common.ts");
const { filterMapForLayer, layerOptionsForResult } = await import("../../lib/v2/ui/tile-layers.ts");
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

function rawResult(code, features, polygons = [], lines = []) {
  return {
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
  };
}

function result(code, features, polygons = [], lines = []) {
  return parseTileResult(rawResult(code, features, polygons, lines));
}

const feature = (layer, fid) => ({ layer, fid, lng: 127.15, lat: 37.62 });
const polygon = (layer, fid) => ({ layer, fid, rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]] });
const line = (layer, fid) => ({ layer, fid, points: [[127.149, 37.62], [127.151, 37.62]] });

const a01 = result("A01", [feature("bus_stop", "bus"), feature("rail_station", "rail"), feature("store", "other")], [], [line("rail_line", "line")]);
assert.deepEqual(layerOptionsForResult(a01).map((option) => option.id), ["all", "transit", "bus"]);
const a01Transit = viewWithLayer(toTileView(a01), "transit");
assert.deepEqual(a01Transit.map.features.map((item) => item.layer).sort(), ["rail_station"], "철도 칩(id transit)은 철도만");
assert.deepEqual(a01Transit.map.lines.map((item) => item.layer), ["rail_line"]);
assert.equal(a01Transit.defaultLayer, "transit");

const currentLayerOptions = {
  A02: ["all", "school_zone"],
  A04: ["all", "park_only", "green_space"],
  A07: ["all"],
  A09: ["all", "maintenance_stage"],
  A10: ["all"],
  A11: [],
  A12: ["all"],
  D19: ["all", "parcel_size"],
};
for (const [code, ids] of Object.entries(currentLayerOptions)) {
  assert.deepEqual(layerOptionsForResult(result(code, [])).map((option) => option.id), ids, `${code} 현재 레이어 옵션`);
}

const a07 = result("A07", [feature("trade_q1", "cheap"), feature("trade_q5", "expensive")]);
const a07View = toTileView(a07);
assert.deepEqual(a07View.layerOptions, [{ id: "all", label: "기본 거래" }], "A07 옛 trade_location 칩은 현재 기본 보기로 투영");
assert.equal(a07View.defaultLayer, "all", "A07 옛 저장 레이어의 기본값은 all");
const a07LegacyView = viewWithLayer(a07View, "trade_location");
assert.equal(a07LegacyView.defaultLayer, "all", "A07 옛 trade_location 선택은 view에서 all로 fallback");
assert.deepEqual(a07LegacyView.map.features.map((item) => item.layer).sort(), ["trade_q1", "trade_q5"]);
assert.deepEqual(
  filterMapForLayer(a07View.map, "A07", "trade_location")?.features.map((item) => item.layer).sort(),
  ["trade_q1", "trade_q5"],
  "A07 옛 trade_location 매처는 지도를 잘못 잘라내지 않는다",
);

for (const [code, legacyLayer, staleFeatureLayer] of [
  ["A10", "planned_detail", "planned_rail_line"],
  ["A11", "density_detail", "pop_dens_5"],
  ["A12", "zoning_detail", "zone_residential"],
]) {
  const stale = toTileView(result(code, [feature(staleFeatureLayer, "stale"), feature("other", "other")]));
  assert.deepEqual(
    filterMapForLayer(stale.map, code, legacyLayer)?.features.map((item) => item.layer).sort(),
    ["other", staleFeatureLayer].sort(),
    `${code} 삭제된 ${legacyLayer} 선택은 전체 지도를 유지`,
  );
  assert.equal(viewWithLayer(stale, legacyLayer).defaultLayer, "all", `${code} 삭제된 ${legacyLayer} 선택 fallback`);
}

const d05 = result("D05", [feature("floors_1_4", "floor"), feature("tall_ge35", "tall"), feature("low_le12", "low")]);
assert.deepEqual(layerOptionsForResult(d05).map((option) => option.id), ["all", "height_tall", "height_low"]);
const tall = viewWithLayer(toTileView(d05), "height_tall");
assert.deepEqual(tall.map.features.map((item) => item.layer), ["tall_ge35"]);
const d05Base = viewWithLayer(toTileView(d05), "all");
assert.deepEqual(d05Base.map.features.map((item) => item.layer), ["floors_1_4"], "층수 기본 보기에 35m·12m 레이어를 겹치지 않는다");

const a12 = result("A12", [feature("zoning_site", "zone"), feature("store", "other")], [polygon("zone_residential", "zone-poly")], [line("road", "road")]);
// A12는 바꿔도 화면이 같은 레이어 선택을 두지 않는다(계획 1-2) — 단일 보기
assert.deepEqual(layerOptionsForResult(a12).map((option) => option.id), ["all"]);

const many = (layer, prefix) => Array.from({ length: 2000 }, (_, index) => polygon(layer, `${prefix}-${index}`));
const merged = mergeTileResults(result("D05", [], many("floors_1_4", "floor")), result("D05", [], many("height_tall", "height")));
assert.equal(merged.presentation.polygons.length, MAX_MAP_POLYGONS, "흡수 결과도 최종 지도 면 상한을 지킨다");
assert.equal(merged.presentation.polygonsTotal, 3000, "표시 상한을 반영한 전체 면 개수 공식");
assert.deepEqual(new Set(merged.presentation.polygons.map((item) => item.layer)), new Set(["floors_1_4", "height_tall"]), "상한에서도 흡수 레이어별 면을 남긴다");

const otherTileMerged = mergeTileResults(result("D19", [], many("parcel", "parcel-a")), result("D19", [], many("lot_ge3000", "parcel-b")));
assert.equal(otherTileMerged.presentation.polygons.length, MAX_MAP_POLYGONS, "일반 타일 merge 상한은 3,000면을 유지한다");

// D05 흡수 경로는 선택(거리)과 출력(기존 층수 우선)을 분리한다.
const buildingPolygon = (layer, index) => ({
  layer,
  fid: `building-${index}`,
  name: `건물-${index}`,
  sublabel: `${3100 - index}층`,
  labelPriority: 1,
  rings: [[
    [127.1501 + index * 1e-5, 37.61999],
    [127.1503 + index * 1e-5, 37.61999],
    [127.1503 + index * 1e-5, 37.62001],
    [127.1501 + index * 1e-5, 37.61999],
  ]],
});

const d05AllViews = mergeTileResults(
  mergeTileResults(
    result("D05", [], Array.from({ length: 1200 }, (_, index) => buildingPolygon("floors_1_4", index))),
    result("D05", [], Array.from({ length: 1200 }, (_, index) => buildingPolygon("tall_ge35", index))),
    { d05BuildingPolygons: true },
  ),
  result("D05", [], Array.from({ length: 1200 }, (_, index) => buildingPolygon("low_le12", index))),
  { d05BuildingPolygons: true },
);
assert.equal(d05AllViews.presentation.polygons.length, 3600, "1,200동×3보기는 전부 유지한다");
assert.equal(new Set(d05AllViews.presentation.polygons.map((item) => item.fid)).size, 1200, "D05는 보기별 면을 같은 건물 그룹으로 묶는다");
assert.deepEqual(new Set(d05AllViews.presentation.polygons.map((item) => item.layer)), new Set(["floors_1_4", "tall_ge35", "low_le12"]), "D05 세 보기 면을 모두 보존한다");

const d05Nearest = mergeTileResults(
  mergeTileResults(
    rawResult("D05", [], Array.from({ length: 3100 }, (_, index) => buildingPolygon("floors_1_4", index))),
    rawResult("D05", [], Array.from({ length: 3100 }, (_, index) => buildingPolygon("tall_ge35", index))),
    { d05BuildingPolygons: true },
  ),
  rawResult("D05", [], Array.from({ length: 3100 }, (_, index) => buildingPolygon("low_le12", index))),
  { d05BuildingPolygons: true },
);
assert.equal(d05Nearest.presentation.polygons.length, MAX_D05_BUILDING_POLYGONS, "3,100동이면 가까운 3,000동×3보기만 남긴다");
assert.equal(new Set(d05Nearest.presentation.polygons.map((item) => item.fid)).size, 3000, "D05 건물 cap은 3,000동 단위다");
assert.ok(d05Nearest.presentation.polygons.some((item) => item.fid === "building-0" && item.layer === "floors_1_4"), "가까운 저층 건물은 남긴다");
assert.ok(!d05Nearest.presentation.polygons.some((item) => item.fid === "building-3000"), "가장 먼 100동 중 첫 건물은 빠진다");
assert.ok(!d05Nearest.presentation.polygons.some((item) => item.fid === "building-3099"), "가장 먼 100동 중 마지막 건물은 빠진다");
const outputFloorLabels = d05Nearest.presentation.polygons.map((item) => Number.parseInt(item.sublabel ?? "", 10));
assert.deepEqual(outputFloorLabels, [...outputFloorLabels].sort((a, b) => b - a), "선택 후 출력은 기존 층수 내림차순 우선순위를 유지한다");
const d05NearestView = toTileView(d05Nearest);
assert.equal(viewWithLayer(d05NearestView, "all").map.polygons.length, 3000, "D05 기본 지도는 한 보기 3,000면이다");
assert.equal(viewWithLayer(d05NearestView, "height_tall").map.polygons.length, 3000, "D05 고층 지도는 한 보기 3,000면이다");
assert.equal(viewWithLayer(d05NearestView, "height_low").map.polygons.length, 3000, "D05 저층 지도는 한 보기 3,000면이다");

const fakeContext = { analysisId: "d05-cap-source", manifestHash: "a".repeat(64), conditions: base.conditions };
const sourcePolygons = Array.from({ length: 3100 }, (_, index) => ({ id: index, areaM2: 1, p: buildingPolygon("floors_1_4", index) }));
const oversizedSourcePolygons = Array.from({ length: 10000 }, (_, index) => ({
  id: index * 1000,
  areaM2: index === 9999 ? 1000000 : 1,
  p: buildingPolygon("floors_1_4", index),
}));
const nearestSourceCandidates = capD05BuildingCandidates(oversizedSourcePolygons, base.conditions.center);
assert.equal(nearestSourceCandidates.length, MAX_MAP_POLYGONS, "D05 원본이 9,000면을 넘어도 가까운 3,000동 후보만 남긴다");
assert.ok(nearestSourceCandidates.some(({ p }) => p.fid === "building-0"), "원본 사전 cap에서도 가까운 건물을 남긴다");
assert.ok(!nearestSourceCandidates.some(({ p }) => p.fid === "building-9999"), "원본 사전 cap에서도 먼 건물을 버린다");
const tieCandidates = [
  { id: 1000, areaM2: 1, p: { ...buildingPolygon("floors_1_4", 0), fid: "tie-first" } },
  { id: 2000, areaM2: 1, p: { ...buildingPolygon("floors_1_4", 0), fid: "tie-second" } },
];
assert.equal(capD05BuildingCandidates(tieCandidates, base.conditions.center, 1)[0]?.p.fid, "tie-first", "D05 거리 동률은 기존 첫 등장 순으로 결정한다");
const d05Source = makeTile(fakeContext, {
  code: "D05",
  status: "complete",
  metrics: [],
  sources: [{ sourceId: "test", releaseId: "test@1", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z" }],
  limitations: [],
  polygons: nearestSourceCandidates,
  polygonTotal: oversizedSourcePolygons.length,
  polygonCap: MAX_MAP_POLYGONS,
});
assert.equal(d05Source.presentation.polygons.length, MAX_MAP_POLYGONS, "D05 원본 사전 후보는 일반 화면 한 보기 상한만큼 보존한다");
assert.equal(d05Source.presentation.polygonsTotal, oversizedSourcePolygons.length, "D05 원본은 사전 선택 전 면 수를 전체 개수로 유지한다");
const ordinarySource = makeTile(fakeContext, {
  code: "D19",
  status: "complete",
  metrics: [],
  sources: [{ sourceId: "test", releaseId: "test@1", sourceAsOf: "2026-10-01", fetchedAt: "2026-10-01T00:00:00Z" }],
  limitations: [],
  polygons: sourcePolygons,
});
assert.equal(ordinarySource.presentation.polygons.length, MAX_MAP_POLYGONS, "일반 타일 조립기의 기본 cap은 3,000면이다");

console.log("✓ v2 W3 tile registry, merge layer options, and map filtering");
