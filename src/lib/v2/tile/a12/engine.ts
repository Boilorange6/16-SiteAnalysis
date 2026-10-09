/** A12 토지·용도지역·공시지가·주변 지가. 용도지역 집계는 D08과 공유한다. */
import type BetterSqlite3 from "better-sqlite3";
import { feature, featureCollection, intersect } from "@turf/turf";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation, SourceRef } from "../../engine/context";
import { est, makeTile, obs, type MapCandidate, type TileDraft } from "../../engine/tiles/common";
import { polygonArea, polygonParts } from "../../engine/tiles/geo";
import { collectZoning, CLASSES, ZONING_LAYERS, type ZoningCollection } from "../../engine/tiles/zoning-shared";
import { notProvided } from "../../engine/tiles/not-provided";
import { zoningPolygons, zoningSiteCandidate } from "./labels";

export { CLASSES } from "../../engine/tiles/zoning-shared";

const RAW_TOP = 6;
type Metric = TileResult["metrics"][number];

const r1 = (n: number) => Math.round(n * 10) / 10;
const rounded = (n: number) => Math.round(n);

function unavailable(id: string, label: string, unit: string, formulaVersion: string, numerator: number | null = null, denominator: number | null = null): Metric {
  return { id, label, value: null, unit, formulaVersion, numerator, denominator, status: "missing" };
}

function hasTable(db: BetterSqlite3.Database | null, table: string): boolean {
  if (!db) return false;
  try {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  } catch {
    return false;
  }
}

interface PriceRow {
  pnu: string;
  base_year: number;
  price_krw_per_m2: number;
}

function pricesByPnu(db: BetterSqlite3.Database, pnus: readonly string[]): Map<string, PriceRow> {
  const out = new Map<string, PriceRow>();
  for (let offset = 0; offset < pnus.length; offset += 500) {
    const batch = pnus.slice(offset, offset + 500);
    if (batch.length === 0) continue;
    const rows = db.prepare(`SELECT pnu, base_year, price_krw_per_m2 FROM land_price WHERE pnu IN (${batch.map(() => "?").join(",")})`).all(...batch) as PriceRow[];
    for (const row of rows) out.set(row.pnu, row);
  }
  return out;
}

function geometryAreaM2(hit: { geometry: Parameters<typeof polygonParts>[0] }): number | null {
  const area = polygonParts(hit.geometry).reduce((sum, rings) => sum + polygonArea(rings), 0);
  return area > 0 && Number.isFinite(area) ? area : null;
}

