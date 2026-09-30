/**
 * v2 데이터 파일 스키마 (spec §3.2~3.3).
 *
 * 데이터 파일은 로컬 PC에서 만들어 읽기 전용으로 게시한다. 파일 하나가 한 종류(core/reference/market/osm)다.
 * geom_json은 EPSG:5179 미터 좌표의 GeoJSON geometry다.
 * ponytail: WKB 대신 GeoJSON 텍스트 — 파일 크기가 커진다. A0 실측에서 core가 디스크 예산을 넘으면 WKB로 바꾼다.
 */
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

export type DataFileKind = "core" | "buildings" | "reference" | "market" | "osm";
export const DATA_FILE_KINDS: readonly DataFileKind[] = ["core", "buildings", "reference", "market", "osm"];
export const DATA_SCHEMA_VERSION = 2;
export const VALUE_STATUSES = ["observed", "estimated", "suppressed", "missing", "not_applicable"] as const;

const statusList = VALUE_STATUSES.map((s) => `'${s}'`).join(",");

const COMMON_SQL = `
  CREATE TABLE IF NOT EXISTS data_file_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_release (
    release_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_as_of TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    checksum TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    license_code TEXT NOT NULL,
    rights_json TEXT NOT NULL DEFAULT '{}',
    coverage_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS ingest_run (
    run_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    partition_key TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running','succeeded','rejected','failed')),
    expected_count INTEGER,
    received_count INTEGER NOT NULL DEFAULT 0,
    accepted_count INTEGER NOT NULL DEFAULT 0,
    rejected_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    release_id TEXT REFERENCES source_release(release_id),
    snapshot_json TEXT
  );

  CREATE TABLE IF NOT EXISTS feature (
    feature_id INTEGER PRIMARY KEY,
    stable_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    source_key TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id),
    geom_json TEXT NOT NULL,
    name TEXT,
    pnu TEXT,
    legal_code TEXT,
    properties_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_feature_kind ON feature (kind);
  CREATE INDEX IF NOT EXISTS idx_feature_pnu ON feature (pnu);

  CREATE VIRTUAL TABLE IF NOT EXISTS feature_rtree USING rtree(feature_id, min_x, max_x, min_y, max_y);

  CREATE TABLE IF NOT EXISTS feature_link (
    from_stable_id TEXT NOT NULL,
    to_stable_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    method TEXT NOT NULL,
    confidence REAL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id),
    valid_from TEXT,
    valid_to TEXT,
    PRIMARY KEY (from_stable_id, to_stable_id, relation_type)
  );

  CREATE TABLE IF NOT EXISTS observation (
    subject_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    value REAL,
    unit TEXT NOT NULL,
    value_status TEXT NOT NULL CHECK (value_status IN (${statusList})),
    release_id TEXT NOT NULL REFERENCES source_release(release_id),
    method_version TEXT NOT NULL,
    PRIMARY KEY (subject_id, metric, period_start, release_id)
  );
`;

/** 건물 도형(약 1,500만 동)은 core를 키우므로 별도 파일에 둔다. building_fact는 이 파일에만 만든다(옛 core 파일에는 남아 있을 수 있다). */
const BUILDINGS_SQL = `
  CREATE TABLE IF NOT EXISTS building_fact (
    feature_id INTEGER PRIMARY KEY REFERENCES feature(feature_id),
    ledger_pk TEXT,
    complex_id TEXT,
    height_m REAL,
    height_method TEXT NOT NULL CHECK (height_method IN ('source','floors_estimate','user','unknown')),
    floors_above INTEGER,
    floors_below INTEGER,
    use_code TEXT,
    approval_date TEXT,
    gross_floor_area_m2 REAL,
    footprint_area_m2 REAL,
    field_provenance_json TEXT NOT NULL DEFAULT '{}'
  );
`;

const CORE_SQL = `
  CREATE TABLE IF NOT EXISTS parcel_point (
    pnu TEXT PRIMARY KEY,
    lng REAL NOT NULL,
    lat REAL NOT NULL,
    jimok TEXT,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS legal_area (
    code TEXT PRIMARY KEY,
    level TEXT NOT NULL CHECK (level IN ('sigungu','emd','ri')),
    name TEXT NOT NULL,
    parent_code TEXT,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  );
  CREATE INDEX IF NOT EXISTS idx_legal_area_parent ON legal_area (parent_code, level);
`;

const MARKET_SQL = `
  CREATE TABLE IF NOT EXISTS property_transaction (
    transaction_id TEXT PRIMARY KEY,
    source_record_key TEXT NOT NULL,
    lawd_cd TEXT NOT NULL,
    deal_date TEXT NOT NULL,
    property_type TEXT NOT NULL,
    contract_type TEXT NOT NULL,
    price_krw INTEGER,
    deposit_krw INTEGER,
    rent_krw INTEGER,
    area_m2 REAL,
    floor INTEGER,
    cancelled_at TEXT,
    location_id TEXT,
    match_status TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tx_lawd_date ON property_transaction (lawd_cd, deal_date);

  CREATE TABLE IF NOT EXISTS development_event (
    event_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    stage TEXT NOT NULL,
    effective_date TEXT,
    planned_date TEXT,
    planned_date_precision TEXT NOT NULL CHECK (planned_date_precision IN ('day','month','half','year','unknown')),
    units INTEGER,
    geometry_id TEXT,
    evidence_url TEXT NOT NULL,
    release_id TEXT NOT NULL REFERENCES source_release(release_id)
  );
  CREATE INDEX IF NOT EXISTS idx_devevent_project ON development_event (project_id);
`;

export function initDataFileSchema(db: Db, kind: DataFileKind): void {
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='data_file_meta'").get() !== undefined;
  const existing = hasMeta
    ? (db.prepare("SELECT value FROM data_file_meta WHERE key='kind'").pluck().get() as string | undefined)
    : undefined;
  if (existing !== undefined && existing !== kind) {
    throw new Error(`data file already initialized as ${existing}`);
  }
  if (existing !== undefined) {
    const stored = db.prepare("SELECT value FROM data_file_meta WHERE key='schema_version'").pluck().get() as string | undefined;
    if (stored !== undefined && Number(stored) !== DATA_SCHEMA_VERSION) {
      throw new Error(`data file schema version ${stored} != ${DATA_SCHEMA_VERSION}; rebuild the data file`);
    }
  }
  db.exec(COMMON_SQL);
  if (kind === "core") db.exec(CORE_SQL);
  if (kind === "buildings") db.exec(BUILDINGS_SQL);
  if (kind === "market") db.exec(MARKET_SQL);
  const upsert = db.prepare("INSERT INTO data_file_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  upsert.run("kind", kind);
  upsert.run("schema_version", String(DATA_SCHEMA_VERSION));
}

export function readDataFileMeta(db: Db): { kind: DataFileKind; schemaVersion: number } {
  const rows = db.prepare("SELECT key, value FROM data_file_meta").all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const kind = map.get("kind");
  if (!kind || !(DATA_FILE_KINDS as readonly string[]).includes(kind)) throw new Error("data file has no valid kind");
  return { kind: kind as DataFileKind, schemaVersion: Number(map.get("schema_version")) };
}
