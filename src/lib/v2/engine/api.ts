/** API 라우트의 본체. 인증은 라우트가 하고, 여기서는 입력 검증·실행·응답 모양만 다룬다(테스트하기 쉽게 분리). */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { getAnalysisRun, loadScene, refreshAnalysisRun as updateAnalysisRun, requestAnalysisCancellation } from "../app-db";
import { readArchivedManifest, readManifest, manifestHash } from "../data/manifest";
import { v2DataDir } from "../paths";
import { DEFAULT_RADIUS_M, RADIUS_CHOICES, restoreSummary, runAnalysis } from "./run";
import { cacheKeyForRun, s03InputsHash } from "./run";
import { listJobs, type JobInfo } from "./jobs-store";
import { SITE_FAILURE_MESSAGE } from "./site";
import { parseTileResult, type TileResult } from "../tile-result";
import { TILE_CODES } from "../ui/tile-catalog";
import { ENGINE_VERSION } from "./tiles/common";

const realDate = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

const siteSchema = z.object({
  pnus: z.array(z.string().trim().regex(/^\d{19}$/, "PNU는 19자리 숫자여야 합니다")).min(1, "선택 필지는 1개 이상이어야 합니다").max(30, "선택 필지는 최대 30개까지 가능합니다").optional(),
  polygon: z.array(z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])).min(4, "다각형은 닫힌 꼭짓점 4개 이상이어야 합니다").max(501, "다각형 꼭짓점은 500개까지 가능합니다").optional(),
})
  .refine((site) => (site.pnus !== undefined) !== (site.polygon !== undefined), { message: "필지 목록 또는 다각형 중 하나만 입력해 주세요" })
  .refine((site) => site.pnus === undefined || new Set(site.pnus).size === site.pnus.length, { message: "선택 필지 목록에 중복 PNU가 있습니다", path: ["pnus"] })
  .refine((site) => site.polygon === undefined || (site.polygon[0]![0] === site.polygon.at(-1)![0] && site.polygon[0]![1] === site.polygon.at(-1)![1]), { message: "다각형의 첫 점과 끝 점이 같아야 합니다", path: ["polygon"] })
  .refine((site) => site.polygon === undefined || new Set(site.polygon.slice(0, -1).map(([lng, lat]) => `${lng},${lat}`)).size >= 3, { message: "다각형에는 서로 다른 꼭짓점이 3개 이상 필요합니다", path: ["polygon"] });

const bodySchema = z
  .object({
    address: z.string().trim().min(1).max(200).optional(),
    center: z.tuple([z.number().min(124).max(132), z.number().min(33).max(39)]).optional(),
    radiusM: z.number().default(DEFAULT_RADIUS_M),
    analysisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDate, "분석일이 올바른 날짜가 아닙니다").optional(),
    site: siteSchema.optional(),
  })
  .refine((b) => b.site !== undefined || b.address !== undefined || b.center !== undefined, { message: "주소 또는 좌표가 필요합니다(또는 대지 선택)" })
  .refine((b) => (RADIUS_CHOICES as readonly number[]).includes(b.radiusM), { message: `반경은 ${RADIUS_CHOICES.join(", ")}m 중 하나여야 합니다`, path: ["radiusM"] });

export interface ApiReply {
  status: number;
  body: Record<string, unknown>;
}

type StoredTileMetaRow = { tile_code: string; status: string; cache_key: string; created_at: string };
type StoredTileRow = StoredTileMetaRow & { result_json: string };
type TileState = { code: string; status: TileResult["status"]; revision: string; elapsedMs: number | null };
type AnalysisSnapshot = { revision: string; tiles: TileState[]; jobs: JobInfo[] };
type StatusJob = Pick<JobInfo, "code" | "status" | "elapsedMs" | "error" | "retryable" | "cancelRequestedAt">;

