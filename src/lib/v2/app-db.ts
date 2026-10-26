/**
 * v2 앱 DB — 분석 실행·타일 결과·저장 프로젝트 (spec §3.2, §5.2).
 * 기존 .cache/site-analysis.db와 다른 파일이다. 교체 대상이 아니다.
 * saved_project.user_id는 기존 로그인 User.id를 TEXT로 보존해 분석·프로젝트 소유권을 함께 검사한다.
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
import { parseSiteInput, type SiteInput } from "./site";

type Db = BetterSqlite3.Database;

export const V2_APP_SCHEMA_VERSION = 3;

export type AnalysisJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type AnalysisJob = {
  analysisId: string;
  code: string;
  status: AnalysisJobStatus;
  priority: number;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number | null;
  error: string | null;
  cancelledAt: string | null;
};

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
      created_at TEXT NOT NULL,
      cancelled_at TEXT,
      refresh_requested_at TEXT
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
      user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tile_request (
      request_id INTEGER PRIMARY KEY,
      tile_code TEXT NOT NULL,
      analysis_id TEXT,
      memo TEXT NOT NULL,
      pins_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      image_path TEXT,
      status TEXT NOT NULL CHECK (status IN ('대기','진행','완료','보류')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_commit TEXT,
      resolved_note TEXT,
      resolved_at TEXT,
      reopen_note TEXT,
      user_id TEXT
    );
  `);
  const analysisColumns = db.prepare("PRAGMA table_info(analysis_run)").all() as Array<{ name: string }>;
  if (!analysisColumns.some((column) => column.name === "user_id")) {
    db.exec("ALTER TABLE analysis_run ADD COLUMN user_id TEXT");
  }
  if (!analysisColumns.some((column) => column.name === "cancelled_at")) {
    db.exec("ALTER TABLE analysis_run ADD COLUMN cancelled_at TEXT");
  }
  if (!analysisColumns.some((column) => column.name === "refresh_requested_at")) {
    db.exec("ALTER TABLE analysis_run ADD COLUMN refresh_requested_at TEXT");
  }
  const savedProjectColumns = db.prepare("PRAGMA table_info(saved_project)").all() as Array<{ name: string }>;
  if (!savedProjectColumns.some((column) => column.name === "user_id")) {
    db.exec("ALTER TABLE saved_project ADD COLUMN user_id TEXT");
  }
  // v2의 소유자 없는 저장본은 참조 중인 분석의 소유자를 그대로 상속한다.
  // 분석도 익명인 오래된 P0 저장본은 null로 남겨 새 사용자에게 노출하지 않는다.
  db.exec(`UPDATE saved_project
    SET user_id = (SELECT user_id FROM analysis_run WHERE analysis_run.analysis_id = saved_project.analysis_id)
    WHERE user_id IS NULL`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_saved_project_owner_updated ON saved_project (user_id, updated_at DESC)");
  db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(V2_APP_SCHEMA_VERSION));
  ensureAnalysisJobTable(db);
}

/** P4 작업 큐. 기존 앱 DB에도 CREATE IF NOT EXISTS로 붙인다. */
export function ensureAnalysisJobTable(db: Db): void {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'analysis_job'").pluck().get() as string | undefined;
  const columns = existing === undefined ? new Set<string>() : new Set((db.prepare("PRAGMA table_info(analysis_job)").all() as Array<{ name: string }>).map((column) => column.name));
  const needsMigration = existing !== undefined && (!/cancelled/.test(existing) || !columns.has("cancel_requested_at"));
  if (needsMigration) {
    db.exec("DROP INDEX IF EXISTS idx_analysis_job_queue");
    db.exec("ALTER TABLE analysis_job RENAME TO analysis_job_legacy");
    db.exec(`
      CREATE TABLE analysis_job (
        analysis_id TEXT NOT NULL REFERENCES analysis_run(analysis_id),
        tile_code TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        enqueued_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        elapsed_ms REAL,
        error TEXT,
        cancel_requested_at TEXT,
        PRIMARY KEY (analysis_id, tile_code)
      );
    `);
    const cancelColumn = columns.has("cancel_requested_at") ? "cancel_requested_at" : "NULL";
    db.exec(`INSERT INTO analysis_job
      (analysis_id, tile_code, status, priority, enqueued_at, started_at, finished_at, elapsed_ms, error, cancel_requested_at)
      SELECT analysis_id, tile_code, status, priority, enqueued_at, started_at, finished_at, elapsed_ms, error, ${cancelColumn}
      FROM analysis_job_legacy`);
    db.exec("DROP TABLE analysis_job_legacy");
  } else {
    db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_job (
      analysis_id TEXT NOT NULL REFERENCES analysis_run(analysis_id),
      tile_code TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
      priority INTEGER NOT NULL DEFAULT 0,
      enqueued_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      elapsed_ms REAL,
      error TEXT,
      cancel_requested_at TEXT,
      PRIMARY KEY (analysis_id, tile_code)
    );
  `);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_analysis_job_queue ON analysis_job (status, priority, enqueued_at)");
}

/** 분석별 수치지형도 업로드 메타데이터. 실제 topo SQLite는 분석 자료 폴더에 따로 둔다. */
export function ensureTopoUploadTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topo_upload (
      topo_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      db_path TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, sha256)
    );
  `);
}

