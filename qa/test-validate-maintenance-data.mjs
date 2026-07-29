import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validateArtifactDocuments,
  validateClientSource,
} from "./maintenance-data-validation.mjs";
import {
  isPublicMaintenanceArtifact,
  validateMaintenanceRelease,
} from "./validate-maintenance-data.mjs";

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
      notice_ids: [],
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
rejects(invalid(({ geojson }) => { geojson.features[0].properties.source_layer = "UD501"; }), "INVALID_PROVENANCE");
rejects(invalid(({ geojson }) => { geojson.features[0].properties.original_crs = "EPSG:3857"; }), "INVALID_PROVENANCE");
rejects(invalid(({ geojson }) => { delete geojson.features[0].properties.notice_ids; }), "INVALID_PROVENANCE");
rejects(invalid(({ geojson }) => { geojson.features[0].properties.area_sqm = Number.NaN; }), "INVALID_PROVENANCE");
rejects(invalid(({ geojson }) => { geojson.features[0].geometry.coordinates[0].pop(); }), "INVALID_RING");
rejects(invalid(({ geojson }) => {
  geojson.features[0].geometry.coordinates[0] = [[126.9, 37.4], [127, 37.4], [126.9, 37.4]];
}), "INVALID_RING");
rejects(invalid(({ geojson }) => { geojson.features[0].geometry.coordinates = []; }), "INVALID_RING");
rejects(invalid(({ geojson }) => {
  geojson.features[0].geometry = { type: "MultiPolygon", coordinates: [[]] };
}), "INVALID_RING");
rejects(invalid(({ geojson }) => { geojson.features[0].properties.bbox = [126.8, 37.4, 127, 37.5]; }), "BBOX_MISMATCH");
rejects(invalid(({ metadata }) => { metadata.bbox = [126.8, 37.4, 127, 37.5]; }), "COLLECTION_BBOX_MISMATCH");
rejects(invalid(({ geojson, metadata }) => {
  geojson.features[0].geometry.coordinates = [[
    [126.9, 37.4], [127, 37.5], [127, 37.4], [126.9, 37.5], [126.9, 37.4],
  ]];
  geojson.features[0].properties.bbox = [126.9, 37.4, 127, 37.5];
  metadata.bbox = [126.9, 37.4, 127, 37.5];
}), "INVALID_GEOMETRY");

// Given two valid features; When validated; Then metadata bbox reconciles their complete union.
{
  const documents = validDocuments();
  const second = structuredClone(documents.geojson.features[0]);
  second.properties.source_feature_id = "UD602-2";
  second.geometry.coordinates = [[
    [128, 36], [128.1, 36], [128.1, 36.1], [128, 36.1], [128, 36],
  ]];
  second.properties.bbox = [128, 36, 128.1, 36.1];
  documents.geojson.features.push(second);
  documents.metadata.input_feature_count = 3;
  documents.metadata.output_feature_count = 2;
  documents.metadata.bbox = [126.9, 36, 128.1, 37.5];
  assert.equal(validateArtifactDocuments(documents).outputCount, 2);
}

// Given a valid MultiPolygon; When validated; Then nested polygon/ring structure is accepted.
{
  const documents = validDocuments();
  const polygon = documents.geojson.features[0].geometry.coordinates;
  documents.geojson.features[0].geometry = { type: "MultiPolygon", coordinates: [polygon] };
  assert.equal(validateArtifactDocuments(documents).outputCount, 1);
}

// Given client source; When it contains server credentials or a keyed official call; Then it fails.
assert.equal(validateClientSource("export const label = 'maintenance';", "safe.tsx"), null);
assert.equal(validateClientSource("const key = process.env.DATA_GO_KR_API_KEY;", "bad.tsx")?.code, "CLIENT_SECRET_REFERENCE");
assert.equal(validateClientSource("fetch('https://api.data.go.kr/openapi/x?serviceKey=secret')", "bad.tsx")?.code, "CLIENT_KEYED_CALL");
assert.equal(validateClientSource("const embedded = 'configured-secret-value';", "bad.tsx", ["configured-secret-value"])?.code, "CLIENT_SECRET_VALUE");

// Given canonical boundary filenames; When public paths are classified; Then every deployable sidecar is blocked without icon/data false positives.
for (const extension of ["shp", "shx", "dbf", "prj", "cpg", "zip", "geojson", "json"]) {
  assert.equal(isPublicMaintenanceArtifact(`spatial/LSMD_CONT_UD602_서울.${extension}`), true);
  assert.equal(isPublicMaintenanceArtifact(`spatial/LSMD_CONT_UD501_부산.${extension}`), true);
}
for (const safePath of ["assets/icons/maintenance.svg", "data/osm-subway.json", "docs/UD602-guide.txt", "assets/apartment.zip"]) {
  assert.equal(isPublicMaintenanceArtifact(safePath), false);
}

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

  // Given a client provider with a secret reference; When the full scan runs; Then src/providers is included.
  const providerPath = join(temporaryRoot, "src/providers/maintenance.ts");
  await mkdir(join(temporaryRoot, "src/providers"), { recursive: true });
  await writeFile(providerPath, "export const key = process.env.DATA_GO_KR_API_KEY;");
  await assert.rejects(
    () => validateMaintenanceRelease({ rootDirectory: temporaryRoot, artifactDirectory }),
    (error) => error?.code === "CLIENT_SECRET_REFERENCE",
  );
  await rm(join(temporaryRoot, "src/providers"), { recursive: true });

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

  const canonicalPublicArtifact = join(temporaryRoot, "public/LSMD_CONT_UD501_부산.prj");
  await writeFile(canonicalPublicArtifact, "synthetic projection fixture");
  await assert.rejects(
    () => validateMaintenanceRelease({ rootDirectory: temporaryRoot, artifactDirectory }),
    (error) => error?.code === "PUBLIC_ARTIFACT",
  );
  await rm(canonicalPublicArtifact);

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
