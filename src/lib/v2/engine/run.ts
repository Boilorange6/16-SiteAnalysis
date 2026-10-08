/**
 * 분석 실행: manifest 읽기 → 대지 확정 → 타일 계산(캐시 우선) → 저장. analysis-skeleton.ts의 흐름을 따른다.
 * 분석마다 manifest를 다시 읽는다(다른 프로세스가 새 버전을 게시할 수 있다).
 */
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { createAnalysisRun, enqueueAnalysisJobs, finishAnalysisRun, findCachedTileResult, getAnalysisRun, saveScene, saveTileResult } from "../app-db";
import { acquireDataFile, releaseDataFile } from "../data/file-pool";
import { readManifest } from "../data/manifest";
import { tileCacheKey, type TileResult } from "../tile-result";
import { loadTileRaster, saveTileRasters } from "../raster-store";
import { canonicalJson, sha256Hex } from "../canonical-json";
import { SEASONS } from "../ingest/sources/asos-wind";
import type { SiteSummary } from "../ui/tile-view";
import { catalogEntry } from "../ui/tile-catalog";
import { EngineContext } from "./context";
import { buildScene } from "./scene";
import { resolveSiteGeometry, SITE_DEPENDENT_TILE_CODES, type SiteFailure, type SiteGeometryResult } from "./site";
import { buildSummary } from "./summary";
import { cacheEngineVersion, ENGINE_VERSION, makeTile } from "./tiles/common";
import { DATE_INDEPENDENT_CODES, HEAVY_TILE_CODES, TILES } from "../tile/server";

export { DATE_INDEPENDENT_CODES, HEAVY_TILE_CODES, TILES } from "../tile/server";

export const RADIUS_CHOICES = [500, 800, 1000, 2000, 3000] as const;
export const DEFAULT_RADIUS_M = 800;

export interface RunInput {
  address?: string;
  center?: LngLat;
  /** API validation guarantees exactly one branch; this wider shape keeps the engine callable from zod-parsed objects. */
  site?: { pnus?: readonly string[]; polygon?: readonly [number, number][] };
  radiusM: number;
  analysisDate?: string;
  userId?: string | number | null;
}

export type RunOutcome =
  | { ok: true; analysisId: string; summary: SiteSummary; results: TileResult[]; computed: string[]; reused: string[]; queued: string[]; timingsMs: { tiles: Record<string, number>; scene: number } }
  | { ok: false; reason: SiteFailure; missingPnus?: string[] };

/** TileResult 계약을 건드리지 않고 API/저장 JSON에 계산 소요를 함께 노출하는 T3 부가 필드. */
export type TimedTileResult = TileResult & { elapsedMs: number };

const HEAVY_TILE_SET = new Set<string>(HEAVY_TILE_CODES);

export const todayKst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

export function cacheKeyFor(ctx: EngineContext, code: string, upstream: string | null = null): string {
  const dateConditions = DATE_INDEPENDENT_CODES.has(code) ? { ...ctx.conditions, analysisDate: "date-independent" } : ctx.conditions;
  const conditions = SITE_DEPENDENT_TILE_CODES.has(code) ? dateConditions : { ...dateConditions, parcelSnapshotHash: null };
  const key = tileCacheKey({ tileCode: code, manifestHash: ctx.manifestHash, engineVersion: cacheEngineVersion(code), conditions });
  return upstream ? sha256Hex(`${key}:${upstream}`) : key;
}

/** S04 reads S03's stored wind/obstacle rasters, and S03's own cache key does not change when a 2D/3D/uploaded wind
 * replaces them — so the S04 key also hashes the raster bytes it will read. */
export function s03InputsHash(db: BetterSqlite3.Database, analysisId: string): string {
  const row = db.prepare("SELECT cache_key FROM tile_result WHERE analysis_id = ? AND tile_code = 'S03' AND status IN ('complete','partial')").get(analysisId) as { cache_key: string } | undefined;
  const hash = createHash("sha256");
  for (const name of [...SEASONS.map((season) => `wind_${season}_z06`), "obstacle_height"]) {
    const stored = row ? loadTileRaster(db, row.cache_key, name) : null;
    hash.update(`${name}:`);
    if (stored) hash.update(canonicalJson(stored.ref)).update(stored.blob);
    hash.update("\n");
  }
  return hash.digest("hex");
}