const now = () => new Date().toISOString();

export function createAnalysisRun(db: Db, r: AnalysisRunInput): void {
  db.prepare(`INSERT INTO analysis_run (analysis_id, address, center_lng, center_lat, radius_m, analysis_date, manifest_hash, engine_version, parameters_json, user_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`)
    .run(r.analysisId, r.address, r.center[0], r.center[1], r.radiusM, r.analysisDate, r.manifestHash, r.engineVersion, JSON.stringify(r.parameters), r.userId == null ? null : String(r.userId), now());
}

export function enqueueAnalysisJobs(db: Db, analysisId: string, codes: readonly string[]): void {
  ensureAnalysisJobTable(db);
  const insert = db.prepare(`
    INSERT INTO analysis_job (analysis_id, tile_code, status, priority, enqueued_at)
    VALUES (?, ?, 'queued', ?, ?)
    ON CONFLICT(analysis_id, tile_code) DO NOTHING
  `);
  const enqueue = db.transaction((items: readonly string[]) => {
    const at = now();
    items.forEach((code, priority) => insert.run(analysisId, code, priority, at));
  });
  enqueue(codes);
}

export type RefreshAnalysisRunResult =
  | { ok: true; analysisId: string; queued: string[] }
  | { ok: false; reason: "not_found" | "active" };

/**
 * 같은 analysisId의 manifest/엔진 메타데이터를 교체하고 stale job을 재큐잉한다.
 * 소유권과 stale 판정은 API 계층에서 처리하지만, active 확인과 갱신은 한 트랜잭션으로 묶는다.
 */
export function refreshAnalysisRun(db: Db, analysisId: string, manifestHash: string, engineVersion: string, codes: readonly string[]): RefreshAnalysisRunResult {
  ensureAnalysisJobTable(db);
  return db.transaction(() => {
    const row = db.prepare("SELECT status, cancelled_at FROM analysis_run WHERE analysis_id = ?").get(analysisId) as { status: string; cancelled_at: string | null } | undefined;
    if (!row) return { ok: false as const, reason: "not_found" as const };
    const activeJobs = Number(db.prepare("SELECT COUNT(*) FROM analysis_job WHERE analysis_id = ? AND status IN ('queued','running')").pluck().get(analysisId));
    if (row.status === "running" || activeJobs > 0) return { ok: false as const, reason: "active" as const };

    const queued = [...codes];
    db.prepare(`UPDATE analysis_run
      SET manifest_hash = ?, engine_version = ?, status = ?, cancelled_at = NULL, refresh_requested_at = ?
      WHERE analysis_id = ?`)
      .run(manifestHash, engineVersion, queued.length > 0 ? "running" : "complete", now(), analysisId);

    if (queued.length > 0) {
      const upsert = db.prepare(`
        INSERT INTO analysis_job (analysis_id, tile_code, status, priority, enqueued_at)
        VALUES (?, ?, 'queued', ?, ?)
        ON CONFLICT(analysis_id, tile_code) DO UPDATE SET
          status = 'queued',
          priority = excluded.priority,
          enqueued_at = excluded.enqueued_at,
          started_at = NULL,
          finished_at = NULL,
          elapsed_ms = NULL,
          error = NULL,
          cancel_requested_at = NULL
      `);
      const at = now();
      queued.forEach((code, priority) => upsert.run(analysisId, code, priority, at));
    }
    return { ok: true as const, analysisId, queued };
  })();
}

