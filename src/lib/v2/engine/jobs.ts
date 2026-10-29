/** P4 무거운 타일 작업 큐. 프로세스마다 작업자 하나, 분석 하나를 타일 순서대로 계산한다. */
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import type BetterSqlite3 from "better-sqlite3";
import { ANALYSIS_CANCELLED_REASON, cancelQueuedAnalysisJobs, cancelRunningAnalysisJobs, enqueueAnalysisJobs, ensureAnalysisJobTable, finishAnalysisRun, getAnalysisRun, isAnalysisCancellationRequested, openV2AppDb, saveTileResult, findCachedTileResult, loadScene, saveScene } from "../app-db";
import { acquireDataFile, releaseDataFile } from "../data/file-pool";
import { ManifestError, manifestHash, readArchivedManifest, resolveDataPath, type Manifest } from "../data/manifest";
import { parseTileResult, type RasterRef, type TileResult } from "../tile-result";
import { loadTileRaster, saveTileRasters } from "../raster-store";
import { EngineContext, type RasterValues } from "./context";
import { buildScene } from "./scene";
import { isPreBasemapScene } from "../scene";
import { cacheKeyFor, cacheKeyForRun as cacheKeyForStoredRun, conditionsForRun, s03InputsHash, saveTileResultWithElapsed } from "./run";
import { restoreSiteFromParameters } from "./site";
import { DATE_INDEPENDENT, HEAVY_TILES, TILES } from "../tile/server";
import { d10 } from "../tile/d10/engine";
import { d29 } from "../tile/d29/engine";
import { s02 } from "../tile/s02/engine";
import { s03 } from "../tile/s03/engine";
import { s04 } from "../tile/s04/engine";
import { makeTile } from "./tiles/common";
import { catalogEntry } from "../ui/tile-catalog";
import { listJobs, type JobInfo } from "./jobs-store";
import { closeTopoHandle, hasTopoParameter, topoHandleFor, type TopoHandle } from "../topo/context";

type Db = BetterSqlite3.Database;

export { DATE_INDEPENDENT, HEAVY_TILES };
export const DATA_VERSION_CHANGED_REASON = "데이터 버전이 바뀌어 다시 계산해야 합니다";
const JOB_FAILURE_REASON = "계산에 실패했습니다. 다시 계산해 주세요";

class PinnedManifestUnavailable extends Error {
  constructor(cause?: unknown) {
    super(DATA_VERSION_CHANGED_REASON, cause === undefined ? undefined : { cause });
    this.name = "PinnedManifestUnavailable";
  }
}

type JobRow = {
  analysis_id: string;
  tile_code: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  priority: number;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  elapsed_ms: number | null;
  error: string | null;
  cancel_requested_at: string | null;
};

type AnalysisRun = NonNullable<ReturnType<typeof getAnalysisRun>>;

function cacheKeyForRun(db: Db, run: AnalysisRun, code: string): string {
  return cacheKeyForStoredRun(run, code, run.manifestHash, code === "S04" ? s03InputsHash(db, run.analysisId) : null);
}

function readPinnedManifest(dataDir: string, hash: string): Manifest {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new PinnedManifestUnavailable(new Error("invalid manifest hash"));
  try {
    const archived = readArchivedManifest(dataDir, hash);
    if (!archived || manifestHash(archived) !== hash) throw new Error("archived manifest is missing or does not match its hash");
    if (!archived.files.core) throw new Error("archived manifest has no core file");
    for (const file of Object.values(archived.files)) {
      if (!existsSync(resolveDataPath(dataDir, file.path))) throw new Error(`missing data file: ${file.path}`);
    }
    return archived;
  } catch (error) {
    throw new PinnedManifestUnavailable(error);
  }
}

function isMissingPinnedData(error: unknown): boolean {
  if (error instanceof PinnedManifestUnavailable || error instanceof ManifestError) return true;
  const code = (error as { code?: string } | null)?.code;
  if (code === "ENOENT") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /MANIFEST_HASH_MISMATCH|unable to open database file|no such file|missing data file/i.test(message);
}

function jobFailureReason(error: unknown): string {
  return isMissingPinnedData(error) ? DATA_VERSION_CHANGED_REASON : JOB_FAILURE_REASON;
}

