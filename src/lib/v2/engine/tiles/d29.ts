/** D29 개방감(SVF) — 건물·DEM 기반 지면 하늘열림 도판. */
import { parseTileResult, type TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { BUILDING_SOURCES, buildingRetirementLimitations, buildingRows, type BuildingRow } from "./buildings-shared";
import { est, makeTile, missing, polygonCandidate } from "./common";
import { polygonArea, polygonParts } from "./geo";
import { notProvided } from "./not-provided";
import { DEM_LIMITATION, demSources } from "./terrain-shared";
import {
  pointInParts,
  SVF_CELL_M,
  SVF_DIRS,
  SVF_EYE_M,
  SVF_HORIZON_AZIMUTHS,
  SVF_HORIZON_CELL_M,
  SVF_HORIZON_SEARCH_M,
  SVF_MAX_DIST_M,
  svfFor,
} from "./svf-shared";

const SVF_BREAKS = [0.3, 0.5, 0.7];
const SVF_LAYERS = ["svf_lt03", "svf_03_05", "svf_05_07", "svf_ge07"] as const;
const SVF_BAND_LABELS = ["0.3 미만", "0.3~0.5", "0.5~0.7", "0.7 이상"] as const;
const RASTER_NODATA = 255;
const FLAT_TERRAIN_LIMITATION = {
  kind: "partial",
  note: "Copernicus DEM GLO-30이 아직 게시되지 않아 지형 지평선은 평탄면(0°)으로 처리했습니다. 건물 기하만 반영한 부분 결과입니다.",
} as const;

function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** API 지표는 래스터보다 짧게 표시해 상세 패널의 값·단위가 겹치지 않게 한다. */
function ratioMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function circleValues(grid: { cx: number; cy: number; cellM: number; cols: number; rows: number; x0: number; y0: number }, svf: Float32Array, radiusM: number): { values: number[]; totalCells: number } {
  const values: number[] = [];
  let totalCells = 0;
  for (let row = 0; row < grid.rows; row += 1) {
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    for (let col = 0; col < grid.cols; col += 1) {
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      if (Math.hypot(x - grid.cx, y - grid.cy) > radiusM + grid.cellM / 2) continue;
      totalCells += 1;
      const value = svf[row * grid.cols + col];
      if (Number.isFinite(value)) values.push(Math.max(0, Math.min(1, value)));
    }
  }
  return { values, totalCells };
}

function siteParts(ctx: EngineContext): number[][][][] | null {
  if (!ctx.input.pnu) return null;
  const hit = ctx.hits("parcels", ["parcel"], Math.min(5000, ctx.input.radiusM))
    .find((candidate) => candidate.pnu === ctx.input.pnu);
  return hit ? polygonParts(hit.geometry) : null;
}

function siteValues(
  ctx: EngineContext,
  grid: { cx: number; cy: number; cellM: number; cols: number; rows: number; x0: number; y0: number },
  svf: Float32Array,
): { values: number[]; fallback: boolean } {
  const parts = siteParts(ctx);
  if (parts) {
    const values: number[] = [];
    for (let row = 0; row < grid.rows; row += 1) {
      const y = grid.y0 + (row + 0.5) * grid.cellM;
      for (let col = 0; col < grid.cols; col += 1) {
        const x = grid.x0 + (col + 0.5) * grid.cellM;
        const value = svf[row * grid.cols + col];
        if (Number.isFinite(value) && pointInParts(x, y, parts)) values.push(Math.max(0, Math.min(1, value)));
      }
    }
    if (values.length > 0) return { values, fallback: false };
  }

  // Coordinate-only analyses have no selected parcel. Keep a small, explicit
  // center proxy so the site metric remains useful without pretending it is a
  // parcel measurement.
  const proxyRadius = Math.min(50, ctx.input.radiusM);
  const values: number[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    for (let col = 0; col < grid.cols; col += 1) {
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      const value = svf[row * grid.cols + col];
      if (Math.hypot(x - grid.cx, y - grid.cy) <= proxyRadius && Number.isFinite(value)) values.push(Math.max(0, Math.min(1, value)));
    }
  }
  return { values, fallback: true };
}

function rasterValues(grid: { cols: number; rows: number }, svf: Float32Array): Uint8Array {
  const values = new Uint8Array(grid.cols * grid.rows);
  values.fill(RASTER_NODATA);
  for (let index = 0; index < svf.length; index += 1) {
    const value = svf[index];
    if (Number.isFinite(value)) values[index] = Math.max(0, Math.min(250, Math.round(value * 250)));
  }
  return values;
}

/** 지도 위에서는 계산용 확장 반경이 아닌 표시 반경의 건물만 회색 마스크로 그린다. */
function buildingMaskPolygons(rows: BuildingRow[]) {
  return rows.flatMap((row) => polygonParts(row.hit.geometry).flatMap((rings, partIndex) => {
    const areaM2 = Math.max(0, polygonArea(rings) || row.footprintM2 || 0);
    const candidate = polygonCandidate(row.hit.featureId * 1000 + partIndex, "svf_building", rings, areaM2);
    return candidate ? [candidate] : [];
  }));
}

export function d29(ctx: EngineContext): TileResult {
  const shared = svfFor(ctx, null);
  if (!shared) return notProvided(ctx, "D29", "건물 자료가 없어 하늘열림을 계산하지 못했습니다.");

  const { values, totalCells } = circleValues(shared.grid, shared.svf, ctx.input.radiusM);
  const sources = [...ctx.sources("buildings", BUILDING_SOURCES), ...demSources(ctx)];
  const terrainLimitation = shared.terrainAvailable ? DEM_LIMITATION : FLAT_TERRAIN_LIMITATION;
  if (values.length === 0) {
    return makeTile(ctx, {
      code: "D29",
      type: "diagram",
      status: "no_data",
      metrics: [
        missing("fill_svf_pct", "SVF 유효 지면 채움률", "%", "d29-fill-svf@1:유효 SVF 셀 면적÷원 안 셀 면적"),
        missing("svf_median", "하늘열림 중앙값", "비율", "d29-svf-median@1:유효 지면 SVF 중앙값"),
      ],
      sources,
      layers: ["svf"],
      limitations: [terrainLimitation, { kind: "not_provided", note: "반경 안에서 유효한 지면·건물 DSM 셀을 확인하지 못했습니다." }],
    });
  }

  const rows = buildingRows(ctx, Math.min(5000, ctx.input.radiusM + SVF_MAX_DIST_M + SVF_CELL_M)) ?? [];
  const displayRows = buildingRows(ctx, ctx.input.radiusM) ?? rows;
  const buildingPolygons = buildingMaskPolygons(displayRows);
  const unknownBuildings = rows.filter((row) => row.heightM === null).length;
  let demMissingCells = 0;
  for (let row = 0; row < shared.grid.rows; row += 1) {
    const y = shared.grid.y0 + (row + 0.5) * shared.grid.cellM;
    for (let col = 0; col < shared.grid.cols; col += 1) {
      const x = shared.grid.x0 + (col + 0.5) * shared.grid.cellM;
      if (Math.hypot(x - shared.grid.cx, y - shared.grid.cy) > ctx.input.radiusM + shared.grid.cellM / 2) continue;
      if (!Number.isFinite(shared.grid.values[row * shared.grid.cols + col])) demMissingCells += 1;
    }
  }
  const validArea = values.length * SVF_CELL_M ** 2;
  const totalArea = totalCells * SVF_CELL_M ** 2;
  const bucketCounts = [0, 0, 0, 0];
  for (const value of values) {
    const bucket = SVF_BREAKS.findIndex((breakValue) => value < breakValue);
    bucketCounts[bucket < 0 ? 3 : bucket] += 1;
  }
  const site = siteValues(ctx, shared.grid, shared.svf);
  const siteMedian = quantile(site.values, 0.5);
  const fillPct = percent(validArea, totalArea);
  const nodataPct = Math.max(0, Math.round((100 - fillPct) * 10) / 10);
  const metrics: TileResult["metrics"] = [
    est("fill_svf_pct", "SVF 유효 지면 채움률", fillPct, "%", "d29-fill-svf@1:유효 SVF 셀 면적÷원 안 셀 면적", validArea, totalArea),
    est("back_nodata_pct", "SVF 결측·건물 지붕 면적률", nodataPct, "%", "d29-back-nodata@1:유효하지 않은 원 안 셀 면적÷원 안 셀 면적", Math.max(0, totalArea - validArea), totalArea),
    est("svf_median", "하늘열림 중앙값", ratioMetric(quantile(values, 0.5) as number), "비율", "d29-svf-median@1:유효 지면 SVF 중앙값", null, validArea),
    est("svf_p10", "하늘열림 P10", ratioMetric(quantile(values, 0.1) as number), "비율", "d29-svf-p10@1:유효 지면 SVF 10백분위", null, validArea),
    ...SVF_LAYERS.map((layer, index) => est(
      `share_${layer}_pct`,
      `하늘열림 ${SVF_BAND_LABELS[index]} 면적 구성비`,
      percent(bucketCounts[index] * SVF_CELL_M ** 2, validArea),
      "%",
      `d29-svf-share@1:${layer} 구간의 유효 지면 셀 면적÷유효 지면 셀 면적`,
      bucketCounts[index] * SVF_CELL_M ** 2,
      validArea,
    )),
    siteMedian === null
      ? missing("svf_site_median", "대지 하늘열림 중앙값", "비율", "d29-svf-site-median@1:대상 필지 안 유효 SVF 셀 중앙값")
      : est("svf_site_median", "대지 하늘열림 중앙값", ratioMetric(siteMedian), "비율", "d29-svf-site-median@1:대상 필지 안 유효 SVF 셀 중앙값", null, site.values.length * SVF_CELL_M ** 2),
  ];

  const limitations: TileResult["limitations"] = [
    ...buildingRetirementLimitations(ctx, Math.min(5000, ctx.input.radiusM + SVF_MAX_DIST_M + SVF_CELL_M)),
    terrainLimitation,
    { kind: "estimated", note: "건물·지형 DSM과 32방위 표본으로 계산한 기하학적 지표입니다." },
    { kind: "estimated", note: "건물은 단순 매스로 표현했으며 높이·지붕 형태·차양은 단순화했습니다." },
    { kind: "estimated", note: "수목 제외 — 수관·차양은 반영하지 않았습니다." },
    ...(site.fallback ? [{ kind: "estimated" as const, note: "대상 필지 도형이 없어 중심 주변 100m를 대지 지표의 대체 영역으로 사용했습니다." }] : []),
    ...(unknownBuildings > 0 ? [{ kind: "incomplete" as const, note: `높이 미상 건물 ${unknownBuildings}동은 지붕 높이를 알 수 없어 해당 발자국을 유효 지면에서 제외했습니다.` }] : []),
    ...(demMissingCells > 0 ? [{ kind: "partial" as const, note: `원 안 DEM 결측 ${demMissingCells.toLocaleString("en-US")}개 셀은 SVF 통계에서 제외했습니다.` }] : []),
  ];
  const status: TileResult["status"] = limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const median = quantile(values, 0.5) as number;
  const closedPct = percent((bucketCounts[0] ?? 0) * SVF_CELL_M ** 2, validArea);
  const tile = makeTile(ctx, {
    code: "D29",
    type: "diagram",
    status,
    metrics,
    judgment: {
      ruleId: "D29-svf@1",
      basisMetricIds: ["svf_median", "share_svf_lt03_pct"],
      sentence: `반경 안 지면 하늘열림 중앙값 ${median.toFixed(2)}, 0.3 미만(닫힌 골목) ${closedPct}% → 건물·지형 기준 기하 지표이며 수목·차양 제외 → 현장 개방감으로 확인할 것`,
      level: null,
      criteria: null,
    },
    sources,
    layers: ["svf"],
    limitations,
    polygons: buildingPolygons,
  });
  const raster = ctx.emitRaster("D29", {
    ref: {
      name: "svf",
      kind: "scalar",
      crs: "EPSG:5179",
      x0: shared.grid.x0,
      y0: shared.grid.y0,
      cellM: SVF_CELL_M,
      cols: shared.grid.cols,
      rows: shared.grid.rows,
      dtype: "u8",
      bands: 1,
      scale: 1 / 250,
      offset: 0,
      nodata: RASTER_NODATA,
      palette: "svf",
      label: "하늘열림(SVF)",
    },
    values: rasterValues(shared.grid, shared.svf),
  });
  return parseTileResult({
    ...tile,
    conditions: {
      ...ctx.conditions,
      simulation: {
        model: "sky-view-factor",
        cellM: SVF_CELL_M,
        dirs: SVF_DIRS,
        maxDistM: SVF_MAX_DIST_M,
        eyeM: SVF_EYE_M,
        terrainHorizonCellM: SVF_HORIZON_CELL_M,
        terrainHorizonAzimuths: SVF_HORIZON_AZIMUTHS,
        terrainHorizonSearchM: SVF_HORIZON_SEARCH_M,
        terrain: shared.terrainAvailable ? "dem-glo30" : "flat-no-dem",
        canopy: "excluded",
        buildings: rows.length,
        unknownHeightBuildings: unknownBuildings,
      },
    },
    presentation: {
      ...tile.presentation,
      legend: [{ label: "하늘열림(SVF)", min: 0, max: 1 }, { label: "건물 마스크", min: null, max: null }],
      rasters: [raster],
    },
  });
}
