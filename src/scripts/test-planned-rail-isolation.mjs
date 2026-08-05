import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { validate } from "./validate-planned-rail-registry.mjs";

const { buildFactSheetRows, buildFactSummary } = await import("../lib/fact-summary.ts");
const { computeAnalysisScores } = await import("../lib/analysis-engine.ts");
const { clearDynamicRegionCache, loadDynamicRegion } = await import("../lib/data-provider.ts");
const { classifyElement } = await import("../lib/overpass-api.ts");
const { dedupeRouteVariants } = await import("../lib/ppt-generator.ts");
const { loadRailNetworkSnapshot, toSubwayStations } = await import("../lib/server/rail-network-store.ts");

const root = resolve();
const registryPath = resolve("data/rail/planned-registry.json");
const publicPlannedPath = resolve("public/data/rail/planned.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const config = {
  centerName: "격리 검증 입지",
  centerLat: 37.5487,
  centerLng: 127.156,
  radiusKm: 1,
};

const operationalFixture = {
  source: "fixture",
  license: "fixture",
  generated_at: "2026-07-19T00:00:00Z",
  stations: [
    { osm_id: "operational-station", station_name: "운영 기준역", lat: 37.5487, lng: 127.156 },
  ],
  entrances: [],
  lines: [
    {
      osm_id: "operational-line",
      line_ref: "9",
      line_name: "운영 기준선",
      color: "#AA5500",
      lat: 37.5487,
      lng: 127.156,
      geometry: {
        type: "MultiLineString",
        coordinates: [[[127.155, 37.548], [127.156, 37.5487], [127.157, 37.5494]]],
      },
    },
  ],
  station_axes: [
    {
      station_osm_id: "operational-station",
      station_name: "운영 기준역",
      line_ref: "9",
      line_name: "운영 기준선",
      color: "#AA5500",
      lat: 37.5487,
      lng: 127.156,
      endpoints: [[127.155, 37.548], [127.157, 37.5494]],
    },
  ],
};

const operatingStation = { id: "osm-node-6039313593", name: "고덕", lat: 37.5549771, lng: 127.1537755, category: "subway", line: "5호선", lineColor: "#794698" };
const constructionStation = { id: "osm-node-414685254", name: "940정거장", lat: 37.5476879, lng: 127.1558844, category: "subway", line: "9호선", lineColor: "#A49D87" };
const operatingRoute = { line: "5호선", lineColor: "#794698", stationIds: [], coordinates: [[37.554, 127.153], [37.556, 127.154]] };
const constructionRoute = { line: "9호선 4단계", lineColor: "#A49D87", stationIds: [], coordinates: [[37.547, 127.155], [37.549, 127.157]] };
const operationalRailResponse = {
  snapshotVersion: "operational-fixture-v1",
  stations: [{ id: operatingStation.id, osmId: "node/6039313593", name: operatingStation.name, lat: operatingStation.lat, lng: operatingStation.lng, memberships: [{ lineId: "5|서울 지하철 5호선", lineRef: "5호선", lineName: "서울 지하철 5호선", color: operatingStation.lineColor }] }],
  lines: [],
  routes: [operatingRoute],
  plannedProjects: [],
  mapData: { source: "fixture", license: "fixture", generated_at: "2026-07-19T00:00:00Z", stations: [], entrances: [], lines: [], station_axes: [] },
  source: { source: "rail-network", status: "cached", fetchedAt: 1_753_000_000_000 },
};

const PPT_TRAFFIC_ROW_LABELS = ["최근접 역", "반경 내 역·노선 수"];

function routePositions(routes) {
  return dedupeRouteVariants(routes.map((route) => ({
    line: route.line,
    lineColor: route.lineColor,
    points: (route.coordinates ?? []).map(([lat, lng]) => ({ nx: lng / 180, ny: lat / 90 })),
  })));
}

