/** D17 지형·등고선 — DEM 상대고 밴드와 절대고 등고선. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import type { FeatureHit } from "../../data/features";
import { toUtmk } from "../../crs";
import { relativeTerrainGrid, terrainBandPolygons, terrainContourLines, terrainGridFor, terrainGridStats, terrainValuesInCircle } from "../../engine/tiles/terrain-grid";
import { DEM_LIMITATION, demReader, demSources, terrainCellM, topoTerrainLimitation } from "../../engine/tiles/terrain-shared";
import { est, lineCandidate, makeTile, obs, polygonCandidate, type LineCandidate } from "../../engine/tiles/common";
import { clipLineToCircle, linePathLength, polygonArea } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";
import { maxOf, minOf } from "../../extent";
import { terrainSections, type TerrainSections } from "../../engine/tiles/terrain-section";

const RELIEF_BREAKS = [-20, -5, 5, 20];
const RELIEF_LAYERS = ["relief_lt_m20", "relief_m20_m5", "relief_m5_5", "relief_5_20", "relief_ge20"];
const RELIEF_LABELS = ["중심 대비 −20m 미만", "중심 대비 −20~−5m", "중심 대비 −5~5m", "중심 대비 5~20m", "중심 대비 20m 이상"] as const;
const CONTOUR_INTERVAL_M = 5;

const percent = (part: number, whole: number): number => whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function contourInfo(label: string | null | undefined): { name: string | null; labelPriority: 0 | 1; emphasis: "major" | "minor" } {
  const elevation = Number.parseFloat((label ?? "").replace(/m$/, ""));
  if (!Number.isFinite(elevation)) return { name: null, labelPriority: 0, emphasis: "minor" };
  const rounded = Math.abs(elevation) < 1e-9 ? 0 : Math.round(elevation * 100) / 100;
  const major = Math.abs(elevation / 25 - Math.round(elevation / 25)) <= 1e-6;
  return {
    name: major ? `표고 ${rounded}m` : null,
    labelPriority: major ? 1 : 0,
    emphasis: major ? "major" : "minor",
  };
}

function retainingName(hit: FeatureHit): string {
  const heightM = hit.properties.heightM;
  return typeof heightM === "number" && Number.isFinite(heightM) && heightM > 0
    ? `옹벽 ${Math.round(heightM * 10) / 10}m`
    : "옹벽 · 높이 미확인";
}

function topoLines(ctx: EngineContext, hits: FeatureHit[]) {
  return hits.flatMap((hit) => clipLineToCircle(ctx.input.center, ctx.input.radiusM, hit.geometry).flatMap((path, partIndex) => {
    const layer = hit.kind === "topo_retaining" ? "retaining_wall" : hit.kind === "topo_fence" ? "fence" : "cut_fill";
    const name = hit.kind === "topo_retaining" ? retainingName(hit) : hit.kind === "topo_fence" ? "울타리" : "절성토";
    const id = 1_000_000_000 + hit.featureId * 1_000 + partIndex;
    const line = lineCandidate(id, layer, path, linePathLength(path), null, {
      fid: `topo:${hit.stableId}:${partIndex}`,
      name,
      sublabel: null,
      labelPriority: 1,
    });
    return line ? [line] : [];
  }));
}

function sectionLines(sections: TerrainSections | null): LineCandidate[] {
  if (!sections) return [];
  return ([
    [sections.A, "terrain_section_a", "단면 A–A′ (동서)", 1_000_000_010],
    [sections.B, "terrain_section_b", "단면 B–B′ (남북)", 1_000_000_011],
  ] as const).flatMap(([section, layer, name, id]) => {
    const lengthM = Math.hypot(section.to[0] - section.from[0], section.to[1] - section.from[1]);
    const line = lineCandidate(id, layer, [section.from, section.to], lengthM, null, {
      fid: `terrain-section:${section.axis}`,
      name,
      sublabel: null,
      labelPriority: 1,
      legendLabel: name,
    });
    return line ? [line] : [];
  });
}

function sectionsFor(ctx: EngineContext): TerrainSections | null {
  const geometry = ctx.input.site.geometry;
  return ctx.topo && geometry?.type === "Polygon" ? terrainSections(ctx, geometry) : null;
}

function topoCoverage(ctx: EngineContext) {
  if (!ctx.topo) return null;
  const ring = ctx.topo.summary.coverageWgs84.map(([lng, lat]) => {
    const [x, y] = toUtmk([lng, lat]);
    return [x, y];
  });
  return polygonCandidate(
    1_000_000_001,
    "topo_coverage",
    [ring],
    polygonArea([ring]),
    null,
    { name: null, sublabel: null, labelPriority: 0 },
  );
}

export function d17(ctx: EngineContext): TileResult {
  const reader = demReader(ctx);
  const grid = terrainGridFor(ctx, terrainCellM(ctx));
  if (!reader || !grid) return notProvided(ctx, "D17", "지형 자료를 확인하지 못했습니다.");

  const absoluteValues = terrainValuesInCircle(grid, ctx.input.radiusM);
  const sections = sectionsFor(ctx);
  if (absoluteValues.length === 0) {
    return makeTile(ctx, {
      code: "D17",
      type: "diagram",
      status: "no_data",
      metrics: [],
      sources: demSources(ctx),
      layers: [...RELIEF_LAYERS, "dem_nodata", "contour", ...(ctx.topo ? ["topo_coverage", "retaining_wall", "cut_fill", "fence", ...(sections ? ["terrain_section_a", "terrain_section_b"] : [])] : [])],
      terrainSections: sections ?? undefined,
      limitations: [DEM_LIMITATION, ...(ctx.topo ? [topoTerrainLimitation] : []), { kind: "not_provided", note: "분석 반경 안에서 유효한 DEM 표고를 확인하지 못했습니다." }],
    });
  }

  const readerCenter = reader.elevation(...ctx.input.center);
  const originZ = readerCenter ?? median(absoluteValues);
  if (originZ === null) return notProvided(ctx, "D17", "지형(DEM) 유효 표고 미확인");

  const relative = relativeTerrainGrid(grid, originZ);
  // Turf's isobands implementation expands every sample as a call argument;
  // use the 30 m presentation grid for filled bands at large 5 m topo extents
  // while keeping the 5 m grid for statistics and contour lines.
  const bandGrid = ctx.topo && grid.cellM === 5 ? terrainGridFor(ctx, 30) : grid;
  const bandRelative = bandGrid && bandGrid !== grid ? relativeTerrainGrid(bandGrid, originZ) : relative;
  const stats = terrainGridStats(relative, ctx.input.radiusM);
  const relativeValues = terrainValuesInCircle(relative, ctx.input.radiusM);
  const reliefMin = minOf(relativeValues);
  const reliefMax = maxOf(relativeValues);
  const reliefMedian = median(relativeValues) as number;
  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const bands = terrainBandPolygons(ctx.input.center, ctx.input.radiusM, bandRelative, RELIEF_BREAKS, RELIEF_LAYERS, "dem_nodata");
  const reliefPolygons = bands.polygons.map((polygon) => ({
    ...polygon,
    p: {
      ...polygon.p,
      name: null,
      sublabel: null,
      labelPriority: 0,
    },
  }));
  const stepHits = ctx.topo?.hits(["topo_retaining", "topo_cut_fill", "topo_fence"]) ?? [];
  const coverage = topoCoverage(ctx);
  const polygons = [...reliefPolygons, ...(coverage ? [coverage] : [])];
  const lines: LineCandidate[] = [
    ...terrainContourLines(ctx.input.center, ctx.input.radiusM, grid, CONTOUR_INTERVAL_M, "contour")
      .map((line) => {
        const contour = contourInfo(line.l.label);
        return {
          ...line,
          l: {
            ...line.l,
            label: null,
            name: contour.name,
            sublabel: null,
            labelPriority: contour.labelPriority,
            emphasis: contour.emphasis,
          },
        };
      }),
    ...topoLines(ctx, stepHits),
    ...sectionLines(sections),
  ];
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
      `${RELIEF_LABELS[index]} 면적 구성비`,
      percent(bands.areaM2[index] ?? 0, circleAreaM2),
      "%",
      `d17-relief-share@1:${layer} 밴드의 원 교차면적÷π·r²`,
      Math.round(bands.areaM2[index] ?? 0),
      Math.round(circleAreaM2),
    )),
    est("share_nodata_pct", "DEM 결측 면적 구성비", percent(nodataArea, circleAreaM2), "%", "d17-relief-nodata@1:DEM 결측 밴드의 원 교차면적÷π·r²", Math.round(nodataArea), Math.round(circleAreaM2)),
    obs("contour_interval_m", "등고선 간격", CONTOUR_INTERVAL_M, "m", "d17-contour-interval@1:절대 표고 등고선 간격"),
    ...(ctx.topo ? [obs("retaining_count", "반경 안 단차 시설 수", stepHits.length, "개", "d17-step-count@1:반경 안 수치지형도 옹벽·절성토·울타리 시설 수")] : []),
  ];

  const limitations: TileResult["limitations"] = [
    DEM_LIMITATION,
    ctx.topo ? topoTerrainLimitation : { kind: "estimated", note: "등고선은 30m 격자 보간선입니다." },
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
      sentence: `중심 표고 ${originZ.toFixed(1)}m · 반경 안 DEM 유효 셀 ${stats.valid.toLocaleString("en-US")}개(채움률 ${percent(stats.valid, stats.cells)}%)에서 중심 대비 고저차 ${reliefMin.toFixed(1)}~${reliefMax.toFixed(1)}m, 중앙값 ${reliefMedian.toFixed(1)}m를 확인 → 상대고 밴드와 25m 배수 표고 라벨을 포함한 절대고 등고선으로 지형 기복을 표시 → 측량과 최신 지형 자료로 확인할 것`,
      level: null,
      criteria: null,
    },
    sources: demSources(ctx),
    layers: [...RELIEF_LAYERS, "dem_nodata", "contour", ...(ctx.topo ? ["topo_coverage", "retaining_wall", "cut_fill", "fence", ...(sections ? ["terrain_section_a", "terrain_section_b"] : [])] : [])],
    polygons,
    lines,
    terrainSections: sections ?? undefined,
    limitations,
  });
}
