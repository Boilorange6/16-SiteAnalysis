/** D05 건축물 높이 — 지상층수 기본, 미터 높이는 펼침용 보조 집계. */
import type { Geometry } from "geojson";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { areaInCircle, polygonArea } from "./geo";
import { BUILDING_SOURCES, assumedOneFloorLimitation, buildingRetirementLimitations, buildingRows, isConfirmedHeightMethod, isCounted, isAssumedOneFloor, type BuildingRow } from "./buildings-shared";
import { est, makeTile, missing, obs, polygonCandidate, type TileDraft } from "./common";
import { notProvided } from "./not-provided";

const FLOOR_BUCKETS = [
  { id: "share_floors_1", label: "1~4층", layer: "floors_1_4" },
  { id: "share_floors_2", label: "5~8층", layer: "floors_5_8" },
  { id: "share_floors_3", label: "9~14층", layer: "floors_9_14" },
  { id: "share_floors_4", label: "15~25층", layer: "floors_15_25" },
  { id: "share_floors_5", label: "26층 이상", layer: "floors_26p" },
  { id: "share_floors_6", label: "층수 미상", layer: "floors_unknown" },
  { id: "share_floors_assumed_1f", label: "1층 가정(추정)", layer: "floors_assumed_1f_est" },
] as const;

const HEIGHT_BUCKETS = [
  { id: "alt_height_1", label: "0~12m", min: 0, max: 12 },
  { id: "alt_height_2", label: "12~24m", min: 12, max: 24 },
  { id: "alt_height_3", label: "24~45m", min: 24, max: 45 },
  { id: "alt_height_4", label: "45~75m", min: 45, max: 75 },
  { id: "alt_height_5", label: "75m 이상", min: 75, max: Infinity },
] as const;

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

function bucket(floors: number | null): (typeof FLOOR_BUCKETS)[number]["layer"] {
  if (floors === null || !Number.isFinite(floors) || floors < 1) return "floors_unknown";
  if (floors < 5) return "floors_1_4";
  if (floors < 9) return "floors_5_8";
  if (floors < 15) return "floors_9_14";
  if (floors < 26) return "floors_15_25";
  return "floors_26p";
}

function heightBucket(row: BuildingRow): (typeof HEIGHT_BUCKETS)[number]["id"] | null {
  if (!isConfirmedHeightMethod(row.heightMethod) || row.heightM === null) return null;
  const found = HEIGHT_BUCKETS.find(({ min, max }) => row.heightM! >= min && row.heightM! < max);
  return found?.id ?? null;
}

function polygonsFor(ctx: EngineContext, row: BuildingRow, layer: string) {
  const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, row.hit.geometry as Geometry);
  if (!clipped) return [];
  return clipped.parts.flatMap((rings, index) => {
    const polygon = polygonCandidate(row.hit.featureId * 1000 + index, layer, rings, polygonArea(rings), row.hit.name);
    return polygon ? [polygon] : [];
  });
}