function selectPptTrafficRows(factSummary) {
  const rows = buildFactSheetRows(config, factSummary, new Date("2026-07-19T00:00:00Z"))
    .filter((row) => PPT_TRAFFIC_ROW_LABELS.includes(row.label));
  assert.deepEqual(rows.map((row) => row.label), PPT_TRAFFIC_ROW_LABELS, "fixture must select the real PPT traffic rows by label");
  return rows;
}

function collectProviderOutputs(regionData) {
  const pois = regionData.subwayStations;
  const factSummary = buildFactSummary({ config, allPois: pois });
  return {
    stations: regionData.subwayStations,
    routes: regionData.subwayRoutes,
    transit: factSummary.transit,
    analysisScores: computeAnalysisScores(config, pois),
    pptTrafficMetrics: selectPptTrafficRows(factSummary),
    pptRoutePositions: routePositions(regionData.subwayRoutes),
  };
}

async function runProviderScenario({ railNetwork, pois, fallbackRoutes }) {
  const originalFetch = globalThis.fetch;
  let legacyRouteRequests = 0;
  globalThis.fetch = async (input) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (path.startsWith("/api/rail-network?")) {
      return railNetwork
        ? Response.json(railNetwork)
        : Response.json({ error: "forced rail-network failure" }, { status: 503 });
    }
    if (path.startsWith("/api/poi-search?")) {
      return Response.json({ pois, warnings: [], sources: [{ source: "osm", status: "fresh", fetchedAt: 1_753_000_000_000 }] });
    }
    if (path.startsWith("/api/subway-routes?")) {
      legacyRouteRequests += 1;
      return Response.json({ routes: fallbackRoutes, source: { source: "subway-routes", status: "fresh", fetchedAt: 1_753_000_000_000 } });
    }
    throw new Error(`Unexpected provider request: ${path}`);
  };

  clearDynamicRegionCache();
  try {
    const regionData = await loadDynamicRegion(config.centerLat, config.centerLng, config.radiusKm);
    return { outputs: collectProviderOutputs(regionData), legacyRouteRequests };
  } finally {
    clearDynamicRegionCache();
    globalThis.fetch = originalFetch;
  }
}

function collectOperationalOutputs(dataPath, plannedPath) {
  const snapshot = loadRailNetworkSnapshot(dataPath, plannedPath);
  const pois = toSubwayStations(snapshot);
  const factSummary = buildFactSummary({ config, allPois: pois });
  return {
    stations: pois,
    routes: snapshot.routes,
    transit: factSummary.transit,
    analysisScores: computeAnalysisScores(config, pois),
    pptTrafficMetrics: selectPptTrafficRows(factSummary),
    pptRoutePositions: routePositions(snapshot.routes),
    plannedProjects: snapshot.plannedProjects,
  };
}

function assertOperationalOutputsEqual(actual, baseline) {
  assert.deepEqual(actual.stations, baseline.stations, "planned payload must not change operational stations");
  assert.deepEqual(actual.routes, baseline.routes, "planned payload must not change operational routes");
  assert.deepEqual(actual.transit, baseline.transit, "planned payload must not change transit distance or access metrics");
  assert.deepEqual(actual.analysisScores, baseline.analysisScores, "planned payload must not change computeAnalysisScores output");
  assert.deepEqual(actual.pptTrafficMetrics, baseline.pptTrafficMetrics, "planned payload must not change PPT traffic metrics");
  assert.deepEqual(actual.pptRoutePositions, baseline.pptRoutePositions, "planned payload must not change PPT route positions");
}

// Given: the production data-provider path with an unavailable authoritative rail snapshot.
// When: the POI and legacy-route responses contain construction rail beside valid operating rail.
// Then: degraded output fails closed and planned data changes no operating analysis or PPT input.
const emptyFallback = await runProviderScenario({ railNetwork: null, pois: [], fallbackRoutes: [] });
const poisonedFallback = await runProviderScenario({
  railNetwork: null,
  pois: [constructionStation, operatingStation],
  fallbackRoutes: [constructionRoute],
});
assert.deepEqual(poisonedFallback.outputs, emptyFallback.outputs, "planned construction rail must not change production fallback outputs");
assert.deepEqual(poisonedFallback.outputs.stations, [], "rail-network failure must return no operating stations");
assert.deepEqual(poisonedFallback.outputs.routes, [], "rail-network failure must return no operating routes");
assert.equal(poisonedFallback.legacyRouteRequests, 0, "rail-network failure must not invoke the untrusted legacy rail fallback");

