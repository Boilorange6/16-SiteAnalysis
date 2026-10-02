/** D17 지형·등고선 — DEM 상대고 밴드와 절대고 등고선. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { relativeTerrainGrid, terrainBandPolygons, terrainContourLines, terrainGridFor, terrainGridStats, terrainValuesInCircle } from "./terrain-grid";
import { DEM_LIMITATION, demReader, demSources } from "./terrain-shared";
import { est, makeTile, obs } from "./common";
import { notProvided } from "./not-provided";
import { maxOf, minOf } from "../../extent";

const RELIEF_BREAKS = [-20, -5, 5, 20];
const RELIEF_LAYERS = ["relief_lt_m20", "relief_m20_m5", "relief_m5_5", "relief_5_20", "relief_ge20"];
const CONTOUR_INTERVAL_M = 5;

const percent = (part: number, whole: number): number => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

export function d17(ctx: EngineContext): TileResult {
  const reader = demReader(ctx);
  const grid = terrainGridFor(ctx, 30);
  if (!reader || !grid) return notProvided(ctx, "D17", "지형(DEM) 미적재");

  const absoluteValues = terrainValuesInCircle(grid, ctx.input.radiusM);
  if (absoluteValues.length === 0) {
    return makeTile(ctx, {
      code: "D17",
      type: "diagram",
      status: "no_data",
      metrics: [],
      sources: demSources(ctx),
      layers: [...RELIEF_LAYERS, "dem_nodata", "contour"],
      limitations: [DEM_LIMITATION, { kind: "not_provided", note: "분석 반경 안에서 유효한 DEM 표고를 확인하지 못했습니다." }],
    });
  }

  const readerCenter = reader.elevation(...ctx.input.center);
  const originZ = readerCenter ?? median(absoluteValues);
  if (originZ === null) return notProvided(ctx, "D17", "지형(DEM) 유효 표고 미확인");

  const relative = relativeTerrainGrid(grid, originZ);
  const stats = terrainGridStats(relative, ctx.input.radiusM);
  const relativeValues = terrainValuesInCircle(relative, ctx.input.radiusM);
  const reliefMin = minOf(relativeValues);
  const reliefMax = maxOf(relativeValues);
  const reliefMedian = median(relativeValues) as number;
  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const bands = terrainBandPolygons(ctx.input.center, ctx.input.radiusM, relative, RELIEF_BREAKS, RELIEF_LAYERS, "dem_nodata");
  const lines = terrainContourLines(ctx.input.center, ctx.input.radiusM, grid, CONTOUR_INTERVAL_M, "contour");
  const nodataArea = bands.areaM2.at(-1) ?? 0;
  const centerStatus = readerCenter === null ? "estimated" : "observed";

  const metrics: TileResult["metrics"] = [
    centerStatus === "estimated"
      ? est("center_elevation_m", "중심 표고", originZ, "m", "d17-center-elevation@1:중심 DEM 표고; 결측이면 유효 격자 중앙값", null, null)
      : obs("center_elevation_m", "중심 표고", originZ, "m", "d17-center-elevation@1:중심 DEM 표고", null, null),
    obs("fill_dem_pct", "DEM 유효 격자 채움률", percent(stats.valid, stats.cells), "%", "d17-fill-dem@1:원 안 셀 중심 중 유효 DEM 셀÷원 안 셀", stats.valid, stats.cells),
    est("relief_min_m", "중심 대비 최저 고저차", reliefMin, "m", "d17-relief-range@1:원 안 유효 셀의 표고−중심 표고 최솟값"),
    est("relief_max_m", "중심 대비 최고 고저차", reliefMax, "m", "d17-relief-range@1:원 안 유효 셀의 표고−중심 표고 최댓값"),
    est("relief_median_m", "중심 대비 고저차 중앙값", reliefMedian, "m", "d17-relief-median@1:원 안 유효 셀의 표고−중심 표고 중앙값"),
    ...RELIEF_LAYERS.map((layer, index) => est(
      `share_${layer}`,
      `${layer} 면적 구성비`,
      percent(bands.areaM2[index] ?? 0, circleAreaM2),
      "%",
      `d17-relief-share@1:${layer} 밴드의 원 교차면적÷π·r²`,
      Math.round(bands.areaM2[index] ?? 0),
      Math.round(circleAreaM2),
    )),
    est("share_nodata_pct", "DEM 결측 면적 구성비", percent(nodataArea, circleAreaM2), "%", "d17-relief-nodata@1:DEM 결측 밴드의 원 교차면적÷π·r²", Math.round(nodataArea), Math.round(circleAreaM2)),
    obs("contour_interval_m", "등고선 간격", CONTOUR_INTERVAL_M, "m", "d17-contour-interval@1:절대 표고 등고선 간격"),
  ];

  const limitations: TileResult["limitations"] = [
    DEM_LIMITATION,
    { kind: "estimated", note: "등고선은 30m 격자 보간선입니다." },
    ...(readerCenter === null ? [{ kind: "estimated" as const, note: "중심 표고 결측으로 유효 DEM 격자 중앙값을 상대고 기준으로 사용했습니다." }] : []),
  ];
  if (stats.valid < stats.cells) limitations.push({ kind: "partial", note: `원 안 DEM 셀 ${stats.cells - stats.valid}개는 결측으로 면적 구성에서 별도 표시했습니다.` });

  return makeTile(ctx, {
    code: "D17",
    type: "diagram",
    status: stats.valid === stats.cells ? "complete" : "partial",
    metrics,
    judgment: {
      ruleId: "D17-relief@1",
      basisMetricIds: ["fill_dem_pct", "relief_min_m", "relief_max_m"],
      sentence: `반경 안 DEM 유효 셀 ${stats.valid.toLocaleString("en-US")}개에서 중심 대비 고저차 ${reliefMin.toFixed(1)}~${reliefMax.toFixed(1)}m를 확인 → 상대고 밴드와 5m 절대고 등고선으로 지형 기복을 표시 → 측량과 최신 지형 자료로 확인할 것`,
      level: null,
      criteria: null,
    },
    sources: demSources(ctx),
    layers: [...RELIEF_LAYERS, "dem_nodata", "contour"],
    polygons: bands.polygons,
    lines,
    limitations,
  });
}
