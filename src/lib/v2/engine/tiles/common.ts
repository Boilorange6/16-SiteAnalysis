/** 타일 공통: 지표 생성기와 TileResult 조립. 결과는 항상 parseTileResult를 통과한다. */
import { parseTileResult, type TileResult } from "../../tile-result";
import { sourceName } from "../../ui/tile-catalog";
import type { EngineContext, Limitation, SourceRef } from "../context";

export const ENGINE_VERSION = "v2-p1b-1";

type Metric = TileResult["metrics"][number];

export function obs(id: string, label: string, value: number, unit: string, formulaVersion: string, numerator: number | null = null, denominator: number | null = null): Metric {
  return { id, label, value, unit, formulaVersion, numerator, denominator, status: "observed" };
}
export function est(id: string, label: string, value: number, unit: string, formulaVersion: string, numerator: number | null = null, denominator: number | null = null): Metric {
  return { ...obs(id, label, value, unit, formulaVersion, numerator, denominator), status: "estimated" };
}
export function missing(id: string, label: string, unit: string, formulaVersion: string): Metric {
  return { id, label, value: null, unit, formulaVersion, numerator: null, denominator: null, status: "missing" };
}

export const roundM = (m: number) => Math.round(m);
export const nearestM = (distances: Array<number | null>): number | null => {
  const ds = distances.filter((d): d is number => d !== null);
  return ds.length ? roundM(Math.min(...ds)) : null;
};

export interface TileDraft {
  code: string;
  type?: TileResult["tileType"];
  status: TileResult["status"];
  metrics: Metric[];
  judgment?: TileResult["judgment"];
  sources: SourceRef[];
  limitations: Limitation[];
  layers?: string[];
}

export function makeTile(ctx: EngineContext, d: TileDraft): TileResult {
  return parseTileResult({
    tileId: `${ctx.analysisId}-${d.code}`,
    analysisId: ctx.analysisId,
    tileType: d.type ?? "analysis",
    tileCode: d.code,
    status: d.status,
    engineVersion: ENGINE_VERSION,
    conditions: ctx.conditions,
    metrics: d.metrics,
    judgment: d.judgment ?? null,
    presentation: { legend: [], camera: null, layers: d.layers ?? [], outputFace: "front" },
    provenance: { manifestHash: ctx.manifestHash, sources: d.sources },
    limitations: d.limitations,
  });
}

/** 필요한 원천이 하나라도 적재돼 있지 않으면 자료 없음 타일 */
export function noDataTile(ctx: EngineContext, code: string, missingSources: string[]): TileResult {
  return makeTile(ctx, {
    code,
    status: "no_data",
    metrics: [],
    sources: [],
    limitations: [{ kind: "not_provided", note: `${missingSources.map(sourceName).join(", ")} 자료가 적재되지 않았습니다.` }],
  });
}

/** 한국어 ‘n곳’ 같은 단위 문장에 쓰는 천 단위 쉼표 */
export const fmt = (n: number) => n.toLocaleString("en-US");
