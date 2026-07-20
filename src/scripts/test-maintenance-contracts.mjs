import assert from "node:assert/strict";
import { POI_SOURCE_CATEGORIES, POI_SOURCE_LABELS } from "../lib/types.ts";
import { boundaryToLeafletLatLngs } from "../lib/maintenance-map-utils.ts";

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

console.log("maintenance contracts: ok");
