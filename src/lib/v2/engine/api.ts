/** API 라우트의 본체. 인증은 라우트가 하고, 여기서는 입력 검증·실행·응답 모양만 다룬다(테스트하기 쉽게 분리). */
import type BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { getAnalysisRun, loadScene, loadTileResults } from "../app-db";
import { DEFAULT_RADIUS_M, RADIUS_CHOICES, restoreSummary, runAnalysis } from "./run";
import { SITE_FAILURE_MESSAGE } from "./site";

const realDate = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

const bodySchema = z
  .object({
    address: z.string().trim().min(1).max(200).optional(),
    center: z.tuple([z.number().min(124).max(132), z.number().min(33).max(39)]).optional(),
    radiusM: z.number().default(DEFAULT_RADIUS_M),
    analysisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(realDate, "분석일이 올바른 날짜가 아닙니다").optional(),
  })
  .refine((b) => b.address !== undefined || b.center !== undefined, { message: "주소 또는 좌표가 필요합니다" })
  .refine((b) => (RADIUS_CHOICES as readonly number[]).includes(b.radiusM), { message: `반경은 ${RADIUS_CHOICES.join(", ")}m 중 하나여야 합니다`, path: ["radiusM"] });

export interface ApiReply {
  status: number;
  body: Record<string, unknown>;
}

export function postAnalysis(appDb: BetterSqlite3.Database, dataDir: string, raw: unknown, userId?: string | number | null): ApiReply {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0].message } };
  let outcome;
  try {
    outcome = runAnalysis(appDb, dataDir, { ...parsed.data, userId });
  } catch (e) {
    if (/no published manifest/.test((e as Error).message)) return { status: 503, body: { error: "분석 데이터가 아직 게시되지 않았습니다" } };
    return { status: 500, body: { error: "분석 중 오류가 발생했습니다" } };
  }
  if (!outcome.ok) return { status: 422, body: { error: SITE_FAILURE_MESSAGE[outcome.reason], reason: outcome.reason } };
  return { status: 200, body: { analysisId: outcome.analysisId, summary: outcome.summary, results: outcome.results } };
}

function canRead(run: { userId?: string | number | null }, userId?: string | number | null): boolean {
  return run.userId == null || (userId != null && run.userId === String(userId));
}

export function getAnalysis(appDb: BetterSqlite3.Database, id: string, userId?: string | number | null): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || !canRead(run, userId)) return { status: 404, body: { error: "분석을 찾을 수 없습니다" } };
  const results = loadTileResults(appDb, id);
  return { status: 200, body: { analysisId: id, summary: restoreSummary(run, results), results } };
}

export function getScene(appDb: BetterSqlite3.Database, id: string, userId?: string | number | null): ApiReply {
  const run = getAnalysisRun(appDb, id);
  if (!run || !canRead(run, userId)) return { status: 404, body: { error: "장면을 찾을 수 없습니다" } };
  const scene = loadScene(appDb, id);
  if (!scene) return { status: 404, body: { error: "장면을 찾을 수 없습니다" } };
  return { status: 200, body: scene as unknown as Record<string, unknown> };
}