function savedTile(db: Db, analysisId: string, code: string): { result: TileResult; cacheKey: string } | null {
  const row = db.prepare("SELECT cache_key, result_json FROM tile_result WHERE analysis_id = ? AND tile_code = ?").get(analysisId, code) as { cache_key: string; result_json: string } | undefined;
  if (!row) return null;
  return { cacheKey: row.cache_key, result: parseTileResult(JSON.parse(row.result_json)) };
}

function failureTile(db: Db, run: AnalysisRun, code: string, reason: string): { result: TileResult; cacheKey: string } {
  const existing = savedTile(db, run.analysisId, code);
  if (existing) {
    return {
      cacheKey: existing.cacheKey,
      result: parseTileResult({
        ...existing.result,
        tileId: `${run.analysisId}-${code}`,
        analysisId: run.analysisId,
        status: "failed",
        metrics: [],
        judgment: null,
        provenance: { ...existing.result.provenance, manifestHash: run.manifestHash, sources: [] },
        limitations: [{ kind: "unknown", note: reason }],
      }),
    };
  }
  const conditions = conditionsForRun(run);
  return {
    cacheKey: cacheKeyForRun(db, run, code),
    result: parseTileResult({
      tileId: `${run.analysisId}-${code}`,
      analysisId: run.analysisId,
      tileType: catalogEntry(code).kind,
      tileCode: code,
      status: "failed",
      engineVersion: run.engineVersion,
      conditions,
      metrics: [],
      judgment: null,
      presentation: { legend: [], camera: null, layers: [], outputFace: "front" },
      provenance: { manifestHash: run.manifestHash, sources: [] },
      limitations: [{ kind: "unknown", note: reason }],
    }),
  };
}

export { listJobs } from "./jobs-store";
export type { JobInfo } from "./jobs-store";

const HEAVY_TILE_COMPUTES: Record<(typeof HEAVY_TILES)[number], (ctx: EngineContext) => TileResult> = {
  S02: s02,
  D29: d29,
  D10: d10,
  S03: s03,
  S04: s04,
};

export function recoverRunningJobs(db: Db): number {
  ensureAnalysisJobTable(db);
  const cancelled = cancelRunningAnalysisJobs(db);
  const result = db.prepare("UPDATE analysis_job SET status = 'queued', started_at = NULL, finished_at = NULL, elapsed_ms = NULL, error = NULL WHERE status = 'running'").run();
  return cancelled + result.changes;
}

function nextQueuedAnalysis(db: Db): string | null {
  ensureAnalysisJobTable(db);
  const row = db.prepare("SELECT analysis_id FROM analysis_job WHERE status = 'queued' ORDER BY priority, enqueued_at LIMIT 1").get() as { analysis_id: string } | undefined;
  return row?.analysis_id ?? null;
}

function markRunning(db: Db, analysisId: string, code: string, startedAt: string): boolean {
  return db.prepare("UPDATE analysis_job SET status = 'running', started_at = ?, finished_at = NULL, elapsed_ms = NULL, error = NULL WHERE analysis_id = ? AND tile_code = ? AND status = 'queued'")
    .run(startedAt, analysisId, code).changes === 1;
}

function markDone(db: Db, analysisId: string, code: string, elapsedMs: number): void {
  db.prepare("UPDATE analysis_job SET status = 'done', finished_at = ?, elapsed_ms = ?, error = NULL WHERE analysis_id = ? AND tile_code = ? AND status = 'running'")
    .run(new Date().toISOString(), elapsedMs, analysisId, code);
}

function markFailed(db: Db, analysisId: string, code: string, elapsedMs: number, reason: string): void {
  // queued도 실패 처리한다: failRemainingJobs가 데이터 버전 교체 시 대기 행을 실패로 닫지 않으면 runQueuedJobs가 같은 분석을 무한 반복한다.
  db.prepare("UPDATE analysis_job SET status = 'failed', finished_at = ?, elapsed_ms = ?, error = ? WHERE analysis_id = ? AND tile_code = ? AND status IN ('queued', 'running')")
    .run(new Date().toISOString(), elapsedMs, reason, analysisId, code);
}

