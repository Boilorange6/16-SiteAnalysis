/** D28 도보권 5·10·15분 도달 면과 보행망 선. */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

const { toUtmk } = await import("../../lib/v2/crs.ts");
const { d28 } = await import("../../lib/v2/engine/tiles/d28.ts");
const { isochroneGrid, walkField } = await import("../../lib/v2/engine/tiles/walk-shared.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const CENTER = [127.1506, 37.6245];
const [cx, cy] = toUtmk(CENTER);
const source = {
  sourceId: "osm_roads",
  releaseId: "osm-roads-test",
  sourceAsOf: "2026-09-30",
  fetchedAt: "2026-10-01T00:00:00Z",
};
let featureId = 1;

function road(id, points, fclass = "residential") {
  return {
    featureId: featureId++,
    stableId: `road:${id}`,
    kind: "road",
    releaseId: source.releaseId,
    name: null,
    pnu: null,
    legalCode: null,
    properties: { fclass },
    geometry: { type: "LineString", coordinates: points.map(([x, y]) => [cx + x, cy + y]) },
    distanceM: null,
  };
}

const roads = [
  road("east", [[0, 0], [200, 0], [400, 0], [520, 0]]),
  road("north", [[0, 0], [300, 0], [600, 0], [900, 0]], "footway"),
  // A detour puts a reachable pocket inside the circle into the 15-minute band.
  road("detour", [[0, 0], [0, 500], [500, 500]], "footway"),
  // This road is close enough to be queried but has no graph connection to the center.
  road("blocked-block", [[-500, 450], [500, 450]]),
  // Motorway shortcuts must not collapse the pedestrian route.
  road("motorway", [[0, 0], [800, 0]], "motorway"),
];

function fakeContext(hits = roads, availableSources = [source]) {
  const memoized = new Map();
  return {
    manifestHash: "a".repeat(64),
    analysisId: "d28-test",
    conditions: {
      address: "테스트",
      center: CENTER,
      radiusM: 800,
      analysisDate: "2026-10-01",
      timezone: "Asia/Seoul",
      filters: {},
      simulation: null,
      parcelSnapshotHash: null,
    },
    input: { address: "테스트", center: CENTER, radiusM: 800, analysisDate: "2026-10-01", pnu: null },
    hits: (_key, _kinds, radiusM) => {
      assert.ok(radiusM <= 2500 && radiusM <= 5000, `unexpected walk query radius: ${radiusM}`);
      return hits;
    },
    sources: (_key, sourceIds) => sourceIds.includes("osm_roads") ? availableSources : [],
    coverage: () => [],
    memo: (key, compute) => {
      if (!memoized.has(key)) memoized.set(key, compute());
      return memoized.get(key);
    },
  };
}

const field = walkField(fakeContext());
assert.ok(field);
const directGrid = isochroneGrid(field, CENTER, [5, 10, 15], { cellM: 5, bufferM: 30 });
const valueAt = (dx, dy) => {
  const col = Math.round((cx + dx - directGrid.x0) / directGrid.cellM);
  const row = Math.round((cy + dy - directGrid.y0) / directGrid.cellM);
  return directGrid.values[row * directGrid.cols + col];
};
assert.equal(valueAt(400, 0), 5, "the 400 m route should be in the 5-minute reach");
assert.ok(!Number.isFinite(valueAt(-500, 450)), "the opposite side of a disconnected block must remain unreachable");

const started = performance.now();
const result = parseTileResult(d28(fakeContext()));
const elapsedMs = performance.now() - started;
assert.ok(elapsedMs <= 1500, `D28 exceeded the 1.5 s budget: ${Math.round(elapsedMs)} ms`);

const metric = (id) => result.metrics.find((item) => item.id === id);
const area5 = metric("area_5min_km2");
const area10 = metric("area_10min_km2");
const area15 = metric("area_15min_km2");
assert.equal(result.tileCode, "D28");
assert.equal(result.tileType, "diagram");
assert.equal(result.status, "complete");
assert.deepEqual(result.presentation.layers, ["walk_5", "walk_10", "walk_15", "walk_net"]);
assert.ok(area5 && area10 && area15);
assert.equal(area5.status, "estimated");
assert.equal(area10.status, "estimated");
assert.equal(area15.status, "estimated");
assert.ok(area5.value > 0);
assert.ok(area5.value <= area10.value && area10.value <= area15.value, "cumulative reach area must be monotonic");
assert.ok(metric("reach_ratio_10min_pct").value < 100, "network barriers must keep the 10-minute reach below the straight-line circle");
assert.equal(metric("network_nodes").value, field.nodes);
assert.match(result.judgment.sentence, /보행망 도보 10분\(800 m\) 도달 면적/);
assert.match(result.judgment.sentence, /OSM 보행망·80 m\/분 기준/);
assert.match(result.judgment.sentence, /현장 동선으로 확인할 것/);
assert.ok(result.presentation.polygons?.length > 0);
assert.deepEqual(
  [...new Set(result.presentation.polygons.map((polygon) => polygon.layer))].sort(),
  ["walk_10", "walk_15", "walk_5"],
);
const smoothRing = result.presentation.polygons[0].rings[0];
const diagonalEdges = smoothRing.reduce((count, point, index) => {
  const next = smoothRing[(index + 1) % smoothRing.length];
  const [aX, aY] = toUtmk(point);
  const [bX, bY] = toUtmk(next);
  return count + (Math.abs(aX - bX) > 0.1 && Math.abs(aY - bY) > 0.1 ? 1 : 0);
}, 0);
assert.ok(diagonalEdges > 0, "marching-squares smoothing must remove cell-only right-angle edges");
assert.ok(result.presentation.lines?.length > 0);
assert.ok(result.presentation.lines.every((line) => line.layer === "walk_net" && line.points.length >= 2));
assert.ok(result.presentation.lines.every((line) => line.points.every((point) => {
  const [x, y] = toUtmk(point);
  return Math.hypot(x - cx, y - cy) <= 802;
})), "walk_net must stay inside the analysis radius");
assert.ok(result.limitations.some((limitation) => limitation.note.includes("OSM") && limitation.note.includes("완전성")));
assert.ok(result.limitations.some((limitation) => limitation.note.includes("80 m/분")));
assert.ok(result.limitations.some((limitation) => limitation.note.includes("경사")));
assert.doesNotMatch(JSON.stringify(result), /종합|법적 적합|개발 가능|건강 위험 예측/);

// The T7 reference benchmark is a 50,451-node graph. Keep the D28-specific
// vectorization and presentation work inside the task's 1.5 s budget too.
function performanceRoads() {
  const out = [];
  const xCount = 251;
  const yCount = 201;
  const x0 = -1250;
  const y0 = -1000;
  const node = (x, y) => [x0 + x * 10, y0 + y * 10];
  for (let y = 0; y < yCount; y++) for (let x = 0; x + 1 < xCount; x++) out.push(road(`perf-h-${x}-${y}`, [node(x, y), node(x + 1, y)]));
  for (let x = 0; x < xCount; x++) for (let y = 0; y + 1 < yCount; y++) out.push(road(`perf-v-${x}-${y}`, [node(x, y), node(x, y + 1)]));
  return out;
}
const perfStarted = performance.now();
const perfResult = parseTileResult(d28(fakeContext(performanceRoads())));
const perfElapsedMs = performance.now() - perfStarted;
assert.ok(perfElapsedMs <= 1500, `D28 50,451-node benchmark exceeded the 1.5 s budget: ${Math.round(perfElapsedMs)} ms`);
assert.equal(metric("network_nodes").value, field.nodes);
assert.equal(perfResult.metrics.find((item) => item.id === "network_nodes").value, 50451);
assert.ok(perfResult.metrics.find((item) => item.id === "area_10min_km2").value > 0);

const notProvided = parseTileResult(d28(fakeContext([], [source])));
assert.equal(notProvided.status, "not_provided");
assert.match(notProvided.limitations[0].note, /보행망/);

if (process.env.D28_RENDER_PATH) {
  const { default: sharp } = await import("sharp");
  const project = ([lng, lat]) => {
    const [x, y] = toUtmk([lng, lat]);
    return [600 + (x - cx) * 0.55, 600 - (y - cy) * 0.55];
  };
  const colors = { walk_5: "#4D9D7E", walk_10: "#8FC9B3", walk_15: "#CDE8DC", walk_net: "#5AA88E" };
  const polygons = (result.presentation.polygons ?? []).map((polygon) => {
    const points = polygon.rings[0].map(project).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return `<polygon points="${points}" fill="${colors[polygon.layer]}" fill-opacity="0.58" stroke="${colors[polygon.layer]}" stroke-width="1"/>`;
  }).join("");
  const lines = (result.presentation.lines ?? []).map((line) => {
    const points = line.points.map(project).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return `<polyline points="${points}" fill="none" stroke="${colors.walk_net}" stroke-width="3" stroke-linecap="round"/>`;
  }).join("");
  const labels = ["area_5min_km2", "area_10min_km2", "area_15min_km2"].map((id, index) => {
    const value = metric(id).value.toFixed(3);
    return `<text x="44" y="${54 + index * 27}" font-family="Arial,sans-serif" font-size="20" fill="#24303a">${["5분", "10분", "15분"][index]} 도달 면적 ${value} km²</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200"><rect width="1200" height="1200" fill="#f7f5f1"/><text x="44" y="34" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#19232d">D28 도보권 — 합성 도로 픽스처</text>${labels}<circle cx="600" cy="600" r="440" fill="none" stroke="#263746" stroke-width="3" stroke-dasharray="10 8"/>${polygons}${lines}<circle cx="600" cy="600" r="5" fill="#17212b"/><text x="610" y="596" font-family="Arial,sans-serif" font-size="16" fill="#17212b">대지 중심</text><g font-family="Arial,sans-serif" font-size="17"><rect x="44" y="1080" width="20" height="20" fill="#4D9D7E" fill-opacity="0.58"/><text x="72" y="1097">5분</text><rect x="142" y="1080" width="20" height="20" fill="#8FC9B3" fill-opacity="0.58"/><text x="170" y="1097">10분</text><rect x="255" y="1080" width="20" height="20" fill="#CDE8DC" fill-opacity="0.58"/><text x="283" y="1097">15분</text><line x1="380" y1="1090" x2="420" y2="1090" stroke="#5AA88E" stroke-width="3"/><text x="430" y="1097">보행망 선</text><line x1="570" y1="1090" x2="610" y2="1090" stroke="#263746" stroke-width="3" stroke-dasharray="10 8"/><text x="620" y="1097">분석 반경 800 m</text></g></svg>`;
  mkdirSync(dirname(process.env.D28_RENDER_PATH), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(process.env.D28_RENDER_PATH);
}

console.log(`✓ v2 D28 walk isochrones (${Math.round(elapsedMs)} ms)`);