// `pending` can be a current, intentional result (S03 waits for the browser wind
// case); it is not an old engine/data result once its current cache key is saved.
// Failed/cancelled rows, by contrast, always need another attempt.
const STALE_RESULT_STATUSES = new Set(["failed", "cancelled", "running"]);

export type AnalysisRefreshTile = {
  code: string;
  stale: boolean;
  status: string;
  jobStatus: JobInfo["status"] | null;
  storedCacheKey: string | null;
  currentCacheKey: string | null;
  reason: string | null;
};

export type AnalysisRefreshSummary = {
  available: boolean;
  state: "fresh" | "stale" | "running" | "unavailable";
  stale: boolean | null;
  active: boolean;
  activeCodes: string[];
  canRefresh: boolean;
  dataChanged: boolean;
  engineChanged: boolean;
  analysisManifestHash: string;
  currentManifestHash: string | null;
  analysisEngineVersion: string;
  currentEngineVersion: string;
  staleCodes: string[];
  /** Public alias used by the refresh banner/API contract. */
  staleTiles: string[];
  tiles: AnalysisRefreshTile[];
  error: string | null;
};

function storedElapsed(raw: unknown): number | null {
  const value = (raw as { elapsedMs?: unknown } | null)?.elapsedMs;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTileMetadata(db: BetterSqlite3.Database, analysisId: string): StoredTileMetaRow[] {
  return db.prepare("SELECT tile_code, status, cache_key, created_at FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").all(analysisId) as StoredTileMetaRow[];
}

function readTileRows(db: BetterSqlite3.Database, analysisId: string, tileCodes?: readonly string[]): StoredTileRow[] {
  if (tileCodes === undefined) {
    return db.prepare("SELECT tile_code, status, cache_key, created_at, result_json FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").all(analysisId) as StoredTileRow[];
  }
  if (tileCodes.length === 0) return [];
  const placeholders = tileCodes.map(() => "?").join(",");
  return db.prepare(`SELECT tile_code, status, cache_key, created_at, result_json FROM tile_result WHERE analysis_id = ? AND tile_code IN (${placeholders}) ORDER BY tile_code`)
    .all(analysisId, ...tileCodes) as StoredTileRow[];
}

function analysisSnapshot(db: BetterSqlite3.Database, analysisId: string, run: { status: string }): AnalysisSnapshot {
  const jobs = listJobs(db, analysisId);
  const jobsByCode = new Map(jobs.map((job) => [job.code, job]));
  const rows = readTileMetadata(db, analysisId);
  const tiles = rows.map((row) => {
    const job = jobsByCode.get(row.tile_code);
    const revision = [row.status, row.created_at].join("|");
    return { code: row.tile_code, status: row.status as TileResult["status"], revision, elapsedMs: job?.elapsedMs ?? null };
  });
  const fingerprint = JSON.stringify({
    status: run.status,
    tiles: tiles.map(({ code, status, revision }) => ({ code, status, revision })),
    jobs,
  });
  const revision = createHash("sha256").update(fingerprint).digest("hex");
  return { revision, tiles, jobs };
}

function loadResults(db: BetterSqlite3.Database, analysisId: string, tileCodes?: readonly string[]): TileResult[] {
  const catalogCodes = new Set<string>(TILE_CODES);
  return readTileRows(db, analysisId, tileCodes).flatMap((row) => {
    const raw = JSON.parse(row.result_json);
    const result = parseTileResult(raw);
    // W1a 이전 저장 결과에는 현재 카탈로그에서 삭제된 코드가 남을 수 있다.
    // 상태 행·작업 스냅샷은 보존하되 화면 결과에서는 카탈로그 밖 타일을 숨긴다.
    if (!catalogCodes.has(result.tileCode)) return [];
    const elapsedMs = storedElapsed(raw);
    return [elapsedMs === null ? result : Object.assign(result, { elapsedMs })];
  });
}

export function postAnalysis(appDb: BetterSqlite3.Database, dataDir: string, raw: unknown, userId?: string | number | null): ApiReply {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0].message } };
  let outcome;
  const started = performance.now();
  try {
    outcome = runAnalysis(appDb, dataDir, { ...parsed.data, userId });
  } catch (e) {
    if (/no published manifest/.test((e as Error).message)) return { status: 503, body: { error: "분석 데이터가 아직 게시되지 않았습니다" } };
    return { status: 500, body: { error: "분석 중 오류가 발생했습니다" } };
  }
  if (!outcome.ok) {
    const error = outcome.reason === "site_missing_pnu" && outcome.missingPnus?.length
      ? `다음 PNU 필지 도형을 찾지 못했습니다: ${outcome.missingPnus.join(", ")}`
      : SITE_FAILURE_MESSAGE[outcome.reason];
    const status = outcome.reason === "site_data_missing" ? 503 : outcome.reason.startsWith("site_") ? 400 : 422;
    return { status, body: { error, reason: outcome.reason, ...(outcome.missingPnus ? { missingPnus: outcome.missingPnus } : {}) } };
  }
  const snapshot = analysisSnapshot(appDb, outcome.analysisId, getAnalysisRun(appDb, outcome.analysisId)!);
  return {
    status: 202,
    body: {
      analysisId: outcome.analysisId,
      status: getAnalysisRun(appDb, outcome.analysisId)?.status ?? "running",
      summary: outcome.summary,
      results: outcome.results,
      jobs: snapshot.jobs,
      tiles: snapshot.tiles,
      revision: snapshot.revision,
      timingsMs: { light: Math.max(1, Math.round(performance.now() - started)), ...outcome.timingsMs },
    },
  };
}

