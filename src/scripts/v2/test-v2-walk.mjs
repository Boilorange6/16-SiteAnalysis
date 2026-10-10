/** Task 7 보행망 그래프·최단거리·등시선 래스터 계약. */
import assert from "node:assert/strict";

const {
  WALK_BUFFER_M,
  WALK_EXCLUDED_FCLASS,
  WALK_SNAP_M,
  WALK_SPEED_M_PER_MIN,
  isochroneGrid,
  walkField,
  walkMinutes,
  walkSources,
} = await import("../../lib/v2/engine/tiles/walk-shared.ts");
const { toUtmk } = await import("../../lib/v2/crs.ts");
const { maxOf } = await import("../../lib/v2/extent.ts");

assert.equal(WALK_SPEED_M_PER_MIN, 80);
assert.equal(WALK_SNAP_M, 150);
assert.equal(WALK_BUFFER_M, 1500);
assert.deepEqual([...WALK_EXCLUDED_FCLASS].sort(), ["motorway", "motorway_link", "trunk_link"].sort());
assert.equal(walkMinutes(400), 5);

const center = [127.1506, 37.6245];
const [cx, cy] = toUtmk(center);
let featureId = 1;
const source = { sourceId: "osm_roads", releaseId: "osm-roads-test", sourceAsOf: "2026-09-30", fetchedAt: "2026-10-01T00:00:00Z" };

function road(points, fclass = "residential") {
  return {
    featureId: featureId++,
    stableId: `road:${featureId}`,
    kind: "road",
    releaseId: source.releaseId,
    name: null,
    pnu: null,
    legalCode: null,
    properties: { fclass },
    geometry: { type: "LineString", coordinates: points },
    distanceM: null,
  };
}

const roads = [
  road([[cx, cy], [cx + 200, cy]], "footway"),
  road([[cx + 200, cy], [cx + 400, cy]]),
  // The dead-end continues beyond the 5-minute budget; the isochrone must cut it at 400 m.
  road([[cx + 400, cy], [cx + 520, cy]]),
  // A separate branch makes the 10-minute footprint strictly larger than the 5-minute one.
  road([[cx, cy], [cx, cy + 900]], "footway"),
  // This shortcut must not enter the graph.
  road([[cx, cy], [cx + 400, cy + 0.01]], "motorway"),
];

function fakeContext(hits = roads, inputCenter = center) {
  const memoized = new Map();
  return {
    input: { center: inputCenter, radiusM: 1000 },
    hits: (_key, _kinds, radiusM) => {
      assert.ok(radiusM <= 2500 && radiusM <= 5000, `unexpected walk query radius: ${radiusM}`);
      return hits;
    },
    sources: (_key, sourceIds) => sourceIds.includes("osm_roads") && hits.length > 0 ? [source] : [],
    memo: (key, compute) => {
      if (!memoized.has(key)) memoized.set(key, compute());
      return memoized.get(key);
    },
  };
}

const ctx = fakeContext();
const field = walkField(ctx);
assert.ok(field, "a center connected to OSM roads should build a walk field");
assert.ok(field.nodes >= 5);
assert.equal(field.edges, 4, "motorway shortcut must be excluded from the pedestrian graph");
assert.deepEqual(walkSources(ctx), [source]);

const route = field.distTo([cx + 400, cy]);
assert.ok(route, "the 400 m target should snap to a graph vertex");
assert.ok(Math.abs(route.distanceM - 400) <= 1, `expected 400 m Manhattan route, got ${route.distanceM}`);
assert.equal(route.minutes, 5);
assert.ok(route.path.length >= 3);
assert.deepEqual(route.path[0], [cx, cy]);
assert.deepEqual(route.path.at(-1), [cx + 400, cy]);
assert.equal(field.distTo([cx + 1000, cy]), null, "a point beyond the snap radius should return null");

const reached = field.reachable(400);
const clippedCandidate = reached.find(({ a, b }) =>
  (Math.abs(a[0] - (cx + 400)) < 0.2 && Math.abs(b[0] - (cx + 520)) < 0.2) ||
  (Math.abs(b[0] - (cx + 400)) < 0.2 && Math.abs(a[0] - (cx + 520)) < 0.2));
