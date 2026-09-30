/**
 * 분석 실행: manifest 읽기 → 대지 확정 → 타일 계산(캐시 우선) → 저장. analysis-skeleton.ts의 흐름을 따른다.
 * 분석마다 manifest를 다시 읽는다(다른 프로세스가 새 버전을 게시할 수 있다).
 */
import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { createAnalysisRun, finishAnalysisRun, findCachedTileResult, getAnalysisRun, saveTileResult } from "../app-db";
import { openDataFile, readManifest } from "../data/manifest";
import { tileCacheKey, type TileResult } from "../tile-result";
import type { SiteSummary } from "../ui/tile-view";
import { EngineContext } from "./context";
import { resolveSite, type SiteFailure } from "./site";
import { buildSummary } from "./summary";
import { a01 } from "./tiles/a01";
import { a03 } from "./tiles/a03";
import { a04 } from "./tiles/a04";
import { a05 } from "./tiles/a05";
import { a06 } from "./tiles/a06";
import { ENGINE_VERSION, makeTile } from "./tiles/common";
import { notProvided } from "./tiles/not-provided";

export const RADIUS_CHOICES = [500, 800, 1000, 2000, 3000] as const;
export const DEFAULT_RADIUS_M = 800;

export interface RunInput {
  address?: string;
  center?: LngLat;
  radiusM: number;
  analysisDate?: string;
}

export type RunOutcome =
  | { ok: true; analysisId: string; summary: SiteSummary; results: TileResult[]; computed: string[]; reused: string[] }
  | { ok: false; reason: SiteFailure };

/** 화면 순서(카탈로그 순). 계산하는 타일 다음에 아직 제공하지 않는 타일이 코드 순서에 끼어든다. */
const TILES: Array<[code: string, compute: (ctx: EngineContext) => TileResult]> = [
  ["A01", a01],
  ["A02", (c) => notProvided(c, "A02")],
  ["A03", a03],
  ["A04", a04],
  ["A05", a05],
  ["A06", a06],
  ["A07", (c) => notProvided(c, "A07")],
  ["A09", (c) => notProvided(c, "A09")],
  ["A10", (c) => notProvided(c, "A10")],
  ["A12", (c) => notProvided(c, "A12")],
  ["D04", (c) => notProvided(c, "D04")],
  ["S02", (c) => notProvided(c, "S02")],
  ["S03", (c) => notProvided(c, "S03")],
];

export const todayKst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

export function runAnalysis(appDb: BetterSqlite3.Database, dataDir: string, input: RunInput): RunOutcome {
  const manifest = readManifest(dataDir);
  if (!manifest) throw new Error("no published manifest — run a data build first");
  const core = openDataFile(dataDir, manifest, "core");
  const site = (() => {
    try {
      return resolveSite(core, input);
    } finally {
      core.close();
    }
  })();
  if (!site.ok) return { ok: false, reason: site.reason };

  const analysisId = randomUUID();
  const analysisDate = input.analysisDate ?? todayKst();
  const ctx = new EngineContext(dataDir, manifest, analysisId, { address: site.label, center: site.center, radiusM: input.radiusM, analysisDate });
  try {
    createAnalysisRun(appDb, {
      analysisId, address: site.label, center: site.center, radiusM: input.radiusM, analysisDate,
      manifestHash: ctx.manifestHash, engineVersion: ENGINE_VERSION,
      parameters: { pnu: site.pnu, legalCode: site.legalCode, jimok: site.jimok },
    });
    const results: TileResult[] = [];
    const computed: string[] = [];
    const reused: string[] = [];
    for (const [code, compute] of TILES) {
      const key = tileCacheKey({ tileCode: code, manifestHash: ctx.manifestHash, engineVersion: ENGINE_VERSION, conditions: ctx.conditions });
      const cached = findCachedTileResult(appDb, key);
      let tile: TileResult;
      if (cached) {
        tile = { ...cached, tileId: `${analysisId}-${code}`, analysisId };
        reused.push(code);
      } else {
        try {
          tile = compute(ctx);
          computed.push(code);
        } catch (e) {
          // 한 타일의 실패가 분석 전체를 막지 않는다 — 실패 타일은 재시도할 수 있고 캐시되지 않는다
          tile = makeTile(ctx, { code, status: "failed", metrics: [], sources: [], limitations: [{ kind: "unknown", note: `계산 중 오류: ${String((e as Error).message).slice(0, 200)}` }] });
        }
      }
      saveTileResult(appDb, tile, key);
      results.push(tile);
    }
    finishAnalysisRun(appDb, analysisId, "complete");
    return { ok: true, analysisId, summary: buildSummary({ address: site.label, jimok: site.jimok }, input.radiusM, results), results, computed, reused };
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
  return buildSummary({ address: run.address, jimok }, run.radiusM, results);
}
