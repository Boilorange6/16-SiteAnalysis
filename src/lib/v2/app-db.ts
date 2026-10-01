/**
 * v2 앱 DB — 분석 실행·타일 결과·저장 프로젝트 (spec §3.2, §5.2).
 * 기존 .cache/site-analysis.db와 다른 파일이다. 교체 대상이 아니다.
 * ponytail: 사용자 계정은 P1에서 기존 로그인과 연결할 때 붙인다. P0는 로컬 단일 사용자.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { readArchivedManifest, withDataDirLock } from "./data/manifest";
import { v2AppDbPath } from "./paths";
import { parseScene, type Scene } from "./scene";
import { parseTileResult, type TileResult } from "./tile-result";

type Db = BetterSqlite3.Database;

export const V2_APP_SCHEMA_VERSION = 2;

export interface AnalysisRunInput {
  analysisId: string;
  address: string;
  center: readonly [number, number];
  radiusM: number;
  analysisDate: string;
  manifestHash: string;
  engineVersion: string;
  parameters: Record<string, unknown>;
  userId?: string | number | null;
}

export function openV2AppDb(path: string = v2AppDbPath()): Db {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  initV2AppSchema(db);
  return db;
}

export function initV2AppSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS analysis_run (
      analysis_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      center_lng REAL NOT NULL,
      center_lat REAL NOT NULL,
      radius_m REAL NOT NULL,
      analysis_date TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      engine_version TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      user_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('running','complete','failed')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_scene (
      analysis_id TEXT PRIMARY KEY REFERENCES analysis_run(analysis_id),
      version TEXT NOT NULL,
      scene_gz BLOB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tile_result (
      tile_id TEXT PRIMARY KEY,
      analysis_id TEXT NOT NULL REFERENCES analysis_run(analysis_id),
      tile_code TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (analysis_id, tile_code)
    );
    CREATE INDEX IF NOT EXISTS idx_tile_result_cache ON tile_result (cache_key);

    CREATE TABLE IF NOT EXISTS saved_project (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      analysis_id TEXT NOT NULL REFERENCES analysis_run(analysis_id),
      board_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const analysisColumns = db.prepare("PRAGMA table_info(analysis_run)").all() as Array<{ name: string }>;
  if (!analysisColumns.some((column) => column.name === "user_id")) {
    db.exec("ALTER TABLE analysis_run ADD COLUMN user_id TEXT");
  }
  db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(V2_APP_SCHEMA_VERSION));
}

const now = () => new Date().toISOString();

export function createAnalysisRun(db: Db, r: AnalysisRunInput): void {
  db.prepare(`INSERT INTO analysis_run (analysis_id, address, center_lng, center_lat, radius_m, analysis_date, manifest_hash, engine_version, parameters_json, user_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`)
    .run(r.analysisId, r.address, r.center[0], r.center[1], r.radiusM, r.analysisDate, r.manifestHash, r.engineVersion, JSON.stringify(r.parameters), r.userId == null ? null : String(r.userId), now());
}

export function finishAnalysisRun(db: Db, analysisId: string, status: "complete" | "failed"): void {
  db.prepare("UPDATE analysis_run SET status = ? WHERE analysis_id = ?").run(status, analysisId);
}

interface RunRow {
  analysis_id: string; address: string; center_lng: number; center_lat: number; radius_m: number;
  analysis_date: string; manifest_hash: string; engine_version: string; parameters_json: string; user_id: string | null; status: string;
}

export function getAnalysisRun(db: Db, analysisId: string): (AnalysisRunInput & { status: string }) | null {
  const row = db.prepare("SELECT * FROM analysis_run WHERE analysis_id = ?").get(analysisId) as RunRow | undefined;
  if (!row) return null;
  return {
    analysisId: row.analysis_id,
    address: row.address,
    center: [row.center_lng, row.center_lat],
    radiusM: row.radius_m,
    analysisDate: row.analysis_date,
    manifestHash: row.manifest_hash,
    engineVersion: row.engine_version,
    parameters: JSON.parse(row.parameters_json) as Record<string, unknown>,
    userId: row.user_id === null ? null : row.user_id,
    status: row.status,
  };
}

export function saveTileResult(db: Db, result: TileResult, cacheKey: string): void {
  const parsed = parseTileResult(result);
  const run = getAnalysisRun(db, parsed.analysisId);
  if (!run) throw new Error(`unknown analysis ${parsed.analysisId}`);
  if (run.manifestHash !== parsed.provenance.manifestHash) {
    throw new Error(`MANIFEST_HASH_MISMATCH: analysis ${run.manifestHash}, tile ${parsed.provenance.manifestHash}`);
  }
  db.prepare(`INSERT INTO tile_result (tile_id, analysis_id, tile_code, cache_key, status, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(analysis_id, tile_code) DO UPDATE SET tile_id = excluded.tile_id, cache_key = excluded.cache_key,
      status = excluded.status, result_json = excluded.result_json, created_at = excluded.created_at`)
    .run(parsed.tileId, parsed.analysisId, parsed.tileCode, cacheKey, parsed.status, JSON.stringify(parsed), now());
}

/** 같은 캐시 키로 이미 계산된 가장 최근 결과(실패한 타일은 재사용하지 않는다) */
export function findCachedTileResult(db: Db, cacheKey: string): TileResult | null {
  const json = db
    .prepare("SELECT result_json FROM tile_result WHERE cache_key = ? AND status NOT IN ('failed','pending','running') ORDER BY created_at DESC LIMIT 1")
    .pluck()
    .get(cacheKey) as string | undefined;
  return json ? parseTileResult(JSON.parse(json)) : null;
}