function pendingTile(ctx: EngineContext, code: string): TileResult {
  return makeTile(ctx, {
    code,
    type: catalogEntry(code).kind,
    status: "pending",
    metrics: [],
    sources: [],
    limitations: [{ kind: "not_provided", note: "백그라운드 계산 대기 중입니다." }],
  });
}

function attachRasters(tile: TileResult, items: Array<{ ref: NonNullable<TileResult["presentation"]["rasters"]>[number]; blob: Buffer }>): TileResult {
  if (items.length === 0) return tile;
  const refs = new Map((tile.presentation.rasters ?? []).map((ref) => [ref.name, ref]));
  for (const item of items) refs.set(item.ref.name, item.ref);
  return { ...tile, presentation: { ...tile.presentation, rasters: [...refs.values()] } };
}

export function withTileElapsed(tile: TileResult, elapsedMs: number): TimedTileResult {
  return Object.assign(tile, { elapsedMs: Math.max(0, Math.round(elapsedMs)) });
}

/**
 * T1의 TileResult 스키마는 그대로 두고, 저장된 결과 JSON에 T3 측정값만 보존한다.
 * parseTileResult는 알 수 없는 필드를 제거하므로 읽기 API가 raw JSON에서 다시 붙인다.
 */
export function saveTileResultWithElapsed(db: BetterSqlite3.Database, tile: TileResult, cacheKey: string, elapsedMs: number): TimedTileResult {
  const timed = withTileElapsed(tile, elapsedMs);
  const persist = db.transaction(() => {
    saveTileResult(db, timed, cacheKey);
    const row = db.prepare("SELECT result_json FROM tile_result WHERE analysis_id = ? AND tile_code = ?").get(tile.analysisId, tile.tileCode) as { result_json: string } | undefined;
    if (!row) throw new Error(`saved tile is missing: ${tile.analysisId}/${tile.tileCode}`);
    const json = JSON.parse(row.result_json) as Record<string, unknown>;
    json.elapsedMs = timed.elapsedMs;
    db.prepare("UPDATE tile_result SET result_json = ? WHERE analysis_id = ? AND tile_code = ?").run(JSON.stringify(json), tile.analysisId, tile.tileCode);
  });
  persist();
  return timed;
}