function ledgerAreaM2(hit: { geometry: Parameters<typeof polygonParts>[0]; properties: Record<string, unknown> }): number | null {
  for (const key of ["studyAreaM2", "ledgerAreaM2", "officialAreaM2", "landAreaM2", "areaM2"]) {
    const value = hit.properties[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return geometryAreaM2(hit);
}

function intersectionAreaM2(a: Parameters<typeof polygonParts>[0], b: Parameters<typeof polygonParts>[0]): number {
  try {
    const clipped = intersect(featureCollection([feature(a as never), feature(b as never)]) as never);
    if (!clipped) return 0;
    return polygonParts(clipped.geometry).reduce((sum, rings) => sum + polygonArea(rings), 0);
  } catch {
    return 0;
  }
}

interface PriceDetails {
  metrics: Metric[];
  limitations: Limitation[];
  sources: SourceRef[];
}

function priceDetails(ctx: EngineContext): PriceDetails {
  const reference = ctx.db("reference");
  const landPriceTable = hasTable(reference, "land_price");
  const pnu = typeof ctx.input.pnu === "string" && ctx.input.pnu.trim() !== "" ? ctx.input.pnu.trim() : null;
  const siteHits = ctx.siteParcelHits();
  const polygonSite = ctx.input.site.kind === "polygon";
  const priceSources = ctx.sources("reference", ["land_price"]);
  const metrics: Metric[] = [];
  const limitations: Limitation[] = [];

  let targetReason: string | null = null;
  if (!landPriceTable || !reference) {
    targetReason = "land_price 테이블 없음";
    metrics.push(unavailable("land_price", "대상 필지 개별공시지가", "원/㎡", "a12-land-price@1:land_price 테이블 없음"));
  } else if (siteHits.length === 0) {
    targetReason = pnu ? "대상 PNU 도형 행 없음" : polygonSite ? "교차 필지 자료 없음" : "pnu 없음";
    metrics.push(unavailable("land_price", "대상 필지 개별공시지가", "원/㎡", "a12-land-price@1:pnu 없음"));
  } else {
    const targetPnus = siteHits.map((hit) => hit.pnu).filter((value): value is string => typeof value === "string" && value !== "");
    const byPnu = pricesByPnu(reference, [...new Set(targetPnus)]);
    let weightedTotal = 0;
    let weightTotal = 0;
    let latestYear = 0;
    for (const hit of siteHits) {
      const price = hit.pnu ? byPnu.get(hit.pnu) : undefined;
      const geometryArea = geometryAreaM2(hit) ?? 0;
      const clippedArea = polygonSite && ctx.input.site.geometry ? intersectionAreaM2(ctx.input.site.geometry, hit.geometry) : geometryArea;
      const fraction = geometryArea > 0 ? Math.max(0, Math.min(1, clippedArea / geometryArea)) : 0;
      const weight = (ledgerAreaM2(hit) ?? clippedArea) * (polygonSite ? fraction : 1);
      if (price && weight > 0) {
        weightedTotal += price.price_krw_per_m2 * weight;
        weightTotal += weight;
        latestYear = Math.max(latestYear, price.base_year);
      }
    }
    if (weightTotal <= 0) {
      targetReason = "대지 필지의 공시지가 행 없음";
      metrics.push(unavailable("land_price", "대상 필지 개별공시지가", "원/㎡", "a12-land-price@1:해당 PNU 행 없음"));
    } else {
      const average = rounded(weightedTotal / weightTotal);
      const makePrice = polygonSite ? est : obs;
      metrics.push(makePrice(
        "land_price",
        polygonSite ? "대지 면적가중 공시지가(추정)" : siteHits.length > 1 ? "합필 대지 면적가중 공시지가" : "대상 필지 개별공시지가",
        average,
        "원/㎡",
        `a12-land-price@2:${polygonSite ? "그린 구역과 교차한 필지별 면적 가중" : "대지 필지별 공부면적 가중"}, 기준연도 ${latestYear}`,
        rounded(weightTotal),
        rounded(weightTotal),
      ));
    }
  }
  if (targetReason) limitations.push({ kind: "not_provided", note: `대상 필지 개별공시지가를 표시하지 않습니다(${targetReason}).` });

  const parcelsDb = ctx.db("parcels");
  const parcelHits = parcelsDb ? ctx.hits("parcels", ["parcel"]) : [];
  const parcelPnus = parcelHits.map((hit) => hit.pnu).filter((value): value is string => typeof value === "string" && value !== "");
  let nearbyReason: string | null = null;
  if (!parcelsDb) {
    nearbyReason = "주변 필지 자료 없음";
    metrics.push(unavailable("nearby_price_median", "주변 필지 공시지가 중앙값", "원/㎡", "a12-nearby-price@1:주변 필지 자료 없음"));
  } else if (!landPriceTable || !reference) {
    nearbyReason = "land_price 테이블 없음";
    metrics.push(unavailable("nearby_price_median", "주변 필지 공시지가 중앙값", "원/㎡", "a12-nearby-price@1:land_price 테이블 없음", 0, parcelHits.length));
  } else {
    const byPnu = pricesByPnu(reference, [...new Set(parcelPnus)]);
    const values = parcelPnus.map((parcelPnu) => byPnu.get(parcelPnu)?.price_krw_per_m2).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (values.length === 0) {
      nearbyReason = "반경 필지의 공시지가 행 없음";
      metrics.push(unavailable("nearby_price_median", "주변 필지 공시지가 중앙값", "원/㎡", "a12-nearby-price@1:반경 필지의 공시지가 행 없음", 0, parcelHits.length));
    } else {
      values.sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      const median = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
      metrics.push(obs(
        "nearby_price_median",
        "주변 필지 공시지가 중앙값",
        median,
        "원/㎡",
        "a12-nearby-price@1:반경과 교차한 필지의 조회 성공 지가 중앙값",
        values.length,
        parcelHits.length,
      ));
    }
  }
  if (nearbyReason) limitations.push({ kind: "not_provided", note: `주변 필지 공시지가 중앙값을 표시하지 않습니다(${nearbyReason}).` });

  metrics.push(obs("site_parcels", "대지에 포함된 필지 수", siteHits.length, "필지", "a12-site-parcels@1:대지 geometry와 실제 교차하는 parcel 도형 수"));
  let parcelAreaReason: string | null = null;
  if (!parcelsDb) {
    if (polygonSite && ctx.input.site.geometry) {
      const area = polygonParts(ctx.input.site.geometry).reduce((sum, rings) => sum + polygonArea(rings), 0);
      metrics.push(est("parcel_area_m2", "직접 그린 구역 면적(추정)", rounded(area), "㎡", "a12-parcel-area@2:필지 자료 없이 직접 그린 구역 도형 면적"));
    } else {
      parcelAreaReason = "필지 도형 자료 없음";
      metrics.push(unavailable("parcel_area_m2", "대상 필지 도형 면적", "㎡", "a12-parcel-area@1:필지 도형 자료 없음"));
    }
  } else {
    const areaM2 = siteHits.reduce((sum, hit) => {
      const geometryArea = geometryAreaM2(hit) ?? 0;
      const clippedArea = polygonSite && ctx.input.site.geometry ? intersectionAreaM2(ctx.input.site.geometry, hit.geometry) : geometryArea;
      const fraction = geometryArea > 0 ? Math.max(0, Math.min(1, clippedArea / geometryArea)) : 0;
      return sum + (ledgerAreaM2(hit) ?? clippedArea) * (polygonSite ? fraction : 1);
    }, 0);
    if (areaM2 <= 0) {
      parcelAreaReason = siteHits.length > 0 ? "대상 필지 도형 면적 없음" : "대상 PNU 도형 행 없음";
      metrics.push(unavailable("parcel_area_m2", "대상 필지 도형 면적", "㎡", `a12-parcel-area@1:${parcelAreaReason}`));
    } else {
      const makeArea = polygonSite ? est : obs;
      metrics.push(makeArea("parcel_area_m2", polygonSite ? "대지 면적(교차 필지 비율 추정)" : siteHits.length > 1 ? "합필 공부면적 합계" : "대상 필지 도형 면적", rounded(areaM2), "㎡", `a12-parcel-area@2:${polygonSite ? "직접 그린 구역과 필지 교차면적 비율" : "대지 포함 필지별 공부면적 합"}`));
    }
  }
  if (parcelAreaReason) limitations.push({ kind: "not_provided", note: `대상 필지 도형 면적을 표시하지 않습니다(${parcelAreaReason}).` });
  if (polygonSite) limitations.push({ kind: "estimated", note: "직접 그린 구역의 공시지가·면적은 경계와 교차한 필지 면적 비율로 가중한 추정치입니다." });

  return { metrics, limitations, sources: priceSources };
}

function zoningLimitations(ctx: EngineContext, zoning: ZoningCollection, includePrice: Limitation[] = []): Limitation[] {
  const missingLayers = ZONING_LAYERS.filter((layer) => !zoning.sources.some((source) => source.sourceId === layer));
  const overlap = zoning.total > zoning.circleArea * 1.005;
  return [
    ...includePrice,
    { kind: "unknown", note: "구성비의 분모는 반경 원 면적입니다(수면·도면 밖·미지정 구간 포함). 지구·지구단위계획은 포함하지 않습니다." },
    ...(overlap ? [{ kind: "estimated" as const, note: `겹치는 지정 도형이 있어 구성비 합이 ${r1((zoning.total / zoning.circleArea) * 100)}%로 100%를 넘을 수 있습니다(겹친 면적은 각각 셈).` }] : []),
    ...(zoning.umbrellas > 0 ? [{ kind: "suppressed" as const, note: `세분 없이 “도시지역”으로만 지정된 도형 ${zoning.umbrellas}건은 다른 지정과 겹쳐 구성비에서 제외했습니다.` }] : []),
    ...(zoning.fine.length > 1 ? [{ kind: "unknown" as const, note: "대지 중심점에 복수의 용도지역 지정이 있어 모두 표시했습니다. 어느 것이 적용되는지 확인이 필요합니다." }] : []),
    ...(zoning.clipFailed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 절단이 안 된 ${zoning.clipFailed}건은 구성비에서 빠졌습니다.` }] : []),
    ...(missingLayers.length > 0 ? [{ kind: "incomplete" as const, note: `용도지역 자료 ${missingLayers.length}종(${missingLayers.join(", ")})을 확인하지 못했습니다.` }] : []),
    ...ctx.coverage("reference", ZONING_LAYERS),
  ];
}

export function a12(ctx: EngineContext): TileResult {
  const zoning = collectZoning(ctx);
  if (!zoning) return notProvided(ctx, "A12");

  const { byClass, byRaw, circleArea, total, siteLabel, siteNames, fine } = zoning;
  const pct = (areaM2: number) => r1((areaM2 / circleArea) * 100);
  // D08 흡수 후에도 클래스 번호가 자료가 없는 분류 때문에 밀리지 않도록 고정한다.
  const classes = CLASSES.map((name) => [name, byClass.get(name) ?? 0] as const);
  const presentClasses = classes.filter(([, areaM2]) => areaM2 > 0);
  const raws = [...byRaw].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, RAW_TOP);
  const prices = priceDetails(ctx);
  const sources = [...zoning.sources, ...prices.sources];

  const metrics: TileDraft["metrics"] = [
    obs("site_zoning_count", "대지 중심점의 용도지역 지정 수(세분 기준)", fine.length, "건", "a12-site@1:중심점이 든 도형, 우산 도형 제외"),
    ...classes.map(([name, areaM2], index) => obs(`share_class_${index + 1}`, `구성비: ${name}`, pct(areaM2), "%", "a12-share-class@1:교차면적÷반경 원 면적(분류: D08)", rounded(areaM2), rounded(circleArea))),
    ...raws.map(([name, areaM2], index) => obs(`share_raw_${index + 1}`, `세분: ${name}`, pct(areaM2), "%", "a12-share-raw@1:교차면적÷반경 원 면적(원천 세분)", rounded(areaM2), rounded(circleArea))),
    obs("share_sum", "구성비 합", pct(total), "%", "a12-share-sum@1:100% 초과는 겹친 지정", rounded(total), rounded(circleArea)),
    ...prices.metrics,
  ];

  const top = presentClasses.length ? [...presentClasses].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, areaM2]) => `${name} ${pct(areaM2)}%`).join("·") : null;
  const sentence = siteLabel === null
    ? `대지 중심점의 용도지역 지정을 도면에서 확인하지 못함${top ? `, 반경 안 구성은 ${top}` : ""} → 도면 밖이거나 미지정일 수 있음 → 토지이용계획확인서와 공시지가 자료로 확인 필요`
    : `대지 중심점은 ${siteLabel}${siteNames.length > 1 ? "(복수 지정)" : ""}${top ? `, 반경 안 구성은 ${top}` : ""} → 지정 현황이며 지구·건축 허용 여부나 지가 수준은 아님 → 공시지가와 개별 규제를 토지이용계획확인서로 확인 필요`;

  const map: MapCandidate[] = [];
  const site = zoningSiteCandidate(zoning, ctx.input.center[0], ctx.input.center[1]);
  if (site) map.push(site);
  const limitations = zoningLimitations(ctx, zoning, prices.limitations);
  const status: TileResult["status"] = prices.metrics.some((metric) => metric.status === "missing") || limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";

  return makeTile(ctx, {
    code: "A12",
    status,
    metrics,
    judgment: { ruleId: "a12-zoning@1", basisMetricIds: ["site_zoning_count"], sentence, level: null, criteria: null },
    sources,
    layers: ["zoning_site", ...CLASSES.map((name) => `zone:${name}`)],
    map,
    polygons: zoningPolygons(zoning),
    limitations,
  });
}