// Given: an available authoritative operational rail snapshot plus a poisoned POI response.
// When: the production data provider builds the region.
// Then: valid operating rail behavior remains unchanged and the real PPT traffic rows use it.
const normalProvider = await runProviderScenario({
  railNetwork: operationalRailResponse,
  pois: [constructionStation],
  fallbackRoutes: [constructionRoute],
});
assert.deepEqual(normalProvider.outputs.stations.map((station) => station.name), ["고덕"]);
assert.deepEqual(normalProvider.outputs.routes, [operatingRoute]);
assert.deepEqual(normalProvider.outputs.transit, { nearestStationName: "고덕", distanceM: 725, walkMin: 10, lineCount: 1, stationCount: 1 });
assert.equal(normalProvider.outputs.analysisScores.total, 5);
assert.deepEqual(
  normalProvider.outputs.pptTrafficMetrics.map((row) => [row.label, row.value.map((segment) => segment.text).join("")]),
  [["최근접 역", "고덕 · 725m · 도보 10분"], ["반경 내 역·노선 수", "역 1개 · 1개 노선"]],
);
assert.equal(normalProvider.legacyRouteRequests, 0);

// Given: OSM station candidates carrying explicit non-operational lifecycle/status tags.
// When: the authoritative Overpass classifier evaluates them.
// Then: they cannot be classified as operating subway stations, while a valid station remains valid.
const nonOperationalTags = [
  { "construction:railway": "station" },
  { "proposed:railway": "station" },
  { "planned:railway": "station" },
  { railway: "construction", construction: "subway" },
  { status: "planned" },
  { operational_status: "not_in_service" },
];
for (const [index, lifecycleTags] of nonOperationalTags.entries()) {
  assert.equal(classifyElement({ type: "node", id: index, tags: { station: "subway", ...lifecycleTags } }), null);
}
assert.equal(classifyElement({ type: "node", id: 999, tags: { railway: "station", station: "subway" } }), "subway");
if (process.env.PLANNED_RAIL_PROVIDER_ONLY === "1") { console.log(JSON.stringify({ fallbackTransit: poisonedFallback.outputs.transit, fallbackScore: poisonedFallback.outputs.analysisScores.total, fallbackPptRows: poisonedFallback.outputs.pptTrafficMetrics.map((row) => row.value.map((segment) => segment.text).join("")), fallbackRoutes: poisonedFallback.outputs.routes.length, legacyRouteRequests: poisonedFallback.legacyRouteRequests, normalTransit: normalProvider.outputs.transit, normalScore: normalProvider.outputs.analysisScores.total, normalPptRows: normalProvider.outputs.pptTrafficMetrics.map((row) => row.value.map((segment) => segment.text).join("")), lifecycleRejected: nonOperationalTags.length })); console.log("planned-rail-provider-fallback: all gates passed"); process.exit(0); }

const registry = readJson(registryPath);
const planned = readJson(publicPlannedPath);
const plannedWithStation = structuredClone(planned);
plannedWithStation[0].stations = [{ name: "예정 유출역", lat: 37.5487, lng: 127.156 }];
const plannedWithBadCoordinate = structuredClone(planned);
plannedWithBadCoordinate[0].geometry.coordinates[0] = [181, 37.5487];
const plannedWithInvalidSource = structuredClone(planned);
plannedWithInvalidSource[0].sourceUrl = "ftp://invalid.example.test/planned";