function markCancelled(db: Db, analysisId: string, code: string, elapsedMs: number): void {
  db.prepare("UPDATE analysis_job SET status = 'cancelled', finished_at = ?, elapsed_ms = ?, error = ? WHERE analysis_id = ? AND tile_code = ? AND status = 'running'")
    .run(new Date().toISOString(), elapsedMs, ANALYSIS_CANCELLED_REASON, analysisId, code);
}

function saveFailedJob(db: Db, run: AnalysisRun, code: string, elapsedMs: number, reason: string, ctx: EngineContext | null, cacheKey: string | null = null): void {
  markFailed(db, run.analysisId, code, elapsedMs, reason);
  // Refresh는 실패한 새 계산이 기존의 정상/부분 결과를 덮어쓰지 않도록 한다.
  // 초기 실행은 refresh_requested_at이 null이므로 기존의 failed marker 저장 계약을 유지한다.
  if (run.refreshRequestedAt !== null && savedTile(db, run.analysisId, code)) return;
  try {
    const fallback = ctx ? null : failureTile(db, run, code, reason);
    const failed = ctx
      ? makeTile(ctx, {
        code,
        status: "failed",
        metrics: [],
        sources: [],
        limitations: [{ kind: "unknown", note: reason }],
      })
      : fallback!.result;
    const key = cacheKey ?? (ctx ? cacheKeyFor(ctx, code) : fallback!.cacheKey);
    if (elapsedMs > 0) saveTileResultWithElapsed(db, failed, key, elapsedMs);
    else saveTileResult(db, failed, key);
  } catch (error) {
    // 상태 행은 이미 failed로 남겼다. 저장된 pending 타일이 손상된 경우에도 큐를 막지 않는다.
    console.warn(`v2 analysis job ${run.analysisId}/${code} failed-result save skipped: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
  }
}

function finishIfIdle(db: Db, analysisId: string): void {
  const remaining = listJobs(db, analysisId).some((job) => job.status === "queued" || job.status === "running");
  if (!remaining) finishAnalysisRun(db, analysisId, "complete");
}

function failRemainingJobs(db: Db, run: AnalysisRun, error: unknown): void {
  if (isAnalysisCancellationRequested(db, run.analysisId)) {
    cancelQueuedAnalysisJobs(db, run.analysisId);
    finishIfIdle(db, run.analysisId);
    return;
  }
  const reason = jobFailureReason(error);
  for (const job of listJobs(db, run.analysisId)) {
    if (job.status !== "queued" && job.status !== "running") continue;
    saveFailedJob(db, run, job.code, 1, reason, null);
  }
  finishIfIdle(db, run.analysisId);
}

function valuesFromStored(ref: RasterRef, blob: Buffer): RasterValues {
  const raw = inflateRawSync(blob);
  const bytes = ref.cols * ref.rows * ref.bands * (ref.dtype === "u16" || ref.dtype === "i16" ? 2 : 1);
  if (raw.byteLength !== bytes) throw new Error(`RASTER_RAW_LENGTH_MISMATCH: ${ref.name}`);
  if (ref.dtype === "u8" || ref.dtype === "bits") return new Uint8Array(raw);
  if (ref.dtype === "u16") return new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  return new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
}

function rasterReader(db: Db, analysisId: string): (code: string, name: string) => { ref: RasterRef; values: RasterValues } | null {
  return (code, name) => {
    const row = db.prepare("SELECT cache_key FROM tile_result WHERE analysis_id = ? AND tile_code = ? AND status IN ('complete','partial')").get(analysisId, code) as { cache_key: string } | undefined;
    if (!row) return null;
    const stored = loadTileRaster(db, row.cache_key, name);
    return stored ? { ref: stored.ref, values: valuesFromStored(stored.ref, stored.blob) } : null;
  };
}

function tileWithRasters(tile: TileResult, items: Array<{ ref: RasterRef; blob: Buffer }>): TileResult {
  if (items.length === 0) return tile;
  const byName = new Map((tile.presentation.rasters ?? []).map((ref) => [ref.name, ref]));
  for (const item of items) byName.set(item.ref.name, item.ref);
  return {
    ...tile,
    presentation: { ...tile.presentation, rasters: [...byName.values()] },
  };
}

/** 한 분석의 queued 무거운 타일을 같은 EngineContext로 순서대로 계산한다. */
export function runHeavyTiles(appDb: Db, dataDir: string, analysisId: string): void {
  ensureAnalysisJobTable(appDb);
  const run = getAnalysisRun(appDb, analysisId);
  if (!run) throw new Error(`unknown analysis ${analysisId}`);
  if (run.status === "cancelled") {
    cancelQueuedAnalysisJobs(appDb, analysisId);
    finishIfIdle(appDb, analysisId);
    return;
  }
  let ctx: EngineContext | null = null;
  let core: BetterSqlite3.Database | null = null;
  let parcels: BetterSqlite3.Database | null = null;
  let topo: TopoHandle | null = null;
  let refreshScene = false;
  try {
    // 재현성: 현재 manifest가 아니라 분석 행에 기록된 보관본만 연다.
    const manifest = readPinnedManifest(dataDir, run.manifestHash);
    core = acquireDataFile(dataDir, manifest, "core");
    // New runs persist the resolved geometry; legacy pnu-only runs still need
    // the parcel file so S02/D19/A12 can reconstruct the original site.
    parcels = manifest.files.parcels ? acquireDataFile(dataDir, manifest, "parcels") : null;
    topo = topoHandleFor(appDb, run.parameters, run.userId);
    if (hasTopoParameter(run.parameters) && !topo) throw new Error("topo data is no longer available");
    ctx = new EngineContext(
      dataDir,
      manifest,
      analysisId,
      { address: run.address, center: run.center, radiusM: run.radiusM, analysisDate: run.analysisDate, pnu: typeof run.parameters.pnu === "string" ? run.parameters.pnu : null, site: restoreSiteFromParameters(run.parameters) },
      { core, ...(parcels ? { parcels } : {}) },
      { rasterReader: rasterReader(appDb, analysisId), reuseDataFiles: true, pooledKeys: parcels ? ["core", "parcels"] : ["core"], topo },
    );
    const scene = loadScene(appDb, analysisId);
    refreshScene = scene === null || scene.manifestHash !== run.manifestHash || isPreBasemapScene(scene);
  } catch (error) {
    if (!ctx) closeTopoHandle(topo);
    if (parcels) releaseDataFile(parcels);
    if (core) releaseDataFile(core);
    failRemainingJobs(appDb, run, error);
    return;
  }
  const engine = ctx;
  if (!engine) {
    failRemainingJobs(appDb, run, new Error("engine context was not created"));
    return;
  }
  try {
    // Initial runs queue only HEAVY_TILES. Refresh queues every stale catalog code,
    // so this single worker path intentionally handles light and heavy computes.
    const queuedCodes = listJobs(appDb, analysisId)
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.priority - b.priority || a.enqueuedAt.localeCompare(b.enqueuedAt))
      .map((job) => job.code);
    for (const code of queuedCodes) {
      if (isAnalysisCancellationRequested(appDb, analysisId)) {
        cancelQueuedAnalysisJobs(appDb, analysisId);
        break;
      }
      const job = listJobs(appDb, analysisId).find((candidate) => candidate.code === code);
      if (!job || job.status !== "queued") continue;
      if (!markRunning(appDb, analysisId, code, new Date().toISOString())) continue;
      const started = performance.now();
      let key: string | null = null;
      let emitted: Array<{ ref: RasterRef; blob: Buffer }> = [];
      try {
        key = cacheKeyFor(engine, code, code === "S04" ? s03InputsHash(appDb, analysisId) : null);
        const cached = findCachedTileResult(appDb, key);
        let tile: TileResult;
        if (cached) {
          tile = { ...cached, tileId: `${analysisId}-${code}`, analysisId, conditions: ctx.conditions };
        } else {
          const compute = HEAVY_TILE_COMPUTES[code as (typeof HEAVY_TILES)[number]] ?? TILES.find(([candidate]) => candidate === code)?.[1];
          if (!compute) throw new Error(`unknown heavy tile ${code}`);
          tile = compute(engine);
          emitted = engine.takeRasters(code);
          tile = tileWithRasters(tile, emitted);
        }
        if (emitted.length > 0) saveTileRasters(appDb, key, emitted);
        const elapsedMs = Math.max(1, Math.round(performance.now() - started));
        if (isAnalysisCancellationRequested(appDb, analysisId)) {
          markCancelled(appDb, analysisId, code, elapsedMs);
          const cancelled = makeTile(engine, {
            code,
            status: "cancelled",
            metrics: [],
            sources: [],
            limitations: [{ kind: "unknown", note: ANALYSIS_CANCELLED_REASON }],
          });
          saveTileResultWithElapsed(appDb, cancelled, key, elapsedMs);
        } else {
          saveTileResultWithElapsed(appDb, tile, key, elapsedMs);
          markDone(appDb, analysisId, code, elapsedMs);
        }
      } catch (error) {
        engine.takeRasters(code);
        const elapsedMs = Math.max(1, Math.round(performance.now() - started));
        if (isAnalysisCancellationRequested(appDb, analysisId)) {
          markCancelled(appDb, analysisId, code, elapsedMs);
          try {
            const cancelled = makeTile(engine, {
              code,
              status: "cancelled",
              metrics: [],
              sources: [],
              limitations: [{ kind: "unknown", note: ANALYSIS_CANCELLED_REASON }],
            });
            saveTileResultWithElapsed(appDb, cancelled, key ?? cacheKeyFor(engine, code), elapsedMs);
          } catch (saveError) {
            console.warn(`v2 analysis job ${analysisId}/${code} cancelled-result save skipped: ${String(saveError instanceof Error ? saveError.message : saveError).slice(0, 200)}`);
          }
        } else {
          console.warn(`v2 analysis job ${analysisId}/${code} failed: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
          saveFailedJob(appDb, run, code, elapsedMs, jobFailureReason(error), engine, key);
        }
      }
    }
    if (refreshScene && !isAnalysisCancellationRequested(appDb, analysisId)) {
      try {
        const scene = buildScene(engine);
        if (scene) saveScene(appDb, scene);
      } catch (error) {
        // Scene is an auxiliary artifact; retain the previous scene if refresh build fails.
        console.warn(`scene refresh failed for ${analysisId}: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
      }
    }
  } finally {
    engine.close();
  }
  finishIfIdle(appDb, analysisId);
}

let activeWorker: Worker | null = null;

/** 서버 프로세스당 하나의 worker_threads 작업자를 시작한다. */
export function startJobRunner(opts: { appDbPath: string; dataDir: string }): void {
  if (activeWorker) return;
  const recoveryDb = openV2AppDb(opts.appDbPath);
  try {
    recoverRunningJobs(recoveryDb);
  } finally {
    recoveryDb.close();
  }
  const worker = new Worker(new URL("./job-worker.ts", import.meta.url), { workerData: opts });
  activeWorker = worker;
  worker.unref();
  worker.once("error", (error) => {
    console.warn(`v2 analysis worker stopped: ${String(error.message).slice(0, 200)}`);
  });
  worker.once("exit", () => {
    if (activeWorker === worker) activeWorker = null;
  });
}

/** 작업자가 큐를 비울 때 쓰는 내부 루프. */
export function runQueuedJobs(appDbPath: string, dataDir: string): void {
  const db = openV2AppDb(appDbPath);
  try {
    recoverRunningJobs(db);
    for (;;) {
      const analysisId = nextQueuedAnalysis(db);
      if (!analysisId) break;
      try {
        runHeavyTiles(db, dataDir, analysisId);
      } catch (error) {
        // 한 분석/타일의 예외가 worker_threads 전체를 종료시키지 않는다.
        const run = getAnalysisRun(db, analysisId);
        if (run) {
          try {
            failRemainingJobs(db, run, error);
          } catch (recoveryError) {
            console.warn(`v2 analysis job recovery failed for ${analysisId}: ${String(recoveryError instanceof Error ? recoveryError.message : recoveryError).slice(0, 200)}`);
          }
        }
        console.warn(`v2 analysis job failed for ${analysisId}: ${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
      }
    }
  } finally {
    db.close();
  }
}

/** 계획의 작업 큐 공개 이름. 저장소 계층 함수명은 기존 호환을 위해 유지한다. */
export const enqueueHeavyTiles = enqueueAnalysisJobs;
export { enqueueAnalysisJobs };
