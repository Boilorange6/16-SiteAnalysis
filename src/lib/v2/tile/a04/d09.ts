/**
 * D09 공원·녹지·하천.
 *
 * 공원은 경계가 없는 대표점 원천의 개수·원천 면적 합으로, 녹지와 수면은
 * 반경 원과 실제 도형의 교차면적으로 따로 계산한다. 서로 다른 원천을
 * 합쳐 하나의 녹지 면적으로 해석하지 않는다.
 */
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../../engine/context";
import { candidate, makeTile, missing, obs, polygonCandidate, type MapCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";

const ZONING_SOURCES = ["zoning_urban", "zoning_management", "zoning_agri_forest", "zoning_nature", "zoning_other"] as const;
const WATER_JIMOK = new Set(["천", "구", "유"]);
const GREEN_JIMOK = new Set(["임", "공"]);

const pct = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;
const rounded = (value: number) => Math.round(value);

interface AreaSummary {
  areaM2: number;
  failed: number;
  polygons: PolygonCandidate[];
  map: MapCandidate[];
}

function clippedAreas(ctx: EngineContext, hits: ReturnType<EngineContext["hits"]>, layer: string): AreaSummary {
  let areaM2 = 0;
  let failed = 0;
  const polygons: PolygonCandidate[] = [];
  const map: MapCandidate[] = [];

  for (const hit of hits) {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    if (clipped === null) {
      failed++;
      continue;
    }
    if (clipped.areaM2 <= 0) continue;
    areaM2 += clipped.areaM2;
    const label = hit.name ?? null;
    map.push(candidate(hit, layer, { label, weight: rounded(clipped.areaM2) }));
    for (const rings of clipped.parts) {
      const partArea = polygonArea(rings);
      const polygon = polygonCandidate(hit.featureId, layer, rings, partArea, label);
      if (polygon && polygon.areaM2 > 0) polygons.push(polygon);
    }
  }
  return { areaM2, failed, polygons, map };
}

function sourceArea(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function dedupeLimitations(limitations: Limitation[]): Limitation[] {
  return limitations.filter((limitation, index) => limitations.findIndex((other) => other.note === limitation.note) === index);
}

export function d09(ctx: EngineContext): TileResult {
  const parkSources = ctx.sources("reference", ["park"]);
  const zoningSources = ctx.sources("reference", ZONING_SOURCES);
  const parcelSources = ctx.sources("parcels", ["parcel_polygon"]);

  if (parkSources.length === 0 && zoningSources.length === 0 && parcelSources.length === 0) {
    return notProvided(ctx, "D09", "공원·녹지·하천 자료(공원·용도지역·필지 도형)를 확인하지 못했습니다.");
  }

  const circleAreaM2 = Math.PI * ctx.input.radiusM * ctx.input.radiusM;
  const circleAreaRounded = rounded(circleAreaM2);
  const parkHits = parkSources.length > 0 ? ctx.hits("reference", ["park"]) : [];
  const zoningHits = zoningSources.length > 0
    ? ctx.hits("reference", ["zoning_area"]).filter((hit) => hit.properties.zoningClass === "녹지")
    : [];
  const parcelHits = parcelSources.length > 0 ? ctx.hits("parcels", ["parcel"]) : [];

  const parkAreas = parkHits.map((hit) => sourceArea(hit.properties.areaM2)).filter((area): area is number => area !== null);
  const waterHits = parcelHits.filter((hit) => WATER_JIMOK.has(String(hit.properties.jimok ?? "")));
  const greenParcelHits = parcelHits.filter((hit) => GREEN_JIMOK.has(String(hit.properties.jimok ?? "")));
  const water = clippedAreas(ctx, waterHits, "water_parcel");
  const greenParcel = clippedAreas(ctx, greenParcelHits, "green_parcel");
  const greenZone = clippedAreas(ctx, zoningHits, "green_zone");

  const metrics: TileDraft["metrics"] = [
    parcelSources.length > 0
      ? obs("share_water_pct", "수면·하천 지목 구성비", pct(water.areaM2, circleAreaM2), "%", "d09-water-share@1:지목 천·구·유 도형의 반경 교차면적÷π·r²", rounded(water.areaM2), circleAreaRounded)
      : missing("share_water_pct", "수면·하천 지목 구성비", "%", "d09-water-share@1:필지 도형 자료 확인 불가"),
    parcelSources.length > 0
      ? obs("share_green_parcel_pct", "공원·임야 지목 녹지 구성비", pct(greenParcel.areaM2, circleAreaM2), "%", "d09-green-parcel-share@1:지목 임·공 도형의 반경 교차면적÷π·r²", rounded(greenParcel.areaM2), circleAreaRounded)
      : missing("share_green_parcel_pct", "공원·임야 지목 녹지 구성비", "%", "d09-green-parcel-share@1:필지 도형 자료 확인 불가"),
    zoningSources.length > 0
      ? obs("share_green_zone_pct", "녹지지역 구성비", pct(greenZone.areaM2, circleAreaM2), "%", "d09-green-zone-share@1:zoningClass=녹지 도형의 반경 교차면적÷π·r²", rounded(greenZone.areaM2), circleAreaRounded)
      : missing("share_green_zone_pct", "녹지지역 구성비", "%", "d09-green-zone-share@1:용도지역 자료 확인 불가"),
    parcelSources.length > 0
      ? obs("back_other_pct", "기타 면적 구성비(수면·지목 녹지 제외)", pct(circleAreaM2 - water.areaM2 - greenParcel.areaM2, circleAreaM2), "%", "d09-other-share@1:100%-수면-지목 녹지, 녹지지역은 제외하지 않음", rounded(circleAreaM2 - water.areaM2 - greenParcel.areaM2), circleAreaRounded)
      : missing("back_other_pct", "기타 면적 구성비(수면·지목 녹지 제외)", "%", "d09-other-share@1:필지 도형 자료 확인 불가"),
  ];

  const observedMetricIds = metrics.filter((metric) => metric.status === "observed").map((metric) => metric.id);
  const parkFact = parkSources.length > 0 ? `공원 ${parkHits.length}곳` : "공원 자료 미확인";
  const waterFact = parcelSources.length > 0 ? `수면·하천 지목 ${pct(water.areaM2, circleAreaM2)}%` : "수면·하천 지목 자료 미확인";
  const greenParcelFact = parcelSources.length > 0 ? `공원·임야 지목 ${pct(greenParcel.areaM2, circleAreaM2)}%` : "공원·임야 지목 자료 미확인";
  const greenZoneFact = zoningSources.length > 0 ? `녹지지역 ${pct(greenZone.areaM2, circleAreaM2)}%` : "녹지지역 자료 미확인";
  const sentence = `${parkFact}, ${waterFact}, ${greenParcelFact}, ${greenZoneFact} → 공원 수·지목 도형·용도지역 도형을 서로 다른 원천으로 본 현황이며 녹지지역은 지목 녹지와 겹칠 수 있음 → 계획 공원·실제 하천 경계·토지이용계획은 원문과 현장 확인 필요`;

  const map: MapCandidate[] = [];
  const polygons: PolygonCandidate[] = [...water.polygons, ...greenParcel.polygons, ...greenZone.polygons];
  map.push(...water.map, ...greenParcel.map, ...greenZone.map);

  const limitations: Limitation[] = [
    { kind: "not_provided", note: "하천·수면은 지적 지목 기준이며 OSM 수계 자료는 확인하지 못했습니다." },
    { kind: "not_provided", note: "계획 공원(도시계획시설)은 D12" },
    { kind: "unknown", note: "녹지지역은 지목과 겹칠 수 있어 합계 100% 아님" },
  ];
  if (parkSources.length === 0) limitations.push({ kind: "not_provided", note: "공원 자료를 확인하지 못해 운영 공원 수와 원천 면적을 계산하지 않았습니다." });
  if (parcelSources.length === 0) limitations.push({ kind: "not_provided", note: "필지 도형 자료를 확인하지 못해 지목별 수면·녹지와 기타 면적을 계산하지 않았습니다." });
  if (zoningSources.length === 0) limitations.push({ kind: "not_provided", note: "용도지역 자료를 확인하지 못해 녹지지역 구성비를 계산하지 않았습니다." });
  if (parkHits.length > parkAreas.length) limitations.push({ kind: "unknown", note: `공원 ${parkHits.length - parkAreas.length}곳은 원천 면적이 없어 면적 합에서 제외했습니다.` });
  if (water.failed > 0 || greenParcel.failed > 0 || greenZone.failed > 0) {
    limitations.push({ kind: "partial", note: `도형 오류로 수면 ${water.failed}건·지목 녹지 ${greenParcel.failed}건·녹지지역 ${greenZone.failed}건은 교차면적에서 제외했습니다.` });
  }
  if (parkSources.length > 0) limitations.push(...ctx.coverage("reference", ["park"]));
  if (zoningSources.length > 0) limitations.push(...ctx.coverage("reference", ZONING_SOURCES));
  if (parcelSources.length > 0) limitations.push(...ctx.coverage("parcels", ["parcel_polygon"]));

  return makeTile(ctx, {
    code: "D09",
    status: "partial",
    metrics,
    judgment: { ruleId: "d09-green-space@1", basisMetricIds: observedMetricIds, sentence, level: null, criteria: null },
    sources: [...parkSources, ...zoningSources, ...parcelSources],
    layers: ["green_zone", "green_parcel", "water_parcel"],
    map,
    polygons,
    limitations: dedupeLimitations(limitations),
  });
}
