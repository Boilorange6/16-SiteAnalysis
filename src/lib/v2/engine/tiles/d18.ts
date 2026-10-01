/** D18 경사도 — DEM 중앙차분 경사 밴드. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { bandPolygons, gridStats, type LocalGrid } from "./raster-grid";
import { DEM_LIMITATION, demGridFor, demSources } from "./terrain-shared";
import { est, makeTile, polygonCandidate, type PolygonCandidate } from "./common";
import { areaInCircle } from "./geo";
import { notProvided } from "./not-provided";

const SLOPE_BREAKS = [5, 10, 15, 20];
const SLOPE_LAYERS = ["slope_0_5", "slope_5_10", "slope_10_15", "slope_15_20", "slope_ge20"];

const percent = (part: number, whole: number): number => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

function slopeGrid(dem: LocalGrid): LocalGrid {
  const values = new Float64Array(dem.values.length);
  values.fill(Number.NaN);
  for (let row = 1; row < dem.rows - 1; row++) {
    for (let col = 1; col < dem.cols - 1; col++) {
      const west = dem.values[row * dem.cols + col - 1];
      const east = dem.values[row * dem.cols + col + 1];
      const south = dem.values[(row - 1) * dem.cols + col];
      const north = dem.values[(row + 1) * dem.cols + col];
      if (![west, east, south, north].every(Number.isFinite)) continue;
      const dzdx = (east - west) / (2 * dem.cellM);
      const dzdy = (north - south) / (2 * dem.cellM);
      values[row * dem.cols + col] = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI);
    }
  }
  // localGrid has one cell of padding around the analysis circle. Its outer
  // frame is never a reported cell, but leaving it NaN makes isobands treat
  // the whole circle as a missing fringe. Reuse the nearest central-difference
  // value only for that outside padding; missing neighbors inside the circle
  // remain NaN and are counted as slope_nodata.
  for (const row of [0, dem.rows - 1]) {
    for (let col = 0; col < dem.cols; col++) {
      const sourceRow = row === 0 ? 1 : dem.rows - 2;
      const candidate = values[sourceRow * dem.cols + Math.min(dem.cols - 2, Math.max(1, col))];
      if (Number.isFinite(candidate)) values[row * dem.cols + col] = candidate;
    }
  }
  for (let col of [0, dem.cols - 1]) {
    for (let row = 1; row < dem.rows - 1; row++) {
      const sourceCol = col === 0 ? 1 : dem.cols - 2;
      const candidate = values[row * dem.cols + sourceCol];
      if (Number.isFinite(candidate)) values[row * dem.cols + col] = candidate;
    }
  }
  return { ...dem, values };
}

function valuesInCircle(grid: LocalGrid, radiusM: number): number[] {
  const values: number[] = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      if (Math.hypot(x - grid.cx, y - grid.cy) > radiusM + 1e-9) continue;
      const value = grid.values[row * grid.cols + col];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function slopeBandIndex(value: number): number {
  for (let index = 0; index < SLOPE_BREAKS.length; index++) if (value < SLOPE_BREAKS[index]) return index;
  return SLOPE_LAYERS.length - 1;
}

/** isobands가 외곽 지배 밴드의 폐곡선을 잃는 경우를 위한 셀 면 fallback. */
function cellBandPolygons(ctx: EngineContext, grid: LocalGrid): { polygons: PolygonCandidate[]; areaM2: number[] } {
  const areaM2 = Array.from({ length: SLOPE_LAYERS.length + 1 }, () => 0);
  const polygons: PolygonCandidate[] = [];
  const half = grid.cellM / 2;
  let id = 1;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      const square = {
        type: "Polygon" as const,
        coordinates: [[[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half], [x - half, y - half]]],
      };
      const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, square);
      if (!clipped || clipped.areaM2 <= 0) continue;
      const value = grid.values[row * grid.cols + col];
      const bandIndex = Number.isFinite(value) ? slopeBandIndex(value) : SLOPE_LAYERS.length;
      areaM2[bandIndex] += clipped.areaM2;
      const layer = Number.isFinite(value) ? SLOPE_LAYERS[bandIndex] : "slope_nodata";
      for (const rings of clipped.parts) {
        const polygon = polygonCandidate(id++, layer, rings, clipped.areaM2);
        if (polygon) polygons.push(polygon);
      }
    }
  }
  return { polygons, areaM2 };
}

export function d18(ctx: EngineContext): TileResult {
  const dem = demGridFor(ctx, 30);
  if (!dem) return notProvided(ctx, "D18", "지형(DEM) 미적재");

  const slope = slopeGrid(dem);
  const stats = gridStats(slope, ctx.input.radiusM);
  const values = valuesInCircle(slope, ctx.input.radiusM);
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
  const interpolatedBands = bandPolygons(ctx.input.center, ctx.input.radiusM, slope, SLOPE_BREAKS, SLOPE_LAYERS, "slope_nodata");
  const interpolatedArea = interpolatedBands.areaM2.reduce((sum, value) => sum + value, 0);
  const bands = Math.abs(interpolatedArea - circleAreaM2) / circleAreaM2 <= 0.02
    ? interpolatedBands
    : cellBandPolygons(ctx, slope);
  const slopeMedian = median(values) as number;
  const slopeMax = Math.max(...values);
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