// Given: public planned data that attempts to carry station or invalid collection data.
// When: the registry validator evaluates those public projections.
// Then: the collection gates reject every unsafe projection before the store can serve it.
const stationGate = validate(registry, plannedWithStation, { registry: registryPath, publicData: publicPlannedPath });
assert.ok(stationGate.errors.includes("public[0].stations must be empty to preserve operational station isolation"));
const coordinateGate = validate(registry, plannedWithBadCoordinate, { registry: registryPath, publicData: publicPlannedPath });
assert.ok(coordinateGate.errors.includes("public[0].geometry.coordinates[0] has longitude outside [-180, 180]"));
const sourceGate = validate(registry, plannedWithInvalidSource, { registry: registryPath, publicData: publicPlannedPath });
assert.ok(sourceGate.errors.includes("public[0].sourceUrl must use http or https"));

const tempDirectory = mkdtempSync(join(tmpdir(), "planned-rail-isolation-"));
try {
  const operationalPath = join(tempDirectory, "operational.json");
  const plannedPath = join(tempDirectory, "planned.json");
  writeJson(operationalPath, operationalFixture);
  writeJson(plannedPath, planned);

  // Given: a stable operational fixture.
  // When: it is loaded with the normal planned payload.
  // Then: capture the operational-only output baseline.
  const baseline = collectOperationalOutputs(operationalPath, plannedPath);
  assert.equal(baseline.plannedProjects.length, 1, "fixture must include one planned project");
  assert.equal(baseline.plannedProjects[0].stations.length, 0, "published planned fixture must contain zero stations");

  // Given: a planned payload carrying adversarial station and route-shaped fields.
  // When: it is loaded alongside unchanged operational fixture data.
  // Then: the operational and PPT inputs remain byte-for-byte equivalent to baseline.
  const injectedPlanned = structuredClone(plannedWithStation);
  injectedPlanned[0].routes = [{ line: "예정 유출선", lineColor: "#FF0000", coordinates: [[37.5487, 127.156], [37.5494, 127.157]] }];
  writeJson(plannedPath, injectedPlanned);
  const isolated = collectOperationalOutputs(operationalPath, plannedPath);
  assertOperationalOutputsEqual(isolated, baseline);
  assert.equal(isolated.plannedProjects[0].stations.length, 1, "defense-in-depth fixture must retain the injected planned station only in plannedProjects");

  // Given: the same baseline fixture.
  // When: a planned station and route are incorrectly inserted into the operational data fixture.
  // Then: this regression suite itself fails, proving the baseline comparisons are sensitive to leakage.
  if (process.env.PLANNED_RAIL_ADVERSARIAL_LEAK === "1") {
    const leakedOperational = structuredClone(operationalFixture);
    leakedOperational.stations.push({ osm_id: "planned-leak-station", station_name: "예정 유출역", lat: 37.5487, lng: 127.156 });
    leakedOperational.lines.push({
      osm_id: "planned-leak-line",
      line_ref: "예정",
      line_name: "예정 유출선",
      color: "#FF0000",
      lat: 37.5487,
      lng: 127.156,
      geometry: { type: "MultiLineString", coordinates: [[[127.156, 37.5487], [127.157, 37.5494]]] },
    });
    leakedOperational.station_axes.push({
      station_osm_id: "planned-leak-station",
      station_name: "예정 유출역",
      line_ref: "예정",
      line_name: "예정 유출선",
      color: "#FF0000",
      lat: 37.5487,
      lng: 127.156,
      endpoints: [[127.156, 37.5487], [127.157, 37.5494]],
    });
    writeJson(operationalPath, leakedOperational);
    assertOperationalOutputsEqual(collectOperationalOutputs(operationalPath, plannedPath), baseline);
  } else {
    const adversarial = spawnSync(process.execPath, ["--import", "tsx", resolve("src/scripts/test-planned-rail-isolation.mjs")], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PLANNED_RAIL_ADVERSARIAL_LEAK: "1" },
    });
    assert.notEqual(adversarial.status, 0, "adversarial operational fixture must make the isolation assertion fail");
    assert.match(`${adversarial.stdout}\n${adversarial.stderr}`, /planned payload must not change operational stations/);
  }
} finally {
  rmSync(tempDirectory, { recursive: true, force: true });
}

console.log("planned-rail-isolation: all gates passed");
