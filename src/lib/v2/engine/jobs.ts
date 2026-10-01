/** P4 무거운 타일 작업 큐. 프로세스마다 작업자 하나, 분석 하나를 타일 순서대로 계산한다. */
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { inflateRawSync } from "node:zlib";
import type BetterSqlite3 from "better-sqlite3";
import { enqueueAnalysisJobs, ensureAnalysisJobTable, finishAnalysisRun, getAnalysisRun, openV2AppDb, saveTileResult, findCachedTileResult } from "../app-db";
import { openDataFile, readManifest } from "../data/manifest";
import { tileCacheKey, type RasterRef, type TileResult } from "../tile-result";
import { loadTileRaster, saveTileRasters } from "../raster-store";
import { EngineContext, type RasterValues } from "./context";
import { TILES } from "./run";
import { ENGINE_VERSION, makeTile } from "./tiles/common";

type Db = BetterSqlite3.Database;

export const HEAVY_TILES = ["S02", "D21", "D29", "D10", "S03", "S04"] as const;
export const DATE_INDEPENDENT = new Set(["S03", "D10", "D29", "D01", "D28"]);

type JobRow = {
  analysis_id: string;
  tile_code: string;
  status: "queued" | "running" | "done" | "failed";
  priority: number;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  elapsed_ms: number | null;
  error: string | null;
};

export type JobInfo = {
  code: string;
  status: JobRow["status"];
  priority: number;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedMs: number | null;
  error: string | null;
};

export function listJobs(db: Db, analysisId: string): JobInfo[] {
  ensureAnalysisJobTable(db);
  const rows = db.prepare(`SELECT analysis_id, tile_code, status, priority, enqueued_at, started_at, finished_at, elapsed_ms, error
    FROM analysis_job WHERE analysis_id = ? ORDER BY priority, enqueued_at`).all(analysisId) as JobRow[];
  return rows.map((row) => ({
    code: row.tile_code,
    status: row.status,
    priority: row.priority,
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    elapsedMs: row.elapsed_ms,
    error: row.error,
  }));
}

export function recoverRunningJobs(db: Db): number {
  ensureAnalysisJobTable(db);
  const result = db.prepare("UPDATE analysis_job SET status = 'queued', started_at = NULL, finished_at = NULL, elapsed_ms = NULL, error = NULL WHERE status = 'running'").run();
  return result.changes;
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
  db.prepare("UPDATE analysis_job SET status = 'done', finished_at = ?, elapsed_ms = ?, error = NULL WHERE analysis_id = ? AND tile_code = ?")
    .run(new Date().toISOString(), elapsedMs, analysisId, code);
}

function markFailed(db: Db, analysisId: string, code: string, elapsedMs: number, error: unknown): void {
  const message = String(error instanceof Error ? error.message : error).slice(0, 500);
  db.prepare("UPDATE analysis_job SET status = 'failed', finished_at = ?, elapsed_ms = ?, error = ? WHERE analysis_id = ? AND tile_code = ?")
    .run(new Date().toISOString(), elapsedMs, message, analysisId, code);
}

function keyFor(ctx: EngineContext, code: string): string {
  const conditions = DATE_INDEPENDENT.has(code) ? { ...ctx.conditions, analysisDate: "date-independent" } : ctx.conditions;
  return tileCacheKey({ tileCode: code, manifestHash: ctx.manifestHash, engineVersion: ENGINE_VERSION, conditions });
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
  const manifest = readManifest(dataDir);
  if (!manifest) throw new Error("no published manifest — run a data build first");
  const core = openDataFile(dataDir, manifest, "core");
  const ctx = new EngineContext(
    dataDir,
    manifest,
    analysisId,
    { address: run.address, center: run.center, radiusM: run.radiusM, analysisDate: run.analysisDate, pnu: typeof run.parameters.pnu === "string" ? run.parameters.pnu : null },
    { core },
    { rasterReader: rasterReader(appDb, analysisId) },
  );
  try {
    for (const code of HEAVY_TILES) {
      const job = listJobs(appDb, analysisId).find((candidate) => candidate.code === code);
      if (!job || job.status !== "queued") continue;
      if (!markRunning(appDb, analysisId, code, new Date().toISOString())) continue;
      const started = performance.now();
      const key = keyFor(ctx, code);
      let emitted: Array<{ ref: RasterRef; blob: Buffer }> = [];
      try {
        const cached = findCachedTileResult(appDb, key);
        let tile: TileResult;
        if (cached) {
          tile = { ...cached, tileId: `${analysisId}-${code}`, analysisId, conditions: ctx.conditions };
        } else {
          const compute = TILES.find(([candidate]) => candidate === code)?.[1];
          if (!compute) throw new Error(`unknown heavy tile ${code}`);
          tile = compute(ctx);
          emitted = ctx.takeRasters(code);
          tile = tileWithRasters(tile, emitted);
        }
        if (emitted.length > 0) saveTileRasters(appDb, key, emitted);
        saveTileResult(appDb, tile, key);
        markDone(appDb, analysisId, code, Math.max(1, Math.round(performance.now() - started)));
      } catch (error) {
        ctx.takeRasters(code);
        const failed = makeTile(ctx, {
          code,
          status: "failed",
          metrics: [],
          sources: [],
          limitations: [{ kind: "unknown", note: `계산 중 오류: ${String(error instanceof Error ? error.message : error).slice(0, 200)}` }],
        });
        saveTileResult(appDb, failed, key);
        markFailed(appDb, analysisId, code, Math.max(1, Math.round(performance.now() - started)), error);
      }
    }
  } finally {
    ctx.close();
  }
  const remaining = listJobs(appDb, analysisId).some((job) => job.status === "queued" || job.status === "running");
  if (!remaining) finishAnalysisRun(appDb, analysisId, "complete");
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
      runHeavyTiles(db, dataDir, analysisId);
    }
  } finally {
    db.close();
  }
}

/** 계획의 작업 큐 공개 이름. 저장소 계층 함수명은 기존 호환을 위해 유지한다. */
export const enqueueHeavyTiles = enqueueAnalysisJobs;
export { enqueueAnalysisJobs };
