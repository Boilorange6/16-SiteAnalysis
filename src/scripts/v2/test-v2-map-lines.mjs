/** 선 지물(MapLine)·D22 rose 계약과 지도 렌더 테스트. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;
const { legendItems } = await import("../../lib/v2/ui/map-layers.ts");
const { MAX_MAP_LINES, MAX_LINE_VERTICES, parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { capLines, lineCandidate } = await import("../../lib/v2/engine/tiles/common.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

const center = [127.1505, 37.6205];
const mapLine = (label, dx = 0) => ({
  layer: "contour",
  points: [[127.149 + dx, 37.6215], [127.1505 + dx, 37.6215], [127.152 + dx, 37.6215]],
  label,
});
const model = {
  center,
  radiusM: 500,
  features: [{ layer: "bldg_point", lng: center[0], lat: center[1] }],
  total: 1,
  notes: [],
  polygons: [{ layer: "bldg_footprint", rings: [[[127.15, 37.62], [127.151, 37.62], [127.151, 37.621], [127.15, 37.62]]] }],
  lines: [mapLine("100m"), mapLine("110m", 0.002)],
  linesTotal: 2,
};
const svg = renderToStaticMarkup(createElement(MapFigure, { model, width: 800, height: 500, basemap: "none", fixed: true }));
assert.equal((svg.match(/<polyline[^>]*data-line/g) ?? []).length, 2, "선 2개");
assert.ok(svg.indexOf("data-poly") < svg.indexOf("data-line"), "면이 선보다 먼저");
assert.ok(svg.indexOf("data-line") < svg.indexOf("<circle"), "선이 점보다 먼저");
assert.ok(svg.includes("100m"), "선 라벨");

assert.deepEqual(
  legendItems({ center, radiusM: 500, features: [], polygons: [], lines: [mapLine(null)], total: 0, notes: [] }).map((item) => item.layer),
  ["contour"],
  "선 레이어도 범례에 포함",
);

assert.equal(MAX_MAP_LINES, 2000);
assert.equal(MAX_LINE_VERTICES, 200);
const many = Array.from({ length: 2100 }, (_, id) => ({ id, lengthM: id, l: mapLine(String(id)) }));
const capped = capLines(many);
assert.equal(capped.total, 2100);
assert.equal(capped.lines.length, 2000);
assert.equal(capped.lines[0].label, "2099", "긴 선부터 유지");
assert.equal(capped.lines.at(-1).label, "100", "상한 경계가 결정적");

const [x, y] = toUtmk(center);
const pathM = Array.from({ length: 300 }, (_, i) => [x + i, y + Math.sin(i / 8) * 10]);
const candidate = lineCandidate(7, "contour", pathM, 500, "등고선");
assert.ok(candidate);
assert.ok(candidate.l.points.length <= MAX_LINE_VERTICES, "선 꼭짓점 상한");
assert.deepEqual(candidate.l.points[0], [center[0], center[1]]);
assert.equal(candidate.l.label, "등고선");
assert.equal(lineCandidate(8, "contour", [[x, y]], 1), null, "2점 미만 선 제외");

const base = {
  tileId: "x-D22",
  analysisId: "x",
  tileType: "diagram",
  tileCode: "D22",
  status: "complete",
  engineVersion: "v2-p3-terrain-1",
  conditions: { address: "a", center, radiusM: 500, analysisDate: "2026-09-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [],
  judgment: null,
  presentation: { legend: [], camera: null, layers: ["contour"], outputFace: "front", lines: [mapLine("100m")], linesTotal: 1 },
  provenance: { manifestHash: "a".repeat(64), sources: [{ sourceId: "terrain_tiles", releaseId: "terrain_tiles@2026-09-30", sourceAsOf: "2026-09-30", fetchedAt: "2026-09-30T00:00:00Z" }] },
  limitations: [],
};
const dirs = Array.from({ length: 16 }, () => Array(5).fill(1));
assert.doesNotThrow(() => parseTileResult({ ...base, presentation: { ...base.presentation, lines: undefined, linesTotal: undefined, rose: { station: "near", dirs, calmHours: 1, missingHours: 2, totalHours: 83 } } }));
assert.throws(() => parseTileResult({ ...base, presentation: { ...base.presentation, lines: undefined, linesTotal: undefined, rose: { station: "near", dirs: dirs.slice(1), calmHours: 1, missingHours: 2, totalHours: 83 } } }));
assert.equal(toTileView(parseTileResult(base)).map.lines.length, 1);

console.log("✓ v2 map lines");
