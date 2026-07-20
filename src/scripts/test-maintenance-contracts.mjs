import assert from "node:assert/strict";
import { reloadSource } from "../lib/data-provider.ts";
import { POI_SOURCE_CATEGORIES, POI_SOURCE_LABELS } from "../lib/types.ts";
import { boundaryToLeafletLatLngs } from "../lib/maintenance-map-utils.ts";
import { applyMaintenanceRetryResult } from "../lib/maintenance-retry-state.ts";

const sources = [
  "maintenance_attributes",
  "maintenance_boundaries",
  "maintenance_seoul",
  "maintenance_busan",
];

for (const source of sources) {
  assert.deepEqual(POI_SOURCE_CATEGORIES[source], ["maintenance"]);
  assert.equal(typeof POI_SOURCE_LABELS[source], "string");
  assert.ok(POI_SOURCE_LABELS[source].length > 0);
}

const polygon = {
  type: "Polygon",
  coordinates: [
    [[127.0, 37.5], [127.01, 37.5], [127.01, 37.51], [127.0, 37.5]],
    [[127.002, 37.502], [127.008, 37.502], [127.008, 37.508], [127.002, 37.502]],
  ],
};
assert.deepEqual(boundaryToLeafletLatLngs(polygon), [
  [[37.5, 127.0], [37.5, 127.01], [37.51, 127.01], [37.5, 127.0]],
  [[37.502, 127.002], [37.502, 127.008], [37.508, 127.008], [37.502, 127.002]],
]);

const multiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [[[127.1, 37.6], [127.11, 37.6], [127.1, 37.6]]],
    [[[127.2, 37.7], [127.21, 37.7], [127.2, 37.7]]],
  ],
};
assert.deepEqual(boundaryToLeafletLatLngs(multiPolygon), [
  [[[37.6, 127.1], [37.6, 127.11], [37.6, 127.1]]],
  [[[37.7, 127.2], [37.7, 127.21], [37.7, 127.2]]],
]);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response("retry failed", { status: 500 });

try {
  const failedRetry = await reloadSource(37.5, 127, 1, "maintenance_attributes");
  assert.deepEqual(
    failedRetry.allSources?.map((status) => status.source),
    [
      "maintenance_attributes",
      "maintenance_boundaries",
      "maintenance_seoul",
      "maintenance_busan",
    ],
  );

  const updatedRegion = applyMaintenanceRetryResult({
    regionCode: "custom",
    regionName: "테스트",
    address: "테스트 주소",
    aliases: [],
    defaultConfig: { centerName: "테스트", centerLat: 37.5, centerLng: 127, radiusKm: 1 },
    subwayStations: [],
    schools: [],
    parks: [],
    mountains: [],
    apartments: [],
    officetels: [],
    residentialOthers: [],
    maintenanceProjects: [],
    maintenanceCatalog: [{
      id: "stale-catalog",
      name: "오래된 목록",
      sido: "서울특별시",
      sigungu: "중구",
      type: "재개발",
      stage: "미확인",
      source: "molit_integrated",
      spatial_status: "not_located",
    }],
    subwayRoutes: [],
    sourceStatuses: [
      { source: "osm", status: "fresh", fetchedAt: 100 },
      { source: "maintenance", status: "cached", fetchedAt: 90 },
      { source: "maintenance_seoul", status: "cached", fetchedAt: 90 },
    ],
  }, failedRetry);
  assert.deepEqual(updatedRegion.maintenanceCatalog, []);
  assert.deepEqual(
    updatedRegion.sourceStatuses.map((status) => status.source),
    ["osm", "maintenance_attributes", "maintenance_boundaries", "maintenance_seoul", "maintenance_busan"],
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log("maintenance contracts: ok");