export function loadTileResults(db: Db, analysisId: string): TileResult[] {
  const rows = db.prepare("SELECT result_json FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").pluck().all(analysisId) as string[];
  return rows.map((json) => parseTileResult(JSON.parse(json)));
}

export function saveScene(db: Db, scene: Scene): void {
  const parsed = parseScene(scene);
  db.prepare(`INSERT INTO analysis_scene (analysis_id, version, scene_gz, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(analysis_id) DO UPDATE SET version = excluded.version, scene_gz = excluded.scene_gz, created_at = excluded.created_at`)
    .run(parsed.analysisId, parsed.version, gzipSync(JSON.stringify(parsed)), now());
}

interface SceneRow {
  scene_gz: Buffer;
}

export function loadScene(db: Db, analysisId: string): Scene | null {
  const row = db.prepare("SELECT scene_gz FROM analysis_scene WHERE analysis_id = ?").get(analysisId) as SceneRow | undefined;
  if (!row) return null;
  return parseScene(JSON.parse(gunzipSync(row.scene_gz).toString("utf8")));
}

/**
 * 잠금 안에서 저장한다: 실행이 쓴 데이터 버전이 이미 수집됐으면 DATA_VERSION_GONE.
 * (그대로 저장하면 이후 모든 GC가 MISSING_PINNED_MANIFEST로 멈춘다.)
 */
export async function saveProject(db: Db, dataDir: string, p: { projectId: string; name: string; analysisId: string; board: unknown }): Promise<void> {
  await withDataDirLock(dataDir, () => {
    const run = getAnalysisRun(db, p.analysisId);
    if (!run) throw new Error(`unknown analysis ${p.analysisId}`);
    if (!readArchivedManifest(dataDir, run.manifestHash)) {
      throw new Error(`DATA_VERSION_GONE: data version ${run.manifestHash} of analysis ${p.analysisId} was already collected`);
    }
    insertProject(db, p);
  });
}

function insertProject(db: Db, p: { projectId: string; name: string; analysisId: string; board: unknown }): void {
  const t = now();
  db.prepare(`INSERT INTO saved_project (project_id, name, analysis_id, board_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET name = excluded.name, analysis_id = excluded.analysis_id, board_json = excluded.board_json, updated_at = excluded.updated_at`)
    .run(p.projectId, p.name, p.analysisId, JSON.stringify(p.board), t, t);
}

export function pinnedManifestHashes(db: Db): Set<string> {
  const rows = db
    .prepare(`SELECT r.manifest_hash FROM saved_project p JOIN analysis_run r ON r.analysis_id = p.analysis_id
      UNION SELECT manifest_hash FROM analysis_run WHERE status = 'running' AND datetime(created_at) > datetime('now', '-2 hours')`)
    .pluck()
    .all() as string[];
  return new Set(rows);
}
