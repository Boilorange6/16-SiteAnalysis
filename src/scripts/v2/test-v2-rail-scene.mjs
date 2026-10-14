import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;

const { buildMapScene, RAIL_EXIT_REFERENCE_MPP, railTextContrastRatio } = await import("../../lib/v2/ui/map-scene.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const { legendItems } = await import("../../lib/v2/ui/map-layers.ts");

const CENTER = [127.1542, 37.555];
const METERS_PER_DEGREE_LNG = 88200;
const METERS_PER_DEGREE_LAT = 111320;
const EXIT_MARKER_HEIGHT_PX = 9;
const LINE_COLOR = "#996CAC";

const point = (eastM, northM) => [
  CENTER[0] + eastM / METERS_PER_DEGREE_LNG,
  CENTER[1] + northM / METERS_PER_DEGREE_LAT,
];

const feature = (layer, fid, eastM, northM, extra = {}) => {
  const [lng, lat] = point(eastM, northM);
  return { layer, fid, lng, lat, ...extra };
};

const line = (layer, fid, points, extra = {}) => ({
  layer,
  fid,
  points: points.map(([eastM, northM]) => point(eastM, northM)),
  ...extra,
});

const fixture = {
  center: CENTER,
  radiusM: 1000,
  tileCode: "A01",
  features: [
    feature("rail_station", "station-primary", 0, 0, {
      name: "다온역",
      label: "다온역",
      sublabel: "5호선",
      labelPriority: 1,
      badges: [{ text: "5", color: LINE_COLOR }],
    }),
    // 같은 역의 구 저장 결과가 다른 표기와 rail_nearest로 함께 들어오는 경우다.
    feature("rail_nearest", "station-duplicate", 7, 4, {
      name: "다온 역 (환승)",
      label: "다온 역 (환승)",
      sublabel: "5호선",
      labelPriority: 2,
      badges: [{ text: "5", color: LINE_COLOR }],
    }),
    feature("rail_entrance", "entrance-1", 34, -22, {
      name: "다온역 1번 출구",
      label: "1",
    }),
    feature("rail_entrance", "entrance-2", -34, 22, {
      name: "다온역 2번 출구",
      label: "2",
    }),
  ],
  lines: [
    line("rail_line", "line-5", [[-480, 90], [-240, 90], [0, 90], [240, 90], [480, 90]], {
      label: "5호선",
      name: "5호선",
      legendLabel: "5호선",
      color: LINE_COLOR,
      labelPriority: 1,
    }),
    line("rail_line", "line-5-fragment", [[-460, -220], [-240, -220], [-20, -220]], {
      label: "5호선",
      name: "5호선",
      legendLabel: "5호선",
      color: LINE_COLOR,
      labelPriority: 1,
    }),
    line("rail_station_axis", "axis-station-primary", [[-120, 0], [120, 0]], {
      label: "5호선",
      name: "5호선",
      legendLabel: "5호선",
      color: LINE_COLOR,
      labelPriority: 2,
    }),
    // 같은 역·호선의 거의 같은 축은 한 막대로 합쳐져야 한다.
    line("rail_station_axis", "axis-station-duplicate", [[-118, 1], [122, 1]], {
      label: "5호선",
      name: "5호선",
      legendLabel: "5호선",
      color: LINE_COLOR,
      labelPriority: 3,
    }),
    line("rail_station_axis", "axis-line-2", [[-120, 80], [120, 80]], {
      label: "2호선",
      name: "2호선",
      legendLabel: "2호선",
      color: "#3CB44A",
      labelPriority: 2,
    }),
    line("rail_line", "line-2", [[-460, 80], [-240, 80], [0, 80], [240, 80], [460, 80]], {
      label: "2호선",
      name: "2호선",
      legendLabel: "2호선",
      color: "#3CB44A",
      labelPriority: 1,
    }),
  ],
  polygons: [],
  total: 4,
  notes: [],
};

const baseOptions = {
  width: 1000,
  height: 600,
  activeLayer: "white",
  fill: 0.8,
  scale: false,
  showRadius: false,
  showSiteMarker: false,
  muted: true,
  compact: false,
  showAutomaticLabels: false,
  legendBox: null,
  avoid: [],
  north: false,
};

const sceneFor = ({ model = fixture, ...options } = {}) => buildMapScene({ ...baseOptions, ...options, model });
const boxOverlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const normalizedStationKey = (value) => value.trim().replace(/\s+/gu, "").replace(/\([^)]*\)/gu, "").replace(/역$/u, "");

