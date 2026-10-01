/**
 * 분석 실행: manifest 읽기 → 대지 확정 → 타일 계산(캐시 우선) → 저장. analysis-skeleton.ts의 흐름을 따른다.
 * 분석마다 manifest를 다시 읽는다(다른 프로세스가 새 버전을 게시할 수 있다).
 */
import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "../crs";
import { createAnalysisRun, finishAnalysisRun, findCachedTileResult, getAnalysisRun, saveScene, saveTileResult } from "../app-db";
import { openDataFile, readManifest } from "../data/manifest";
import { tileCacheKey, type TileResult } from "../tile-result";
import type { SiteSummary } from "../ui/tile-view";
import { EngineContext } from "./context";
import { buildScene } from "./scene";
import { resolveSite, type SiteFailure, type SiteResult } from "./site";
import { buildSummary } from "./summary";
import { a01 } from "./tiles/a01";
import { a02 } from "./tiles/a02";
import { a03 } from "./tiles/a03";
import { a04 } from "./tiles/a04";
import { a05 } from "./tiles/a05";
import { a06 } from "./tiles/a06";
import { a07 } from "./tiles/a07";
import { a09 } from "./tiles/a09";
import { a10 } from "./tiles/a10";
import { a11 } from "./tiles/a11";
import { a12 } from "./tiles/a12";
import { ENGINE_VERSION, makeTile } from "./tiles/common";
import { d02 } from "./tiles/d02";
import { d03 } from "./tiles/d03";
import { d04 } from "./tiles/d04";
import { d05 } from "./tiles/d05";
import { d06 } from "./tiles/d06";
import { d07 } from "./tiles/d07";
import { d08 } from "./tiles/d08";
import { d09 } from "./tiles/d09";
import { d11 } from "./tiles/d11";
import { d12 } from "./tiles/d12";
import { d13 } from "./tiles/d13";
import { d14 } from "./tiles/d14";
import { d15 } from "./tiles/d15";
import { d16 } from "./tiles/d16";
import { d17 } from "./tiles/d17";
import { d18 } from "./tiles/d18";
import { d19 } from "./tiles/d19";
import { d20 } from "./tiles/d20";
import { d21 } from "./tiles/d21";
import { d22 } from "./tiles/d22";
import { d23 } from "./tiles/d23";
import { d24 } from "./tiles/d24";
import { d25 } from "./tiles/d25";
import { d27 } from "./tiles/d27";
import { notProvided } from "./tiles/not-provided";
import { s01 } from "./tiles/s01";
import { s02 } from "./tiles/s02";

export const RADIUS_CHOICES = [500, 800, 1000, 2000, 3000] as const;
export const DEFAULT_RADIUS_M = 800;

export interface RunInput {
  address?: string;
  center?: LngLat;
  radiusM: number;
  analysisDate?: string;
  userId?: string | number | null;
}

export type RunOutcome =
  | { ok: true; analysisId: string; summary: SiteSummary; results: TileResult[]; computed: string[]; reused: string[] }
  | { ok: false; reason: SiteFailure };

/** 화면 순서(카탈로그 순). 계산하는 타일 다음에 아직 제공하지 않는 타일이 코드 순서에 끼어든다. */
const TILES: Array<[code: string, compute: (ctx: EngineContext) => TileResult]> = [
  ["A01", a01],
  ["A02", a02],
  ["A03", a03],
  ["A04", a04],
  ["A05", a05],
  ["A06", a06],
  ["A07", a07],
  ["A09", a09],
  ["A10", a10],
  ["A11", a11],
  ["A12", a12],
  ["D02", d02],
  ["D03", d03],
  ["D04", d04],
  ["D05", d05],
  ["D06", d06],
  ["D07", d07],
  ["D08", d08],
  ["D09", d09],
  ["D11", d11],
  ["D12", d12],
  ["D13", d13],
  ["D14", d14],
  ["D15", d15],
  ["D16", d16],
  ["D17", d17],
  ["D18", d18],
  ["D19", d19],
  ["D20", d20],
  ["D21", d21],
  ["D22", d22],
  ["D23", d23],
  ["D24", d24],
  ["D25", d25],
  ["D27", d27],
  ["S01", s01],
  ["S02", s02],
  ["S03", (c) => notProvided(c, "S03")],
];

export const todayKst = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

export function runAnalysis(appDb: BetterSqlite3.Database, dataDir: string, input: RunInput): RunOutcome {
  const manifest = readManifest(dataDir);
  if (!manifest) throw new Error("no published manifest — run a data build first");
  const core = openDataFile(dataDir, manifest, "core");
  let site: SiteResult;
  try {
    site = resolveSite(core, input);
  } catch (error) {
    core.close();
    throw error;
  }
  if (!site.ok) {
    core.close();
    return { ok: false, reason: site.reason };
  }

  const analysisId = randomUUID();
  const analysisDate = input.analysisDate ?? todayKst();
  const ctx = new EngineContext(dataDir, manifest, analysisId, { address: site.label, center: site.center, radiusM: input.radiusM, analysisDate, pnu: site.pnu }, { core });
  try {
    createAnalysisRun(appDb, {
      analysisId, address: site.label, center: site.center, radiusM: input.radiusM, analysisDate,
      manifestHash: ctx.manifestHash, engineVersion: ENGINE_VERSION,
      parameters: { pnu: site.pnu, legalCode: site.legalCode, jimok: site.jimok },
      userId: input.userId,
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
    // 장면은 내보내기용 부가 산출물 — 실패해도 분석 결과는 살린다
    try {
      const scene = buildScene(ctx);
      if (scene) saveScene(appDb, scene);
    } catch (e) {
      console.warn(`scene build failed for ${analysisId}: ${(e as Error).message}`);
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
