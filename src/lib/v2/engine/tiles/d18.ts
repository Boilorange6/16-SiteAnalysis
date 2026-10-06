/** D18 경사도 — DEM 중앙차분 경사 밴드. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { slopeGridFor, terrainBandPolygons, terrainClassGrid, terrainGridFor, terrainGridStats, terrainValuesInCircle } from "./terrain-grid";
import { DEM_LIMITATION, demSources } from "./terrain-shared";
import { est, makeTile } from "./common";
import { notProvided } from "./not-provided";
import { maxOf, minOf } from "../../extent";

const SLOPE_BREAKS = [5, 10, 15, 20];
const SLOPE_LAYERS = ["slope_0_5", "slope_5_10", "slope_10_15", "slope_15_20", "slope_ge20"];

const percent = (part: number, whole: number): number => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

export function d18(ctx: EngineContext): TileResult {
  const dem = terrainGridFor(ctx, 30);
  if (!dem) return notProvided(ctx, "D18", "지형 자료를 확인하지 못했습니다.");

  const slope = slopeGridFor(ctx, 30);
  if (!slope) return notProvided(ctx, "D18", "지형 경사 자료를 확인하지 못했습니다.");
  const reportedSlope = terrainClassGrid(slope);
  const stats = terrainGridStats(reportedSlope, ctx.input.radiusM);
  const values = terrainValuesInCircle(reportedSlope, ctx.input.radiusM);
  if (values.length === 0) {
    return makeTile(ctx, {
      code: "D18",
      type: "diagram",
      status: "no_data",
      metrics: [],
      sources: demSources(ctx),
      layers: [...SLOPE_LAYERS, "slope_nodata"],
      limitations: [DEM_LIMITATION, { kind: "not_provided", note: "분석 반경 안에서 이웃 표고가 모두 유효한 경사 셀을 확인하지 못했습니다." }],
    });
  }

  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const slopeMedian = ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
  const bands = terrainBandPolygons(ctx.input.center, ctx.input.radiusM, reportedSlope, SLOPE_BREAKS, SLOPE_LAYERS, "slope_nodata");
  const slopeMax = maxOf(values);
  const nodataArea = bands.areaM2.at(-1) ?? 0;
  const metrics: TileResult["metrics"] = [
    est("fill_slope_pct", "경사 계산 가능 셀 채움률", percent(stats.valid, stats.cells), "%", "d18-fill-slope@1:원 안 셀 중심 중 중앙차분 경사 계산 가능 셀÷원 안 셀", stats.valid, stats.cells),
    est("slope_median_deg", "경사도 중앙값", slopeMedian, "°", "d18-slope-summary@1:원 안 경사 계산 가능 셀 중앙값"),
    est("slope_max_deg", "경사도 최댓값", slopeMax, "°", "d18-slope-summary@1:원 안 경사 계산 가능 셀 최댓값"),
    ...SLOPE_LAYERS.map((layer, index) => est(
      `share_${layer}`,
      `${layer} 면적 구성비`,
      percent(bands.areaM2[index] ?? 0, circleAreaM2),
      "%",
      `d18-slope-share@1:${layer} 밴드의 원 교차면적÷π·r²`,
      Math.round(bands.areaM2[index] ?? 0),
      Math.round(circleAreaM2),
    )),
    est("share_nodata_pct", "경사 결측 면적 구성비", percent(nodataArea, circleAreaM2), "%", "d18-slope-nodata@1:이웃 결측으로 경사를 계산하지 못한 밴드의 원 교차면적÷π·r²", Math.round(nodataArea), Math.round(circleAreaM2)),
  ];

  const limitations: TileResult["limitations"] = [
    DEM_LIMITATION,
    { kind: "estimated", note: "개발 여부(가능·불가능)를 판정하지 않음 · 평활 거리 30m" },
  ];
  if (stats.valid < stats.cells) limitations.push({ kind: "partial", note: `원 안 경사 결측 셀 ${stats.cells - stats.valid}개는 slope_nodata로 별도 표시했습니다.` });

  return makeTile(ctx, {
    code: "D18",
    type: "diagram",
    status: stats.valid === stats.cells ? "complete" : "partial",
    metrics,
    judgment: {
      ruleId: "D18-slope@1",
      basisMetricIds: ["fill_slope_pct", "slope_median_deg", "slope_max_deg"],
      sentence: `반경 안 경사 계산 가능 셀 ${stats.valid.toLocaleString("en-US")}개에서 경사도 중앙값 ${slopeMedian.toFixed(1)}°, 최댓값 ${slopeMax.toFixed(1)}°를 확인 → 30m 평활 거리의 경사 분포를 표시 → 현장 측량과 배수·지반 조건을 별도로 확인할 것`,
      level: null,
      criteria: null,
    },
    sources: demSources(ctx),
    layers: [...SLOPE_LAYERS, "slope_nodata"],
    polygons: bands.polygons,
    limitations,
  });
}