export function finishAnalysisRun(db: Db, analysisId: string, status: "complete" | "failed"): void {
  db.prepare("UPDATE analysis_run SET status = ? WHERE analysis_id = ?").run(status, analysisId);
}

interface RunRow {
  analysis_id: string; address: string; center_lng: number; center_lat: number; radius_m: number;
  analysis_date: string; manifest_hash: string; engine_version: string; parameters_json: string; user_id: string | null; status: string; cancelled_at: string | null; refresh_requested_at: string | null;
}

export function getAnalysisRun(db: Db, analysisId: string): (AnalysisRunInput & { status: string; cancelledAt: string | null; refreshRequestedAt: string | null }) | null {
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
    status: row.cancelled_at === null ? row.status : "cancelled",
    cancelledAt: row.cancelled_at,
    refreshRequestedAt: row.refresh_requested_at,
  };
}

export const ANALYSIS_CANCELLED_REASON = "사용자가 취소했습니다. 다시 실행할 수 있습니다";

function markTileResultCancelled(db: Db, analysisId: string, tileCode: string, at: string): void {
  const row = db.prepare("SELECT result_json FROM tile_result WHERE analysis_id = ? AND tile_code = ?").get(analysisId, tileCode) as { result_json: string } | undefined;
  if (!row) return;
  try {
    const result = JSON.parse(row.result_json) as { status?: string; limitations?: unknown };
    result.status = "cancelled";
    const limitations = Array.isArray(result.limitations) ? result.limitations : [];
    if (!limitations.some((item) => item && typeof item === "object" && "note" in item && (item as { note?: unknown }).note === ANALYSIS_CANCELLED_REASON)) {
      limitations.push({ kind: "unknown", note: ANALYSIS_CANCELLED_REASON });
    }
    result.limitations = limitations;
    db.prepare("UPDATE tile_result SET status = 'cancelled', result_json = ?, created_at = ? WHERE analysis_id = ? AND tile_code = ?")
      .run(JSON.stringify(result), at, analysisId, tileCode);
  } catch {
    // A malformed pending result must not prevent the job state from being cancelled.
  }
}

/** Mark queued tiles cancelled and make their pending result explicitly retryable. */
export function cancelQueuedAnalysisJobs(db: Db, analysisId: string, at = now()): number {
  ensureAnalysisJobTable(db);
  const queued = db.prepare("SELECT tile_code FROM analysis_job WHERE analysis_id = ? AND status = 'queued'").all(analysisId) as Array<{ tile_code: string }>;
  if (queued.length === 0) return 0;
  db.prepare("UPDATE analysis_job SET status = 'cancelled', finished_at = ?, error = ?, cancel_requested_at = COALESCE(cancel_requested_at, ?) WHERE analysis_id = ? AND status = 'queued'")
    .run(at, ANALYSIS_CANCELLED_REASON, at, analysisId);
  for (const job of queued) markTileResultCancelled(db, analysisId, job.tile_code, at);
  return queued.length;
}

/** A worker that died after a cancellation request must not resurrect its running tile. */
export function cancelRunningAnalysisJobs(db: Db, analysisId?: string, at = now()): number {
  ensureAnalysisJobTable(db);
  const rows = db.prepare(`SELECT analysis_id, tile_code FROM analysis_job
    WHERE status = 'running' AND cancel_requested_at IS NOT NULL
      ${analysisId === undefined ? "" : "AND analysis_id = ?"}`).all(...(analysisId === undefined ? [] : [analysisId])) as Array<{ analysis_id: string; tile_code: string }>;
  if (rows.length === 0) return 0;
  const update = db.prepare("UPDATE analysis_job SET status = 'cancelled', finished_at = ?, error = ? WHERE analysis_id = ? AND tile_code = ? AND status = 'running'");
  for (const row of rows) {
    update.run(at, ANALYSIS_CANCELLED_REASON, row.analysis_id, row.tile_code);
    markTileResultCancelled(db, row.analysis_id, row.tile_code, at);
  }
  return rows.length;
}

export interface AnalysisCancellation {
  queued: number;
  running: number;
  cancelledAt: string;
}

