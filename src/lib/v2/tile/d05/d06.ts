/** D06 고층 건물 — 35m 기준, 추정 높이는 별도 범주로 표시한다. */
import type { Geometry } from "geojson";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { BUILDING_SOURCES, assumedOneFloorLimitation, buildingRetirementLimitations, buildingRows, isConfirmedHeightMethod, isCounted, type BuildingRow } from "../../engine/tiles/buildings-shared";
import { est, makeTile, missing, obs, polygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { notProvided } from "../../engine/tiles/not-provided";

const LAYERS = ["tall_ge35", "tall_ge35_est", "tall_assumed_1f_est", "tall_lt35", "tall_unknown"] as const;
const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

function bucket(heightM: number | null, heightMethod: string): (typeof LAYERS)[number] {
  if (heightM === null || !Number.isFinite(heightM)) return "tall_unknown";
  if (heightMethod === "assumed_one_floor") return "tall_assumed_1f_est";
  if (heightMethod === "floors_estimate") return heightM >= 35 ? "tall_ge35_est" : "tall_lt35";
  if (isConfirmedHeightMethod(heightMethod as BuildingRow["heightMethod"])) return heightM >= 35 ? "tall_ge35" : "tall_lt35";
  return "tall_unknown";
}

function heightArea(ctx: EngineContext, row: BuildingRow) {
  return areaInCircle(ctx.input.center, ctx.input.radiusM, row.hit.geometry as Geometry);
}

export function d06(ctx: EngineContext): TileResult {
  const rows = buildingRows(ctx);
  if (rows === null) return notProvided(ctx, "D06");

  const total = rows.filter((row) => isCounted(ctx, row)).length; // 동수·구성비는 중심점이 반경 안인 건물만, 그림은 교차 전부
  const all = rows.map((row) => ({ row, layer: bucket(row.heightM, row.heightMethod), area: heightArea(ctx, row) }));
  const classified = all.filter(({ row }) => isCounted(ctx, row)); // 동수·구성비는 중심점이 반경 안인 건물만
  const sourceKnown = classified.filter(({ row }) => isConfirmedHeightMethod(row.heightMethod) && row.heightM !== null).length;
  const tallSource = classified.filter(({ layer }) => layer === "tall_ge35").length;
  const tallEstimated = classified.filter(({ layer }) => layer === "tall_ge35_est").length;
  const notTall = classified.filter(({ layer }) => layer === "tall_lt35").length;
  const unknown = classified.filter(({ layer }) => layer === "tall_unknown").length;
  const assumed = classified.filter(({ layer }) => layer === "tall_assumed_1f_est").length;
  const tallEntries = classified.filter(({ layer }) => layer === "tall_ge35" || layer === "tall_ge35_est");
  const tallAreaKnown = tallEntries.every(({ area }) => area !== null);
  const tallAreaM2 = tallEntries.reduce((sum, { area }) => sum + (area?.areaM2 ?? 0), 0);
  const polygons: NonNullable<TileDraft["polygons"]> = [];
  let geometryFailures = 0;
  for (const { row, layer, area } of all) { // 그림은 교차 전부
    const rowPolygons = area
      ? area.parts.flatMap((rings, index) => {
        const polygon = polygonCandidate(row.hit.featureId * 1000 + index, layer, rings, polygonArea(rings), row.hit.name);
        return polygon ? [polygon] : [];
      })
      : [];
    if (rowPolygons.length > 0) polygons.push(...rowPolygons);
    else geometryFailures += 1;
  }

  const metrics: TileDraft["metrics"] = [
    total === 0 ? missing("tall_buildings", "35m 이상 건물(확인)", "동", "d06-tall-count@1") : obs("tall_buildings", "35m 이상 건물(확인)", tallSource, "동", "d06-tall-count@1", tallSource, total),
    total === 0 ? missing("tall_buildings_est", "35m 이상 건물([추정])", "동", "d06-tall-count@1") : est("tall_buildings_est", "35m 이상 건물([추정])", tallEstimated, "동", "d06-tall-count@1", tallEstimated, total),
    total === 0 ? missing("fill_height_m_pct", "미터 높이 확인률", "%", "d06-fill-height@1") : obs("fill_height_m_pct", "미터 높이 확인률", pct(sourceKnown, total), "%", "d06-fill-height@1", sourceKnown, total),
    total === 0 ? missing("share_tall_pct", "35m 이상 구성비", "%", "d06-share@1") : est("share_tall_pct", "35m 이상 구성비(확인+추정)", pct(tallSource + tallEstimated, total), "%", "d06-share@1", tallSource + tallEstimated, total),
    total === 0 ? missing("share_not_tall_pct", "35m 미만 구성비", "%", "d06-share@1") : obs("share_not_tall_pct", "35m 미만 구성비", pct(notTall, total), "%", "d06-share@1", notTall, total),
    total === 0 ? missing("share_unknown_pct", "높이 미상 구성비", "%", "d06-share@1") : obs("share_unknown_pct", "높이 미상 구성비", pct(unknown, total), "%", "d06-share@1", unknown, total),
    total === 0 ? missing("share_assumed_one_floor_pct", "1층 가정(추정) 구성비", "%", "d06-share@1") : est("share_assumed_one_floor_pct", "1층 가정(추정) 구성비", pct(assumed, total), "%", "d06-share@1", assumed, total),
    total === 0 ? missing("tall_buildings_assumed", "1층 가정(추정) 건물", "동", "d06-tall-assumed@1") : est("tall_buildings_assumed", "1층 가정(추정) 건물", assumed, "동", "d06-tall-assumed@1", assumed, total),
    total === 0 || !tallAreaKnown
      ? missing("back_tall_area_m2", "35m 이상 발자국 면적", "㎡", "d06-tall-area@1")
      : obs("back_tall_area_m2", "35m 이상 발자국 면적", Math.round(tallAreaM2), "㎡", "d06-tall-area@1", Math.round(tallAreaM2), null),
  ];

  const limitations = [
    ...buildingRetirementLimitations(ctx),
    ...ctx.coverage("buildings", BUILDING_SOURCES),
    { kind: "estimated" as const, note: "[추정] 높이는 층수×3m(적재기 상수), 공식 고층건축물 정의가 아님" },
    ...(assumedOneFloorLimitation(classified.map(({ row }) => row)) ? [assumedOneFloorLimitation(classified.map(({ row }) => row))!] : []),
    ...(geometryFailures > 0 ? [{ kind: "unknown" as const, note: `건물 ${geometryFailures}동의 도형을 지도 면으로 변환하지 못했습니다.` }] : []),
  ];
  const status: TileResult["status"] = limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const sentence = total === 0
    ? "반경 안 건물이 확인되지 않아 높이 35m 기준 분류를 산출하지 못함 → 건물 자료와 현장 확인 필요"
    : `반경 안 건물 ${total.toLocaleString("en-US")}동 중 높이 35m 이상 ${tallSource + tallEstimated}동(확인 ${tallSource}동·추정 ${tallEstimated}동), 1층 가정 ${assumed}동 → 확인 높이·층수 추정·1층 가정을 분리해 표시 → 건축물대장 높이 확인 필요`;

  return makeTile(ctx, {
    code: "D06",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D06-height@1", basisMetricIds: ["share_tall_pct", "fill_height_m_pct"], sentence, level: null, criteria: null },
    sources: ctx.sources("buildings", BUILDING_SOURCES),
    layers: [...LAYERS],
    polygons,
    limitations,
  });
}