export function d05(ctx: EngineContext): TileResult {
  const rows = buildingRows(ctx);
  if (rows === null) return notProvided(ctx, "D05");

  const total = rows.filter((row) => isCounted(ctx, row)).length; // 동수·구성비는 중심점이 반경 안인 건물만, 그림은 교차 전부
  const floorCounts = new Map<string, number>(FLOOR_BUCKETS.map(({ layer }) => [layer, 0]));
  const heightCounts = new Map<string, number>(HEIGHT_BUCKETS.map(({ id }) => [id, 0]));
  const polygons: NonNullable<TileDraft["polygons"]> = [];
  let floorsKnown = 0;
  let sourceHeights = 0;
  let assumedFloors = 0;
  let geometryFailures = 0;

  for (const row of rows) {
    const floorLayer = isAssumedOneFloor(row) ? "floors_assumed_1f_est" : bucket(row.floorsAbove);
    const counted = isCounted(ctx, row);
    if (counted) floorCounts.set(floorLayer, (floorCounts.get(floorLayer) ?? 0) + 1);
    if (counted && row.floorsAbove !== null && !isAssumedOneFloor(row)) floorsKnown += 1;
    if (counted && isAssumedOneFloor(row)) assumedFloors += 1;

    const heightId = heightBucket(row);
    if (counted && heightId !== null) {
      sourceHeights += 1;
      heightCounts.set(heightId, (heightCounts.get(heightId) ?? 0) + 1);
    }

    const rowPolygons = polygonsFor(ctx, row, floorLayer);
    if (rowPolygons.length > 0) polygons.push(...rowPolygons);
    else geometryFailures += 1;
  }

  const metrics: TileDraft["metrics"] = [
    total === 0
      ? missing("fill_floors_pct", "층수 확인률", "%", "d05-fill-floors@1")
      : obs("fill_floors_pct", "층수 확인률", pct(floorsKnown, total), "%", "d05-fill-floors@1", floorsKnown, total),
    total === 0
      ? missing("fill_height_m_pct", "미터 높이 확인률", "%", "d05-fill-height@1")
      : obs("fill_height_m_pct", "미터 높이 확인률", pct(sourceHeights, total), "%", "d05-fill-height@1", sourceHeights, total),
    ...FLOOR_BUCKETS.map(({ id, label, layer }) =>
      total === 0
        ? missing(id, `층수 구성: ${label}`, "%", "d05-floors-share@1")
        : layer === "floors_assumed_1f_est"
          ? est(id, `층수 구성: ${label}`, pct(floorCounts.get(layer) ?? 0, total), "%", "d05-floors-share@1", floorCounts.get(layer) ?? 0, total)
          : obs(id, `층수 구성: ${label}`, pct(floorCounts.get(layer) ?? 0, total), "%", "d05-floors-share@1", floorCounts.get(layer) ?? 0, total),
    ),
    ...HEIGHT_BUCKETS.map(({ id, label }) =>
      sourceHeights === 0
        ? missing(id, `미터 높이 구성: ${label}`, "%", "d05-height-alt@1")
        : obs(id, `미터 높이 구성: ${label}`, pct(heightCounts.get(id) ?? 0, sourceHeights), "%", "d05-height-alt@1", heightCounts.get(id) ?? 0, sourceHeights),
    ),
    total === 0
      ? missing("alt_height_assumed_1f_est", "미터 높이 구성: 1층 가정(추정)", "%", "d05-height-alt@1")
      : est("alt_height_assumed_1f_est", "미터 높이 구성: 1층 가정(추정)", pct(assumedFloors, total), "%", "d05-height-alt@1", assumedFloors, total),
  ];

  const assumedLimitation = assumedOneFloorLimitation(rows.filter((row) => isCounted(ctx, row)));
  const limitations = [
    ...buildingRetirementLimitations(ctx),
    ...ctx.coverage("buildings", BUILDING_SOURCES),
    ...(assumedLimitation ? [assumedLimitation] : []),
    ...(geometryFailures > 0 ? [{ kind: "unknown" as const, note: `건물 ${geometryFailures}동의 도형을 지도 면으로 변환하지 못했습니다.` }] : []),
  ];
  const status: TileResult["status"] = limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";
  const sentence = total === 0
    ? "반경 안 건물이 확인되지 않아 지상층수 분포를 산출하지 못함 → 건물 자료와 현장 확인 필요"
    : `반경 안 건물 ${total.toLocaleString("en-US")}동 중 지상층수 확인 ${pct(floorsKnown, total)}%, 1층 가정(추정) ${assumedFloors}동 → 확인·추정·미상을 분리해 표시 → 건축물대장 층수 확인 필요`;

  return makeTile(ctx, {
    code: "D05",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D05-floors@1", basisMetricIds: ["fill_floors_pct"], sentence, level: null, criteria: null },
    sources: ctx.sources("buildings", BUILDING_SOURCES),
    layers: FLOOR_BUCKETS.map(({ layer }) => layer),
    polygons,
    limitations,
  });
}
