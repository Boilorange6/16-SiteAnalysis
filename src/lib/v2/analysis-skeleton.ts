/**
 * P0 끝에서 끝 증명용 최소 분석 (spec §6 P0 완료 기준).
 * D02 건물 타일 하나만 만든다. 실제 타일 엔진은 P1에서 이 흐름 위에 올린다.
 */
import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { LngLat } from "./crs";
import { queryFeaturesInRadius } from "./data/features";
import { manifestHash, openDataFile, readManifest } from "./data/manifest";
import { createAnalysisRun, finishAnalysisRun, getAnalysisRun, saveTileResult } from "./app-db";
import { parseTileResult, tileCacheKey, type TileResult } from "./tile-result";

export const SKELETON_ENGINE_VERSION = "v2-p0";

export interface SkeletonInput {
  address: string;
  center: LngLat;
  radiusM: number;
  analysisDate: string;
}

interface ReleaseRow {
  release_id: string;
  source_id: string;
  source_as_of: string | null;
  fetched_at: string;
}

export function runSkeletonAnalysis(
  appDb: BetterSqlite3.Database,
  dataDir: string,
  input: SkeletonInput,
): { analysisId: string; manifestHash: string; tiles: TileResult[] } {
  const manifest = readManifest(dataDir);
  if (!manifest) throw new Error("no published manifest — run a data build first");
  const hash = manifestHash(manifest);
  // 데이터 파일을 먼저 연다 — 열기에 실패하면 'running'으로 남는 분석 실행을 만들지 않는다.
  const core = openDataFile(dataDir, manifest, "core");
  const analysisId = randomUUID();
  try {
    createAnalysisRun(appDb, {
      analysisId, address: input.address, center: input.center, radiusM: input.radiusM,
      analysisDate: input.analysisDate, manifestHash: hash, engineVersion: SKELETON_ENGINE_VERSION, parameters: {},
    });
    const hits = queryFeaturesInRadius(core, input.center, input.radiusM, ["building"]);
    // 반경 안 건물이 0동이어도 건물 원천이 적재돼 있으면 "0동 관측"이다. 원천 자체가 없으면 "자료 없음"이다.
    const releases = core
      .prepare(`SELECT release_id, source_id, source_as_of, fetched_at FROM source_release
        WHERE release_id IN (SELECT DISTINCT release_id FROM feature WHERE kind = 'building') ORDER BY release_id`)
      .all() as ReleaseRow[];
    const hasSource = releases.length > 0;

    const conditions = {
      address: input.address,
      center: [input.center[0], input.center[1]] as [number, number],
      radiusM: input.radiusM,
      analysisDate: input.analysisDate,
      timezone: "Asia/Seoul" as const,
      filters: {},
      simulation: null,
      parcelSnapshotHash: null,
    };
    const tile = parseTileResult({
      tileId: `${analysisId}-D02`,
      analysisId,
      tileType: "diagram",
      tileCode: "D02",
      status: hasSource ? "complete" : "no_data",
      engineVersion: SKELETON_ENGINE_VERSION,
      conditions,
      metrics: [{
        id: "building_count", label: "반경 내 건물", value: hasSource ? hits.length : null, unit: "동",
        formulaVersion: "d02-count@1", numerator: null, denominator: null, status: hasSource ? "observed" : "missing",
      }],
      judgment: null,
      presentation: { legend: [], camera: null, layers: ["building"], outputFace: "front" },
      provenance: {
        manifestHash: hash,
        // 의도: 반경 안 적중 여부와 무관하게 조회한 건물 원천(파일 내 모든 building release)을 모두 나열한다.
        sources: releases.map((r) => ({ sourceId: r.source_id, releaseId: r.release_id, sourceAsOf: r.source_as_of, fetchedAt: r.fetched_at })),
      },
      limitations: hasSource ? [] : [{ kind: "not_provided", note: "건물 원천이 적재되지 않았습니다" }],
    });
    saveTileResult(appDb, tile, tileCacheKey({ tileCode: "D02", manifestHash: hash, engineVersion: SKELETON_ENGINE_VERSION, conditions }));
    finishAnalysisRun(appDb, analysisId, "complete");
    return { analysisId, manifestHash: hash, tiles: [tile] };
  } catch (error) {
    try {
      if (getAnalysisRun(appDb, analysisId)) finishAnalysisRun(appDb, analysisId, "failed");
    } catch {
      // 상태 기록 실패는 무시한다 — 원래 오류를 가리지 않는다.
    }
    throw error;
  } finally {
    core.close();
  }
}
