/** W0·W1 공용 지도 라벨·표식 계약의 RED→GREEN 테스트. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;

const { mapLabelText, automaticLabelText, selectAutomaticLabels, badgeTextColor } = await import("../../lib/v2/ui/map-labels.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { candidate, polygonCandidate, lineCandidate } = await import("../../lib/v2/engine/tiles/common.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

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

console.log("✓ v2 map contract");
