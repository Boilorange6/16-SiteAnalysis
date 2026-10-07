/** S01 3D 매스 — 공개 건물 도형과 높이 확보 수준을 장면 조건으로 전달한다. */
import { SCENE_MAX_BUILDINGS, SCENE_VERSION } from "../../scene";
import { parseTileResult, type TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { ENGINE_VERSION, est, missing, obs } from "./common";
import { BUILDING_SOURCES, assumedOneFloorLimitation, buildingRetirementLimitations, buildingRows, isConfirmedHeightMethod, isCounted, type BuildingRow } from "./buildings-shared";
import { notProvided } from "./not-provided";
import { DEM_LIMITATION, demReader } from "./terrain-shared";
import { maxOf, minOf } from "../../extent";

// The renderer already hatches mass_estimated faces; the separate engine metric
// and SceneBuilding.heightMethod keep 1층 가정 distinct without inventing a
// screen layer the existing mass projection cannot render.
const LAYERS = ["mass_source", "mass_estimated", "mass_unknown"] as const;
const FLAT_GROUND_LIMITATION = {
  kind: "not_provided",
  note: "지형 자료를 확인하지 못해 평탄 지반으로 표시합니다.",
} as const;
const pct = (part: number, whole: number): number => Math.round((part / whole) * 1000) / 10;

function knownRows(rows: BuildingRow[]): BuildingRow[] {
  return rows.filter((row) => (isConfirmedHeightMethod(row.heightMethod) || row.heightMethod === "floors_estimate") && row.heightM !== null);
}

function sourceRows(rows: BuildingRow[]): BuildingRow[] {
  return rows.filter((row) => isConfirmedHeightMethod(row.heightMethod) && row.heightM !== null);
}

function estimatedRows(rows: BuildingRow[]): BuildingRow[] {
  return rows.filter((row) => row.heightMethod === "floors_estimate" && row.heightM !== null);
}

function assumedRows(rows: BuildingRow[]): BuildingRow[] {
  return rows.filter((row) => row.heightMethod === "assumed_one_floor" && row.heightM !== null);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function sentence(total: number, known: number, knownPct: number | null, estimated: number, assumed: number, unknown: number): string {
  if (total === 0) return "반경 안 건물이 0동으로 확인됨 → 3D 매스 대상이 없어 높이 분포를 산출하지 못함 → 건물 도형 원천과 현장 확인 필요";
  return `반경 안 건물 ${total.toLocaleString("en-US")}동 중 높이 확인 ${knownPct}%(${known}동, 층수 추정 ${estimated}동, 1층 가정 ${assumed}동) → 공개 도형과 확보·가정 높이로 매스를 구성하고 높이 미상 ${unknown}동은 바닥 모양만 표시 → 높이와 지반 조건을 확인할 것`;
}

export function s01(ctx: EngineContext): TileResult {
  const intersectingRows = buildingRows(ctx);
  if (intersectingRows === null) return notProvided(ctx, "S01");
  const rows = intersectingRows.filter((row) => isCounted(ctx, row));

  const total = rows.length;
  const known = knownRows(rows);
  const source = sourceRows(rows);
  const estimated = estimatedRows(rows);
  const assumed = assumedRows(rows);
  const unknown = total - known.length - assumed.length;
  const knownPct = total === 0 ? null : pct(known.length, total);
  const sourcePct = total === 0 ? null : pct(source.length, total);
  const heights = known.flatMap((row) => (row.heightM === null ? [] : [row.heightM]));
  const medianHeight = median(heights);
  const maxHeight = heights.length === 0 ? null : maxOf(heights);
  const sceneTotal = intersectingRows.length;
  const included = Math.min(sceneTotal, SCENE_MAX_BUILDINGS);
  const demReady = demReader(ctx) !== null;
  const coverage = ctx.coverage("buildings", BUILDING_SOURCES);
  const retirementLimitations = buildingRetirementLimitations(ctx);
  const assumedLimitation = assumedOneFloorLimitation(rows);
  const limitations: TileResult["limitations"] = [
    { kind: "estimated", note: "공개 도형과 확보 높이로 만든 매스. 높이 미상 건물은 바닥 모양만 표시" },
    demReady ? DEM_LIMITATION : FLAT_GROUND_LIMITATION,
    ...(assumedLimitation ? [assumedLimitation] : []),
    ...(unknown > 0 ? [{ kind: "incomplete" as const, note: `높이 미상 건물 ${unknown}동은 높이를 세우지 않고 바닥 모양만 표시했습니다.` }] : []),
    ...(sceneTotal > included ? [{ kind: "partial" as const, note: `성능 상한 ${SCENE_MAX_BUILDINGS.toLocaleString("en-US")}동으로 교차 건물 ${sceneTotal.toLocaleString("en-US")}동 중 ${included.toLocaleString("en-US")}동만 장면에 포함합니다.` }] : []),
    ...retirementLimitations,
    ...coverage,
  ];
  const status: TileResult["status"] = unknown > 0 || sceneTotal > included || retirementLimitations.length > 0 || coverage.some((entry) => entry.kind === "partial" || entry.kind === "incomplete") ? "partial" : "complete";

  const metrics: TileResult["metrics"] = [
    obs("buildings", "반경 안 건물(중심점 기준)", total, "동", "s01-buildings@2:발자국 중심점이 반경 원 안에 있는 건물 동수"),
    total === 0
      ? missing("height_known_pct", "높이 확인 건물 비율", "%", "s01-height-known@1:(source+floors_estimate)÷전체 건물")
      : (estimated.length > 0
        ? est("height_known_pct", "높이 확인 건물 비율", knownPct as number, "%", "s01-height-known@1:(source+floors_estimate)÷전체 건물", known.length, total)
        : obs("height_known_pct", "높이 확인 건물 비율", knownPct as number, "%", "s01-height-known@1:(source+floors_estimate)÷전체 건물", known.length, total)),
    total === 0
      ? missing("height_source_pct", "원천 높이 건물 비율", "%", "s01-height-source@1:source÷전체 건물")
      : obs("height_source_pct", "원천 높이 건물 비율", sourcePct as number, "%", "s01-height-source@1:source÷전체 건물", source.length, total),
    est("height_estimated_count", "층수 추정 높이 건물", estimated.length, "동", "s01-height-estimated@1:floors_estimate 높이 건물 수", estimated.length, total),
    est("height_assumed_one_floor_count", "1층 가정(추정) 건물", assumed.length, "동", "s01-height-assumed-one-floor@1:높이·층수 미상 건물 수", assumed.length, total),
    obs("height_unknown_count", "높이 미상 건물", unknown, "동", "s01-height-unknown@1:height_m 미상 건물 수"),
    medianHeight === null
      ? missing("height_median_m", "확보 높이 중앙값", "m", "s01-height-median@1:source+floors_estimate 높이 중앙값")
      : (estimated.length > 0
        ? est("height_median_m", "확보 높이 중앙값", medianHeight, "m", "s01-height-median@1:source+floors_estimate 높이 중앙값")
        : obs("height_median_m", "확보 높이 중앙값", medianHeight, "m", "s01-height-median@1:source+floors_estimate 높이 중앙값")),
    maxHeight === null
      ? missing("height_max_m", "확보 높이 최댓값", "m", "s01-height-max@1:source+floors_estimate 높이 최댓값")
      : (estimated.length > 0
        ? est("height_max_m", "확보 높이 최댓값", maxHeight, "m", "s01-height-max@1:source+floors_estimate 높이 최댓값")
        : obs("height_max_m", "확보 높이 최댓값", maxHeight, "m", "s01-height-max@1:source+floors_estimate 높이 최댓값")),
  ];

  return parseTileResult({
    tileId: `${ctx.analysisId}-S01`,
    analysisId: ctx.analysisId,
    tileType: "simulation",
    tileCode: "S01",
    status,
    engineVersion: ENGINE_VERSION,
    conditions: {
      ...ctx.conditions,
      simulation: {
        scene: SCENE_VERSION,
        buildingsIncluded: included,
        buildingsTotal: sceneTotal,
        cap: SCENE_MAX_BUILDINGS,
        ground: demReady ? "dem" : "flat",
      },
    },
    metrics,
    judgment: {
      ruleId: "S01-mass-summary@1",
      basisMetricIds: ["buildings", "height_known_pct"],
      sentence: sentence(total, known.length, knownPct, estimated.length, assumed.length, unknown),
      level: null,
      criteria: null,
    },
    presentation: {
      legend: [],
      camera: { kind: "axonometric", azimuthDeg: 225, elevationDeg: 35, radiusM: ctx.input.radiusM },
      layers: [...LAYERS],
      outputFace: "front",
    },
    provenance: { manifestHash: ctx.manifestHash, sources: ctx.sources("buildings", BUILDING_SOURCES) },
    limitations,
  });
}
