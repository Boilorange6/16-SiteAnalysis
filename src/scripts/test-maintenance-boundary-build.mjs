import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
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
  readAcquisitionMetadata,
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
const canonical5186 = 'PROJCS["KGD2002_Central_Belt_2010",GEOGCS["GCS_Korean_Geodetic_Datum_2002",DATUM["D_Korean_Geodetic_Datum_2002",SPHEROID["GRS_1980",6378137,298.257222101]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000],PARAMETER["False_Northing",600000],PARAMETER["Central_Meridian",127],PARAMETER["Scale_Factor",1],PARAMETER["Latitude_Of_Origin",38],UNIT["Meter",1],AUTHORITY["EPSG","5186"]]';
const canonical2097 = 'PROJCS["Korean_1985_Central_Belt",GEOGCS["GCS_Korean_Datum_1985",DATUM["D_Korean_Datum_1985",SPHEROID["Bessel_1841",6377397.155,299.1528128]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000],PARAMETER["False_Northing",500000],PARAMETER["Central_Meridian",127.002890277778],PARAMETER["Scale_Factor",1],PARAMETER["Latitude_Of_Origin",38],UNIT["Meter",1],AUTHORITY["EPSG","2097"]]';
const canonical5174 = 'PROJCS["Korean 1985 / Modified Central Belt",GEOGCS["Korean 1985",DATUM["Korean_Datum_1985",SPHEROID["Bessel 1841",6377397.155,299.1528128,AUTHORITY["EPSG","7004"]],AUTHORITY["EPSG","6162"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",38],PARAMETER["central_meridian",127.002890277778],PARAMETER["scale_factor",1],PARAMETER["false_easting",200000],PARAMETER["false_northing",500000],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","5174"]]';
assert.equal(identifySupportedCrs(canonical5186), "EPSG:5186");
assert.equal(identifySupportedCrs(canonical2097), "EPSG:2097");
assert.equal(identifySupportedCrs(canonical5174), "EPSG:5174");
assert.equal(identifySupportedCrs("EPSG:5186"), "EPSG:5186");
assert.equal(identifySupportedCrs("EPSG:5174"), "EPSG:5174");
assert.throws(() => identifySupportedCrs(canonical5186.replace('PARAMETER["False_Northing",600000]', 'PARAMETER["False_Northing",500000]')), /Unsupported CRS/);
assert.throws(() => identifySupportedCrs(canonical2097.replace('SPHEROID["Bessel_1841",6377397.155,299.1528128]', 'SPHEROID["GRS_1980",6378137,298.257222101]')), /Unsupported CRS/);
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

// Given: Polygon and MultiPolygon geometries without usable members.
// When: each empty geometry is transformed.
// Then: it is explicitly quarantined before Turf or bbox processing.
for (const geometry of [
  { type: "Polygon", coordinates: [] },
  { type: "MultiPolygon", coordinates: [] },
  { type: "MultiPolygon", coordinates: [[]] },
]) {
  const emptyResult = transformBoundaryFeature({ geometry, properties: { ID: `empty-${geometry.type}` } }, "EPSG:5186", source);
  assert.equal(emptyResult.quarantine?.reason, "empty_geometry");
}

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

  // Given: a complete prior generation and a failure during the second or third promotion.
  // When: artifact promotion fails after partially replacing finals.
  // Then: all three prior files are restored and no temp or backup file remains.
  for (const failAt of [2, 3]) {
    const prior = { "boundaries.geojson": { generation: "prior-geojson" }, "boundaries.meta.json": { generation: "prior-meta" }, "boundaries.quarantine.json": { generation: "prior-quarantine" } };
    await Promise.all(Object.entries(prior).map(([name, value]) => writeFile(join(atomicRoot, name), JSON.stringify(value), "utf8")));
    let promotionCount = 0;
    await assert.rejects(
      writeBoundaryArtifactsAtomically({
        outputDirectory: atomicRoot,
        geojson: { generation: "next-geojson" },
        metadata: { generation: "next-meta" },
        quarantine: { generation: "next-quarantine" },
        promote: async ({ temporaryPath, finalPath }) => {
          promotionCount += 1;
          if (promotionCount === failAt) throw new Error(`injected promotion failure ${failAt}`);
          await rename(temporaryPath, finalPath);
        },
      }),
      /injected promotion failure/,
    );
    for (const [name, value] of Object.entries(prior)) assert.deepEqual(JSON.parse(await readFile(join(atomicRoot, name), "utf8")), value);
    assert.equal((await readdir(atomicRoot)).some((name) => name.includes(".tmp-") || name.includes(".backup-")), false);
  }
} finally {
  await rm(atomicRoot, { recursive: true, force: true });
}

// Given: a ZIP with trusted acquisition metadata stored in a sibling sidecar.
// When: the ZIP mtime changes or the ZIP and sidecar are copied together.
// Then: provenance remains exactly the operator-recorded metadata.
const provenanceRoot = await mkdtemp(join(tmpdir(), "maintenance-boundaries-provenance-"));
try {
  const archivePath = join(provenanceRoot, "UD602.zip");
  const sidecar = {
    schema_version: 1,
    retrieved_at: "2026-07-18T09:30:00+09:00",
    source_url: "https://www.data.go.kr/data/15146864/fileData.do",
    source_dataset_id: "30335",
    source_layer: "UD602",
  };
  await writeFile(archivePath, "authorized archive fixture", "utf8");
  await writeFile(`${archivePath}.metadata.json`, JSON.stringify(sidecar), "utf8");
  const beforeTouch = await readAcquisitionMetadata({ archivePath });
  await utimes(archivePath, new Date("2035-01-01T00:00:00Z"), new Date("2035-01-01T00:00:00Z"));
  assert.deepEqual(await readAcquisitionMetadata({ archivePath }), beforeTouch);
  const copiedArchive = join(provenanceRoot, "copied-UD602.zip");
  await copyFile(archivePath, copiedArchive);
  await copyFile(`${archivePath}.metadata.json`, `${copiedArchive}.metadata.json`);
  const copiedProvenance = await readAcquisitionMetadata({ archivePath: copiedArchive });
  for (const key of ["sourceUrl", "retrievedAt", "sourceDatasetId", "sourceLayer", "sourceUpdatedAt", "metadataSha256"]) {
    assert.equal(copiedProvenance[key], beforeTouch[key]);
  }
  assert.equal(beforeTouch.sourceUpdatedAt, undefined);
  await assert.rejects(readAcquisitionMetadata({ archivePath: join(provenanceRoot, "missing.zip") }), /Missing acquisition metadata sidecar/);
  const invalidArchive = join(provenanceRoot, "invalid.zip");
  await writeFile(`${invalidArchive}.metadata.json`, JSON.stringify({ ...sidecar, source_layer: "UD501" }), "utf8");
  await assert.rejects(readAcquisitionMetadata({ archivePath: invalidArchive }), /Invalid acquisition metadata sidecar/);
} finally {
  await rm(provenanceRoot, { recursive: true, force: true });
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
