import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  identifySupportedCrs,
  transformBoundaryFeature,
  validateArchiveMembers,
} from "../lib/server/maintenance/boundary-build.ts";
import {
  enforceOutputCountGate,
  writeBoundaryArtifactsAtomically,
} from "./build-maintenance-boundaries.mjs";

const source = {
  sourceUrl: "https://www.data.go.kr/data/15146864/fileData.do",
  retrievedAt: "2026-07-20",
  sourceDatasetId: "30335",
  sourceLayer: "UD602",
};

// Given: official Korean Central Belt CRS descriptions.
// When: the CRS is identified.
// Then: only supported EPSG codes are accepted.
assert.equal(
  identifySupportedCrs('PROJCS["Korea 2000 / Central Belt 2010",GEOGCS["GRS 1980"],AUTHORITY["EPSG","5186"]]'),
  "EPSG:5186",
);
assert.equal(
  identifySupportedCrs('PROJCS["Korean 1985 / Central Belt",GEOGCS["Korean 1985"],AUTHORITY["EPSG","2097"]]'),
  "EPSG:2097",
);
assert.throws(() => identifySupportedCrs('PROJCS["Unknown local grid"]'), /Unsupported CRS/);

// Given: an incomplete shapefile archive.
// When: archive members are validated.
// Then: the missing PRJ member is reported before conversion.
assert.throws(
  () => validateArchiveMembers(["sample.shp", "sample.shx", "sample.dbf"]),
  /PRJ/,
);
assert.equal(
  validateArchiveMembers(["folder/SAMPLE.SHP", "folder/sample.shx", "folder/Sample.dbf", "folder/sample.PrJ"]).length,
  1,
);

// Given: an EPSG:5186 polygon containing an open exterior ring and a closed hole.
// When: the feature is transformed.
// Then: every ring is preserved and closed with normalized provenance aliases.
const polygonResult = transformBoundaryFeature(
  {
    geometry: {
      type: "Polygon",
      coordinates: [
        [[200000, 500000], [201000, 500000], [201000, 501000], [200000, 501000]],
        [[200200, 500200], [200800, 500200], [200800, 500800], [200200, 500800], [200200, 500200]],
      ],
    },
    properties: { ID: "p-1", NAME: "테스트구역", SIDO_NM: "서울특별시", AREA: 1234 },
  },
  "EPSG:5186",
  source,
);
assert.equal(polygonResult.quarantine, null);
assert.equal(polygonResult.feature.geometry.type, "Polygon");
assert.equal(polygonResult.feature.geometry.coordinates.length, 2);
for (const ring of polygonResult.feature.geometry.coordinates) {
  assert.deepEqual(ring[0], ring.at(-1));
}
assert.equal(polygonResult.feature.properties.source_feature_id, "p-1");
assert.equal(polygonResult.feature.properties.name, "테스트구역");
assert.equal(polygonResult.feature.properties.sido, "서울특별시");
assert.equal(polygonResult.feature.properties.area_sqm, 1234);
assert.deepEqual(polygonResult.feature.properties.notice_ids, []);

// Given: a valid EPSG:2097 MultiPolygon with two members.
// When: the feature is transformed.
// Then: both polygon members remain independently represented.
const multiPolygonResult = transformBoundaryFeature(
  {
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [[[200000, 500000], [200500, 500000], [200500, 500500], [200000, 500500], [200000, 500000]]],
        [[[201000, 501000], [201500, 501000], [201500, 501500], [201000, 501500], [201000, 501000]]],
      ],
    },
    properties: { MGT_NO: "m-1" },
  },
  "EPSG:2097",
  { ...source, sourceDatasetId: "30336", sourceLayer: "UD501" },
);
assert.equal(multiPolygonResult.quarantine, null);
assert.equal(multiPolygonResult.feature.geometry.type, "MultiPolygon");
assert.equal(multiPolygonResult.feature.geometry.coordinates.length, 2);

// Given: non-finite coordinates and a self-intersecting polygon.
// When: each feature is transformed.
// Then: invalid geometry is quarantined instead of repaired silently.
const nonFiniteResult = transformBoundaryFeature(
  {
    geometry: { type: "Polygon", coordinates: [[[200000, 500000], [Number.NaN, 500000], [201000, 501000], [200000, 500000]]] },
    properties: { ID: "bad-number" },
  },
  "EPSG:5186",
  source,
);
assert.equal(nonFiniteResult.quarantine?.reason, "non_finite_coordinate");

const selfIntersectionResult = transformBoundaryFeature(
  {
    geometry: {
      type: "Polygon",
      coordinates: [[[200000, 500000], [201000, 501000], [201000, 500000], [200000, 501000], [200000, 500000]]],
    },
    properties: { ID: "bow-tie" },
  },
  "EPSG:5186",
  source,
);
assert.equal(selfIntersectionResult.quarantine?.reason, "invalid_geometry");

// Given: prior metadata and a 25% output-count change.
// When: the release gate is evaluated.
// Then: an explicit acceptance is required and retained in metadata.
assert.throws(() => enforceOutputCountGate({ previousCount: 100, nextCount: 75, acceptLargeChange: false }), /20%/);
assert.equal(enforceOutputCountGate({ previousCount: 100, nextCount: 75, acceptLargeChange: true }), true);
assert.equal(enforceOutputCountGate({ previousCount: 100, nextCount: 85, acceptLargeChange: false }), false);

// Given: three complete in-memory artifacts.
// When: sibling temporary files are atomically promoted.
// Then: all final artifacts exist and no temporary files remain.
const atomicRoot = await mkdtemp(join(tmpdir(), "maintenance-boundaries-atomic-"));
try {
  await writeBoundaryArtifactsAtomically({
    outputDirectory: atomicRoot,
    geojson: { type: "FeatureCollection", features: [] },
    metadata: { schema_version: 1, output_feature_count: 0 },
    quarantine: [],
  });
  assert.equal(JSON.parse(await readFile(join(atomicRoot, "boundaries.geojson"), "utf8")).type, "FeatureCollection");
  assert.equal(JSON.parse(await readFile(join(atomicRoot, "boundaries.meta.json"), "utf8")).schema_version, 1);
  assert.deepEqual(JSON.parse(await readFile(join(atomicRoot, "boundaries.quarantine.json"), "utf8")), []);
  assert.equal((await readdir(atomicRoot)).some((name) => name.includes(".tmp-")), false);
} finally {
  await rm(atomicRoot, { recursive: true, force: true });
}

// Given: an empty authorized input directory.
// When: the real CLI is invoked.
// Then: it exits nonzero with an actionable message and writes no output.
const emptyInput = await mkdtemp(join(tmpdir(), "maintenance-boundaries-empty-"));
const output = join(emptyInput, "processed");
try {
  const cli = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/scripts/build-maintenance-boundaries.mjs", "--input", emptyInput, "--output", output],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(cli.status, 0);
  assert.match(`${cli.stdout}${cli.stderr}`, /No authorized maintenance SHP archives found/);

  const missingInputCli = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/scripts/build-maintenance-boundaries.mjs", "--input", join(emptyInput, "missing"), "--output", output],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(missingInputCli.status, 0);
  assert.match(`${missingInputCli.stdout}${missingInputCli.stderr}`, /No authorized maintenance SHP archives found/);
} finally {
  await rm(emptyInput, { recursive: true, force: true });
}

console.log("maintenance boundary build tests passed");
