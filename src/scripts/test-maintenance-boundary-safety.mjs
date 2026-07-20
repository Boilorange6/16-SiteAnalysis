import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { identifySupportedCrs } from "../lib/server/maintenance/boundary-build.ts";
import { readAcquisitionMetadata, writeBoundaryArtifactsAtomically } from "./build-maintenance-boundaries.mjs";

const canonicalWkt1 = 'PROJCS["KGD2002_Central_Belt_2010",GEOGCS["GCS_Korean_Geodetic_Datum_2002",DATUM["D_Korean_Geodetic_Datum_2002",SPHEROID["GRS_1980",6378137,298.257222101]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000],PARAMETER["False_Northing",600000],PARAMETER["Central_Meridian",127],PARAMETER["Scale_Factor",1],PARAMETER["Latitude_Of_Origin",38],UNIT["Meter",1],AUTHORITY["EPSG","5186"]]';
const canonicalWkt2 = 'PROJCRS["KGD2002 Central Belt 2010",BASEGEOGCRS["KGD2002",DATUM["Geocentric Datum of Korea",ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]]],CONVERSION["Central Belt",METHOD["Transverse Mercator"],PARAMETER["Latitude of natural origin",38],PARAMETER["Longitude of natural origin",127],PARAMETER["Scale factor at natural origin",1],PARAMETER["False easting",200000],PARAMETER["False northing",600000]],CS[Cartesian,2],AXIS["easting",east],AXIS["northing",north],LENGTHUNIT["metre",1],ID["EPSG",5186]]';

// Given: canonical WKT1/WKT2 projected coordinate systems.
// When: their projected linear unit is checked.
// Then: metre/1 is accepted and Foot/0.3048 is rejected.
assert.equal(identifySupportedCrs(canonicalWkt1), "EPSG:5186");
assert.equal(identifySupportedCrs(canonicalWkt2), "EPSG:5186");
assert.throws(() => identifySupportedCrs(canonicalWkt1.replace('UNIT["Meter",1]', 'UNIT["Foot",0.3048]')), /Unsupported CRS/);
assert.throws(() => identifySupportedCrs(canonicalWkt2.replaceAll('LENGTHUNIT["metre",1]', 'LENGTHUNIT["Foot",0.3048]')), /Unsupported CRS/);

const sidecarRoot = await mkdtemp(join(tmpdir(), "maintenance-sidecar-safety-"));
try {
  const valid = { schema_version: 1, retrieved_at: "2026-07-20T10:30:00+09:00", source_url: "https://example.com/source", source_dataset_id: "30335", source_layer: "UD602" };
  for (const [name, metadata] of [
    ["invalid-month.zip", { ...valid, retrieved_at: "2026-13-01" }],
    ["invalid-day.zip", { ...valid, retrieved_at: "2026-02-30" }],
    ["unknown-key.zip", { ...valid, unexpected: "must-not-be-accepted" }],
  ]) {
    const archivePath = join(sidecarRoot, name);
    await writeFile(`${archivePath}.metadata.json`, JSON.stringify(metadata), "utf8");
    await assert.rejects(readAcquisitionMetadata({ archivePath }), /Invalid acquisition metadata sidecar/);
  }
} finally {
  await rm(sidecarRoot, { recursive: true, force: true });
}

const artifactNames = ["boundaries.geojson", "boundaries.meta.json", "boundaries.quarantine.json"];
async function seedPrior(directory) {
  await Promise.all(artifactNames.map((name) => writeFile(join(directory, name), JSON.stringify({ prior: name }), "utf8")));
}

async function exerciseIncompleteRollback({ failCleanup, failRestore }) {
  const directory = await mkdtemp(join(tmpdir(), "maintenance-rollback-safety-"));
  const restoreAttempts = [];
  let promoted = 0;
  await seedPrior(directory);
  const fileOperations = {
    makeDirectory: async ({ path }) => { await mkdir(path, { recursive: true }); },
    writeText: async ({ path, contents }) => { await writeFile(path, contents, "utf8"); },
    move: async ({ from, to }) => {
      if (from.includes(".backup-")) {
        restoreAttempts.push(to);
        if (to.endsWith(failRestore)) throw new Error(`injected restore failure: ${failRestore}`);
      } else if (from.includes(".tmp-")) {
        promoted += 1;
        if (promoted === 2) throw new Error("injected promotion failure");
      }
      await rename(from, to);
    },
    removeFile: async ({ path }) => {
      if (path.endsWith(failCleanup)) throw new Error(`injected cleanup failure: ${failCleanup}`);
      await rm(path, { force: true });
    },
  };
  try {
    let errorMessage = "";
    await assert.rejects(writeBoundaryArtifactsAtomically({
      outputDirectory: directory,
      geojson: { next: "geojson" },
      metadata: { next: "meta" },
      quarantine: { next: "quarantine" },
      fileOperations,
    }), (error) => {
      assert.ok(error instanceof Error);
      errorMessage = error.message;
      return true;
    });
    assert.match(errorMessage, /Manual recovery backups retained/);
    assert.equal(restoreAttempts.length, 3);
    const backups = (await readdir(directory)).filter((name) => name.includes(".backup-"));
    assert.ok(backups.some((name) => name.startsWith(failRestore)));
    assert.match(errorMessage, new RegExp(backups.find((name) => name.startsWith(failRestore)).replaceAll(".", "\\.")));
    assert.equal((await readdir(directory)).some((name) => name.includes(".tmp-")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Given: failures while removing a partial final and restoring one backup.
// When: rollback runs after a partial promotion.
// Then: every restore is attempted and unrecovered backups survive with actionable paths.
await exerciseIncompleteRollback({ failCleanup: "boundaries.geojson", failRestore: "boundaries.geojson" });
await exerciseIncompleteRollback({ failCleanup: "never", failRestore: "boundaries.meta.json" });

console.log("maintenance boundary safety tests passed");