const defaultScene = sceneFor();
assert.ok(defaultScene.mpp > RAIL_EXIT_REFERENCE_MPP, `1km default mpp ${defaultScene.mpp} should be coarser than the exit threshold`);
assert.equal(defaultScene.rail.exitVisible, false, "1km default scene must hide exits");
assert.equal(defaultScene.rail.exits.length, 0, "1km default scene must not emit exits");

const detailScene = sceneFor({ model: { ...fixture, radiusM: 300, features: fixture.features.map((entry) => entry.fid === "station-primary" ? { ...entry, sublabel: "5호선·2호선", badges: [{ text: "5", color: LINE_COLOR }, { text: "2", color: "#3CB44A" }] } : entry) } });
assert.ok(detailScene.mpp <= RAIL_EXIT_REFERENCE_MPP, `300m mpp ${detailScene.mpp} should reach the exit threshold`);
assert.equal(detailScene.rail.exitVisible, true, "300m scene must enable exits");
assert.equal(detailScene.rail.exits.length, 2, "300m scene must include both numbered entrances");
assert.equal(defaultScene.rail.routes.filter((route) => route.label === "5호선").length, 2, "same-line route fragments must all remain in the scene");
assert.equal(detailScene.rail.axes.filter((axis) => axis.label === "5호선").length, 1, "near-identical same-line axes must merge");
assert.equal(detailScene.rail.axes.filter((axis) => axis.label === "2호선").length, 1, "one horizontal platform axis should remain");
const horizontalInside = detailScene.rail.axisLabels.find((label) => label.text === "2호선");
assert.ok(horizontalInside, "the 18px horizontal axis should receive an inside label");
assert.equal(horizontalInside.placement, "inside", "the 18px horizontal axis label should be inside the bar");
assert.equal(horizontalInside.fontSize, 9, "inside axis labels should fit the 18px bar at 9px");
assert.ok(Math.abs(horizontalInside.angle) <= 90, "inside axis labels must use normalized readable rotation");
const horizontalAxis = detailScene.rail.axes.find((axis) => axis.label === "2호선");
assert.ok(horizontalAxis, "horizontal axis fixture is present");
assert.ok(railTextContrastRatio(horizontalInside.color, horizontalAxis.color) >= 4.5, "inside axis label contrast must be at least 4.5:1");
const insideSvg = renderToStaticMarkup(createElement(MapFigure, { model: { ...fixture, radiusM: 300, features: fixture.features.map((entry) => entry.fid === "station-primary" ? { ...entry, sublabel: "5호선·2호선", badges: [{ text: "5", color: LINE_COLOR }, { text: "2", color: "#3CB44A" }] } : entry) }, width: 1000, height: 600, basemap: "none", legend: false, scale: false, showRadius: false, showSiteMarker: false, showAutomaticLabels: false }));
const insideTag = insideSvg.match(/<text[^>]*data-rail-axis-label="2호선"[^>]*>/u)?.[0] ?? "";
assert.match(insideTag, /data-rail-axis-label-placement="inside"/u, "SVG should expose the inside placement");
assert.match(insideTag, /stroke="none"/u, "inside SVG labels must not have a white halo");
assert.notEqual(insideTag.match(/fill="([^"]+)"/u)?.[1], insideTag.match(/stroke="([^"]+)"/u)?.[1], "inside SVG label fill and stroke must differ");
const sceneLegend = legendItems({ ...fixture, radiusM: 300 });
assert.equal(sceneLegend.find((item) => item.layer === "rail_station")?.symbol, "rail-axis", "history legend must use a bar symbol");
assert.equal(sceneLegend.find((item) => item.layer === "rail_entrance")?.symbol, "rail-exit", "entrance legend must use an exit symbol");
const legendSvg = renderToStaticMarkup(createElement(MapFigure, { model: { ...fixture, radiusM: 300 }, width: 1000, height: 600, basemap: "none", legend: true, scale: false, showRadius: false, showSiteMarker: false, showAutomaticLabels: false }));
assert.match(legendSvg, /data-legend-symbol="rail-axis"/u, "MapFigure legend should render the history bar symbol");
assert.match(legendSvg, /data-legend-symbol="rail-exit"[^>]*fill="#FFD200"/u, "MapFigure legend should render the yellow exit symbol");
for (const exit of detailScene.rail.exits) {
  assert.equal(exit.demoted, false, `${exit.number} exit should keep its full-size marker`);
  const height = exit.box.y1 - exit.box.y0;
  assert.ok(Math.abs(height - EXIT_MARKER_HEIGHT_PX) <= 1, `${exit.number} marker height ${height} should be about ${EXIT_MARKER_HEIGHT_PX}px`);
}

