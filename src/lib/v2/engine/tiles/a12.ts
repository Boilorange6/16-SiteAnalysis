/** A12 토지·용도지역·공시지가·주변 지가. 용도지역 집계는 D08과 공유한다. */
import type BetterSqlite3 from "better-sqlite3";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation, SourceRef } from "../context";
import { makeTile, obs, type MapCandidate, type TileDraft } from "./common";
import { polygonArea, polygonParts } from "./geo";
import { collectZoning, CLASSES, ZONING_LAYERS, type ZoningCollection } from "./zoning-shared";
import { notProvided } from "./not-provided";

export { CLASSES } from "./zoning-shared";

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

function fullParcelAreaM2(hit: { geometry: Parameters<typeof polygonParts>[0]; properties: Record<string, unknown> }): number | null {
  const area = polygonParts(hit.geometry).reduce((sum, rings) => sum + polygonArea(rings), 0);
  if (area > 0 && Number.isFinite(area)) return rounded(area);
  const fallback = hit.properties.areaM2;
  return typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0 ? rounded(fallback) : null;
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
  const priceSources = ctx.sources("reference", ["land_price"]);
  const metrics: Metric[] = [];
  const limitations: Limitation[] = [];

  let targetReason: string | null = null;
  if (!landPriceTable || !reference) {
    targetReason = "land_price 테이블 없음";
    metrics.push(unavailable("land_price", "대상 필지 개별공시지가", "원/㎡", "a12-land-price@1:land_price 테이블 없음"));
  } else if (!pnu) {
    targetReason = "pnu 없음";
    metrics.push(unavailable("land_price", "대상 필지 개별공시지가", "원/㎡", "a12-land-price@1:pnu 없음"));
  } else {
    const targetPrice = reference.prepare("SELECT pnu, base_year, price_krw_per_m2 FROM land_price WHERE pnu = ?").get(pnu) as PriceRow | undefined;
    if (!targetPrice) {
      targetReason = "행 없음";
      metrics.push(unavailable("land_price", "대상 필지 개별공시지가", "원/㎡", "a12-land-price@1:해당 PNU 행 없음"));
    } else {
      metrics.push(obs(
        "land_price",
        "대상 필지 개별공시지가",
        targetPrice.price_krw_per_m2,
        "원/㎡",
        `a12-land-price@1:해당 PNU 개별공시지가, 기준연도 ${targetPrice.base_year}`,
      ));
    }
  }
  if (targetReason) limitations.push({ kind: "not_provided", note: `대상 필지 개별공시지가를 표시하지 않습니다(${targetReason}).` });

  const parcelsDb = ctx.db("parcels");
  const parcelHits = parcelsDb ? ctx.hits("parcels", ["parcel"]) : [];
  const parcelPnus = parcelHits.map((hit) => hit.pnu).filter((value): value is string => typeof value === "string" && value !== "");
  let nearbyReason: string | null = null;
  if (!parcelsDb) {
    nearbyReason = "parcels 파일 없음";
    metrics.push(unavailable("nearby_price_median", "주변 필지 공시지가 중앙값", "원/㎡", "a12-nearby-price@1:parcels 파일 없음"));
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

  let parcelAreaReason: string | null = null;
  if (!parcelsDb) {
    parcelAreaReason = "parcels 파일 없음";
    metrics.push(unavailable("parcel_area_m2", "대상 필지 도형 면적", "㎡", "a12-parcel-area@1:parcels 파일 없음"));
  } else if (!pnu) {
    parcelAreaReason = "pnu 없음";
    metrics.push(unavailable("parcel_area_m2", "대상 필지 도형 면적", "㎡", "a12-parcel-area@1:pnu 없음"));
  } else {
    const targetParcel = parcelHits.find((hit) => hit.pnu === pnu);
    const areaM2 = targetParcel ? fullParcelAreaM2(targetParcel) : null;
    if (areaM2 === null) {
      parcelAreaReason = targetParcel ? "대상 필지 도형 면적 없음" : "대상 PNU 도형 행 없음";
      metrics.push(unavailable("parcel_area_m2", "대상 필지 도형 면적", "㎡", `a12-parcel-area@1:${parcelAreaReason}`));
    } else {
      metrics.push(obs("parcel_area_m2", "대상 필지 도형 면적", areaM2, "㎡", "a12-parcel-area@1:대상 PNU 필지 전체 도형 면적"));
    }
  }
  if (parcelAreaReason) limitations.push({ kind: "not_provided", note: `대상 필지 도형 면적을 표시하지 않습니다(${parcelAreaReason}).` });

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
    ...(missingLayers.length > 0 ? [{ kind: "incomplete" as const, note: `용도지역 레이어 ${missingLayers.length}종(${missingLayers.join(", ")})이 적재되지 않았습니다.` }] : []),
    ...ctx.coverage("reference", ZONING_LAYERS),
  ];
}

export function a12(ctx: EngineContext): TileResult {
  const zoning = collectZoning(ctx);
  if (!zoning) return notProvided(ctx, "A12");

  const { byClass, byRaw, circleArea, total, siteLabel, siteNames, fine, polys, points } = zoning;
  const pct = (areaM2: number) => r1((areaM2 / circleArea) * 100);
  const classes = CLASSES.filter((name) => byClass.has(name)).map((name) => [name, byClass.get(name)!] as const);
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

  const top = classes.length ? [...classes].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, areaM2]) => `${name} ${pct(areaM2)}%`).join("·") : null;
  const sentence = siteLabel === null
    ? `대지 중심점의 용도지역 지정을 도면에서 확인하지 못함${top ? `, 반경 안 구성은 ${top}` : ""} → 도면 밖이거나 미지정일 수 있음 → 토지이용계획확인서와 공시지가 자료로 확인 필요`
    : `대지 중심점은 ${siteLabel}${siteNames.length > 1 ? "(복수 지정)" : ""}${top ? `, 반경 안 구성은 ${top}` : ""} → 지정 현황이며 지구·건축 허용 여부나 지가 수준은 아님 → 공시지가와 개별 규제를 토지이용계획확인서로 확인 필요`;

  const map: MapCandidate[] = [...points];
  if (siteLabel) map.push({ id: 0, f: { layer: "zoning_site", lng: ctx.input.center[0], lat: ctx.input.center[1], highlight: true, label: siteLabel } });
  const limitations = zoningLimitations(ctx, zoning, prices.limitations);
  const status: TileResult["status"] = prices.metrics.some((metric) => metric.status === "missing") || limitations.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete") ? "partial" : "complete";

  return makeTile(ctx, {
    code: "A12",
    status,
    metrics,
    judgment: { ruleId: "a12-zoning@1", basisMetricIds: ["site_zoning_count"], sentence, level: null, criteria: null },
    sources,
    layers: ["zoning_site", ...CLASSES.flatMap((name) => [`zone:${name}`, `zone_center:${name}`])],
    map,
    polygons: polys,
    limitations,
  });
}
