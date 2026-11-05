/** D04 준공 연대 — 별도 buildings 파일의 건물별 사용승인일 분포. */
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { DECADE_LAYERS, decadeLayer } from "../../ui/callout-layout";
import { candidate, makeTile, missing, obs, polygonCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { BUILDING_SOURCES, buildingLabelName, buildingRetirementLimitations, buildingRows, isCounted, nearestBuildingPerGroup, pnuNameLimitation, straightDistanceLabel, type BuildingRow } from "../../engine/tiles/buildings-shared";
import { useLabelOf } from "../d03/engine";
import { notProvided } from "../../engine/tiles/not-provided";

const DECADES = [
  { id: "share_pre1980", label: "1979년 이하", layer: "bldg_pre1980" },
  { id: "share_1980s", label: "1980년대", layer: "bldg_1980s" },
  { id: "share_1990s", label: "1990년대", layer: "bldg_1990s" },
  { id: "share_2000s", label: "2000년대", layer: "bldg_2000s" },
  { id: "share_2010s", label: "2010년대", layer: "bldg_2010s" },
  { id: "share_2020s", label: "2020년 이상", layer: "bldg_2020s" },
] as const;

function approvalYear(value: unknown, analysisDate: string): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const year = Number(value.slice(0, 4));
  return year >= 1800 && year <= Number(analysisDate.slice(0, 4)) ? year : null;
}

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;
const buildingMapExtra = (name: string | null, year: number | null) => ({
  name,
  sublabel: year === null ? null : `${year}년`,
  labelPriority: name === null ? 0 : 1,
  value: year, // 그래프 값: 사용승인 연도(미상 null)
});
const fallbackPoint = (hit: Parameters<typeof candidate>[0], layer: string, year: number | null, counted: boolean, name: string | null) => {
  try {
    return candidate(hit, layer, { ...buildingMapExtra(name, year), counted });
  } catch {
    return null;
  }
};

/** 연도: 원천 승인일, 없으면 같은 필지 단일 단지의 승인일(라벨·연대용 보충). */
const rowYear = (row: BuildingRow, analysisDate: string): number | null => approvalYear(row.approvalDate ?? row.pnuSupplement?.approvalDate, analysisDate);

/** D04 라벨 대상: 공동주택(주용도 02) 또는 용도 없음 + 같은 필지에 단지가 있는 건물. */
const isLabelTarget = (row: BuildingRow): boolean => (row.useCode?.startsWith("02") ?? false) || (row.useCode === null && row.pnuSupplement?.hasComplex === true);

