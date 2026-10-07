/** API 라우트의 본체. 인증은 라우트가 하고, 여기서는 입력 검증·실행·응답 모양만 다룬다(테스트하기 쉽게 분리). */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { getAnalysisRun, loadScene, requestAnalysisCancellation } from "../app-db";
import { DEFAULT_RADIUS_M, RADIUS_CHOICES, restoreSummary, runAnalysis } from "./run";
import { listJobs, type JobInfo } from "./jobs-store";
import { SITE_FAILURE_MESSAGE } from "./site";
import { parseTileResult, type TileResult } from "../tile-result";

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

type StoredTileMetaRow = { tile_code: string; status: string; created_at: string };
type StoredTileRow = StoredTileMetaRow & { result_json: string };
type TileState = { code: string; status: TileResult["status"]; revision: string; elapsedMs: number | null };
type AnalysisSnapshot = { revision: string; tiles: TileState[]; jobs: JobInfo[] };
type StatusJob = Pick<JobInfo, "code" | "status" | "elapsedMs" | "error" | "retryable" | "cancelRequestedAt">;

function storedElapsed(raw: unknown): number | null {
  const value = (raw as { elapsedMs?: unknown } | null)?.elapsedMs;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTileMetadata(db: BetterSqlite3.Database, analysisId: string): StoredTileMetaRow[] {
  return db.prepare("SELECT tile_code, status, created_at FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").all(analysisId) as StoredTileMetaRow[];
}

function readTileRows(db: BetterSqlite3.Database, analysisId: string, tileCodes?: readonly string[]): StoredTileRow[] {
  if (tileCodes === undefined) {
    return db.prepare("SELECT tile_code, status, created_at, result_json FROM tile_result WHERE analysis_id = ? ORDER BY tile_code").all(analysisId) as StoredTileRow[];
  }
  if (tileCodes.length === 0) return [];
  const placeholders = tileCodes.map(() => "?").join(",");
  return db.prepare(`SELECT tile_code, status, created_at, result_json FROM tile_result WHERE analysis_id = ? AND tile_code IN (${placeholders}) ORDER BY tile_code`)
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
  return readTileRows(db, analysisId, tileCodes).map((row) => {
    const raw = JSON.parse(row.result_json);
    const result = parseTileResult(raw);
    const elapsedMs = storedElapsed(raw);
    return elapsedMs === null ? result : Object.assign(result, { elapsedMs });
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

export function getAnalysis(appDb: BetterSqlite3.Database, id: string, userId?: string | number | null, options: { tileCodes?: readonly string[] } = {}): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || !canRead(run, userId)) return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  const snapshot = analysisSnapshot(appDb, id, run);
  // 요약과 결과가 같은 저장 JSON을 두 번 파싱하지 않도록 한 번만 읽고,
  // 증분 요청(?tiles=)은 이미 파싱한 전체 결과에서 골라낸다.
  const allResults = loadResults(appDb, id);
  const requested = options.tileCodes === undefined ? null : new Set(options.tileCodes);
  const results = requested === null ? allResults : allResults.filter((result) => requested.has(result.tileCode));
  return { status: 200, body: { analysisId: id, status: run.status, summary: restoreSummary(run, allResults), results, jobs: snapshot.jobs, tiles: snapshot.tiles, revision: snapshot.revision } };
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
