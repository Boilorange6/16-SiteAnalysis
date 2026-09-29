/**
 * 데이터 파일 스키마 테스트.
 * PNU를 숫자로 저장하면 19자리가 깨지고, 높이를 0으로 채우면 "모름"과 "0m"가 섞인다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema, readDataFileMeta, DATA_SCHEMA_VERSION, DATA_FILE_KINDS } = await import("../../lib/v2/data/schema.ts");

function tables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all().map((r) => r.name));
}

function seedRelease(db) {
  db.prepare(`INSERT INTO source_release (release_id, source_id, provider, source_url, fetched_at, checksum, schema_version, license_code)
    VALUES ('r1','gis_building','국토교통부','https://www.data.go.kr/data/15083092/fileData.do','2026-09-29T00:00:00+09:00','abc',1,'KOGL-1')`).run();
}

// ─── 1. 종류별 테이블 ──────────────────────────────────────────────────────
{
  assert.deepEqual([...DATA_FILE_KINDS], ["core", "reference", "market", "osm"]);
  for (const kind of DATA_FILE_KINDS) {
    const db = new Database(":memory:");
    initDataFileSchema(db, kind);
    const t = tables(db);
    for (const common of ["data_file_meta", "source_release", "ingest_run", "feature", "feature_link", "observation"]) {
      assert.ok(t.has(common), `${kind}: ${common}`);
    }
    assert.ok(t.has("feature_rtree"), `${kind}: R*Tree`);
    assert.equal(t.has("building_fact"), kind === "core", `${kind}: building_fact`);
    assert.equal(t.has("property_transaction"), kind === "market", `${kind}: property_transaction`);
    assert.equal(t.has("development_event"), kind === "market", `${kind}: development_event`);
    assert.deepEqual(readDataFileMeta(db), { kind, schemaVersion: DATA_SCHEMA_VERSION });
    initDataFileSchema(db, kind); // 두 번 불러도 안전
  }
}

// ─── 2. 다른 종류로 다시 초기화하면 거부 ────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  assert.throws(() => initDataFileSchema(db, "market"), /already initialized as core/);
}

// ─── 3. PNU는 문자열 그대로, 높이 미상은 NULL ───────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "core");
  seedRelease(db);
  db.prepare(`INSERT INTO feature (stable_id, kind, source_key, release_id, geom_json, pnu) VALUES ('b1','building','k1','r1','{}','1168010100100010000')`).run();
  const row = db.prepare("SELECT pnu, typeof(pnu) AS t FROM feature WHERE stable_id='b1'").get();
  assert.equal(row.pnu, "1168010100100010000");
  assert.equal(row.t, "text");

  const id = db.prepare("SELECT feature_id FROM feature WHERE stable_id='b1'").get().feature_id;
  db.prepare("INSERT INTO building_fact (feature_id, height_method) VALUES (?, 'unknown')").run(id);
  const fact = db.prepare("SELECT height_m, floors_above, approval_date FROM building_fact WHERE feature_id=?").get(id);
  assert.deepEqual(fact, { height_m: null, floors_above: null, approval_date: null }, "미상은 NULL");
  assert.throws(() => db.prepare("INSERT INTO building_fact (feature_id, height_method) VALUES (?, 'guess')").run(id + 1), /CHECK/);
}

// ─── 4. value_status 제약 ──────────────────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "reference");
  seedRelease(db);
  const ins = db.prepare(`INSERT INTO observation (subject_id, metric, period_start, period_end, value, unit, value_status, release_id, method_version)
    VALUES ('g1','population','2025-01-01','2025-12-31',?,'명',?,'r1','sgis@1')`);
  ins.run(null, "suppressed");
  assert.throws(() => ins.run(0, "zero"), /CHECK/);
}

// ─── 5. ingest_run 상태 제약 ───────────────────────────────────────────────
{
  const db = new Database(":memory:");
  initDataFileSchema(db, "market");
  assert.throws(
    () => db.prepare("INSERT INTO ingest_run (run_id, source_id, started_at, status) VALUES ('x','rtms','2026-09-29T00:00:00+09:00','ok')").run(),
    /CHECK/,
  );
}

console.log("✓ v2 data schema");