export function d04(ctx: EngineContext): TileResult {
  const sources = ctx.sources("buildings", BUILDING_SOURCES);
  if (sources.length === 0 || !ctx.db("buildings")) return notProvided(ctx, "D04");

  const rows = buildingRows(ctx);
  if (rows === null) return notProvided(ctx, "D04");
  const allYears = new Map(rows.map((row) => [row.hit.featureId, rowYear(row, ctx.input.analysisDate)]));
  const years = new Map(rows.filter((row) => isCounted(ctx, row)).map((row) => [row.hit.featureId, allYears.get(row.hit.featureId) ?? null])); // 동수·구성비는 중심점이 반경 안인 건물만, 그림은 교차 전부
  const ledgerBackfilled = rows.filter((row) => isCounted(ctx, row) && row.approvalDateSource === "core_ledger_pnu").length;
  const points: Array<ReturnType<typeof candidate>> = [];
  const polygons: PolygonCandidate[] = [];
  const labelRows: Array<{ row: BuildingRow; year: number; polygons: PolygonCandidate[] }> = [];
  let failedGeometry = 0;
  for (const row of rows) {
    const hit = row.hit;
    const year = allYears.get(hit.featureId) ?? null;
    const counted = isCounted(ctx, row);
    const name = buildingLabelName(row);
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (clipped === null) {
      failedGeometry += 1;
      const point = fallbackPoint(hit, decadeLayer(year), year, counted, name);
      if (point) points.push(point);
      continue;
    }
    let hasPolygon = false;
    const rowPolygons: PolygonCandidate[] = [];
    for (const rings of clipped.parts) {
      const polygon = polygonCandidate(hit.featureId, decadeLayer(year), rings, polygonArea(rings), null, { ...buildingMapExtra(name, year), counted });
      if (polygon) {
        polygons.push(polygon);
        rowPolygons.push(polygon);
        hasPolygon = true;
      }
    }
    if (!hasPolygon) {
      failedGeometry += 1;
      const point = fallbackPoint(hit, decadeLayer(year), year, counted, name);
      if (point) points.push(point);
    } else if (counted && year !== null && isLabelTarget(row)) labelRows.push({ row, year, polygons: rowPolygons });
  }
  // 라벨: 연대마다 대지에서 가장 가까운 공동주택 1동의 가장 큰 조각만 우선순위 2(연대 미상은 대상이 아니다).
  for (const { item, distanceM } of nearestBuildingPerGroup(ctx, labelRows, (entry) => decadeLayer(entry.year)).values()) {
    const largest = item.polygons.reduce((best, polygon) => (polygon.areaM2 > best.areaM2 ? polygon : best));
    largest.p.labelPriority = 2;
    largest.p.sublabel = `${item.year}년 · ${straightDistanceLabel(distanceM)}`;
    if (buildingLabelName(item.row) === null) largest.p.unnamedTitle = useLabelOf(item.row.useCode) ?? "공동주택";
  }
  const total = years.size;
  const confirmed = [...years.values()].filter((year): year is number => year !== null).length;
  const byLayer = new Map<string, number>(DECADE_LAYERS.map((layer) => [layer, 0]));
  for (const year of years.values()) {
    const layer = decadeLayer(year);
    byLayer.set(layer, (byLayer.get(layer) ?? 0) + 1);
  }

  const metrics: TileDraft["metrics"] = [
    total === 0 ? missing("confirmed_share_pct", "사용승인일 확인 건물", "%", "d04-confirmed-share@1") : obs("confirmed_share_pct", "사용승인일 확인 건물", pct(confirmed, total), "%", "d04-confirmed-share@1", confirmed, total),
    ...DECADES.map((decade) => {
      const count = byLayer.get(decade.layer) ?? 0;
      return total === 0 ? missing(decade.id, decade.label, "%", "d04-decades@1") : obs(decade.id, decade.label, pct(count, total), "%", "d04-decades@1", count, total);
    }),
    total === 0 ? missing("share_unknown", "미상", "%", "d04-decades@1") : obs("share_unknown", "미상", pct(byLayer.get("bldg_unknown") ?? 0, total), "%", "d04-decades@1", byLayer.get("bldg_unknown") ?? 0, total),
  ];

  const coverage = ctx.coverage("buildings", BUILDING_SOURCES);
  const retirementLimitations = buildingRetirementLimitations(ctx);
  const status: TileResult["status"] = failedGeometry > 0 || retirementLimitations.length > 0 || coverage.some((l) => l.kind === "partial" || l.kind === "incomplete") ? "partial" : "complete";
  const sentence = total === 0
    ? "반경 안 건물이 확인되지 않아 준공 연대를 산출하지 못함 → 건물 자료와 현장 확인 필요"
    : `반경 안 건물 ${total.toLocaleString("en-US")}동 중 사용승인일 확인 ${pct(confirmed, total)}% → 확인된 건물의 준공 연대를 집계하고 미상은 별도로 표시 → 개별 건축물대장 확인 필요`;

  const supplementDated = rows.filter((row) => isCounted(ctx, row) && row.approvalDate === null && row.pnuSupplement?.approvalDate && approvalYear(row.pnuSupplement.approvalDate, ctx.input.analysisDate) !== null).length;
  const nameLimitation = pnuNameLimitation(rows.filter((row) => isCounted(ctx, row)));
  const limitations = [
    ...retirementLimitations,
    ...(ledgerBackfilled > 0 ? [{ kind: "estimated" as const, note: "도로명주소 보충 건물 " + ledgerBackfilled + "동은 PNU로 core 건축물대장 표제부·집계 자료의 사용승인일을 연결했습니다. 한 PNU에 여러 동이 있으면 가장 이른 승인일을 사용합니다." }] : []),
    ...(supplementDated > 0 ? [{ kind: "estimated" as const, note: `같은 필지(PNU)의 단지가 하나뿐인 건물 ${supplementDated}동은 그 단지의 사용승인일을 썼습니다.` }] : []),
    ...(nameLimitation ? [nameLimitation] : []),
    ...coverage,
    ...(failedGeometry > 0 ? [{ kind: "partial" as const, note: `도형 오류로 지도에 표시하지 못한 ${failedGeometry}건은 발자국에서 빠졌습니다.` }] : []),
  ];
  return makeTile(ctx, {
    code: "D04",
    type: "diagram",
    status,
    metrics,
    judgment: { ruleId: "D04-decades@1", basisMetricIds: ["confirmed_share_pct"], sentence, level: null, criteria: null },
    sources,
    layers: [...DECADE_LAYERS],
    map: points,
    polygons,
    valueAxis: { label: "사용승인 연도", unit: "년", countUnit: "동" },
    limitations,
  });
}