/** Set a cancellation request. A running tile is allowed to finish; the worker stops at the next tile boundary. */
export function requestAnalysisCancellation(db: Db, analysisId: string): AnalysisCancellation | null {
  ensureAnalysisJobTable(db);
  const run = getAnalysisRun(db, analysisId);
  if (!run) return null;
  const at = now();
  const result = db.transaction(() => {
    db.prepare("UPDATE analysis_run SET cancelled_at = COALESCE(cancelled_at, ?) WHERE analysis_id = ? AND status = 'running'").run(at, analysisId);
    const running = db.prepare("UPDATE analysis_job SET cancel_requested_at = COALESCE(cancel_requested_at, ?) WHERE analysis_id = ? AND status = 'running'").run(at, analysisId).changes;
    const queued = cancelQueuedAnalysisJobs(db, analysisId, at);
    const active = Number(db.prepare("SELECT COUNT(*) FROM analysis_job WHERE analysis_id = ? AND status IN ('queued','running')").pluck().get(analysisId));
    if (active === 0) db.prepare("UPDATE analysis_run SET status = 'complete' WHERE analysis_id = ? AND cancelled_at IS NOT NULL").run(analysisId);
    const cancelledAt = db.prepare("SELECT cancelled_at FROM analysis_run WHERE analysis_id = ?").pluck().get(analysisId) as string | null;
    return { queued, running, cancelledAt: cancelledAt ?? at };
  })();
  return result;
}