function canRead(run: { userId?: string | number | null }, userId?: string | number | null): boolean {
  return run.userId == null || (userId != null && run.userId === String(userId));
}

function currentManifestState(dataDir: string): { hash: string | null; error: string | null } {
  try {
    const current = readManifest(dataDir);
    if (!current) return { hash: null, error: "현재 운영 manifest가 없습니다. 데이터 게시 후 다시 시도해 주세요" };
    const hash = manifestHash(current);
    const archived = readArchivedManifest(dataDir, hash);
    if (!archived || manifestHash(archived) !== hash) {
      return { hash: null, error: "현재 운영 manifest 보관본을 찾을 수 없습니다. 데이터 게시 상태를 확인해 주세요" };
    }
    return { hash, error: null };
  } catch (error) {
    return { hash: null, error: `현재 운영 manifest를 읽을 수 없습니다: ${String(error instanceof Error ? error.message : error).slice(0, 160)}` };
  }
}

/** 엔진을 실행하지 않고 현재 manifest/cache key와 저장 tile/job 상태만 비교한다. */
export function getAnalysisRefreshSummary(appDb: BetterSqlite3.Database, id: string, dataDir: string = v2DataDir()): AnalysisRefreshSummary | null {
  const run = getAnalysisRun(appDb, id);
  if (!run) return null;
  const current = currentManifestState(dataDir);
  const jobs = listJobs(appDb, id);
  const jobsByCode = new Map(jobs.map((job) => [job.code, job]));
  const rows = new Map(readTileMetadata(appDb, id).map((row) => [row.tile_code, row]));
  const dataChanged = current.hash !== null && run.manifestHash !== current.hash;
  const runEngineChanged = run.engineVersion !== ENGINE_VERSION;
  let upstreamHash: string | null = null;
  let keyError: string | null = null;
  if (current.hash !== null) {
    try {
      upstreamHash = s03InputsHash(appDb, id);
    } catch (error) {
      keyError = `S04 cache key의 S03 입력을 확인할 수 없습니다: ${String(error instanceof Error ? error.message : error).slice(0, 160)}`;
    }
  }
  const tiles = TILE_CODES.map((code): AnalysisRefreshTile => {
    const row = rows.get(code);
    const job = jobsByCode.get(code);
    const status = row?.status ?? "missing";
    let currentCacheKey: string | null = null;
    if (current.hash !== null && keyError === null) {
      try {
        currentCacheKey = cacheKeyForRun(run, code, current.hash, code === "S04" ? upstreamHash : null, ENGINE_VERSION);
      } catch (error) {
        keyError = `cache key를 계산할 수 없습니다: ${String(error instanceof Error ? error.message : error).slice(0, 160)}`;
      }
    }
    const reason = !row
      ? "missing"
      : STALE_RESULT_STATUSES.has(status)
        ? status
        : job && job.status !== "done"
          ? `job_${job.status}`
          : runEngineChanged
            ? "engine_changed"
            : current.hash === null
              ? "manifest_unavailable"
              : currentCacheKey === null || row.cache_key !== currentCacheKey
                ? "cache_key_mismatch"
                : null;
    return {
      code,
      stale: current.hash === null || reason !== null,
      status,
      jobStatus: job?.status ?? null,
      storedCacheKey: row?.cache_key ?? null,
      currentCacheKey,
      reason,
    };
  });
  const activeCodes = jobs.filter((job) => job.status === "queued" || job.status === "running").map((job) => job.code);
  const active = run.status === "running" || activeCodes.length > 0;
  const available = current.hash !== null && keyError === null;
  const staleCodes = tiles.filter((tile) => tile.stale).map((tile) => tile.code);
  // A per-tile TILE_CACHE_REVISION bump changes the cache key without changing
  // the global run engine string. Treat a key mismatch against the same manifest
  // as an engine change in the summary, while leaving dataChanged independent.
  const engineChanged = run.engineVersion !== ENGINE_VERSION
    || (!dataChanged && tiles.some((tile) => tile.reason === "cache_key_mismatch"));
  const error = current.error ?? keyError;
  return {
    available,
    state: !available ? "unavailable" : active ? "running" : staleCodes.length > 0 ? "stale" : "fresh",
    stale: available ? staleCodes.length > 0 : null,
    active,
    activeCodes,
    canRefresh: available && !active && staleCodes.length > 0,
    dataChanged,
    engineChanged,
    analysisManifestHash: run.manifestHash,
    currentManifestHash: current.hash,
    analysisEngineVersion: run.engineVersion,
    currentEngineVersion: ENGINE_VERSION,
    staleCodes,
    staleTiles: staleCodes,
    tiles,
    error,
  };
}

