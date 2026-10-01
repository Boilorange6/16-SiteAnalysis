/** P4 ingest performance path: bulk build output must match the row-by-row baseline. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertFeature, projectGeometry, queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { batched, buildAndPublish, insertRelease, registerIngestProgressTotal, SourceStats } = await import("../../lib/v2/ingest/build.ts");

const [cx, cy] = toUtmk([127.074, 37.514]);
const at = (dx, dy) => [...toLngLat([cx + dx, cy + dy])];
const rect = (x, y, w, h) => ({ type: "Polygon", coordinates: [[at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h), at(x, y)]] });
const fixtures = [
  { stableId: "building:a", sourceKey: "a", kind: "building", geometry: rect(-80, -30, 35, 20), pnu: "4113510100100010000", legalCode: "4113510100", properties: { heightM: 12 } },
  { stableId: "building:b", sourceKey: "b", kind: "building", geometry: rect(-10, -15, 25, 45), pnu: "4113510100100020000", legalCode: "4113510100", properties: { heightM: 24 } },
  { stableId: "building:c", sourceKey: "c", kind: "building", geometry: rect(50, 20, 50, 30), pnu: null, legalCode: "4113510100", properties: { heightM: null } },
  { stableId: "building:d", sourceKey: "d", kind: "building", geometry: rect(850, 850, 30, 30), pnu: null, legalCode: null, properties: { heightM: 6 } },
];

const releaseInput = {
  sourceId: "building",
  provider: "test",
  sourceUrl: "https://example.invalid",
  sourceAsOf: "2026-09-01",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "fixture",
  licenseCode: "TEST",
};

function* positions(coords) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    yield coords;
    return;
  }
  for (const child of coords) yield* positions(child);
}

function legacyInsertFeature(db, input) {
  const projected = projectGeometry(input.geometry, input.roundM);
  const points = [...positions(projected.coordinates)];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const values = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return db.transaction(() => {
    const info = db.prepare(`INSERT INTO feature (stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.stableId, input.kind, input.sourceKey, input.releaseId, JSON.stringify(projected), input.name ?? null, input.pnu ?? null, input.legalCode ?? null, JSON.stringify(input.properties ?? {}));
    const featureId = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO feature_rtree (feature_id, min_x, max_x, min_y, max_y) VALUES (?, ?, ?, ?, ?)").run(featureId, ...values);
    return featureId;
  })();
}

function makeLegacyDb() {
  const db = new Database(":memory:");
  initDataFileSchema(db, "buildings");
  const releaseId = insertRelease(db, releaseInput);
  const fact = db.prepare(`INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [index, input] of fixtures.entries()) {
    const featureId = legacyInsertFeature(db, { ...input, releaseId });
    fact.run(featureId, `ledger-${index}`, input.properties.heightM, input.properties.heightM === null ? "unknown" : "source", index + 1, 0, "01000", "2020-01-01", 100 + index, 20 + index, "{}");
  }
  return db;
}

function featureRows(db) {
  return db.prepare("SELECT feature_id, stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json FROM feature ORDER BY feature_id").all();
}
function rtreeRows(db) {
  return db.prepare("SELECT feature_id, min_x, max_x, min_y, max_y FROM feature_rtree ORDER BY feature_id").all();
}
function buildingFactRows(db) {
  return db.prepare("SELECT feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json FROM building_fact ORDER BY feature_id").all();
}
function boxHits(db, minX, maxX, minY, maxY) {
  return db.prepare(`SELECT f.feature_id, f.stable_id
    FROM feature_rtree r CROSS JOIN feature f ON f.feature_id = r.feature_id
    WHERE r.max_x >= ? AND r.min_x <= ? AND r.max_y >= ? AND r.min_y <= ?
    ORDER BY f.feature_id`).all(minX, maxX, minY, maxY);
}

const legacy = makeLegacyDb();
const dataDir = mkdtempSync(join(tmpdir(), "v2-ingestperf-"));
try {
  const optimized = await buildAndPublish({
    dataDir,
    version: "fixture",
    builders: {
      buildings: async (db) => {
        const releaseId = insertRelease(db, releaseInput);
        const stats = new SourceStats("building", releaseId, ["heightM"]);
        const fact = db.prepare(`INSERT INTO building_fact (feature_id, ledger_pk, height_m, height_method, floors_above, floors_below, use_code, approval_date, gross_floor_area_m2, footprint_area_m2, field_provenance_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        let index = 0;
        await batched(db, fixtures, (input) => {
          stats.read();
          const featureId = insertFeature(db, { ...input, releaseId });
          fact.run(featureId, `ledger-${index}`, input.properties.heightM, input.properties.heightM === null ? "unknown" : "source", index + 1, 0, "01000", "2020-01-01", 100 + index, 20 + index, "{}");
          stats.accept(input.properties, "41", "building");
          index++;
        });
        return [stats];
      },
    },
  });
  assert.equal(optimized.published, true, JSON.stringify(optimized.failures));

  const builtPath = join(dataDir, "versions", "fixture", "buildings.sqlite");
  const after = new Database(builtPath);
  assert.deepEqual(featureRows(after), featureRows(legacy), "feature rows changed");
  assert.deepEqual(rtreeRows(after), rtreeRows(legacy), "R*Tree rows changed");
  assert.deepEqual(buildingFactRows(after), buildingFactRows(legacy), "building_fact rows changed");

  for (const [minX, maxX, minY, maxY] of [[cx - 100, cx + 100, cy - 100, cy + 100], [cx - 20, cx + 70, cy - 20, cy + 70], [cx + 700, cx + 1000, cy + 700, cy + 1000]]) {
    assert.deepEqual(boxHits(after, minX, maxX, minY, maxY), boxHits(legacy, minX, maxX, minY, maxY), "R*Tree box hits changed");
  }
  for (const radius of [100, 500, 1500]) {
    assert.deepEqual(queryFeaturesInRadius(after, [127.074, 37.514], radius, ["building"]), queryFeaturesInRadius(legacy, [127.074, 37.514], radius, ["building"]), `radius hits changed at ${radius}m`);
  }
  assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_feature_kind'").pluck().get(), "idx_feature_kind");
  assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_feature_pnu'").pluck().get(), "idx_feature_pnu");

  const defaults = new Database(join(dataDir, "defaults.sqlite"));
  const defaultPragmas = {
    journalMode: defaults.pragma("journal_mode", { simple: true }),
    synchronous: defaults.pragma("synchronous", { simple: true }),
    tempStore: defaults.pragma("temp_store", { simple: true }),
    cacheSize: defaults.pragma("cache_size", { simple: true }),
  };
  defaults.close();
  assert.equal(after.pragma("journal_mode", { simple: true }), defaultPragmas.journalMode, "journal mode was not restored");
  assert.equal(after.pragma("synchronous", { simple: true }), defaultPragmas.synchronous, "synchronous was not restored");
  assert.equal(after.pragma("temp_store", { simple: true }), defaultPragmas.tempStore, "temp_store was not restored");
  assert.equal(after.pragma("cache_size", { simple: true }), defaultPragmas.cacheSize, "cache_size was not restored");
  after.close();

  const logs = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (message, ...rest) => {
    logs.push(String(message));
    return true;
  };
  try {
    registerIngestProgressTotal("progress-test", 500_000);
    const progress = new SourceStats("progress-test", "progress-test@1", []);
    for (let i = 0; i < 250_000; i++) progress.read();
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.match(logs.join("\n"), /source=progress-test rows=250000\/500000 rows\/s=.* elapsed=.* ETA/);
} finally {
  legacy.close();
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    console.warn(`temporary ingest fixture cleanup deferred: ${dataDir}`);
  }
}

console.log("✓ v2 ingest performance path");
