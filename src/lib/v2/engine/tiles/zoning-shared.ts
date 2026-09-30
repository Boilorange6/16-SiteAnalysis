/** A12·D08 공통 용도지역 조회. 중첩 지정과 우산 도형을 보존한다. */
import { booleanPointInPolygon } from "@turf/turf";
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import type { SourceRef, EngineContext } from "../context";
import { candidate, polygonCandidate, type MapCandidate, type PolygonCandidate } from "./common";
import { clipToCircle, polygonArea } from "./geo";

export const ZONING_LAYERS = ["zoning_urban", "zoning_management", "zoning_agri_forest", "zoning_nature", "zoning_other"] as const;
export const CLASSES = ["주거", "상업", "공업", "녹지", "관리", "농림", "자연환경보전", "기타"] as const;

export interface ZoningCollection {
  sources: SourceRef[];
  hits: FeatureHit[];
  byClass: Map<string, number>;
  byRaw: Map<string, number>;
  polys: PolygonCandidate[];
  points: MapCandidate[];
  total: number;
  circleArea: number;
  umbrellas: number;
  clipFailed: number;
  siteLabel: string | null;
  siteNames: string[];
  fine: FeatureHit[];
}

/** 현재 A12 용도지역 본문을 D08에서도 그대로 사용하도록 한 곳에서 집계한다. */
function collectZoningUncached(ctx: EngineContext): ZoningCollection | null {
  const sources = ctx.sources("reference", ZONING_LAYERS);
  if (sources.length === 0) return null;

  const { center, radiusM } = ctx.input;
  const hits = ctx.hits("reference", ["zoning_area"]);
  const isUmbrella = (h: FeatureHit) => h.properties.umbrella === true;
  const cls = (h: FeatureHit) => (CLASSES as readonly string[]).includes(String(h.properties.zoningClass)) ? String(h.properties.zoningClass) : "기타";
  const nameOf = (h: FeatureHit) => (typeof h.properties.zoningName === "string" && h.properties.zoningName !== "" ? h.properties.zoningName : h.name ?? "이름 없음");

  // 대지: 중심점이 든 도형 (세분 지정이 있으면 그것만, 없으면 우산 도형)
  const xy = toUtmk(center);
  const containing = ctx.hits("reference", ["zoning_area"], 1).filter((h) => booleanPointInPolygon(
    xy as [number, number],
    { type: "Feature", properties: {}, geometry: h.geometry } as never,
  ));
  const fine = containing.filter((h) => !isUmbrella(h));
  const siteNames = [...new Set(fine.map(nameOf))];
  const siteLabel = siteNames.length ? siteNames.join(", ") : containing.length ? "도시지역(세분 미확인)" : null;

  // 반경 안 구성비. 겹치는 지정은 합치지 않으며, 우산 도형은 세분 지정과의 중복을 피하려고 제외한다.
  const circleArea = Math.PI * radiusM * radiusM;
  const byClass = new Map<string, number>();
  const byRaw = new Map<string, number>();
  const polys: PolygonCandidate[] = [];
  const points: MapCandidate[] = [];
  let clipFailed = 0;
  const umbrellas = hits.filter(isUmbrella).length;
  for (const h of hits.filter((x) => !isUmbrella(x))) {
    const parts = clipToCircle(center, radiusM, h.geometry);
    if (parts === null) {
      clipFailed++;
      continue;
    }
    const areaM2 = parts.reduce((sum, part) => sum + polygonArea(part), 0);
    if (areaM2 <= 0) continue;
    byClass.set(cls(h), (byClass.get(cls(h)) ?? 0) + areaM2);
    byRaw.set(nameOf(h), (byRaw.get(nameOf(h)) ?? 0) + areaM2);
    for (const rings of parts) {
      const polygon = polygonCandidate(h.featureId, `zone:${cls(h)}`, rings, polygonArea(rings), nameOf(h));
      if (polygon) polys.push(polygon);
    }
    points.push(candidate({ ...h, geometry: { type: "MultiPolygon", coordinates: parts } }, `zone_center:${cls(h)}`));
  }

  return {
    sources,
    hits,
    byClass,
    byRaw,
    polys,
    points,
    total: [...byClass.values()].reduce((sum, areaM2) => sum + areaM2, 0),
    circleArea,
    umbrellas,
    clipFailed,
    siteLabel,
    siteNames,
    fine,
  };
}

export function collectZoning(ctx: EngineContext): ZoningCollection | null {
  return ctx.memo("zoning:circle:v1", () => collectZoningUncached(ctx));
}