export function runAnalysis(appDb: BetterSqlite3.Database, dataDir: string, input: RunInput): RunOutcome {
  const manifest = readManifest(dataDir);
  if (!manifest) throw new Error("no published manifest — run a data build first");
  const core = acquireDataFile(dataDir, manifest, "core");
  const parcels = manifest.files.parcels ? acquireDataFile(dataDir, manifest, "parcels") : null;
  let site: SiteGeometryResult;
  try {
    site = resolveSiteGeometry(core, parcels, input);
  } catch (error) {
    if (parcels) releaseDataFile(parcels);
    releaseDataFile(core);
    throw error;
  }
  if (!site.ok) {
    if (parcels) releaseDataFile(parcels);
    releaseDataFile(core);
    return { ok: false, reason: site.reason, ...(site.missingPnus ? { missingPnus: site.missingPnus } : {}) };
  }

  const analysisId = randomUUID();
  const analysisDate = input.analysisDate ?? todayKst();
  const ctx = new EngineContext(
    dataDir,
    manifest,
    analysisId,
    { address: site.label, center: site.center, radiusM: input.radiusM, analysisDate, pnu: site.pnu, site: site.site },
    { core, ...(parcels ? { parcels } : {}) },
    { reuseDataFiles: true, pooledKeys: parcels ? ["core", "parcels"] : ["core"] },
  );
  try {
    createAnalysisRun(appDb, {
      analysisId, address: site.label, center: site.center, radiusM: input.radiusM, analysisDate,
      manifestHash: ctx.manifestHash, engineVersion: ENGINE_VERSION,
      // `site` is the resolved EPSG:5179 geometry used by the engine. Keep the
      // original WGS84/PNU input separately so projects can re-open the same
      // selection instead of trying to serialize projected geometry as input.
      parameters: { pnu: site.pnu, legalCode: site.legalCode, jimok: site.jimok, jimokList: site.jimokList, site: site.site, siteInput: input.site ?? null, inputAddress: input.address?.trim() || null },
      userId: input.userId,
    });
    const results: TileResult[] = [];
    const computed: string[] = [];
    const reused: string[] = [];
    const pending = new Set<string>();
    const tileTimings: Record<string, number> = {};
    for (const [code, compute] of TILES) {
      const tileStarted = performance.now();
      const key = cacheKeyFor(ctx, code, code === "S04" ? s03InputsHash(appDb, analysisId) : null);
      const cached = findCachedTileResult(appDb, key);
      let tile: TileResult;
      if (cached) {
        tile = { ...cached, tileId: `${analysisId}-${code}`, analysisId, conditions: ctx.conditions };
        reused.push(code);
      } else if (HEAVY_TILE_SET.has(code)) {
        tile = pendingTile(ctx, code);
        pending.add(code);
      } else {
        try {
          tile = compute(ctx);
          const rasters = ctx.takeRasters(code);
          if (rasters.length > 0) {
            // 가벼운 타일도 래스터를 만들면 캐시 키와 함께 저장한다.
            saveTileRasters(appDb, key, rasters);
            tile = attachRasters(tile, rasters);
          }
          computed.push(code);
        } catch (e) {
          ctx.takeRasters(code);
          // 한 타일의 실패가 분석 전체를 막지 않는다 — 실패 타일은 재시도할 수 있고 캐시되지 않는다
          tile = makeTile(ctx, { code, status: "failed", metrics: [], sources: [], limitations: [{ kind: "unknown", note: `계산 중 오류: ${String((e as Error).message).slice(0, 200)}` }] });
        }
      }
      if (!HEAVY_TILE_SET.has(code)) {
        const elapsedMs = Math.max(0, Math.round(performance.now() - tileStarted));
        tileTimings[code] = elapsedMs;
        results.push(saveTileResultWithElapsed(appDb, tile, key, elapsedMs));
      } else {
        // This is queue/cache lookup time, not the worker's heavy compute time.
        // The worker stores its authoritative elapsed_ms on analysis_job.
        tileTimings[code] = Math.max(0, Math.round(performance.now() - tileStarted));
        saveTileResult(appDb, tile, key);
        results.push(tile);
      }
    }
    const queued = HEAVY_TILE_CODES.filter((code) => pending.has(code));
    if (queued.length > 0) enqueueAnalysisJobs(appDb, analysisId, queued);
    // 장면은 내보내기용 부가 산출물 — 실패해도 분석 결과는 살린다
    const sceneStarted = performance.now();
    try {
      const scene = buildScene(ctx);
      if (scene) saveScene(appDb, scene);
    } catch (e) {
      console.warn(`scene build failed for ${analysisId}: ${(e as Error).message}`);
    }
    const sceneElapsedMs = Math.max(0, Math.round(performance.now() - sceneStarted));
    if (queued.length === 0) finishAnalysisRun(appDb, analysisId, "complete");
    return { ok: true, analysisId, summary: buildSummary({ address: site.label, jimok: site.jimok, kind: site.site.kind }, input.radiusM, results), results, computed, reused, queued, timingsMs: { tiles: tileTimings, scene: sceneElapsedMs } };
  } catch (error) {
    try {
      if (getAnalysisRun(appDb, analysisId)) finishAnalysisRun(appDb, analysisId, "failed");
    } catch {
      // 상태 기록 실패는 원래 오류를 가리지 않는다
    }
    throw error;
  } finally {
    ctx.close();
  }
}

/** 저장된 분석 복원(GET). 요약은 저장된 실행 조건과 결과에서 다시 만든다. */
export function restoreSummary(run: { address: string; radiusM: number; parameters: Record<string, unknown> }, results: TileResult[]): SiteSummary {
  const jimok = typeof run.parameters.jimok === "string" ? run.parameters.jimok : null;
  const storedSite = run.parameters.site;
  const kind = storedSite && typeof storedSite === "object" && !Array.isArray(storedSite) && "kind" in storedSite && ((storedSite as { kind?: unknown }).kind === "address" || (storedSite as { kind?: unknown }).kind === "parcels" || (storedSite as { kind?: unknown }).kind === "polygon")
    ? (storedSite as { kind: "address" | "parcels" | "polygon" }).kind
    : undefined;
  return buildSummary({ address: run.address, jimok, kind }, run.radiusM, results);
}