export function getAnalysis(appDb: BetterSqlite3.Database, id: string, userId?: string | number | null, options: { tileCodes?: readonly string[]; dataDir?: string } = {}): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || !canRead(run, userId)) return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  const snapshot = analysisSnapshot(appDb, id, run);
  // 요약과 결과가 같은 저장 JSON을 두 번 파싱하지 않도록 한 번만 읽고,
  // 증분 요청(?tiles=)은 이미 파싱한 전체 결과에서 골라낸다.
  const allResults = loadResults(appDb, id);
  const requested = options.tileCodes === undefined ? null : new Set(options.tileCodes);
  const results = requested === null ? allResults : allResults.filter((result) => requested.has(result.tileCode));
  const refresh = getAnalysisRefreshSummary(appDb, id, options.dataDir);
  // A readable/null-owner or shared analysis may expose its stale state, but
  // the refresh action is owner-only. Keep the banner action disabled for that
  // response even when the pure summary calculation is otherwise refreshable.
  if (refresh && (run.userId == null || userId == null || String(run.userId) !== String(userId))) refresh.canRefresh = false;
  return { status: 200, body: { analysisId: id, status: run.status, summary: restoreSummary(run, allResults), results, jobs: snapshot.jobs, tiles: snapshot.tiles, revision: snapshot.revision, refresh } };
}

