/** W0·W1 공용 지도 라벨·표식 계약의 RED→GREEN 테스트. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;

const { mapLabelText, mapLabelContent, automaticLabelText, selectAutomaticLabels, badgeTextColor } = await import("../../lib/v2/ui/map-labels.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { candidate, polygonCandidate, lineCandidate } = await import("../../lib/v2/engine/tiles/common.ts");
const { compactLegendItems, layerStyle, legendItems } = await import("../../lib/v2/ui/map-layers.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const { tileClientModuleFor } = await import("../../lib/v2/tile/client.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const center = [127.15, 37.62];
const base = {
  tileId: "x-A01",
  analysisId: "x",
  tileType: "analysis",
  tileCode: "A01",
  status: "partial",
  engineVersion: "test",
  conditions: { address: "a", center, radiusM: 500, analysisDate: "2026-10-09", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [],
  judgment: null,
  presentation: { legend: [], camera: null, layers: [], outputFace: "front", features: [], polygons: [], lines: [] },
  provenance: { manifestHash: "a".repeat(64), sources: [] },
  limitations: [],
};

// 자동 라벨은 name만, priority>=1만 사용하고 같은 문구는 엔진 순서상 한 번만 남긴다.
assert.equal(automaticLabelText("rail_station", "feature", { layer: "rail_station", name: "강남역", labelPriority: 0 }), null);
assert.equal(automaticLabelText("rail_station", "feature", { layer: "rail_station", name: "강남역", labelPriority: 1 }), "강남역");
// 계약 필드가 없는 결과(W2b 전·저장된 분석)는 이전 규칙: 명시 label/name이 있거나 강조된 요소만 자동 라벨
assert.equal(automaticLabelText("rail_station", "feature", { layer: "rail_station", name: "강남역" }), "강남역");
assert.equal(automaticLabelText("zone", "polygon", { layer: "zone", rings: [], label: "상계5구역" }), "상계5구역");
assert.equal(automaticLabelText("rail_nearest", "feature", { layer: "rail_nearest", distanceM: 600 }), null);
assert.match(automaticLabelText("rail_nearest", "feature", { layer: "rail_nearest", distanceM: 600 }, true), /직선 600m/);
assert.deepEqual(
  selectAutomaticLabels([
    { key: "low", autoText: "같은 역", labelPriority: 1, order: 0 },
    { key: "high", autoText: "강남역", labelPriority: 2, order: 1 },
    { key: "duplicate", autoText: "같은 역", labelPriority: 1, order: 2 },
  ]).map((entry) => entry.key),
  ["high", "low"],
);

// 호버·고정 라벨은 name 또는 범례명에 sublabel만 붙이고, 범례명을 이름 뒤에 반복하지 않는다.
assert.equal(mapLabelText("rail_station", "feature", { layer: "rail_station", name: "강남역", sublabel: "2호선", labelPriority: 2 }), "강남역 · 2호선");
assert.equal(mapLabelText("rail_station", "feature", { layer: "rail_station", name: null, sublabel: "2호선", labelPriority: 1 }), "철도역 · 2호선");
assert.equal(mapLabelText("rail_station", "feature", { layer: "rail_station", name: "강남역", sublabel: "미상", labelPriority: 2 }), "강남역");
assert.deepEqual(
  mapLabelContent("rail_station", "feature", { layer: "rail_station", name: "강남역", sublabel: "2호선\n환승 · 5분 · 추가 줄", labelPriority: 2 }),
  { title: "강남역", detailLines: ["2호선", "환승", "5분"], lines: ["강남역", "2호선", "환승", "5분"] },
  "말풍선 내용은 이름 굵은 줄과 보조 문구 최대 3줄로 정규화",
);

assert.equal(badgeTextColor("#111111"), "#FFFFFF");
assert.equal(badgeTextColor("#FDE725"), "#111111");

// 후보 조립은 FeatureHit 이름을 MapFeature로 전달하고, 면·선 후보도 표시 extra를 보존한다.
const hit = { featureId: 7, name: "공원 1", geometry: { type: "Point", coordinates: [127.15, 37.62] } };
assert.equal(candidate(hit, "park").f.name, "공원 1");
assert.equal(polygonCandidate(8, "parcel", [[[14100000, 4500000], [14100010, 4500000], [14100010, 4500010], [14100000, 4500000]]], 100, null, { name: "대상 면", labelPriority: 2 })?.p.name, "대상 면");
assert.equal(lineCandidate(9, "rail_line", [[14100000, 4500000], [14100010, 4500010]], 20, null, { name: "2호선", emphasis: "major" })?.l.name, "2호선");

const parsed = parseTileResult({
  ...base,
  presentation: {
    ...base.presentation,
    features: [{ layer: "rail_station", lng: center[0], lat: center[1], name: "강남역", sublabel: "2호선", labelPriority: 2, badges: [{ text: "환승", color: "#1F5FA8" }] }],
    polygons: [{ layer: "parcel", rings: [[[127.149, 37.619], [127.151, 37.619], [127.151, 37.621], [127.149, 37.619]]], name: "대상 면", labelPriority: 1 }],
    lines: [{ layer: "rail_line", points: [[127.149, 37.619], [127.151, 37.621]], name: "2호선", labelPriority: 1, color: "#1F5FA8", emphasis: "major" }],
  },
});
assert.equal(parsed.presentation.features[0].sublabel, "2호선");
assert.equal(parsed.presentation.features[0].badges[0].text, "환승");
assert.equal(parsed.presentation.lines[0].emphasis, "major");

const legendModel = {
  center,
  radiusM: 500,
  features: [{ layer: "bus_stop", lng: center[0], lat: center[1] }, { layer: "bus_nearest", lng: center[0], lat: center[1], highlight: true, distanceM: 100 }, { layer: "rail_station", lng: center[0], lat: center[1], highlight: true }],
  polygons: [],
  lines: [],
  total: 3,
  notes: [],
};
assert.ok(!legendItems(legendModel).some((item) => item.layer.endsWith("_nearest")), "최근접 레이어는 범례에서 제외");
assert.equal(compactLegendItems(legendModel, 1)[0]?.layer, "rail_station", "강조 레이어를 미니 범례 앞에 둔다");
assert.equal(layerStyle("planned_rail_line").dash, "7 5");
assert.equal(layerStyle("wind_inflow").arrow, true);
assert.equal(layerStyle("road:집산").strokeWidth, 1.5);

const styledSvg = renderToStaticMarkup(createElement(MapFigure, {
  model: {
    center,
    radiusM: 500,
    features: [{ layer: "rail_station", lng: center[0] + 0.001, lat: center[1], name: "강남역", labelPriority: 2, badges: [{ text: "환승", color: "#1F5FA8" }] }, { layer: "amenity", lng: center[0], lat: center[1] + 0.001, highlight: true, distanceM: 120, name: null, labelPriority: 0 }],
    polygons: [],
    lines: [{ layer: "planned_rail_line", points: [[center[0] - 0.002, center[1] - 0.002], [center[0] + 0.002, center[1] + 0.002]], name: "계획선", labelPriority: 1, color: "#6D28D9" }, { layer: "wind_inflow", points: [[center[0] - 0.001, center[1]], [center[0] + 0.001, center[1]]], name: "북서 유입", labelPriority: 1, color: "#0E7490" }],
    total: 2,
    notes: [],
  },
  width: 420,
  height: 280,
  fixed: true,
  basemap: "none",
  legend: false,
}));
assert.match(styledSvg, /data-map-badge="환승"/);
assert.match(styledSvg, /stroke="#6D28D9"/);
assert.match(styledSvg, /stroke-dasharray="3 3"/, "최근접 점선은 _nearest 레이어명이 아닌 highlight+distanceM으로 결정");
assert.match(styledSvg, /stroke-dasharray="7 5"/);
assert.match(styledSvg, /marker-end="url\(#arrow-/);
assert.match(styledSvg, /data-map-label-variant="auto"/, "자동 라벨도 말풍선 변형을 사용");
assert.match(styledSvg, /data-map-label-box="[^"]+"/, "자동 말풍선 상자 렌더");
assert.match(styledSvg, /data-map-label-leader="[^"]+"/, "자동 말풍선 꺾인 지시선 렌더");

// D03/D04/D05/D12는 초기 자동 라벨을 숨기되, 사용자가 고정한 요소는 남긴다.
for (const code of ["D03", "D04", "D05", "D12"]) assert.equal(tileClientModuleFor(code)?.autoLabels, false, `${code} 자동 라벨 정책`);
const d04Key = "rail_station|0";
const d04Model = {
  center,
  radiusM: 500,
  tileCode: "D04",
  features: [{ layer: "rail_station", lng: center[0], lat: center[1], name: "준공역", sublabel: "1990년대", labelPriority: 2 }],
  polygons: [],
  lines: [],
  total: 1,
  notes: [],
};
const d04AutoOff = renderToStaticMarkup(createElement(MapFigure, { model: d04Model, width: 420, height: 280, basemap: "none", legend: false }));
assert.doesNotMatch(d04AutoOff, /data-map-label-variant="auto"/, "D04 초기 자동 라벨 없음");
const d04Pinned = renderToStaticMarkup(createElement(MapFigure, { model: d04Model, width: 420, height: 280, basemap: "none", legend: false, pinnedKeys: [d04Key], onFeaturePin: () => {} }));
assert.match(d04Pinned, /data-map-label-variant="fixed"/, "D04 고정 라벨은 말풍선으로 표시");
assert.doesNotMatch(d04Pinned, /data-map-label-variant="auto"/, "D04 고정 시에도 자동 라벨은 생성하지 않음");
const d04Hover = renderToStaticMarkup(createElement(MapFigure, { model: d04Model, width: 420, height: 280, basemap: "none", legend: false, hoverKey: d04Key }));
assert.match(d04Hover, /data-map-label-variant="hover"/, "D04 호버 라벨은 말풍선으로 표시");
assert.match(d04Hover, /data-map-label-box="rail_station\|0"[^>]*fill="#fff"/, "호버 말풍선도 흰 상자 사용");
const d04Dragging = renderToStaticMarkup(createElement(MapFigure, { model: d04Model, width: 420, height: 280, basemap: "none", legend: false, pinnedKeys: [d04Key], onFeaturePin: () => {}, dragging: true }));
assert.doesNotMatch(d04Dragging, /data-map-label-leader=/, "드래그 중 지시선 숨김");

// PPT map-image가 넘기는 TileView.map도 tileCode를 유지하므로 동일한 MapFigure 정책을 사용한다.
const d04Result = parseTileResult({
  ...base,
  tileCode: "D04",
  presentation: { ...base.presentation, features: d04Model.features },
});
const d04TileView = toTileView(d04Result);
assert.equal(d04TileView.map?.tileCode, "D04", "PPT 지도 모델이 타일 코드를 유지");
const d04ReportMap = renderToStaticMarkup(createElement(MapFigure, { model: d04TileView.map, width: 960, height: 540, basemap: "none", legend: false, fixed: true }));
assert.doesNotMatch(d04ReportMap, /data-map-label-variant="auto"/, "PPT에 전달되는 지도 모델도 D04 자동 라벨 없음");

console.log("✓ v2 map contract");
