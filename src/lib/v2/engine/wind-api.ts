/** S03 바람 결과 API 본체.
 *
 * 라우트는 인증·Next 응답만 맡고, 이 모듈은 업로드 신뢰 경계와 앱 DB 저장을
 * 테스트 가능한 순수한 ApiReply로 제공한다. 브라우저가 보낸 field는 사용자
 * 범위 캐시만 사용하며, 전역 분석 캐시와 섞지 않는다.
 */
import { isMainThread, Worker, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { inflateRawSync } from "node:zlib";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../canonical-json";
import { toUtmk } from "../crs";
import { ensureAnalysisJobTable, getAnalysisRun, openV2AppDb, saveTileResult } from "../app-db";
import { openDataFile, readManifest } from "../data/manifest";
import { EngineContext } from "./context";
import { restoreSiteFromParameters } from "./site";
import { hasTopoParameter, topoHandleFor } from "../topo/context";
import { encodeRaster, loadTileRaster, saveTileRasters } from "../raster-store";
import { parseTileResult, type RasterRef, type TileResult } from "../tile-result";
import {
  WIND_SEASONS,
  PEDESTRIAN_LAYER_Z,
  WIND_RAW_SCALE,
  buildWindCase,
  decodeRasterValues,
  encodedWindLayer,
  fallbackField,
  metricsForWindField,
  windCaseSimulation,
  type EncodedWindLayer,
  type WindCase,
  type WindSeason,
} from "./wind-metrics";

type Db = BetterSqlite3.Database;

const WIND_SEASON_LABEL: Record<WindSeason, string> = {
  annual: "연간",
  spring: "봄",
  summer: "여름",
  autumn: "가을",
  winter: "겨울",
};
const WIND_DIRECTION_CODES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
const WIND_DIRECTION_KO = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"] as const;
const WIND_LEGEND = [
  { label: "U/U유입 · 0~0.5", min: 0, max: 0.5 },
  { label: "U/U유입 · 0.5~0.8", min: 0.5, max: 0.8 },
  { label: "U/U유입 · 0.8~1.2", min: 0.8, max: 1.2 },
  { label: "U/U유입 · 1.2 이상", min: 1.2, max: null },
] as const;

function windDirectionText(value: unknown): string {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawName = typeof record.name === "string" ? record.name.trim().toUpperCase() : "";
  const namedIndex = WIND_DIRECTION_CODES.indexOf(rawName as (typeof WIND_DIRECTION_CODES)[number]);
  const degrees = typeof record.deg === "number" && Number.isFinite(record.deg) ? ((record.deg % 360) + 360) % 360 : null;
  const index = namedIndex >= 0 ? namedIndex : degrees === null ? -1 : Math.round(degrees / 22.5) % WIND_DIRECTION_CODES.length;
  if (index < 0) return "유입 방향 미상";
  const code = WIND_DIRECTION_CODES[index];
  return `${WIND_DIRECTION_KO[index]}(${code})`;
}

function windValueText(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "미상";
}

export function formatWindJudgmentSentence(
  season: WindSeason,
  inflow: unknown,
  median: number | null | undefined,
  highShare: number | null | undefined,
  calmShare: number | null | undefined,
): string {
  return `${WIND_SEASON_LABEL[season]} 주풍향 ${windDirectionText(inflow)} 유입 시 보행층 상대풍속 중앙값 ${windValueText(median)} U/U유입, 1.5 이상 ${windValueText(highShare)}%, 0.2 미만 정체 ${windValueText(calmShare)}% → 주풍향 1방향의 조기설계 참고 모형으로 자리끼리 비교 → 풍환경 검토 단계에서 검증된 CFD·풍동으로 확인할 것`;
}

export interface ApiReply {
  status: number;
  body: Record<string, unknown>;
}

export const MAX_WIND_UPLOAD_BYTES = 40 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_WIND_RAW_BYTES = 128 * 1024 * 1024;

export const WindUploadHeader = z.object({
  season: z.enum(WIND_SEASONS),
  model: z.literal("lbm-d3q19-les@1"),
  cellM: z.number().finite().positive(),
  cols: z.number().int().min(1).max(4096),
  rows: z.number().int().min(1).max(4096),
  layersZm: z.array(z.number().finite().positive().max(100)).min(1).max(8),
  dtype: z.literal("i16"),
  scale: z.literal(WIND_RAW_SCALE),
  steps: z.number().int().positive(),
  elapsedMs: z.number().finite().nonnegative(),
  adapter: z.string().min(1).max(200),
  precision: z.enum(["f16", "f32"]),
  mlups: z.number().finite().nonnegative(),
  planReason: z.string().max(2000).nullable(),
  caseSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type WindUpload = z.infer<typeof WindUploadHeader>;

class WindApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface WindState {
  run: NonNullable<ReturnType<typeof getAnalysisRun>>;
  tile: TileResult;
  row: { cache_key: string; status: string };
  obstacleRef: RasterRef;
  obstacleBlob: Buffer;
  obstacleValues: Uint16Array;
  baseKey: string;
  scopedKey: string;
}

interface WindCacheRow {
  user_id: string;
  base_cache_key: string;
  scoped_cache_key: string;
  case_sha256: string;
  analysis_id: string;
}

function reply(status: number, error: string, extra: Record<string, unknown> = {}): ApiReply {
  return { status, body: { error, ...extra } };
}

function userKey(userId: string | number): string {
  return String(userId);
}

function windScopedKey(baseKey: string, userId: string | number): string {
  return sha256Hex(canonicalJson({ scope: "s03-wind-user", baseKey, userId: userKey(userId) }));
}

function ensureWindCacheTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wind_result_cache (
      user_id TEXT NOT NULL,
      base_cache_key TEXT NOT NULL,
      scoped_cache_key TEXT NOT NULL,
      case_sha256 TEXT NOT NULL,
      analysis_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, base_cache_key)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wind_result_cache_scoped ON wind_result_cache (scoped_cache_key);
  `);
}

function ownerRun(db: Db, analysisId: string, userId: string | number): NonNullable<ReturnType<typeof getAnalysisRun>> {
  const run = getAnalysisRun(db, analysisId);
  if (!run) throw new WindApiError(404, "분석을 찾을 수 없습니다");
  if (run.userId == null || String(run.userId) !== userKey(userId)) throw new WindApiError(403, "접근할 수 없는 분석입니다");
  return run;
}

function baseKeyForRow(db: Db, analysisId: string, userId: string | number, cacheKey: string): { baseKey: string; scopedKey: string } {
  ensureWindCacheTable(db);
  const uid = userKey(userId);
  const byAnalysis = db.prepare("SELECT base_cache_key, scoped_cache_key FROM wind_result_cache WHERE user_id = ? AND analysis_id = ? ORDER BY updated_at DESC LIMIT 1").get(uid, analysisId) as
    | { base_cache_key: string; scoped_cache_key: string }
    | undefined;
  if (byAnalysis) return { baseKey: byAnalysis.base_cache_key, scopedKey: byAnalysis.scoped_cache_key };
  const byScoped = db.prepare("SELECT base_cache_key, scoped_cache_key FROM wind_result_cache WHERE user_id = ? AND scoped_cache_key = ? LIMIT 1").get(uid, cacheKey) as
    | { base_cache_key: string; scoped_cache_key: string }
    | undefined;
  if (byScoped) return { baseKey: byScoped.base_cache_key, scopedKey: byScoped.scoped_cache_key };
  return { baseKey: cacheKey, scopedKey: windScopedKey(cacheKey, userId) };
}

function saveCacheIdentity(db: Db, state: WindState, userId: string | number, caseSha256: string): void {
  ensureWindCacheTable(db);
  db.prepare(`INSERT INTO wind_result_cache (user_id, base_cache_key, scoped_cache_key, case_sha256, analysis_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, base_cache_key) DO UPDATE SET scoped_cache_key = excluded.scoped_cache_key,
      case_sha256 = excluded.case_sha256, analysis_id = excluded.analysis_id, updated_at = excluded.updated_at`)
    .run(userKey(userId), state.baseKey, state.scopedKey, caseSha256, state.run.analysisId, new Date().toISOString());
}

function readWindState(db: Db, analysisId: string, userId: string | number): WindState {
  const run = ownerRun(db, analysisId, userId);
  const row = db.prepare("SELECT cache_key, status, result_json FROM tile_result WHERE analysis_id = ? AND tile_code = 'S03'").get(analysisId) as
    | { cache_key: string; status: string; result_json: string }
    | undefined;
  if (!row) throw new WindApiError(409, "S03 바람 사례가 아직 생성되지 않았습니다");
  const tile = parseTileResult(JSON.parse(row.result_json));
  const obstacleRef = tile.presentation.rasters?.find((candidate) => candidate.name === "obstacle_height");
  if (!obstacleRef) throw new WindApiError(409, "S03 장애물 사례가 아직 준비되지 않았습니다");
  const obstacle = loadTileRaster(db, row.cache_key, obstacleRef.name);
  if (!obstacle) throw new WindApiError(409, "S03 장애물 래스터를 찾을 수 없습니다");
  const values = decodeRasterValues(obstacle.ref, obstacle.blob);
  if (!(values instanceof Uint16Array)) throw new WindApiError(500, "S03 장애물 래스터 형식이 올바르지 않습니다");
  const identity = baseKeyForRow(db, analysisId, userId, row.cache_key);
  return { run, tile, row, obstacleRef, obstacleBlob: obstacle.blob, obstacleValues: values, ...identity };
}

function parseUploadBody(body: Buffer): { header: WindUpload; raw: Buffer } {
  if (body.length > MAX_WIND_UPLOAD_BYTES) throw new WindApiError(413, "바람 결과 업로드 본문은 40 MB 이하이어야 합니다");
  if (body.length < 5) throw new WindApiError(400, "바람 결과 업로드 본문이 짧습니다");
  const headerBytes = body.readUInt32LE(0);
  if (headerBytes <= 0 || headerBytes > MAX_HEADER_BYTES || 4 + headerBytes > body.length) throw new WindApiError(400, "바람 결과 헤더 길이가 올바르지 않습니다");
  let json: unknown;
  try {
    json = JSON.parse(body.subarray(4, 4 + headerBytes).toString("utf8"));
  } catch {
    throw new WindApiError(400, "바람 결과 헤더 JSON을 읽을 수 없습니다");
  }
  const parsed = WindUploadHeader.safeParse(json);
  if (!parsed.success) throw new WindApiError(400, parsed.error.issues[0]?.message ?? "바람 결과 헤더가 올바르지 않습니다");
  const expected = parsed.data.cols * parsed.data.rows * parsed.data.layersZm.length * 2 * 2;
  if (expected > MAX_WIND_RAW_BYTES) throw new WindApiError(413, "해제된 바람 결과가 허용 크기를 초과합니다");
  let raw: Buffer;
  try {
    raw = inflateRawSync(body.subarray(4 + headerBytes), { maxOutputLength: MAX_WIND_RAW_BYTES });
  } catch {
    throw new WindApiError(400, "바람 결과 deflate 본문을 해제할 수 없습니다");
  }
  if (raw.length !== expected) throw new WindApiError(400, `바람 결과 격자 크기가 헤더와 다릅니다(${raw.length}/${expected})`);
  return { header: parsed.data, raw };
}

function asInt16(raw: Buffer): Int16Array {
  const values = new Int16Array(raw.length / 2);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < values.length; i += 1) values[i] = view.getInt16(i * 2, true);
  return values;
}

function validateHeaderAgainstCase(header: WindUpload, season: WindSeason, state: WindState): void {
  if (header.season !== season) throw new WindApiError(400, "바람 결과 계절이 요청 경로와 다릅니다");
  if (header.caseSha256 !== state.obstacleRef.sha256) throw new WindApiError(400, "바람 결과 사례가 현재 분석과 다릅니다");
  if (header.cellM !== state.obstacleRef.cellM || header.cols !== state.obstacleRef.cols || header.rows !== state.obstacleRef.rows) throw new WindApiError(400, "바람 결과 격자가 현재 사례와 다릅니다");
  if (!header.layersZm.some((z) => z === PEDESTRIAN_LAYER_Z)) throw new WindApiError(400, "보행층(6 m) 바람 결과가 없습니다");
}

function validateValues(values: Int16Array): void {
  for (let i = 0; i < values.length; i += 2) {
    const u = values[i] * WIND_RAW_SCALE;
    const v = values[i + 1] * WIND_RAW_SCALE;
    if (Math.hypot(u, v) > 5) throw new WindApiError(400, "바람 결과 상대 성분 범위를 벗어났습니다");
  }
}

function layerValues(values: Int16Array, header: WindUpload, zM: number, cells: number): Int16Array {
  const index = header.layersZm.indexOf(zM);
  if (index < 0) throw new WindApiError(400, "요청한 보행층 바람 결과가 없습니다");
  return values.subarray(index * cells * 2, (index + 1) * cells * 2);
}

function caseLike(state: WindState, built: WindCase | null = null): WindCase {
  if (built) return { ...built, ref: { ...built.ref, ...state.obstacleRef }, obstacleValues: state.obstacleValues };
  const simulation = state.tile.conditions.simulation;
  const simulationCase = simulation && typeof simulation.case === "object" && simulation.case !== null ? simulation.case as Record<string, unknown> : {};
  const inflowValue = simulationCase.inflow && typeof simulationCase.inflow === "object" ? simulationCase.inflow as Record<string, unknown> : {};
  const inflow = Object.fromEntries(WIND_SEASONS.map((season) => {
    const candidate = inflowValue[season];
    if (!candidate || typeof candidate !== "object") return [season, null];
    const value = candidate as Record<string, unknown>;
    return [season, typeof value.deg === "number" && typeof value.name === "string" && typeof value.pct === "number"
      ? { deg: value.deg, name: value.name as never, pct: value.pct, source: value.source === "annual" ? "annual" : "season" } : null];
  })) as WindCase["inflow"];
  const [centerX, centerY] = toUtmk(state.run.center);
  const simulationStation = simulationCase.station && typeof simulationCase.station === "object" ? simulationCase.station as WindCase["station"] : null;
  return {
    ref: { ...state.obstacleRef },
    obstacleValues: state.obstacleValues,
    centerX,
    centerY,
    radiusM: state.run.radiusM,
    bufferM: typeof simulationCase.bufferM === "number" ? simulationCase.bufferM : 200,
    cellM: state.obstacleRef.cellM,
    cols: state.obstacleRef.cols,
    rows: state.obstacleRef.rows,
    x0: state.obstacleRef.x0,
    y0: state.obstacleRef.y0,
    inflow,
    station: simulationStation,
    maxObstacleM: typeof simulationCase.maxObstacleM === "number" ? simulationCase.maxObstacleM : 0,
    assumedOneFloorCount: typeof simulationCase.assumedOneFloorBuildings === "number" ? simulationCase.assumedOneFloorBuildings : 0,
    terrain: typeof simulationCase.terrain === "string" && simulationCase.terrain === "included" ? "included" : `excluded:${String(simulationCase.terrain ?? "미상")}`,
    sources: state.tile.provenance.sources,
    limitations: state.tile.limitations,
  };
}

function sourceForBrowser(header: WindUpload): TileResult["provenance"]["sources"][number] {
  return { sourceId: "browser_lbm", releaseId: `${header.adapter}@${header.precision}`, sourceAsOf: null, fetchedAt: new Date().toISOString() };
}

function sourceForFallback(): TileResult["provenance"]["sources"][number] {
  return { sourceId: "fallback_d2q9", releaseId: "lbm-d2q9@1", sourceAsOf: null, fetchedAt: new Date().toISOString() };
}

function mergeSourceList(tile: TileResult, source: TileResult["provenance"]["sources"][number]): TileResult["provenance"]["sources"] {
  const all = [...tile.provenance.sources, source];
  const seen = new Set<string>();
  return all.filter((item) => {
    const key = `${item.sourceId}:${item.releaseId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeWindTile(
  state: WindState,
  season: WindSeason,
  metrics: TileResult["metrics"],
  raster: RasterRef,
  source: TileResult["provenance"]["sources"][number],
  mode: "browser-webgpu" | "worker-d2q9",
  details: { steps: number; mlups: number | null; adapter?: string; precision?: "f16" | "f32" },
): TileResult {
  const previousSeasons = Array.isArray(state.tile.conditions.simulation?.seasons)
    ? state.tile.conditions.simulation.seasons.filter((value): value is string => typeof value === "string")
    : [];
  const seasons = WIND_SEASONS.filter((candidate) => previousSeasons.includes(candidate) || candidate === season);
  const metricIds = new Set(metrics.map((metric) => metric.id));
  const filteredMetrics = state.tile.metrics.filter((metric) => !metricIds.has(metric.id));
  const oldSimulation = (state.tile.conditions.simulation ?? {}) as Record<string, unknown>;
  const oldCase = typeof oldSimulation.case === "object" && oldSimulation.case !== null ? oldSimulation.case : {};
  const simulation: Record<string, unknown> = {
    ...oldSimulation,
    model: mode === "worker-d2q9" ? "lbm-d2q9@1" : "lbm-d3q19-les@1",
    computedBy: mode,
    seasons,
    steps: details.steps,
    gpuMlups: details.mlups,
    ...(details.adapter ? { adapter: details.adapter, precision: details.precision } : {}),
    case: oldCase,
  };
  const previousRasters = state.tile.presentation.rasters ?? [];
  const rasters = [...new Map([...previousRasters, raster].map((item) => [item.name, item])).values()];
  const limitations = state.tile.limitations.filter((item) => !/백그라운드 계산 대기/.test(item.note));
  if (mode === "worker-d2q9" && !limitations.some((item) => /2D 평면 대체 계산/.test(item.note))) {
    limitations.push({ kind: "estimated", note: "WebGPU 미지원 — 2D 평면 대체 계산(건물 높이·연직 흐름 미반영)" });
  }
  const median = metrics.find((metric) => metric.id === `urel_median_${season}`)?.value;
  const highShare = metrics.find((metric) => metric.id === `share_wind_3_${season}`)?.value;
  const calmShare = metrics.find((metric) => metric.id === `share_calm_lt02_${season}`)?.value;
  const inflow = (oldCase as Record<string, unknown>).inflow && typeof (oldCase as Record<string, unknown>).inflow === "object"
    ? ((oldCase as Record<string, unknown>).inflow as Record<string, unknown>)[season]
    : null;
  const judgment = {
    ruleId: "S03-relative-wind@1",
    basisMetricIds: median === null || median === undefined ? [] : [`urel_median_${season}`],
    sentence: formatWindJudgmentSentence(season, inflow, median, highShare, calmShare),
    level: null,
    criteria: null,
  } satisfies TileResult["judgment"];
  return parseTileResult({
    ...state.tile,
    tileId: `${state.run.analysisId}-S03`,
    analysisId: state.run.analysisId,
    status: mode === "worker-d2q9" ? "partial" : "complete",
    conditions: { ...state.tile.conditions, simulation },
    metrics: [...filteredMetrics, ...metrics],
    judgment,
    presentation: {
      ...state.tile.presentation,
      rasters,
      layers: [...new Set([...(state.tile.presentation.layers ?? []), "wind_inflow", "wind_ratio"])],
      legend: [...WIND_LEGEND],
    },
    provenance: { ...state.tile.provenance, sources: mergeSourceList(state.tile, source) },
    limitations,
  });
}

function rasterItemsForTile(db: Db, state: WindState): Array<{ ref: RasterRef; blob: Buffer }> {
  const items: Array<{ ref: RasterRef; blob: Buffer }> = [];
  for (const ref of state.tile.presentation.rasters ?? []) {
    const stored = loadTileRaster(db, state.row.cache_key, ref.name);
    if (stored) items.push(stored);
  }
  if (!items.some((item) => item.ref.name === state.obstacleRef.name)) items.push({ ref: state.obstacleRef, blob: state.obstacleBlob });
  return items;
}

function saveWindResult(db: Db, state: WindState, userId: string | number, tile: TileResult, items: Array<{ ref: RasterRef; blob: Buffer }>): void {
  const unique = [...new Map(items.map((item) => [item.ref.name, item])).values()];
  saveTileRasters(db, state.scopedKey, unique);
  saveTileResult(db, tile, state.scopedKey);
  saveCacheIdentity(db, state, userId, state.obstacleRef.sha256);
}

function markS03Done(db: Db, analysisId: string): void {
  ensureAnalysisJobTable(db);
  db.prepare(`INSERT INTO analysis_job (analysis_id, tile_code, status, priority, enqueued_at, started_at, finished_at, elapsed_ms, error)
    VALUES (?, 'S03', 'done', 5, ?, ?, ?, ?, NULL)
    ON CONFLICT(analysis_id, tile_code) DO UPDATE SET status = 'done', finished_at = excluded.finished_at, elapsed_ms = excluded.elapsed_ms, error = NULL`)
    .run(analysisId, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), 0);
}

function enqueueS04(db: Db, analysisId: string): void {
  ensureAnalysisJobTable(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO analysis_job (analysis_id, tile_code, status, priority, enqueued_at)
    VALUES (?, 'S04', 'queued', 6, ?)
    ON CONFLICT(analysis_id, tile_code) DO UPDATE SET status = 'queued', priority = 6, enqueued_at = excluded.enqueued_at,
      started_at = NULL, finished_at = NULL, elapsed_ms = NULL, error = NULL`).run(analysisId, now);
}

function cachedTileForSeason(db: Db, state: WindState, userId: string | number, season: WindSeason): { tile: TileResult; cacheKey: string } | null {
  ensureWindCacheTable(db);
  const row = db.prepare("SELECT analysis_id, scoped_cache_key, case_sha256 FROM wind_result_cache WHERE user_id = ? AND base_cache_key = ? AND case_sha256 = ? LIMIT 1")
    .get(userKey(userId), state.baseKey, state.obstacleRef.sha256) as WindCacheRow | undefined;
  if (!row) return null;
  const cached = db.prepare("SELECT result_json FROM tile_result WHERE analysis_id = ? AND tile_code = 'S03' AND cache_key = ? AND status IN ('complete','partial')").get(row.analysis_id, row.scoped_cache_key) as { result_json: string } | undefined;
  if (!cached) return null;
  const tile = parseTileResult(JSON.parse(cached.result_json));
  return tile.presentation.rasters?.some((ref) => ref.name === `wind_${season}_z${String(PEDESTRIAN_LAYER_Z).padStart(2, "0")}`)
    ? { tile, cacheKey: row.scoped_cache_key }
    : null;
}

function adoptCachedTile(db: Db, state: WindState, userId: string | number, cached: { tile: TileResult; cacheKey: string }): TileResult {
  const adopted = parseTileResult({
    ...cached.tile,
    tileId: `${state.run.analysisId}-S03`,
    analysisId: state.run.analysisId,
    conditions: { ...state.tile.conditions, simulation: cached.tile.conditions.simulation },
  });
  const items = (cached.tile.presentation.rasters ?? [])
    .map((ref) => loadTileRaster(db, cached.cacheKey, ref.name))
    .filter((item): item is { ref: RasterRef; blob: Buffer } => item !== null);
  if (!items.some((item) => item.ref.name === state.obstacleRef.name)) items.push({ ref: state.obstacleRef, blob: state.obstacleBlob });
  saveTileRasters(db, state.scopedKey, items);
  saveTileResult(db, adopted, state.scopedKey);
  saveCacheIdentity(db, state, userId, state.obstacleRef.sha256);
  markS03Done(db, state.run.analysisId);
  enqueueS04(db, state.run.analysisId);
  return adopted;
}

function putWindFieldInternal(db: Db, dataDir: string, analysisId: string, season: WindSeason, body: Buffer, userId: string | number): ApiReply {
  const state = readWindState(db, analysisId, userId);
  const upload = parseUploadBody(body);
  validateHeaderAgainstCase(upload.header, season, state);
  const values = asInt16(upload.raw);
  validateValues(values);
  const cached = cachedTileForSeason(db, state, userId, season);
  if (cached) {
    const adopted = adoptCachedTile(db, state, userId, cached);
    return { status: 200, body: { analysisId, season, reused: true, result: adopted } };
  }
  const cells = state.obstacleRef.cols * state.obstacleRef.rows;
  const layer = layerValues(values, upload.header, PEDESTRIAN_LAYER_Z, cells);
  const simulationCase = state.tile.conditions.simulation?.case;
  const simulationCaseRecord = simulationCase && typeof simulationCase === "object" ? simulationCase as Record<string, unknown> : null;
  const inflow = simulationCaseRecord && simulationCaseRecord.inflow && typeof simulationCaseRecord.inflow === "object"
    ? (simulationCaseRecord.inflow as Record<string, unknown>)[season]
    : null;
  const inflowDeg = inflow && typeof inflow === "object" && typeof (inflow as Record<string, unknown>).deg === "number" ? (inflow as Record<string, unknown>).deg as number : null;
  const metricResult = metricsForWindField({
    season,
    ref: state.obstacleRef,
    values: layer,
    obstacleValues: state.obstacleValues,
    centerX: toUtmk(state.run.center)[0],
    centerY: toUtmk(state.run.center)[1],
    radiusM: state.run.radiusM,
    inflowFromDeg: inflowDeg,
    steps: upload.header.steps,
    mlups: upload.header.mlups,
  });
  const encoded: EncodedWindLayer = (() => {
    const raster = {
      ref: {
        name: `wind_${season}_z${String(PEDESTRIAN_LAYER_Z).padStart(2, "0")}`,
        kind: "vector2" as const,
        crs: "EPSG:5179" as const,
        x0: state.obstacleRef.x0,
        y0: state.obstacleRef.y0,
        cellM: state.obstacleRef.cellM,
        cols: state.obstacleRef.cols,
        rows: state.obstacleRef.rows,
        dtype: "i16" as const,
        bands: 2 as const,
        scale: WIND_RAW_SCALE,
        offset: 0,
        nodata: null,
        palette: "wind_ratio",
        label: "보행층 상대풍속",
      },
      values: layer,
    };
    return { ...encodeRaster(raster), values: layer };
  })();
  const tile = mergeWindTile(state, season, metricResult.metrics, encoded.ref, sourceForBrowser(upload.header), "browser-webgpu", {
    steps: upload.header.steps,
    mlups: upload.header.mlups,
    adapter: upload.header.adapter,
    precision: upload.header.precision,
  });
  const items = rasterItemsForTile(db, state);
  items.push({ ref: encoded.ref, blob: encoded.blob });
  saveWindResult(db, state, userId, tile, items);
  markS03Done(db, analysisId);
  enqueueS04(db, analysisId);
  return { status: 200, body: { analysisId, season, reused: false, result: tile, elapsedMs: 0 } };
}

export function putWindField(appDb: Db, dataDir: string, analysisId: string, season: string, body: Buffer, userId: string | number | null): ApiReply {
  if (userId == null) return reply(403, "로그인이 필요합니다");
  if (!Buffer.isBuffer(body)) return reply(400, "바람 결과 본문이 필요합니다");
  try {
    if (!WIND_SEASONS.includes(season as WindSeason)) throw new WindApiError(400, "바람 사례 계절이 올바르지 않습니다");
    return putWindFieldInternal(appDb, "", analysisId, season as WindSeason, body, userId);
  } catch (error) {
    if (error instanceof WindApiError) return reply(error.status, error.message);
    return reply(500, "바람 결과 저장 중 오류가 발생했습니다");
  }
}

function markFallbackRunning(db: Db, analysisId: string): void {
  ensureAnalysisJobTable(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO analysis_job (analysis_id, tile_code, status, priority, enqueued_at, started_at)
    VALUES (?, 'S03', 'running', 5, ?, ?)
    ON CONFLICT(analysis_id, tile_code) DO UPDATE SET status = 'running', started_at = excluded.started_at,
      finished_at = NULL, elapsed_ms = NULL, error = NULL`).run(analysisId, now, now);
}

function runFallbackInternal(db: Db, dataDir: string, analysisId: string, userId: string | number, reason: string): TileResult {
  const state = readWindState(db, analysisId, userId);
  const manifest = readManifest(dataDir);
  if (!manifest) throw new WindApiError(503, "분석 데이터가 아직 게시되지 않았습니다");
  const core = openDataFile(dataDir, manifest, "core");
  const run = state.run;
  const topo = topoHandleFor(db, run.parameters, run.userId);
  if (hasTopoParameter(run.parameters) && !topo) {
    core.close();
    throw new WindApiError(404, "분석 자료를 찾을 수 없습니다");
  }
  const ctx = new EngineContext(dataDir, manifest, analysisId, {
    address: run.address,
    center: run.center,
    radiusM: run.radiusM,
    analysisDate: run.analysisDate,
    pnu: typeof run.parameters.pnu === "string" ? run.parameters.pnu : null,
    site: restoreSiteFromParameters(run.parameters),
  }, { core }, { topo });
  try {
    const built = buildWindCase(ctx);
    if (!built) throw new WindApiError(409, "D2Q9 대체 계산에 필요한 기상·건축물 자료가 없습니다");
    const c = caseLike(state, built);
    let tileState = state;
    const items = rasterItemsForTile(db, state);
    for (const season of WIND_SEASONS) {
      const inflow = c.inflow[season];
      if (!inflow) continue;
      const started = performance.now();
      const field = fallbackField(c, inflow.deg);
      const encoded = encodedWindLayer(c, season, PEDESTRIAN_LAYER_Z, field.values, "2D 대체 보행층 상대풍속");
      const metricResult = metricsForWindField({
        season,
        ref: state.obstacleRef,
        values: field.values,
        obstacleValues: state.obstacleValues,
        centerX: c.centerX,
        centerY: c.centerY,
        radiusM: c.radiusM,
        inflowFromDeg: inflow.deg,
        steps: field.steps,
        mlups: null,
      });
      tileState = { ...tileState, tile: mergeWindTile(tileState, season, metricResult.metrics, encoded.ref, sourceForFallback(), "worker-d2q9", { steps: field.steps, mlups: null }) };
      items.push({ ref: encoded.ref, blob: encoded.blob });
      void started;
    }
    if (tileState.tile.conditions.simulation) {
      const simulation = { ...tileState.tile.conditions.simulation, fallbackReason: reason };
      tileState = { ...tileState, tile: parseTileResult({ ...tileState.tile, conditions: { ...tileState.tile.conditions, simulation } }) };
    }
    saveWindResult(db, state, userId, tileState.tile, items);
    markS03Done(db, analysisId);
    enqueueS04(db, analysisId);
    return tileState.tile;
  } finally {
    ctx.close();
  }
}

export function runWindFallbackJob(appDb: Db, dataDir: string, analysisId: string, userId: string | number, reason = "WebGPU 미지원"): TileResult {
  const started = performance.now();
  try {
    const result = runFallbackInternal(appDb, dataDir, analysisId, userId, reason.slice(0, 200));
    return result;
  } catch (error) {
    ensureAnalysisJobTable(appDb);
    appDb.prepare("UPDATE analysis_job SET status = 'failed', finished_at = ?, elapsed_ms = ?, error = ? WHERE analysis_id = ? AND tile_code = 'S03'")
      .run(new Date().toISOString(), Math.max(1, Math.round(performance.now() - started)), String(error instanceof Error ? error.message : error).slice(0, 500), analysisId);
    throw error;
  }
}

export function requestWindFallback(
  appDb: Db,
  analysisId: string,
  userId: string | number | null,
  reason: string,
  paths?: { appDbPath: string; dataDir: string },
): ApiReply {
  if (userId == null) return reply(403, "로그인이 필요합니다");
  if (paths) return queueWindFallback(appDb, paths.appDbPath, paths.dataDir, analysisId, userId, reason);
  try {
    readWindState(appDb, analysisId, userId);
    return { status: 202, body: { analysisId, status: "queued", model: "lbm-d2q9@1", reason: reason.slice(0, 200), worker: "caller" } };
  } catch (error) {
    if (error instanceof WindApiError) return reply(error.status, error.message);
    return reply(500, "2D 대체 계산을 큐에 넣지 못했습니다");
  }
}

export function queueWindFallback(appDb: Db, appDbPath: string, dataDir: string, analysisId: string, userId: string | number | null, reason: string): ApiReply {
  if (userId == null) return reply(403, "로그인이 필요합니다");
  try {
    readWindState(appDb, analysisId, userId);
    markFallbackRunning(appDb, analysisId);
    const worker = new Worker(new URL("./wind-api.ts", import.meta.url), {
      workerData: { kind: "s03-fallback", appDbPath, dataDir, analysisId, userId: userKey(userId), reason },
    });
    worker.unref();
    worker.once("exit", () => {
      void import("./jobs").then(({ startJobRunner }) => startJobRunner({ appDbPath, dataDir })).catch(() => undefined);
    });
    return { status: 202, body: { analysisId, status: "queued", model: "lbm-d2q9@1", reason: reason.slice(0, 200) } };
  } catch (error) {
    if (error instanceof WindApiError) return reply(error.status, error.message);
    return reply(500, "2D 대체 계산을 큐에 넣지 못했습니다");
  }
}

if (!isMainThread && workerData && typeof workerData === "object" && (workerData as { kind?: string }).kind === "s03-fallback") {
  const data = workerData as { appDbPath: string; dataDir: string; analysisId: string; userId: string; reason: string };
  const db = openV2AppDb(data.appDbPath);
  try {
    runWindFallbackJob(db, data.dataDir, data.analysisId, data.userId, data.reason);
  } finally {
    db.close();
  }
}
