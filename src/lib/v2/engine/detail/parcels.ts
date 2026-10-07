import { booleanPointInPolygon } from "@turf/turf";
import type { DetailCard, DetailColumn, DetailRow, DetailSpec, DetailContext } from "./registry";
import type { FeatureHit } from "../../data/features";
import { toUtmk } from "../../crs";
import { sourceLineOf } from "../../ui/tile-view";
import { catalogEntry } from "../../ui/tile-catalog";
import { polygonArea } from "../tiles/geo";
import { hitPoint } from "../tiles/common";

export const PARCEL_COLUMNS: DetailColumn[] = [
  { key: "address", label: "주소", kind: "text" },
  { key: "jibun", label: "지번", kind: "text" },
  { key: "jimok", label: "지목", kind: "category" },
  { key: "area_m2", label: "면적(㎡, 도형 계산)", kind: "number" },
  { key: "price_krw_per_m2", label: "개별공시지가(원/㎡)", kind: "number" },
  { key: "base_year_month", label: "기준 연월", kind: "date" },
  { key: "pnu", label: "PNU", kind: "text" },
];

type Price = { base_year: number; base_month: number | null; price_krw_per_m2: number };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function polygonAreaOf(hit: FeatureHit): number | null {
  if (hit.geometry.type === "Polygon") return polygonArea(hit.geometry.coordinates as number[][][]);
  if (hit.geometry.type === "MultiPolygon") return (hit.geometry.coordinates as number[][][][]).reduce((sum, rings) => sum + polygonArea(rings), 0);
  return null;
}

function addressOf(hit: FeatureHit): string | null {
  return text(hit.properties.address) ?? text(hit.properties.jibunAddress) ?? text(hit.properties.fullAddress) ?? text(hit.properties.emdName) ?? hit.name;
}

function jibunOf(hit: FeatureHit): string | null {
  return text(hit.properties.jibun) ?? text(hit.name);
}

function prices(ctx: DetailContext, pnus: readonly string[]): Map<string, Price> {
  const db = ctx.db("reference");
  if (!db || pnus.length === 0) return new Map();
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'land_price'").get();
    if (!exists) return new Map();
    const result = new Map<string, Price>();
    for (let offset = 0; offset < pnus.length; offset += 500) {
      const chunk = pnus.slice(offset, offset + 500);
      const rows = db.prepare(`SELECT pnu, base_year, base_month, price_krw_per_m2 FROM land_price WHERE pnu IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as Array<Price & { pnu: string }>;
      for (const row of rows) result.set(row.pnu, row);
    }
    return result;
  } catch {
    return new Map();
  }
}

function sourceText(ctx: DetailContext): string {
  const sources = [
    ...ctx.sources("parcels", ["parcel_polygon"]),
    ...ctx.sources("reference", ["land_price"]),
  ];
  return sourceLineOf(sources);
}

function rowsFor(ctx: DetailContext): DetailRow[] {
  const hits = ctx.hits("parcels", ["parcel"]);
  const landPrices = prices(ctx, hits.map((hit) => hit.pnu).filter((pnu): pnu is string => Boolean(pnu)));
  return hits.map((hit) => {
    const price = hit.pnu ? landPrices.get(hit.pnu) : undefined;
    const [lng, lat] = hitPoint(hit);
    return {
      fid: String(hit.featureId),
      lng,
      lat,
      cells: {
        address: addressOf(hit),
        jibun: jibunOf(hit),
        jimok: text(hit.properties.jimok),
        area_m2: polygonAreaOf(hit),
        price_krw_per_m2: price?.price_krw_per_m2 ?? null,
        base_year_month: price ? `${price.base_year}.${String(price.base_month ?? 1).padStart(2, "0")}` : null,
        pnu: hit.pnu,
      },
    };
  });
}

function selected(ctx: DetailContext, lng: number, lat: number): FeatureHit | null {
  const [x, y] = toUtmk([lng, lat]);
  for (const hit of ctx.hits("parcels", ["parcel"])) {
    try {
      if (booleanPointInPolygon([x, y] as [number, number], { type: "Feature", properties: {}, geometry: hit.geometry } as never)) return hit;
    } catch {
      // A malformed published geometry is reported as no hit, never as a fabricated card.
    }
  }
  return null;
}

function cardFor(ctx: DetailContext, hit: FeatureHit): DetailCard {
  const row = rowsFor(ctx).find((candidate) => candidate.fid === String(hit.featureId));
  const cells = row?.cells ?? {};
  const missing = [
    cells.price_krw_per_m2 === null ? "공시지가" : null,
    cells.base_year_month === null ? "기준 연월" : null,
  ].filter((value): value is string => value !== null);
  return {
    title: String(cells.jimok ?? "필지"),
    subtitle: cells.address === null ? undefined : String(cells.address),
    fields: [
      { label: "지번", value: cells.jibun === null ? null : String(cells.jibun) },
      { label: "지목", value: cells.jimok === null ? null : String(cells.jimok) },
      { label: "면적", value: typeof cells.area_m2 === "number" ? `${cells.area_m2}㎡` : null },
      { label: "공시지가", value: typeof cells.price_krw_per_m2 === "number" ? `${cells.price_krw_per_m2}원/㎡ (${cells.base_year_month ?? "기준 연월 미상"})` : null },
      { label: "PNU", value: cells.pnu === null ? null : String(cells.pnu) },
    ],
    ...(missing.length > 0 ? { missing } : {}),
    source: sourceText(ctx),
  };
}

export const PARCEL_SPECS: Partial<Record<"D19", DetailSpec>> = {};
for (const code of ["D19"] as const) {
  PARCEL_SPECS[code] = {
    columns: PARCEL_COLUMNS,
    summary(ctx) {
      const rows = rowsFor(ctx);
      const known = rows.filter((row) => row.cells.price_krw_per_m2 !== null).length;
      return {
        title: catalogEntry(code).title,
        subtitle: `필지 ${rows.length.toLocaleString("ko-KR")}개`,
        fields: [
          { label: "필지 수", value: `${rows.length.toLocaleString("ko-KR")}개` },
          { label: "공시지가 확인", value: `${known.toLocaleString("ko-KR")}개` },
        ],
        source: sourceText(ctx),
      };
    },
    rows: rowsFor,
    at(ctx, lng, lat) {
      const hit = selected(ctx, lng, lat);
      return hit ? { card: cardFor(ctx, hit), fid: String(hit.featureId) } : null;
    },
  };
}