const sufficientZoomDelta = Math.max(1, Math.ceil(Math.log2(defaultScene.mpp / RAIL_EXIT_REFERENCE_MPP)));
const zoomedScene = sceneFor({ view: { zoomDelta: sufficientZoomDelta, offsetM: [0, 0] } });
assert.ok(zoomedScene.mpp <= RAIL_EXIT_REFERENCE_MPP, `zoomed 1km mpp ${zoomedScene.mpp} should reach the exit threshold`);
assert.equal(zoomedScene.rail.exitVisible, true, "a sufficiently zoomed 1km scene must enable exits");
assert.equal(zoomedScene.rail.exits.length, 2, "a sufficiently zoomed 1km scene must include both exits");

const stationFeatures = fixture.features.filter((entry) => ["rail_station", "rail_nearest"].includes(entry.layer));
const normalizedKeys = new Set(stationFeatures.map((entry) => normalizedStationKey(entry.name)));
assert.deepEqual([...normalizedKeys], ["다온"], "the fixture should represent one normalized station complex");
assert.equal(detailScene.rail.stationLabels.length, 1, "one normalized station complex should have one station label");
for (const key of normalizedKeys) {
  const labels = detailScene.rail.stationLabels.filter((entry) => entry.stationKey === key);
  assert.ok(labels.length <= 1, `${key} should have at most one station label`);
}
for (let index = 0; index < detailScene.rail.stationLabels.length; index += 1) {
  for (let otherIndex = index + 1; otherIndex < detailScene.rail.stationLabels.length; otherIndex += 1) {
    assert.equal(boxOverlaps(detailScene.rail.stationLabels[index].box, detailScene.rail.stationLabels[otherIndex].box), false, "station label boxes must not overlap");
  }
}

const compactScene = sceneFor({ compact: true });
assert.ok(compactScene.rail.routes.length > 0, "compact scene should retain rail route bars");
assert.ok(compactScene.rail.axes.length > 0, "compact scene should retain station-axis bars");
assert.equal(compactScene.rail.routeLabels.length, 0, "compact scene should hide rail route labels");
assert.equal(compactScene.rail.axisLabels.length, 0, "compact scene should hide rail axis labels");
assert.equal(compactScene.rail.stationLabels.length, 0, "compact scene should hide station labels");
assert.equal(compactScene.rail.exits.length, 0, "compact scene should hide exits");

assert.equal(Object.prototype.hasOwnProperty.call(defaultScene, "badges"), false, "legacy feature badges must not become scene badge output");
assert.equal(defaultScene.rail.axes.filter((axis) => axis.label === "5호선").length, 1, "two legacy station badges must not duplicate the rail scene");

const noAxisScene = sceneFor({ model: { ...fixture, lines: fixture.lines.filter((entry) => entry.layer !== "rail_station_axis") } });
assert.ok(noAxisScene.rail.axes.some((axis) => axis.source === "fallback"), "rail_line should provide a fallback station axis when rail_station_axis is omitted");
assert.ok(noAxisScene.rail.axes.every((axis) => axis.stationKey === "다온"), "fallback axes should remain attached to the normalized station key");

console.log(`✓ v2 rail scene (${detailScene.rail.exits.length} exits, mpp ${detailScene.mpp.toFixed(2)}, zoomDelta ${sufficientZoomDelta})`);
