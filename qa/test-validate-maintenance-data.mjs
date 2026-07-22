import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validateArtifactDocuments,
  validateClientSource,
} from "./maintenance-data-validation.mjs";
import { validateMaintenanceRelease } from "./validate-maintenance-data.mjs";

function validDocuments() {
  const bbox = [126.9, 37.4, 127, 37.5];
  const feature = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [126.9, 37.4], [127, 37.4], [127, 37.5], [126.9, 37.5], [126.9, 37.4],
      ]],
    },
    properties: {
      source_feature_id: "UD602-1",
      source_dataset_id: "30335",
      source_layer: "UD602",
      original_crs: "EPSG:5186",
      source_url: "https://www.data.go.kr/data/15146864/fileData.do",
      retrieved_at: "2026-07-20T00:00:00+09:00",
      bbox,
    },
  };
  return {
    geojson: { type: "FeatureCollection", features: [feature] },
    metadata: {
      schema_version: 1,
      input_feature_count: 2,
      output_feature_count: 1,
      quarantined_feature_count: 1,
      bbox,
    },
    quarantine: [{ reason: "invalid_geometry" }],
  };
}

function invalid(mutator) {
  const documents = structuredClone(validDocuments());
  mutator(documents);
  return documents;
}

function rejects(documents, code) {
  assert.throws(() => validateArtifactDocuments(documents), (error) => error?.code === code);
}

// Given a reconciled schema-v1 artifact; When it is validated; Then its summary is returned.
assert.deepEqual(validateArtifactDocuments(validDocuments()), {
  schemaVersion: 1,
  inputCount: 2,
  outputCount: 1,
  quarantineCount: 1,
  bbox: [126.9, 37.4, 127, 37.5],
  datasetIds: ["30335"],
});

// Given invalid metadata branches; When validated; Then each branch fails closed.
rejects(invalid(({ metadata }) => { metadata.schema_version = 2; }), "INVALID_SCHEMA_VERSION");
rejects(invalid(({ metadata }) => { metadata.output_feature_count = 0; }), "EMPTY_OUTPUT");
rejects(invalid(({ metadata }) => { metadata.input_feature_count = 3; }), "COUNT_MISMATCH");
rejects(invalid(({ metadata }) => {
  metadata.input_feature_count = 1;
  metadata.quarantined_feature_count = 0;
}), "QUARANTINE_COUNT_MISMATCH");
rejects(invalid(({ metadata }) => { metadata.bbox[0] = Number.NaN; }), "INVALID_BBOX");
rejects(invalid(({ metadata }) => { metadata.bbox[3] = 42; }), "INVALID_BBOX");

// Given invalid geometry/provenance branches; When validated; Then each branch fails closed.
rejects(invalid(({ geojson }) => { geojson.features[0].geometry.coordinates[0][1][0] = 140; }), "INVALID_COORDINATE");
rejects(invalid(({ geojson }) => { geojson.features[0].properties.source_feature_id = ""; }), "MISSING_PROVENANCE");
rejects(invalid(({ geojson }) => { delete geojson.features[0].properties.source_dataset_id; }), "MISSING_PROVENANCE");
rejects(invalid(({ geojson }) => { delete geojson.features[0].properties.source_layer; }), "MISSING_PROVENANCE");
rejects(invalid(({ geojson }) => { geojson.features[0].properties.source_url = "not-a-url"; }), "MISSING_PROVENANCE");
rejects(invalid(({ geojson }) => { delete geojson.features[0].properties.original_crs; }), "MISSING_PROVENANCE");
rejects(invalid(({ geojson }) => { delete geojson.features[0].properties.retrieved_at; }), "MISSING_PROVENANCE");
rejects(invalid(({ geojson }) => { delete geojson.features[0].properties.bbox; }), "MISSING_PROVENANCE");
rejects(invalid(({ geojson }) => { geojson.features.push(structuredClone(geojson.features[0])); }), "FEATURE_COUNT_MISMATCH");

