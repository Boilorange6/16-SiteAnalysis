import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";

const path = process.argv[2];
if (!path) {
  console.error("usage: node audit-sqlite.mjs <sqlite-path>");
  process.exit(2);
}

const db = new Database(path, { readonly: true, fileMustExist: true });
const exists = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name));
const count = (name) => exists(name) ? Number(db.prepare(`SELECT COUNT(*) FROM "${name}"`).pluck().get()) : null;
const timed = (label, fn) => {
  const started = performance.now();
  let value;
  let error = null;
  try {
    value = fn();
  } catch (e) {
    error = String(e instanceof Error ? e.message : e);
  }
  return { label, ms: Number((performance.now() - started).toFixed(1)), value, error };
};

function hashRows(sql, params = []) {
  const hash = createHash("sha256");
  let rows = 0;
  for (const row of db.prepare(sql).iterate(...params)) {
    hash.update(JSON.stringify(row));
    hash.update("\n");
    rows += 1;
  }
  return { rows, sha256: hash.digest("hex") };
}

const tables = [
  "feature", "feature_rtree", "building_fact", "feature_link", "source_release",
  "ingest_run", "build_progress", "ledger_match_candidate", "ledger_title_dong",
];
const counts = Object.fromEntries(tables.map((name) => [name, count(name)]));
const featureKinds = exists("feature")
  ? db.prepare("SELECT kind, COUNT(*) AS rows FROM feature GROUP BY kind ORDER BY kind").all()
  : [];
const sourceStats = exists("source_release")
  ? db.prepare("SELECT release_id, source_id, coverage_json FROM source_release ORDER BY release_id").all().map((row) => {
    let coverage = {};
    try { coverage = JSON.parse(row.coverage_json ?? "{}"); } catch { coverage = { parseError: true }; }
    return { releaseId: row.release_id, sourceId: row.source_id, coverage };
  })
  : [];
const checksums = {};
if (exists("feature")) {
  checksums.feature = hashRows(`SELECT stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json
    FROM feature ORDER BY stable_id`);
  checksums.featureByKind = {};
  for (const { kind } of featureKinds) {
    checksums.featureByKind[kind] = hashRows(`SELECT stable_id, kind, source_key, release_id, geom_json, name, pnu, legal_code, properties_json
      FROM feature WHERE kind = ? ORDER BY stable_id`, [kind]);
  }
}
if (exists("feature_rtree")) checksums.featureRtree = hashRows("SELECT feature_id, min_x, max_x, min_y, max_y FROM feature_rtree ORDER BY feature_id");
if (exists("building_fact")) checksums.buildingFact = hashRows(`SELECT f.stable_id, b.ledger_pk, b.height_m, b.height_method, b.floors_above, b.floors_below,
    b.use_code, b.approval_date, b.gross_floor_area_m2, b.footprint_area_m2, b.pnu_method, b.pnu_spatial,
    b.field_provenance_json FROM building_fact b JOIN feature f ON f.feature_id = b.feature_id ORDER BY f.stable_id`);
if (exists("feature_link")) checksums.featureLink = hashRows(`SELECT from_stable_id, to_stable_id, relation_type, method, confidence, release_id, valid_from, valid_to
    FROM feature_link ORDER BY from_stable_id, to_stable_id, relation_type`);
if (exists("source_release")) checksums.sourceRelease = hashRows(`SELECT release_id, source_id, provider, source_url, source_as_of, fetched_at, checksum, schema_version,
    license_code, rights_json, coverage_json FROM source_release ORDER BY release_id`);

const timings = [];
if (exists("feature")) timings.push(timed("feature_count", () => db.prepare("SELECT COUNT(*) FROM feature").pluck().get()));
if (exists("feature_rtree")) timings.push(timed("feature_rtree_count", () => db.prepare("SELECT COUNT(*) FROM feature_rtree").pluck().get()));
timings.push(timed("pragma_integrity_check", () => db.prepare("PRAGMA integrity_check").all()));
timings.push(timed("pragma_quick_check", () => db.prepare("PRAGMA quick_check").all()));
timings.push(timed("pragma_foreign_key_check", () => db.prepare("PRAGMA foreign_key_check").all()));
if (exists("feature_rtree")) timings.push(timed("rtreecheck", () => db.prepare("SELECT rtreecheck('feature_rtree') AS result").get()));

console.log(JSON.stringify({ path, sizeBytes: statSync(path).size, counts, featureKinds, sourceStats, checksums, timings }, null, 2));
db.close();