/** 같은 analysisId를 유지한 채 소유자 분석의 stale 타일을 현재 데이터/엔진 기준으로 다시 큐에 넣는다. */
export function refreshAnalysis(appDb: BetterSqlite3.Database, dataDir: string, id: string, userId?: string | number | null): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || run.userId == null || userId == null || String(run.userId) !== String(userId)) {
    return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  }
  const summary = getAnalysisRefreshSummary(appDb, id, dataDir);
  if (!summary) return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  if (!summary.available) return { status: 503, body: { error: summary.error ?? "현재 운영 manifest를 확인할 수 없습니다", refresh: summary } };
  if (summary.active) {
    return { status: 409, body: { error: "이미 실행 중인 분석입니다", analysisId: id, status: run.status, refresh: summary, jobs: listJobs(appDb, id) } };
  }
  if (summary.staleCodes.length === 0) {
    const snapshot = analysisSnapshot(appDb, id, run);
    return { status: 200, body: { analysisId: id, status: run.status, queued: [], refresh: summary, jobs: snapshot.jobs, tiles: snapshot.tiles, revision: snapshot.revision } };
  }
  const updated = updateAnalysisRun(appDb, id, summary.currentManifestHash!, ENGINE_VERSION, summary.staleCodes);
  if (!updated.ok) {
    if (updated.reason === "active") return { status: 409, body: { error: "이미 실행 중인 분석입니다", analysisId: id } };
    return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  }
  const refreshedRun = getAnalysisRun(appDb, id)!;
  const snapshot = analysisSnapshot(appDb, id, refreshedRun);
  const refreshed = getAnalysisRefreshSummary(appDb, id, dataDir)!;
  return {
    status: 202,
    body: {
      analysisId: id,
      status: refreshedRun.status,
      queued: updated.queued,
      refresh: refreshed,
      jobs: snapshot.jobs,
      tiles: snapshot.tiles,
      revision: snapshot.revision,
    },
  };
}

export function getAnalysisStatus(appDb: BetterSqlite3.Database, id: string, userId?: string | number | null): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || !canRead(run, userId)) return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  const snapshot = analysisSnapshot(appDb, id, run);
  const tiles = snapshot.tiles.map(({ code, status, revision }) => ({ code, status, revision }));
  const jobs: StatusJob[] = snapshot.jobs.map(({ code, status, elapsedMs, error, retryable, cancelRequestedAt }) => ({ code, status, elapsedMs, error, retryable, cancelRequestedAt }));
  return { status: 200, body: { analysisId: id, status: run.status, revision: snapshot.revision, tiles, jobs } };
}

/** Cancel only an owned analysis. Queued jobs are cancelled immediately; a running worker observes the request at its next tile boundary. */
export function cancelAnalysis(appDb: BetterSqlite3.Database, id: string, userId?: string | number | null): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || run.userId == null || userId == null || String(run.userId) !== String(userId)) {
    return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  }
  if (run.status === "cancelled") {
    const snapshot = analysisSnapshot(appDb, id, run);
    return { status: 200, body: { analysisId: id, status: run.status, jobs: snapshot.jobs, tiles: snapshot.tiles, revision: snapshot.revision } };
  }
  if (run.status !== "running") return { status: 409, body: { error: "이미 종료된 분석입니다", status: run.status } };
  requestAnalysisCancellation(appDb, id);
  const cancelled = getAnalysisRun(appDb, id)!;
  const snapshot = analysisSnapshot(appDb, id, cancelled);
  return {
    status: 200,
    body: {
      analysisId: id,
      status: cancelled.status,
      jobs: snapshot.jobs,
      tiles: snapshot.tiles,
      revision: snapshot.revision,
      cancelRequested: true,
    },
  };
}

export function getScene(appDb: BetterSqlite3.Database, id: string, userId?: string | number | null): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || !canRead(run, userId)) return { status: 404, body: { error: "장면을 찾을 수 없습니다" } };
  const scene = loadScene(appDb, id);
  if (!scene) return { status: 404, body: { error: "장면을 찾을 수 없습니다" } };
  return { status: 200, body: scene as unknown as Record<string, unknown> };
}