export function isAnalysisCancellationRequested(db: Db, analysisId: string): boolean {
  const value = db.prepare("SELECT cancelled_at FROM analysis_run WHERE analysis_id = ?").pluck().get(analysisId) as string | null | undefined;
  return value != null;
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
    .prepare("SELECT result_json FROM tile_result WHERE cache_key = ? AND status NOT IN ('failed','cancelled','pending','running') ORDER BY created_at DESC LIMIT 1")
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
type ProjectUserId = string | number | null | undefined;
type ProjectInput = { projectId: string; name: string; analysisId: string; board: unknown; userId?: ProjectUserId };

function ownerId(userId: ProjectUserId): string | null {
  return userId == null ? null : String(userId);
}

function ownedBy(value: string | null | undefined, userId: ProjectUserId): boolean {
  return value != null && userId != null && value === String(userId);
}

function assertAnalysisOwner(run: { userId?: string | number | null }, userId: ProjectUserId): void {
  // Keep the old local-only test/fixture contract for anonymous P0 analyses.
  if (run.userId == null && userId == null) return;
  if (!ownedBy(run.userId == null ? null : String(run.userId), userId)) {
    throw new Error("PROJECT_NOT_FOUND: analysis is not owned by this user");
  }
}

function assertProjectOwner(db: Db, projectId: string, userId: ProjectUserId): void {
  const existing = db.prepare("SELECT user_id FROM saved_project WHERE project_id = ?").get(projectId) as { user_id: string | null } | undefined;
  if (!existing) return;
  if (existing.user_id == null && userId == null) return;
  if (!ownedBy(existing.user_id, userId)) throw new Error("PROJECT_NOT_FOUND: project is not owned by this user");
}

export async function saveProject(db: Db, dataDir: string, p: ProjectInput): Promise<void> {
  await withDataDirLock(dataDir, () => {
    const run = getAnalysisRun(db, p.analysisId);
    if (!run) throw new Error(`unknown analysis ${p.analysisId}`);
    assertAnalysisOwner(run, p.userId);
    assertProjectOwner(db, p.projectId, p.userId);
    if (!readArchivedManifest(dataDir, run.manifestHash)) {
      throw new Error(`DATA_VERSION_GONE: data version ${run.manifestHash} of analysis ${p.analysisId} was already collected`);
    }
    insertProject(db, p);
  });
}

function insertProject(db: Db, p: ProjectInput): void {
  const t = now();
  db.prepare(`INSERT INTO saved_project (project_id, name, analysis_id, board_json, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET name = excluded.name, analysis_id = excluded.analysis_id, board_json = excluded.board_json, updated_at = excluded.updated_at`)
    .run(p.projectId, p.name, p.analysisId, JSON.stringify(p.board), ownerId(p.userId), t, t);
}

export type SavedProject = {
  projectId: string;
  name: string;
  analysisId: string;
  board: unknown;
  userId: string | null;
  address: string;
  radiusM: number;
  analysisDate: string;
  dataVersion: string;
  engineVersion: string;
  createdAt: string;
  updatedAt: string;
  site?: SiteInput;
};

export type SavedProjectSummary = Omit<SavedProject, "board">;

type ProjectRow = {
  project_id: string;
  name: string;
  analysis_id: string;
  board_json?: string;
  user_id: string | null;
  address: string;
  radius_m: number;
  analysis_date: string;
  manifest_hash: string;
  engine_version: string;
  parameters_json: string;
  created_at: string;
  updated_at: string;
};

function projectFromRow(row: ProjectRow, board?: unknown): SavedProject {
  let site: SiteInput | undefined;
  let inputAddress: string | undefined;
  try {
    const parameters = JSON.parse(row.parameters_json) as { siteInput?: unknown; inputAddress?: unknown };
    const parsed = parseSiteInput(parameters.siteInput);
    if (parsed) site = parsed;
    if (typeof parameters.inputAddress === "string" && parameters.inputAddress.trim()) inputAddress = parameters.inputAddress.trim();
  } catch {
    // Legacy runs can contain no JSON siteInput. They remain openable as address runs.
  }
  return {
    projectId: row.project_id,
    name: row.name,
    analysisId: row.analysis_id,
    board,
    userId: row.user_id,
    address: inputAddress ?? row.address,
    radiusM: row.radius_m,
    analysisDate: row.analysis_date,
    dataVersion: row.manifest_hash,
    engineVersion: row.engine_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(site ? { site } : {}),
  };
}

const projectSelect = `SELECT p.project_id, p.name, p.analysis_id, p.board_json, p.user_id,
  r.address, r.radius_m, r.analysis_date, r.manifest_hash, r.engine_version, r.parameters_json,
  p.created_at, p.updated_at
  FROM saved_project p JOIN analysis_run r ON r.analysis_id = p.analysis_id`;

/** 저장된 보드 설정을 복원한다. board_json에 없는 새 필드는 호출자가 기본값으로 보완한다. */
export function loadProject(db: Db, projectId: string, userId?: ProjectUserId): SavedProject | null {
  const row = db.prepare(`${projectSelect} WHERE p.project_id = ?`).get(projectId) as ProjectRow | undefined;
  if (!row || (userId !== undefined && !ownedBy(row.user_id, userId))) return null;
  return projectFromRow(row, JSON.parse(row.board_json ?? "null") as unknown);
}

export function listProjects(db: Db, userId: string | number): SavedProjectSummary[] {
  const rows = db.prepare(`${projectSelect} WHERE p.user_id = ? ORDER BY p.updated_at DESC, p.project_id DESC`).all(String(userId)) as ProjectRow[];
  return rows.map((row) => {
    const project = projectFromRow(row);
    const { board: _board, ...summary } = project;
    return summary;
  });
}

export function renameProject(db: Db, projectId: string, userId: string | number, name: string): SavedProjectSummary | null {
  const result = db.prepare("UPDATE saved_project SET name = ?, updated_at = ? WHERE project_id = ? AND user_id = ?")
    .run(name, now(), projectId, String(userId));
  if (result.changes === 0) return null;
  const row = db.prepare(`${projectSelect} WHERE p.project_id = ? AND p.user_id = ?`).get(projectId, String(userId)) as ProjectRow | undefined;
  if (!row) return null;
  const project = projectFromRow(row);
  const { board: _board, ...summary } = project;
  return summary;
}

export function deleteProject(db: Db, projectId: string, userId: string | number): boolean {
  return db.prepare("DELETE FROM saved_project WHERE project_id = ? AND user_id = ?").run(projectId, String(userId)).changes > 0;
}

export function pinnedManifestHashes(db: Db): Set<string> {
  const rows = db
    .prepare(`SELECT r.manifest_hash FROM saved_project p JOIN analysis_run r ON r.analysis_id = p.analysis_id
      UNION SELECT manifest_hash FROM analysis_run WHERE status = 'running' AND cancelled_at IS NULL AND datetime(created_at) > datetime('now', '-2 hours')`)
    .pluck()
    .all() as string[];
  return new Set(rows);
}
