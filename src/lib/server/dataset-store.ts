/**
 * 전국 배치 적재 저장소.
 *
 * 실시간 API 조회를 DB 적재로 바꾸면 상류 장애가 조용해진다.
 * 2026-08-05에 건축물대장 응답 기본 포맷이 XML→JSON으로 바뀌어 전국 주거 POI가
 * 통째로 0건이 됐는데 HTTP 200이라 아무 경고도 없었다. 매 요청이 실시간 조회였기에
 * QA에서 겨우 잡혔지, 배치였다면 0건이 그대로 적재됐을 것이다.
 *
 * 그래서 적재는 세 가지를 보장한다.
 *   1. 원자적 교체 — staging에 다 채우고 성공했을 때만 한 트랜잭션으로 교체
 *   2. 급감 거부  — 직전 대비 30% 넘게 줄면 거부하고 기존 데이터를 지킨다
 *   3. 적재 이력  — 마지막 성공 시각/건수/상태를 남겨 신뢰 표시에 쓴다
 */
import type BetterSqlite3 from "better-sqlite3";

type Db = BetterSqlite3.Database;

/** 직전 적재 대비 이 비율을 넘게 줄면 상류 장애로 보고 거부한다 */
export const DROP_REJECT_RATIO = 0.3;

export interface DatasetSpec {
  /** ingest_run 키 */
  dataset: string;
  /** 실제 테이블명 (staging은 `${table}_staging`) */
  table: string;
  columns: readonly string[];
}

export const PLANNED_HOUSING_SPEC: DatasetSpec = {
  dataset: "planned_housing",
  table: "planned_housing",
  columns: [
    "id", "name", "address", "area_name", "kind", "units",
    "sale_date", "move_in_month", "homepage_url", "notice_url", "lat", "lng",
  ],
};

export const LEDGER_BUILDING_SPEC: DatasetSpec = {
  dataset: "ledger_building",
  table: "ledger_building",
  columns: [
    "id", "sigungu_cd", "bjdong_cd", "name", "address",
    "units", "parking", "max_floor", "use_apr_day", "bun", "ji", "lat", "lng",
  ],
};

const SPECS = [PLANNED_HOUSING_SPEC, LEDGER_BUILDING_SPEC];

/** 테이블명은 내부 상수에서만 온다. 동적 SQL을 쓰므로 화이트리스트로 한 번 더 막는다. */
function assertKnownSpec(spec: DatasetSpec): void {
  if (!SPECS.some((s) => s.table === spec.table && s.dataset === spec.dataset)) {
    throw new Error(`unknown dataset spec: ${spec.dataset}`);
  }
}

export function shouldRejectIngest(previousCount: number, nextCount: number): boolean {
  if (nextCount <= 0) return true;
  if (previousCount <= 0) return false;
  return nextCount < previousCount * (1 - DROP_REJECT_RATIO);
}