// Given client source; When it contains server credentials or a keyed official call; Then it fails.
assert.equal(validateClientSource("export const label = 'maintenance';", "safe.tsx"), null);
assert.equal(validateClientSource("const key = process.env.DATA_GO_KR_API_KEY;", "bad.tsx")?.code, "CLIENT_SECRET_REFERENCE");
assert.equal(validateClientSource("fetch('https://api.data.go.kr/openapi/x?serviceKey=secret')", "bad.tsx")?.code, "CLIENT_KEYED_CALL");
assert.equal(validateClientSource("const embedded = 'configured-secret-value';", "bad.tsx", ["configured-secret-value"])?.code, "CLIENT_SECRET_VALUE");

async function writeDocuments(directory, documents = validDocuments()) {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "boundaries.geojson"), JSON.stringify(documents.geojson)),
    writeFile(join(directory, "boundaries.meta.json"), JSON.stringify(documents.metadata)),
    writeFile(join(directory, "boundaries.quarantine.json"), JSON.stringify(documents.quarantine)),
  ]);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "maintenance-validator-"));
try {
  const artifactDirectory = join(temporaryRoot, "release");
  await writeDocuments(artifactDirectory);
  await mkdir(join(temporaryRoot, "src/components"), { recursive: true });
  await mkdir(join(temporaryRoot, "public"), { recursive: true });
  await writeFile(join(temporaryRoot, ".gitignore"), "data/maintenance/raw/\ndata/maintenance/processed/\n");
  execFileSync("git", ["init", "--quiet"], { cwd: temporaryRoot });

  // Given an isolated clean repository; When the full validator runs; Then policy and artifact checks pass.
  const release = await validateMaintenanceRelease({ rootDirectory: temporaryRoot, artifactDirectory });
  assert.equal(release.outputCount, 1);
  const cli = spawnSync(process.execPath, ["qa/validate-maintenance-data.mjs", "--root", temporaryRoot, "--artifact-directory", artifactDirectory], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(cli.status, 0, cli.stderr);

  // Given no release artifact; When the CLI runs; Then it fails closed.
  const missing = spawnSync(process.execPath, ["qa/validate-maintenance-data.mjs", "--root", temporaryRoot, "--artifact-directory", join(temporaryRoot, "missing")], {
    cwd: process.cwd(), encoding: "utf8",
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /MISSING_ARTIFACT/);

  // Given a public artifact; When validated; Then publication is rejected.
  const publicArtifact = join(temporaryRoot, "public/data/maintenance/boundaries.geojson");
  await mkdir(join(temporaryRoot, "public/data/maintenance"), { recursive: true });
  await writeFile(publicArtifact, "{}");
  await assert.rejects(
    () => validateMaintenanceRelease({ rootDirectory: temporaryRoot, artifactDirectory }),
    (error) => error?.code === "PUBLIC_ARTIFACT",
  );
  await rm(join(temporaryRoot, "public/data"), { recursive: true });

  // Given a processed path missing from .gitignore; When validated; Then the policy check fails.
  await writeFile(join(temporaryRoot, ".gitignore"), "data/maintenance/raw/\n");
  await assert.rejects(
    () => validateMaintenanceRelease({ rootDirectory: temporaryRoot, artifactDirectory }),
    (error) => error?.code === "UNIGNORED_DATA_PATH",
  );
  await writeFile(join(temporaryRoot, ".gitignore"), "data/maintenance/raw/\ndata/maintenance/processed/\n");

  // Given a tracked maintenance file; When validated; Then repository containment is rejected.
  await mkdir(join(temporaryRoot, "data/maintenance"), { recursive: true });
  await writeFile(join(temporaryRoot, "data/maintenance/tracked.txt"), "not licensed geometry");
  execFileSync("git", ["add", "--force", "data/maintenance/tracked.txt"], { cwd: temporaryRoot });
  await assert.rejects(
    () => validateMaintenanceRelease({ rootDirectory: temporaryRoot, artifactDirectory }),
    (error) => error?.code === "TRACKED_DATA",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("maintenance release validator tests passed");
