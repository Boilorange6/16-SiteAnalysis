/** Resumable per-raw-file ingest: rollback, resume, lock recovery, and parity. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { insertFeature, queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { buildAndPublish, buildResumableSourceFiles, insertRelease, SourceStats } = await import("../../lib/v2/ingest/build.ts");

const [cx, cy] = toUtmk([127.074, 37.514]);
const at = (dx, dy) => [...toLngLat([cx + dx, cy + dy])];
const rect = (x, y, w, h) => ({
  type: "Polygon",
  coordinates: [[at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h), at(x, y)]],
});

const buildingFiles = [
  { path: "gis_building/AL_D010_41_a.shp", size: 101, mtimeMs: 1_700_000_001_000, rows: 2 },
  { path: "gis_building/AL_D010_41_b.shp", size: 102, mtimeMs: 1_700_000_002_000, rows: 2 },
  { path: "gis_building/AL_D010_41_c.shp", size: 103, mtimeMs: 1_700_000_003_000, rows: 2 },
];
const parcelFiles = [
  { path: "cadastral/AL_D002_41_a.shp", size: 201, mtimeMs: 1_700_000_011_000, rows: 2 },
  { path: "cadastral/AL_D002_41_b.shp", size: 202, mtimeMs: 1_700_000_012_000, rows: 2 },
];

const buildingRows = new Map(buildingFiles.map((file, fileIndex) => [file.path, [0, 1].map((rowIndex) => ({
  stableId: `building:${fileIndex}:${rowIndex}`,
  sourceKey: `building-${fileIndex}-${rowIndex}`,
  kind: "building",
  geometry: rect(-120 + fileIndex * 100 + rowIndex * 30, -40 + rowIndex * 20, 20, 16),
  pnu: `41135101001000${fileIndex}${rowIndex}00000`,
  legalCode: "4113510100",
  properties: { heightM: 12 + rowIndex, floorsAbove: 3 + rowIndex, useCode: "01000", approvalDate: "2020-01-01" },
}))]));
const parcelRows = new Map(parcelFiles.map((file, fileIndex) => [file.path, [0, 1].map((rowIndex) => {
  const pnu = `41135101002000${fileIndex}${rowIndex}00000`;
  return {
    stableId: `parcel:${pnu}`,
    sourceKey: pnu,
    kind: "parcel",
    geometry: rect(-90 + fileIndex * 120 + rowIndex * 35, 100 + rowIndex * 30, 28, 22),
    pnu,
    legalCode: "4113510100",
    properties: { jimok: "대", jibun: `${fileIndex + 1}-${rowIndex + 1}`, sigungu: "41135", areaM2: 616 + rowIndex },
  };
})]));

const release = (sourceId) => ({
  sourceId,
  provider: "resume-fixture",
  sourceUrl: "https://example.invalid/resume",
  sourceAsOf: "2026-10-01",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: `resume-${sourceId}`,
  licenseCode: "TEST",
});

function insertBuildingFact(db, featureId, input, index) {
  db.prepare(`INSERT INTO building_fact
    (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code,
     approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
    VALUES (?, ?, ?, 'source', ?, 0, ?, ?, ?, ?, '{}')`).run(
    featureId,
    `ledger-${index}`,
    input.properties.heightM,
    input.properties.floorsAbove,
    input.properties.useCode,
    input.properties.approvalDate,
    100 + index,
    20 + index,
  );
}

function makePlan(dataDir, version, options = {}) {
  const buildingSpec = {
    sourceId: "building",
    parameters: JSON.stringify({ fixture: "resume-v1", kind: "buildings", variant: options.variant ?? "same" }),
    files: buildingFiles,
  };
  const parcelSpec = {
    sourceId: "parcel_polygon",
    parameters: JSON.stringify({ fixture: "resume-v1", kind: "parcels", variant: options.variant ?? "same" }),
    files: parcelFiles,
  };
  const builders = {
    buildings: async (db) => {
      const releaseId = insertRelease(db, release("building"));
      const stats = await buildResumableSourceFiles(db, {
        spec: buildingSpec,
        releaseId,
        fillFields: ["heightM", "floorsAbove", "useCode", "approvalDate"],
        buildFile: async (file) => {
          const sourceStats = new SourceStats("building", releaseId, ["heightM", "floorsAbove", "useCode", "approvalDate"]);
          const fileIndex = buildingFiles.findIndex((candidate) => candidate.path === file.path);
          for (const input of buildingRows.get(file.path) ?? []) {
            sourceStats.read();
            const featureId = insertFeature(db, { ...input, releaseId });
            insertBuildingFact(db, featureId, input, fileIndex * 2 + sourceStats.received - 1);
            sourceStats.accept(input.properties, "41", "source");
            if (options.interruptPath === file.path && sourceStats.received === 1) {
              throw new Error(`simulated interruption in ${file.path}`);
            }
            if (options.childReady && file.path === buildingFiles[0].path && sourceStats.received === 1) {
              writeFileSync(options.childReady, "in-file-transaction\n");
              await new Promise((resolve) => setTimeout(resolve, 15_000));
            }
          }
          return sourceStats;
        },
      });
      stats.expectedRegions = ["41"];
      return [stats];
    },
    parcels: async (db) => {
      const releaseId = insertRelease(db, release("parcel_polygon"));
      const stats = await buildResumableSourceFiles(db, {
        spec: parcelSpec,
        releaseId,
        fillFields: ["jimok", "jibun", "sigungu", "areaM2"],
        buildFile: async (file) => {
          const sourceStats = new SourceStats("parcel_polygon", releaseId, ["jimok", "jibun", "sigungu", "areaM2"]);
          for (const input of parcelRows.get(file.path) ?? []) {
            sourceStats.read();
            insertFeature(db, { ...input, releaseId });
            sourceStats.accept(input.properties, "41", "대");
          }
          return sourceStats;
        },
      });
      stats.expectedRegions = ["41"];
      return [stats];
    },
  };
  return {
    dataDir,
    version,
    builders,
    progress: { buildings: buildingSpec, parcels: parcelSpec },
    resume: options.resume === true,
  };
}

function dbPath(dataDir, version, kind) {
  return join(dataDir, "versions", version, `${kind}.sqlite`);
}

function rows(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function snapshot(dataDir, version) {
  const result = {};
  for (const kind of ["buildings", "parcels"]) {
    const db = new Database(dbPath(dataDir, version, kind));
    try {
      result[kind] = {
        feature: rows(db, "SELECT feature_id, stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json FROM feature ORDER BY feature_id"),
        rtree: rows(db, "SELECT feature_id, min_x, max_x, min_y, max_y FROM feature_rtree ORDER BY feature_id"),
        hits: rows(db, "SELECT f.feature_id, f.stable_id FROM feature_rtree r JOIN feature f ON f.feature_id = r.feature_id WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ? ORDER BY f.feature_id", cx - 200, cx + 200, cy - 200, cy + 200),
        radiusHits: queryFeaturesInRadius(db, [127.074, 37.514], 500, [kind === "buildings" ? "building" : "parcel"]).map((hit) => hit.stableId),
        facts: kind === "buildings" ? rows(db, "SELECT feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json FROM building_fact ORDER BY feature_id") : [],
        parcelRows: kind === "parcels" ? rows(db, "SELECT stable_id, pnu, properties_json FROM feature WHERE kind = 'parcel' ORDER BY feature_id") : [],
      };
    } finally {
      db.close();
    }
  }
  return result;
}

async function runChild(dataDir, readyPath) {
  await buildAndPublish(makePlan(dataDir, "killed", { childReady: readyPath }));
}

if (process.argv[2] === "--child") {
  await runChild(process.argv[3], process.argv[4]);
  process.exit(0);
}

async function waitForFile(path, child, timeoutMs = 8_000) {
  const started = Date.now();
  while (!existsSync(path)) {
    if (Date.now() - started > timeoutMs) throw new Error("child did not reach its in-file transaction");
    if (child.exitCode !== null) throw new Error(`child exited before interruption: ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const tempDirs = [];
try {
  const uninterruptedDir = mkdtempSync(join(tmpdir(), "v2-resume-reference-"));
  const interruptedDir = mkdtempSync(join(tmpdir(), "v2-resume-throw-"));
  const childDir = mkdtempSync(join(tmpdir(), "v2-resume-kill-"));
  const staleDir = mkdtempSync(join(tmpdir(), "v2-resume-stale-"));
  tempDirs.push(uninterruptedDir, interruptedDir, childDir, staleDir);

  await buildAndPublish(makePlan(uninterruptedDir, "reference"));

  await assert.rejects(
    buildAndPublish(makePlan(interruptedDir, "fixture", { interruptPath: buildingFiles[1].path })),
    /simulated interruption/,
  );
  const partial = new Database(dbPath(interruptedDir, "fixture", "buildings"));
  try {
    assert.equal(partial.prepare("SELECT COUNT(*) FROM build_progress WHERE source_id = 'building'").pluck().get(), 1, "only the first file should be committed");
    assert.equal(partial.prepare("SELECT COUNT(*) FROM feature").pluck().get(), 2, "the interrupted file must roll back");
    assert.equal(partial.prepare("SELECT COUNT(*) FROM feature_rtree_pending").pluck().get(), 2, "committed bbox staging must survive");
  } finally {
    partial.close();
  }
  await assert.rejects(
    buildAndPublish(makePlan(interruptedDir, "fixture", { resume: true, variant: "changed" })),
    /build parameters or raw file set mismatch/,
  );
  await assert.rejects(
    buildAndPublish(makePlan(interruptedDir, "fixture")),
    /already exists.*resume/,
  );
  await buildAndPublish(makePlan(interruptedDir, "fixture", { resume: true }));
  assert.deepEqual(snapshot(interruptedDir, "fixture"), snapshot(uninterruptedDir, "reference"), "throw/resume output differs from uninterrupted output");

  const readyPath = join(childDir, "child-ready.txt");
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--child", childDir, readyPath], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.resume();
  child.stderr.resume();
  await waitForFile(readyPath, child);
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await buildAndPublish(makePlan(childDir, "killed", { resume: true }));
  assert.deepEqual(snapshot(childDir, "killed"), snapshot(uninterruptedDir, "reference"), "child-kill/resume output differs from uninterrupted output");

  writeFileSync(join(staleDir, ".lock"), "99999999 2000-01-01T00:00:00.000Z\n");
  await buildAndPublish(makePlan(staleDir, "stale"));
  assert.deepEqual(snapshot(staleDir, "stale"), snapshot(uninterruptedDir, "reference"), "stale-lock build output differs");
} finally {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
  }
}

console.log("✓ v2 ingest resume path");