export function initDatasetSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS planned_housing (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      area_name TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'apartment',
      units INTEGER NOT NULL DEFAULT 0,
      sale_date TEXT NOT NULL DEFAULT '',
      move_in_month TEXT NOT NULL DEFAULT '',
      homepage_url TEXT NOT NULL DEFAULT '',
      notice_url TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL
    );
    CREATE INDEX IF NOT EXISTS idx_planned_housing_bbox ON planned_housing (lat, lng);

    CREATE TABLE IF NOT EXISTS ledger_building (
      id TEXT PRIMARY KEY,
      sigungu_cd TEXT NOT NULL DEFAULT '',
      bjdong_cd TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      units INTEGER NOT NULL DEFAULT 0,
      parking INTEGER NOT NULL DEFAULT 0,
      max_floor INTEGER NOT NULL DEFAULT 0,
      use_apr_day TEXT NOT NULL DEFAULT '',
      bun TEXT NOT NULL DEFAULT '',
      ji TEXT NOT NULL DEFAULT '',
      lat REAL,
      lng REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_building_bbox ON ledger_building (lat, lng);
    CREATE INDEX IF NOT EXISTS idx_ledger_building_dong ON ledger_building (sigungu_cd, bjdong_cd);

    CREATE TABLE IF NOT EXISTS ledger_dong_sync (
      sigungu_cd TEXT NOT NULL,
      bjdong_cd TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (sigungu_cd, bjdong_cd)
    );

    CREATE TABLE IF NOT EXISTS ingest_run (
      dataset TEXT PRIMARY KEY,
      last_success_at INTEGER,
      last_attempt_at INTEGER,
      row_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS geocode_cache (
      address TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      created_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS geocode_miss (
      address TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 1,
      last_attempt_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS legalcode_cache (
      coord_key TEXT PRIMARY KEY,
      sigungu_cd TEXT NOT NULL,
      bjdong_cd TEXT NOT NULL,
      area_name TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL
    );
  `);
}

function stagingTable(spec: DatasetSpec): string {
  return `${spec.table}_staging`;
}

/** staging 테이블을 본 테이블과 같은 스키마로 새로 만든다 */
export function beginStaging(db: Db, spec: DatasetSpec): void {
  assertKnownSpec(spec);
  const staging = stagingTable(spec);
  db.exec(`DROP TABLE IF EXISTS ${staging}`);
  db.exec(`CREATE TABLE ${staging} AS SELECT * FROM ${spec.table} WHERE 0`);
}

export function appendStaging(db: Db, spec: DatasetSpec, rows: ReadonlyArray<Record<string, unknown>>): number {
  assertKnownSpec(spec);
  if (rows.length === 0) return 0;
  const staging = stagingTable(spec);
  const cols = spec.columns.join(", ");
  const placeholders = spec.columns.map((c) => `@${c}`).join(", ");
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${staging} (${cols}) VALUES (${placeholders})`);

  const insertAll = db.transaction((items: ReadonlyArray<Record<string, unknown>>) => {
    for (const item of items) {
      const bound: Record<string, unknown> = {};
      for (const col of spec.columns) {
        const value = item[col];
        bound[col] = value === undefined ? null : value;
      }
      stmt.run(bound);
    }
  });
  insertAll(rows);
  return rows.length;
}

export interface IngestResult {
  status: "ok" | "rejected";
  rowCount: number;
  previousCount: number;
  message?: string;
}

function countRows(db: Db, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

function writeIngestRun(
  db: Db,
  dataset: string,
  patch: { lastSuccessAt?: number; lastAttemptAt: number; rowCount: number; status: string; message: string },
): void {
  const existing = db.prepare("SELECT last_success_at FROM ingest_run WHERE dataset = ?").get(dataset) as
    | { last_success_at: number | null }
    | undefined;
  const lastSuccess = patch.lastSuccessAt ?? existing?.last_success_at ?? null;
  db.prepare(
    `INSERT INTO ingest_run (dataset, last_success_at, last_attempt_at, row_count, status, message)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(dataset) DO UPDATE SET
       last_success_at = excluded.last_success_at,
       last_attempt_at = excluded.last_attempt_at,
       row_count = excluded.row_count,
       status = excluded.status,
       message = excluded.message`,
  ).run(dataset, lastSuccess, patch.lastAttemptAt, patch.rowCount, patch.status, patch.message);
}

/**
 * staging을 본 테이블로 교체한다.
 * 급감이면 교체하지 않고 기존 데이터를 그대로 둔다.
 */
export function commitStaging(db: Db, spec: DatasetSpec, now: number): IngestResult {
  assertKnownSpec(spec);
  const staging = stagingTable(spec);
  const previousCount = countRows(db, spec.table);
  const nextCount = countRows(db, staging);

  if (shouldRejectIngest(previousCount, nextCount)) {
    const message =
      `적재 거부: ${previousCount}건 → ${nextCount}건 ` +
      `(${Math.round(DROP_REJECT_RATIO * 100)}% 초과 급감). 상류 응답 형식 변경이나 장애를 의심할 것.`;
    writeIngestRun(db, spec.dataset, {
      lastAttemptAt: now,
      rowCount: previousCount,
      status: "rejected",
      message,
    });
    db.exec(`DROP TABLE IF EXISTS ${staging}`);
    return { status: "rejected", rowCount: nextCount, previousCount, message };
  }

  const swap = db.transaction(() => {
    db.exec(`DELETE FROM ${spec.table}`);
    const cols = spec.columns.join(", ");
    db.exec(`INSERT INTO ${spec.table} (${cols}) SELECT ${cols} FROM ${staging}`);
  });
  swap();
  db.exec(`DROP TABLE IF EXISTS ${staging}`);

  writeIngestRun(db, spec.dataset, {
    lastSuccessAt: now,
    lastAttemptAt: now,
    rowCount: nextCount,
    status: "ok",
    message: "",
  });
  return { status: "ok", rowCount: nextCount, previousCount };
}

export interface IngestRun {
  dataset: string;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  rowCount: number;
  status: string;
  message: string;
}

export function readIngestRun(db: Db, dataset: string): IngestRun | null {
  const row = db.prepare("SELECT * FROM ingest_run WHERE dataset = ?").get(dataset) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    dataset: String(row["dataset"]),
    lastSuccessAt: row["last_success_at"] === null ? null : Number(row["last_success_at"]),
    lastAttemptAt: row["last_attempt_at"] === null ? null : Number(row["last_attempt_at"]),
    rowCount: Number(row["row_count"] ?? 0),
    status: String(row["status"] ?? ""),
    message: String(row["message"] ?? ""),
  };
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function queryDatasetInBbox(db: Db, spec: DatasetSpec, bbox: Bbox): Array<Record<string, unknown>> {
  assertKnownSpec(spec);
  return db
    .prepare(
      `SELECT * FROM ${spec.table}
       WHERE lat IS NOT NULL AND lng IS NOT NULL
         AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    )
    .all(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng) as Array<Record<string, unknown>>;
}

/** 중심 좌표와 반경(m)으로 bbox를 만든다 */
export function bboxFromRadius(lat: number, lng: number, radiusM: number): Bbox {
  const latDeg = radiusM / 111_000;
  const lngDeg = radiusM / (111_000 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return {
    minLat: lat - latDeg,
    maxLat: lat + latDeg,
    minLng: lng - lngDeg,
    maxLng: lng + lngDeg,
  };
}
