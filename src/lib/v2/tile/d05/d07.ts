/** D07 저층 건물 — 12m 이하 기준, 추정 높이는 별도 범주로 표시한다. */
import type { Geometry } from "geojson";
import { MAX_MAP_POLYGONS, type TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { BUILDING_SOURCES, assumedOneFloorLimitation, buildingRetirementLimitations, buildingRows, isConfirmedHeightMethod, isCounted, type BuildingRow } from "../../engine/tiles/buildings-shared";
import { capD05BuildingCandidates, est, makeTile, missing, obs, polygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { notProvided } from "../../engine/tiles/not-provided";
import { buildingMapExtra, heightLayer, sortBuildingRows } from "./presentation";

const LAYERS = ["low_le12", "low_le12_est", "low_assumed_1f_est", "low_gt12", "low_unknown"] as const;
const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

function heightArea(ctx: EngineContext, row: BuildingRow) {
  return areaInCircle(ctx.input.center, ctx.input.radiusM, row.hit.geometry as Geometry);
}

export function d07(ctx: EngineContext): TileResult {
  const sourceRows = buildingRows(ctx);
  if (sourceRows === null) return notProvided(ctx, "D07");
  const rows = sortBuildingRows(sourceRows);

  const total = rows.filter((row) => isCounted(ctx, row)).length; // 동수·구성비는 중심점이 반경 안인 건물만, 그림은 교차 전부
  const all = rows.map((row) => ({ row, layer: heightLayer(row, "low") as (typeof LAYERS)[number], area: heightArea(ctx, row) }));
  const classified = all.filter(({ row }) => isCounted(ctx, row)); // 동수·구성비는 중심점이 반경 안인 건물만
  const sourceKnown = classified.filter(({ row }) => isConfirmedHeightMethod(row.heightMethod) && row.heightM !== null).length;
  const lowSource = classified.filter(({ layer }) => layer === "low_le12").length;
  const lowEstimated = classified.filter(({ layer }) => layer === "low_le12_est").length;
  const notLow = classified.filter(({ layer }) => layer === "low_gt12").length;
  const unknown = classified.filter(({ layer }) => layer === "low_unknown").length;
  const assumed = classified.filter(({ layer }) => layer === "low_assumed_1f_est").length;
  const lowEntries = classified.filter(({ layer }) => layer === "low_le12" || layer === "low_le12_est");
  const lowAreaKnown = lowEntries.every(({ area }) => area !== null);
  const lowAreaM2 = lowEntries.reduce((sum, { area }) => sum + (area?.areaM2 ?? 0), 0);
  const polygons: NonNullable<TileDraft["polygons"]> = [];
  let geometryFailures = 0;
  for (const { row, layer, area } of all) { // 그림은 교차 전부
    const rowPolygons = area
      ? area.parts.flatMap((rings, index) => {
        const polygon = polygonCandidate(row.hit.featureId * 1000 + index, layer, rings, polygonArea(rings), null, { ...buildingMapExtra(row, layer), counted: isCounted(ctx, row) });
        return polygon ? [polygon] : [];
      })
      : [];
    if (rowPolygons.length > 0) polygons.push(...rowPolygons);
    else geometryFailures += 1;
  }

  const metrics: TileDraft["metrics"] = [
    total === 0 ? missing("low_buildings", "12m 이하 건물(확인)", "동", "d07-low-count@1") : obs("low_buildings", "12m 이하 건물(확인)", lowSource, "동", "d07-low-count@1", lowSource, total),
    total === 0 ? missing("low_buildings_est", "12m 이하 건물([추정])", "동", "d07-low-count@1") : est("low_buildings_est", "12m 이하 건물([추정])", lowEstimated, "동", "d07-low-count@1", lowEstimated, total),
    total === 0 ? missing("fill_height_m_pct", "미터 높이 확인률", "%", "d07-fill-height@1") : obs("fill_height_m_pct", "미터 높이 확인률", pct(sourceKnown, total), "%", "d07-fill-height@1", sourceKnown, total),
    total === 0 ? missing("share_low_pct", "12m 이하 구성비", "%", "d07-share@1") : est("share_low_pct", "12m 이하 구성비(확인+추정)", pct(lowSource + lowEstimated, total), "%", "d07-share@1", lowSource + lowEstimated, total),
    total === 0 ? missing("share_not_low_pct", "12m 초과 구성비", "%", "d07-share@1") : obs("share_not_low_pct", "12m 초과 구성비", pct(notLow, total), "%", "d07-share@1", notLow, total),
    total === 0 ? missing("share_unknown_pct", "높이 미상 구성비", "%", "d07-share@1") : obs("share_unknown_pct", "높이 미상 구성비", pct(unknown, total), "%", "d07-share@1", unknown, total),
    total === 0 ? missing("share_assumed_one_floor_pct", "1층 가정(추정) 구성비", "%", "d07-share@1") : est("share_assumed_one_floor_pct", "1층 가정(추정) 구성비", pct(assumed, total), "%", "d07-share@1", assumed, total),
    total === 0 ? missing("low_buildings_assumed", "1층 가정(추정) 건물", "동", "d07-low-assumed@1") : est("low_buildings_assumed", "1층 가정(추정) 건물", assumed, "동", "d07-low-assumed@1", assumed, total),
    total === 0 || !lowAreaKnown
      ? missing("back_low_area_m2", "12m 이하 발자국 면적", "㎡", "d07-low-area@1")
      : obs("back_low_area_m2", "12m 이하 발자국 면적", Math.round(lowAreaM2), "㎡", "d07-low-area@1", Math.round(lowAreaM2), null),
  ];

  const limitations = [
    ...buildingRetirementLimitations(ctx),
    ...ctx.coverage("buildings", BUILDING_SOURCES),
    { kind: "estimated" as const, note: "[추정] 높이는 층수×3m(적재기 상수); 12m 기준은 공식 저층건축물 정의가 아님" },
    ...(assumedOneFloorLimitation(classified.map(({ row }) => row)) ? [assumedOneFloorLimitation(classified.map(({ row }) => row))!] : []),
    ...(geometryFailures > 0 ? [{ kind: "unknown" as const, note: `건물 ${geometryFailures}동의 도형을 지도 면으로 변환하지 못했습니다.` }] : []),
  ];
  const status: TileResult["status"] = limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const sentence = total === 0
    ? "반경 안 건물이 확인되지 않아 높이 12m 기준 분류를 산출하지 못함 → 건물 자료와 현장 확인 필요"
    : `반경 안 건물 ${total.toLocaleString("en-US")}동 중 높이 12m 이하 ${lowSource + lowEstimated}동(확인 ${lowSource}동·추정 ${lowEstimated}동), 1층 가정 ${assumed}동 → 확인 높이·층수 추정·1층 가정을 분리해 표시 → 건축물대장 높이 확인 필요`;

  return makeTile(ctx, {
    code: "D07",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D07-height@1", basisMetricIds: ["share_low_pct", "fill_height_m_pct"], sentence, level: null, criteria: null },
    sources: ctx.sources("buildings", BUILDING_SOURCES),
    layers: [...LAYERS],
    polygons: capD05BuildingCandidates(polygons, ctx.input.center),
    polygonTotal: polygons.length,
    polygonCap: MAX_MAP_POLYGONS,
    limitations,
  });
}
