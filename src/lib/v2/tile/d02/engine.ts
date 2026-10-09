/** D02 건물 — 반경과 교차하는 건물 발자국·대표점(동수는 중심점이 반경 안인 건물)과 발자국 구성비. */
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../../engine/context";
import { BUILDING_SOURCES, buildingRetirementLimitations, buildingRows, isCounted } from "../../engine/tiles/buildings-shared";
import { candidate, makeTile, missing, obs, polygonCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";

const round1 = (value: number) => Math.round(value * 10) / 10;
const fallbackPoint = (hit: Parameters<typeof candidate>[0]) => {
  try {
    return candidate(hit, "bldg_point");
  } catch {
    return null;
  }
};

export function d02(ctx: EngineContext): TileResult {
  const rows = buildingRows(ctx);
  if (rows === null) return notProvided(ctx, "D02");

  const counted = rows.filter((row) => isCounted(ctx, row)).length; // 동수는 중심점 기준, 그림은 교차 전부
  const points: Array<ReturnType<typeof candidate>> = [];
  const polygons: PolygonCandidate[] = [];
  let validGeometry = 0;
  let footprintM2 = 0;
  let failedGeometry = 0;

  for (const row of rows) {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, row.hit.geometry);
    if (clipped === null) {
      failedGeometry++;
      const point = fallbackPoint(row.hit);
      if (point) points.push(point);
      continue;
    }
    footprintM2 += clipped.areaM2;
    let hasPolygon = false;
    for (const rings of clipped.parts) {
      const polygon = polygonCandidate(row.hit.featureId, "bldg_footprint", rings, polygonArea(rings), row.hit.name);
      if (polygon) {
        polygons.push(polygon);
        hasPolygon = true;
      }
    }
    if (hasPolygon) {
      validGeometry++;
    } else {
      failedGeometry++;
      const point = fallbackPoint(row.hit);
      if (point) points.push(point);
    }
  }

  const circleAreaM2 = Math.round(Math.PI * ctx.input.radiusM ** 2);
  const footprintNumerator = Math.round(footprintM2);
  const footprintPct = round1((footprintNumerator / circleAreaM2) * 100);
  const nonBuildingPct = round1(100 - footprintPct);
  const geometryMetric = rows.length === 0
    ? missing("fill_geometry_pct", "유효 건물 도형", "%", "d02-fill-geometry@1:유효 도형 동수÷히트 동수")
    : obs("fill_geometry_pct", "유효 건물 도형", round1((validGeometry / rows.length) * 100), "%", "d02-fill-geometry@1:유효 도형 동수÷히트 동수", validGeometry, rows.length);
  const metrics: TileDraft["metrics"] = [
    obs("buildings", "반경 안 건물(중심점 기준)", counted, "동", "d02-buildings@1:발자국 중심점이 반경 원 안에 있는 건물 동수"),
    geometryMetric,
    obs("share_footprint_pct", "건물 발자국 구성비", footprintPct, "%", "d02-share@1:Σ교차 발자국 면적÷π·r²", footprintNumerator, circleAreaM2),
    obs("share_non_building_pct", "비건물 면적 구성비", nonBuildingPct, "%", "d02-non-building@1:100−건물 발자국 구성비", circleAreaM2 - footprintNumerator, circleAreaM2),
    obs("back_buildings", "반경 안 건물(중심점 기준)", counted, "동", "d02-back-buildings@1:발자국 중심점이 반경 원 안에 있는 건물 동수"),
  ];

  const coverage = ctx.coverage("buildings", BUILDING_SOURCES);
  const retirementLimitations = buildingRetirementLimitations(ctx);
  const status: TileResult["status"] = failedGeometry > 0 || retirementLimitations.length > 0 || coverage.some((l) => l.kind === "partial" || l.kind === "incomplete") ? "partial" : "complete";
  const sentence = counted === 0
    ? "반경 안 건물(중심점 기준) 0동이며 발자국 도형이 확인되지 않음 → 건물 자료 기준으로 비건물 면적을 표시함 → 현장 건물과 최신 건축물대장 확인 필요"
    : `반경 안 건물(중심점 기준) ${counted.toLocaleString("en-US")}동, 발자국 구성비 ${footprintPct}% → 반경 안 건물 범위와 비건물 면적을 표시하며 발자국 합계는 겹침 제거 전 값임 → 건물 경계와 현장 이용 현황 확인 필요`;
  const limitations: Limitation[] = [
    { kind: "estimated", note: "발자국 겹침을 제거하지 않은 합계(겹침은 드묾)" },
    ...(failedGeometry > 0 ? [{ kind: "partial" as const, note: `도형 오류로 교차 면적을 계산하지 못한 ${failedGeometry}동은 발자국 구성비에서 빠졌습니다.` }] : []),
    ...retirementLimitations,
    ...coverage,
  ];

  return makeTile(ctx, {
    code: "D02",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D02-buildings@1", basisMetricIds: ["buildings", "share_footprint_pct"], sentence, level: null, criteria: null },
    sources: ctx.sources("buildings", BUILDING_SOURCES),
    layers: ["bldg_footprint", "bldg_point"],
    map: points,
    polygons,
    limitations,
  });
}