assert.ok(clippedCandidate, "the dead-end edge should remain available for partial clipping");
assert.ok(Math.min(clippedCandidate.da, clippedCandidate.db) <= 400);
assert.ok(Math.max(clippedCandidate.da, clippedCandidate.db) > 400);

const grid = isochroneGrid(field, center, [5, 10], { cellM: 5, bufferM: 30 });
const cellAt = (x, y) => {
  const col = Math.round((x - grid.x0) / grid.cellM);
  const row = Math.round((y - grid.y0) / grid.cellM);
  return grid.values[row * grid.cols + col];
};
assert.equal(cellAt(cx + 425, cy), 5, "the 5-minute edge buffer should reach 400+30 m");
assert.ok(!Number.isFinite(cellAt(cx + 435, cy)) || cellAt(cx + 435, cy) > 5, "the clipped dead-end must not become a 5-minute corridor");
let fiveMinuteCells = 0;
let tenMinuteOrLessCells = 0;
for (const value of grid.values) {
  if (value === 5) fiveMinuteCells += 1;
  if (value === 5 || value === 10) tenMinuteOrLessCells += 1;
}
assert.ok(tenMinuteOrLessCells > fiveMinuteCells, "10-minute reachable area should exceed 5-minute area");

const offsetField = walkField(fakeContext([road([[cx + 100, cy], [cx + 500, cy]])]));
assert.ok(offsetField);
const offsetGrid = isochroneGrid(offsetField, center, [5], { cellM: 5, bufferM: 30 });
const offsetCenterCol = Math.round((cx - offsetGrid.x0) / offsetGrid.cellM);
const offsetCenterRow = Math.round((cy - offsetGrid.y0) / offsetGrid.cellM);
assert.ok(!Number.isFinite(offsetGrid.values[offsetCenterRow * offsetGrid.cols + offsetCenterCol]), "the raster must honor the snapped start vertex, not force the unsnapped site center to zero");

const empty = fakeContext([]);
assert.equal(walkField(empty), null, "no road source should produce no walk field");
assert.deepEqual(walkSources(empty), []);

const disconnected = fakeContext([road([[cx + 1000, cy], [cx + 1100, cy]])]);
assert.equal(walkField(disconnected), null, "roads outside the center snap radius should not create a field");

// The task budget is measured on a deterministic ~50k-node grid and includes graph construction,
// one Dijkstra pass, and a 5/10/15-minute raster. The assertion is intentionally the plan budget.
function performanceRoads() {
  const out = [];
  const xCount = 251;
  const yCount = 201;
  const x0 = cx - 1250;
  const y0 = cy - 1000;
  const node = (x, y) => [x0 + x * 10, y0 + y * 10];
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x + 1 < xCount; x++) out.push(road([node(x, y), node(x + 1, y)]));
  }
  for (let x = 0; x < xCount; x++) {
    for (let y = 0; y + 1 < yCount; y++) out.push(road([node(x, y), node(x, y + 1)]));
  }
  return out;
}
const perfRoads = performanceRoads();
function measureWalkPass() {
  const started = performance.now();
  const perfField = walkField(fakeContext(perfRoads));
  assert.ok(perfField);
  const fieldElapsedMs = performance.now() - started;
  isochroneGrid(perfField, center, [5, 10, 15]);
  return { elapsedMs: performance.now() - started, fieldElapsedMs, nodes: perfField.nodes, edges: perfField.edges };
}

const warmupRuns = 1;
const sampleRuns = 5;
for (let i = 0; i < warmupRuns; i += 1) measureWalkPass();
const perfSamples = Array.from({ length: sampleRuns }, () => measureWalkPass());
const ordered = perfSamples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
const medianMs = ordered[Math.floor(ordered.length / 2)];
const maxMs = maxOf(ordered);
const representative = perfSamples[0];
console.log(`walk synthetic nodes=${representative.nodes} edges=${representative.edges} field=${representative.fieldElapsedMs.toFixed(1)}ms; total ${ordered.map((value) => value.toFixed(1)).join(" / ")} ms; median=${medianMs.toFixed(1)}ms max=${maxMs.toFixed(1)}ms budget=1500ms`);
assert.ok(medianMs <= 1500, `walk graph + isochrone 중앙값이 1500ms를 초과: ${medianMs.toFixed(1)}ms`);

console.log("✓ v2 walk graph, routes, and isochrone grid");
