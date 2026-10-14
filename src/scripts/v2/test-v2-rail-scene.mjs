import assert from "node:assert/strict";

const { buildMapScene, RAIL_EXIT_REFERENCE_MPP } = await import("../../lib/v2/ui/map-scene.ts");

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
    line("rail_station_axis", "axis-station-primary", [[-120, 0], [120, 0]], {
      label: "5호선",
      name: "5호선",
      legendLabel: "5호선",
      color: LINE_COLOR,
      labelPriority: 2,
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

const detailScene = sceneFor({ model: { ...fixture, radiusM: 300 } });
assert.ok(detailScene.mpp <= RAIL_EXIT_REFERENCE_MPP, `300m mpp ${detailScene.mpp} should reach the exit threshold`);
assert.equal(detailScene.rail.exitVisible, true, "300m scene must enable exits");
assert.equal(detailScene.rail.exits.length, 2, "300m scene must include both numbered entrances");
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
