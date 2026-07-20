import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadMaintenanceBoundaryArtifact,
  searchMaintenanceBoundaries,
} from "../lib/server/maintenance/boundary-store.ts";

const properties = ({ id, name, bbox }) => ({
  source_feature_id: id,
  source_dataset_id: "30335",
  source_layer: "UD602",
  name,
  notice_ids: [],
  original_crs: "EPSG:5186",
  source_url: "https://example.com/boundaries",
  retrieved_at: "2026-07-20T00:00:00.000Z",
  bbox,
});

const polygon = ({ id, name, rings }) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: rings },
  properties: properties({
    id,
    name,
    bbox: [
      Math.min(...rings.flat().map(([lng]) => lng)),
      Math.min(...rings.flat().map(([, lat]) => lat)),
      Math.max(...rings.flat().map(([lng]) => lng)),
      Math.max(...rings.flat().map(([, lat]) => lat)),
    ],
  }),
});

const square = ({ west, south, east, north }) => [[
  [west, south], [east, south], [east, north], [west, north], [west, south],
]];

const collection = [
  polygon({
    id: "inside",
    name: "중심 구역",
    rings: square({ west: 126.9998, south: 37.4998, east: 127.0002, north: 37.5002 }),
  }),
  polygon({
    id: "edge",
    name: "경계 교차",
    rings: square({ west: 127.0007, south: 37.4998, east: 127.0012, north: 37.5002 }),
  }),
  polygon({
    id: "outside",
    name: "반경 밖",
    rings: square({ west: 127.003, south: 37.4998, east: 127.0034, north: 37.5002 }),
  }),
  {
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        square({ west: 127.02, south: 37.52, east: 127.021, north: 37.521 }),
        square({ west: 126.9993, south: 37.4998, east: 126.9996, north: 37.5002 }),
      ],
    },
    properties: properties({
      id: "multipolygon-near",
      name: "다중 구역",
      bbox: [126.9993, 37.4998, 127.021, 37.521],
    }),
  },
  polygon({
    id: "hole",
    name: "중공 구역",
    rings: [
      ...square({ west: 126.998, south: 37.498, east: 127.002, north: 37.502 }),
      ...square({ west: 126.9995, south: 37.4995, east: 127.0005, north: 37.5005 }),
    ],
  }),
  polygon({
    id: "tie-b",
    name: "동일 구역",
    rings: square({ west: 127.00075, south: 37.4999, east: 127.001, north: 37.5001 }),
  }),
  polygon({
    id: "tie-a",
    name: "  동일   구역 ",
    rings: square({ west: 127.00075, south: 37.4999, east: 127.001, north: 37.5001 }),
  }),
  polygon({
    id: "name-later",
    name: "나 구역",
    rings: square({ west: 126.999, south: 37.4999, east: 126.99925, north: 37.5001 }),
  }),
  polygon({
    id: "name-first",
    name: "가 구역",
    rings: square({ west: 126.999, south: 37.4999, east: 126.99925, north: 37.5001 }),
  }),
];

// Given: polygons covering, intersecting, outside, containing a hole, and split across multiple parts.
// When: exact 100 m spatial search runs around the center.
// Then: polygon surfaces, holes, MultiPolygon parts, distance, and representative markers are respected.
const located = searchMaintenanceBoundaries(collection, { lat: 37.5, lng: 127, radiusM: 100 });
assert.equal(located.find((row) => row.properties.source_feature_id === "inside")?.distance_m, 0);
assert.ok(located.some((row) => row.properties.source_feature_id === "edge"));
assert.ok(located.some((row) => row.properties.source_feature_id === "multipolygon-near"));
assert.equal(located.some((row) => row.properties.source_feature_id === "outside"), false);
const hole = located.find((row) => row.properties.source_feature_id === "hole");
assert.ok(hole && hole.distance_m > 0 && hole.distance_m < 100);
for (const row of located) {
  assert.ok(Number.isFinite(row.representative_lat));
  assert.ok(Number.isFinite(row.representative_lng));
}

// Given: equal-distance results whose normalized names also match.
// When: results are ordered.
// Then: source feature ID provides a deterministic final tie-break.
const tieIds = located
  .filter((row) => row.properties.source_feature_id.startsWith("tie-"))
  .map((row) => row.properties.source_feature_id);
assert.deepEqual(tieIds, ["tie-a", "tie-b"]);
const nameIds = located
  .filter((row) => row.properties.source_feature_id.startsWith("name-"))
  .map((row) => row.properties.source_feature_id);
assert.deepEqual(nameIds, ["name-first", "name-later"]);
for (let index = 1; index < located.length; index += 1) {
  assert.ok(located[index - 1].distance_m <= located[index].distance_m);
}

const artifactRoot = await mkdtemp(join(tmpdir(), "maintenance-boundary-store-"));
const artifactPath = join(artifactRoot, "boundaries.geojson");
try {
  // Given: missing, malformed, structurally invalid, and empty boundary artifacts.
  // When: each artifact is loaded.
  // Then: every unsafe input fails explicitly at the file boundary.
  assert.throws(() => loadMaintenanceBoundaryArtifact(artifactPath));
  await writeFile(artifactPath, "not-json", "utf8");
  assert.throws(() => loadMaintenanceBoundaryArtifact(artifactPath));
  await writeFile(artifactPath, JSON.stringify({ type: "FeatureCollection", features: [{ nope: true }] }), "utf8");
  assert.throws(() => loadMaintenanceBoundaryArtifact(artifactPath));
  await writeFile(artifactPath, JSON.stringify({ type: "FeatureCollection", features: [] }), "utf8");
  assert.throws(() => loadMaintenanceBoundaryArtifact(artifactPath));

  // Given: a valid artifact is cached and then replaced with a newer mtime.
  // When: it is loaded before and after replacement.
  // Then: unchanged mtime reuses the cached value and changed mtime reloads new features.
  await writeFile(artifactPath, JSON.stringify({ type: "FeatureCollection", features: [collection[0]] }), "utf8");
  const first = loadMaintenanceBoundaryArtifact(artifactPath);
  const cached = loadMaintenanceBoundaryArtifact(artifactPath);
  assert.equal(cached, first);
  await writeFile(artifactPath, JSON.stringify({ type: "FeatureCollection", features: [collection[1]] }), "utf8");
  const newerMtime = new Date(Date.now() + 2_000);
  await utimes(artifactPath, newerMtime, newerMtime);
  const reloaded = loadMaintenanceBoundaryArtifact(artifactPath);
  assert.notEqual(reloaded, first);
  assert.equal(reloaded[0]?.properties.source_feature_id, "edge");
} finally {
  await rm(artifactRoot, { recursive: true, force: true });
}

console.log("maintenance boundary store tests passed");
