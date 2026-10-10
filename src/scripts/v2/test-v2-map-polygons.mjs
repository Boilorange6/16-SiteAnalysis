/** 면 지물: MapModel.polygons → SVG path, 범례 포함, 추정 레이어 해칭, 3000 상한. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;
const { compactLegendItems, legendItems, LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { MAX_MAP_POLYGONS } = await import("../../lib/v2/tile-result.ts");
const { capPolygons, polygonCandidate } = await import("../../lib/v2/engine/tiles/common.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

const ring = (dx) => [[127.15 + dx, 37.62], [127.151 + dx, 37.62], [127.151 + dx, 37.621], [127.15 + dx, 37.621], [127.15 + dx, 37.62]];
const model = {
  center: [127.1505, 37.6205],
  radiusM: 500,
  features: [{ layer: "bldg_point", lng: 127.1505, lat: 37.6205 }],
  total: 1,
  notes: [],
  polygons: [
    { layer: "bldg_footprint", rings: [ring(0)], label: "A동" },
    { layer: "tall_ge35_est", rings: [ring(0.002)], label: null },
  ],
  polygonsTotal: 2,
};
const svg = renderToStaticMarkup(createElement(MapFigure, { model, width: 800, height: 500, basemap: "none", fixed: true }));
assert.ok((svg.match(/<path[^>]*data-poly/g) ?? []).length === 2, "면 2개");
assert.ok(/url\(#hatch/.test(svg), "추정 레이어는 해칭");
assert.ok(svg.indexOf("data-poly") < svg.indexOf("<circle"), "면이 점보다 먼저");
const order = Object.keys(LAYER_STYLES);
assert.deepEqual(legendItems(model).map((i) => i.layer), ["bldg_footprint", "tall_ge35_est", "bldg_point"].sort((a, b) => order.indexOf(a) - order.indexOf(b)), "범례에 면 레이어 포함, 정의 순서");
assert.equal(MAX_MAP_POLYGONS, 3000);

const zoningModel = {
  center: [127.1505, 37.6205],
  radiusM: 500,
  features: [
    { layer: "zone:주거", lng: 127.15, lat: 37.62 },
    { layer: "zone_center:주거", lng: 127.151, lat: 37.621 },
    { layer: "zone:상업", lng: 127.152, lat: 37.622 },
    { layer: "zone_center:상업", lng: 127.153, lat: 37.623 },
  ],
  total: 4,
  notes: [],
};
const zoningLegend = legendItems(zoningModel);
assert.equal(zoningLegend.filter((item) => item.label === "주거지역").length, 1, "주거지역 범례 중복 제거");
assert.equal(zoningLegend.filter((item) => item.label === "상업지역").length, 1, "상업지역 범례 중복 제거");
assert.equal(compactLegendItems(zoningModel).find((item) => item.label === "주거지역")?.count, 2, "주거지역 alias 개수 합산");
const assumedLayerModel = {
  center: model.center,
  radiusM: model.radiusM,
  features: [
    { layer: "floors_assumed_1f_est", lng: model.center[0], lat: model.center[1] },
    { layer: "tall_assumed_1f_est", lng: model.center[0], lat: model.center[1] },
    { layer: "low_assumed_1f_est", lng: model.center[0], lat: model.center[1] },
    { layer: "bldg_assumed_1f", lng: model.center[0], lat: model.center[1] },
  ],
  total: 4,
  notes: [],
};
assert.equal(legendItems(assumedLayerModel).filter((item) => item.label === "1층 가정(추정)").length, 1, "같은 1층 가정 범례 문구는 한 항목으로 합친다");

const many = Array.from({ length: 3200 }, (_, i) => polygonCandidate(i, "parcel", [[[0, 0], [10, 0], [10, 10 + i], [0, 0]]], 50 + i)).filter(Boolean);
assert.equal(capPolygons(many).polygons.length, 3000);
const target = polygonCandidate(99999, "parcel_site", [[[0, 0], [1, 0], [1, 1], [0, 0]]], 1);
assert.ok(capPolygons([...many, target]).polygons.some((polygon) => polygon.layer === "parcel_site"), "대상 필지는 면 상한에서도 보존");

// tile-view가 polygons를 MapModel로 넘긴다
const base = { tileId: "x-D19", analysisId: "x", tileType: "diagram", tileCode: "D19", status: "complete", engineVersion: "t", conditions: { address: "a", center: [127.1505, 37.6205], radiusM: 500, analysisDate: "2026-09-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null }, metrics: [], judgment: null, presentation: { legend: [], camera: null, layers: ["parcel"], outputFace: "front", polygons: [{ layer: "parcel", rings: [ring(0)] }], polygonsTotal: 1 }, provenance: { manifestHash: "a".repeat(64), sources: [{ sourceId: "parcel_polygon", releaseId: "parcel_polygon@2026-09-08", sourceAsOf: "2026-09-08", fetchedAt: "2026-09-30T00:00:00Z" }] }, limitations: [] };
assert.equal(toTileView(base).map.polygons.length, 1);
const targetPart = { layer: "parcel_site", rings: [ring(0), [[127.1502, 37.6202], [127.1504, 37.6202], [127.1504, 37.6204], [127.1502, 37.6202]]] };
const targetResult = { ...base, presentation: { ...base.presentation, polygons: [targetPart, { layer: "parcel", rings: [ring(0.002)] }] } };
const targetView = toTileView(targetResult);
assert.equal(targetView.map.siteParcel.length, 1, "대상 필지는 공통 지도 입력으로 분리");
assert.equal(targetView.map.siteParcel[0].rings.length, 2, "대상 필지 홀 보존");
assert.equal(targetView.map.polygons.length, 1, "D19 대상 필지는 일반 면에서 중복 제외");
console.log("✓ v2 map polygons");
