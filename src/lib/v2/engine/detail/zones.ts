import { booleanPointInPolygon } from "@turf/turf";
import type { Geometry } from "geojson";
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import { sourceLineOf } from "../../ui/tile-view";
import { catalogEntry } from "../../ui/tile-catalog";
import type { DetailCard, DetailColumn, DetailRow, DetailSpec, DetailContext } from "./registry";
import { areaInCircle, polygonArea, lineLengthInCircle } from "../tiles/geo";
import { buildingRows } from "../tiles/buildings-shared";
import { hitPoint } from "../tiles/common";
import { SCHOOL_ZONE_KINDS, schoolZoneSources, zoneBaseDate, zoneName, zoneOffice } from "../tiles/school-zone-shared";

const ZONING_SOURCES = ["zoning_urban", "zoning_management", "zoning_agri_forest", "zoning_nature", "zoning_other"] as const;
const ZONE_COLORS: Record<string, string> = {
  주거: "#2563EB",
  주거지역: "#2563EB",
  상업: "#EA580C",
  상업지역: "#EA580C",
  공업: "#64748B",
  녹지: "#15803D",
  녹지지역: "#15803D",
  관리: "#A16207",
  기타: "#6B7280",
};

export const ZONE_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "class", label: "분류", kind: "category" },
  { key: "area_m2", label: "면적(㎡)", kind: "number" },
  { key: "share_pct", label: "비율(%)", kind: "number" },
  { key: "buildings", label: "건물 수", kind: "number" },
  { key: "pieces", label: "조각", kind: "number" },
  { key: "decision_area_m2", label: "결정 면적(㎡)", kind: "number", csvOnly: true },
  { key: "execution", label: "집행", kind: "text", csvOnly: true },
];

export const FACILITY_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "class", label: "분류", kind: "category" },
  { key: "shape", label: "형상", kind: "category" },
  { key: "area_m2", label: "면적(㎡)", kind: "number" },
  { key: "length_m", label: "길이(m)", kind: "number" },
  { key: "count", label: "개수", kind: "number" },
  { key: "remark", label: "비고", kind: "text", csvOnly: true },
];

export const SCHOOL_COLUMNS: DetailColumn[] = [
  { key: "name", label: "학구명", kind: "text" },
  { key: "level", label: "구분", kind: "category" },
  { key: "office", label: "교육청", kind: "text" },
  { key: "area_m2", label: "반경 교차면적(㎡)", kind: "number" },
  { key: "base_date", label: "기준일", kind: "date" },
];

export const POPULATION_COLUMNS: DetailColumn[] = [
  { key: "density_band", label: "밀도 구간", kind: "category" },
  { key: "population", label: "인구", kind: "number" },
  { key: "area_m2", label: "교차 면적(㎡)", kind: "number" },
  { key: "share_pct", label: "비율(%)", kind: "number" },
  { key: "data_year", label: "기준 연도", kind: "date" },
];

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceIdsWithPrefix(ctx: DetailContext, key: "reference" | "market", prefix: string): string[] {
  const db = ctx.db(key);
  if (!db) return [];
  const rows = db.prepare("SELECT source_id FROM source_release WHERE source_id LIKE ? ORDER BY source_id").all(`${prefix}%`) as Array<{ source_id: string }>;
  return rows.map((row) => row.source_id);
}

function sourceLine(ctx: DetailContext, key: "reference" | "market", ids: readonly string[]): string {
  return sourceLineOf(ctx.sources(key, ids));
}

function shapeParts(geometry: Geometry): number[][][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates as number[][][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as number[][][][];
  return [];
}

function pieceCount(geometry: Geometry): number {
  const parts = shapeParts(geometry);
  return parts.length || (geometry.type === "Polygon" ? 1 : 0);
}

function classOf(hit: FeatureHit): string {
  return text(hit.properties.zoningClass)
    ?? text(hit.properties.typeLabel)
    ?? text(hit.properties.class)
    ?? text(hit.properties.cls)
    ?? "기타";
}

function nameOf(hit: FeatureHit): string {
  return text(hit.properties.zoningName)
    ?? text(hit.properties.hakgudoName)
    ?? text(hit.properties.hakgudo_nm)
    ?? text(hit.name)
    ?? "이름 없음";
}

function pointInGeometry(lng: number, lat: number, geometry: Geometry): boolean {
  const [x, y] = toUtmk([lng, lat]);
  try {
    if (geometry.type === "Point") {
      const [px, py] = geometry.coordinates as number[];
      return Math.hypot(px - x, py - y) <= 1;
    }
    if (geometry.type === "LineString" || geometry.type === "MultiLineString") return false;
    return booleanPointInPolygon([x, y] as [number, number], { type: "Feature", properties: {}, geometry } as never);
  } catch {
    return false;
  }
}

function buildingCount(ctx: DetailContext, geometry: Geometry): number | null {
  const rows = buildingRows(ctx);
  if (rows === null) return null;
  let count = 0;
  for (const row of rows) {
    const [lng, lat] = hitPoint(row.hit);
    if (pointInGeometry(lng, lat, geometry)) count++;
  }
  return count;
}

function zoneRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  return hits.map((hit) => {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    const area = clipped?.areaM2 ?? 0;
    const [lng, lat] = hitPoint(hit);
    return {
      fid: String(hit.featureId),
      lng,
      lat,
      cells: {
        name: nameOf(hit),
        class: classOf(hit),
        area_m2: area,
        share_pct: circleArea > 0 ? (area / circleArea) * 100 : null,
        buildings: buildingCount(ctx, hit.geometry),
        pieces: pieceCount(hit.geometry),
        decision_area_m2: number(hit.properties.decisionAreaM2) ?? number(hit.properties.decision_area_m2),
        execution: text(hit.properties.execution) ?? text(hit.properties.implementation),
      },
    };
  });
}

function zoneCard(ctx: DetailContext, hit: FeatureHit, columns: DetailColumn[] = ZONE_COLUMNS, source = ""): DetailCard {
  const row = zoneRows(ctx, [hit])[0];
  const cells = row.cells;
  return {
    title: String(cells.name ?? "이름 없음"),
    subtitle: String(cells.class ?? "기타"),
    chip: { label: String(cells.class ?? "기타"), color: ZONE_COLORS[String(cells.class)] ?? ZONE_COLORS.기타 },
    fields: [
      { label: "틀 안 면적", value: typeof cells.area_m2 === "number" ? `${cells.area_m2}㎡` : null },
      { label: "비율", value: typeof cells.share_pct === "number" ? `${cells.share_pct}%` : null },
      { label: "건물", value: cells.buildings === null ? null : `${cells.buildings}동` },
      { label: "조각", value: cells.pieces === null ? null : `${cells.pieces}곳` },
    ],
    source: source || sourceLineOf([
      ...ctx.sources("reference", ZONING_SOURCES),
      ...ctx.sources("reference", sourceIdsWithPrefix(ctx, "reference", "district_")),
    ]),
    ...(columns === FACILITY_COLUMNS ? { missing: ["결정 면적", "집행"] } : {}),
  };
}

function featureSpec(
  code: "D08" | "D11" | "D23",
  hitsFor: (ctx: DetailContext) => FeatureHit[],
  sourcesFor: (ctx: DetailContext) => ReturnType<DetailContext["sources"]>,
): DetailSpec {
  return {
    columns: ZONE_COLUMNS,
    summary(ctx) {
      const hits = hitsFor(ctx);
      const rows = zoneRows(ctx, hits);
      const area = rows.reduce((sum, row) => sum + (number(row.cells.area_m2) ?? 0), 0);
      return {
        title: catalogEntry(code).title,
        subtitle: `${rows.length.toLocaleString("ko-KR")}곳`,
        fields: [
          { label: "틀 안 면적 합계", value: area > 0 ? `${Math.round(area)}㎡` : null },
          { label: "구역 수", value: `${rows.length.toLocaleString("ko-KR")}곳` },
        ],
        source: sourceLineOf(sourcesFor(ctx)),
      };
    },
    rows(ctx) {
      return zoneRows(ctx, hitsFor(ctx));
    },
    at(ctx, lng, lat) {
      const hit = hitsFor(ctx).find((candidate) => pointInGeometry(lng, lat, candidate.geometry));
      return hit ? { card: zoneCard(ctx, hit, ZONE_COLUMNS, sourceLineOf(sourcesFor(ctx))), fid: String(hit.featureId) } : null;
    },
  };
}

function zoningHits(ctx: DetailContext): FeatureHit[] {
  // 우산 도형도 Sitedia의 용도지역 집계 한 줄로 노출한다. 세부 도형과의 겹침은 원천 그대로 보존한다.
  return ctx.hits("reference", ["zoning_area"]);
}

function districtHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", ["district_area"]);
}

function maintenanceHits(ctx: DetailContext): FeatureHit[] {
  const out: FeatureHit[] = [];
  for (const key of ["reference", "market"] as const) {
    const seen = new Set(out.map((hit) => hit.stableId));
    for (const hit of ctx.hits(key, ["maintenance_zone"])) if (!seen.has(hit.stableId)) out.push(hit);
  }
  return out.sort((a, b) => a.featureId - b.featureId);
}

function facilityHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", ["plan_facility"]);
}

function facilityRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  return hits.map((hit) => {
    const shape = hit.geometry.type === "Polygon" || hit.geometry.type === "MultiPolygon" ? "면" : hit.geometry.type.includes("Line") ? "선" : "점";
    const area = shape === "면" ? areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry)?.areaM2 ?? 0 : null;
    const length = shape === "선" ? lineLengthInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry) : null;
    const [lng, lat] = hitPoint(hit);
    return { fid: String(hit.featureId), lng, lat, cells: {
      name: nameOf(hit), class: classOf(hit), shape, area_m2: area, length_m: length, count: shape === "점" ? 1 : null, remark: text(hit.properties.remark),
    } };
  });
}

function facilitySpec(): DetailSpec {
  return {
    columns: FACILITY_COLUMNS,
    summary(ctx) {
      const rows = facilityRows(ctx, facilityHits(ctx));
      return { title: catalogEntry("D12").title, subtitle: `${rows.length.toLocaleString("ko-KR")}개`, fields: [{ label: "시설 수", value: `${rows.length.toLocaleString("ko-KR")}개` }], source: sourceLine(ctx, "reference", sourceIdsWithPrefix(ctx, "reference", "facility_")) };
    },
    rows(ctx) { return facilityRows(ctx, facilityHits(ctx)); },
    at(ctx, lng, lat) {
      const hit = facilityHits(ctx).find((candidate) => pointInGeometry(lng, lat, candidate.geometry));
      return hit ? { card: zoneCard(ctx, hit, FACILITY_COLUMNS), fid: String(hit.featureId) } : null;
    },
  };
}

function schoolHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", [...SCHOOL_ZONE_KINDS]);
}

function schoolRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  const baseDate = schoolZoneSources(ctx).map((source) => source.sourceAsOf).filter((value): value is string => value !== null).sort().at(-1) ?? zoneBaseDate(hits[0]);
  return hits.map((hit) => {
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
    const [lng, lat] = hitPoint(hit);
    return { fid: String(hit.featureId), lng, lat, cells: {
      name: zoneName(hit), level: zoneOffice(hit), office: zoneOffice(hit), area_m2: clipped?.areaM2 ?? 0,
      base_date: baseDate,
       share_pct: clipped && circleArea > 0 ? (clipped.areaM2 / circleArea) * 100 : null,
    } };
  });
}

function schoolSpec(): DetailSpec {
  return {
    columns: SCHOOL_COLUMNS,
    summary(ctx) { const rows = schoolRows(ctx, schoolHits(ctx)); return { title: catalogEntry("D26").title, subtitle: `${rows.length.toLocaleString("ko-KR")}곳`, fields: [{ label: "학구·학교군", value: `${rows.length.toLocaleString("ko-KR")}곳` }], source: sourceLineOf(schoolZoneSources(ctx)) }; },
    rows(ctx) { return schoolRows(ctx, schoolHits(ctx)); },
    at(ctx, lng, lat) { const hit = schoolHits(ctx).find((candidate) => pointInGeometry(lng, lat, candidate.geometry)); return hit ? { card: zoneCard(ctx, hit), fid: String(hit.featureId) } : null; },
  };
}

function populationHits(ctx: DetailContext): FeatureHit[] {
  return ctx.hits("reference", ["pop_grid"], Math.min(5000, ctx.input.radiusM + 708));
}

function populationRows(ctx: DetailContext, hits: readonly FeatureHit[]): DetailRow[] {
  const circleArea = Math.PI * ctx.input.radiusM ** 2;
  return hits.map((hit) => {
    const props = hit.properties;
    const size = number(props.cellSizeM) ?? 1000;
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, {
      type: "Polygon",
      coordinates: [[
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] - size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] - size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] + size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] - size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] + size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] + size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] - size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] + size / 2 : 0],
        [hit.geometry.type === "Point" ? hit.geometry.coordinates[0] - size / 2 : 0, hit.geometry.type === "Point" ? hit.geometry.coordinates[1] - size / 2 : 0],
      ]],
    });
    const population = (props.population as { total?: { v?: unknown; s?: string } } | undefined)?.total;
    const value = population?.s === "observed" ? number(population.v) : null;
    const density = value === null ? null : value / ((size * size) / 1e6);
    const band = density === null ? "값 없음" : density < 1000 ? "1,000명/㎢ 미만" : density < 5000 ? "1,000~5,000명/㎢" : density < 10000 ? "5,000~10,000명/㎢" : "10,000명/㎢ 이상";
    const [lng, lat] = hitPoint(hit);
    return { fid: String(hit.featureId), lng, lat, cells: { density_band: band, population: value, area_m2: clipped?.areaM2 ?? 0, share_pct: clipped && circleArea > 0 ? (clipped.areaM2 / circleArea) * 100 : null, data_year: text(props.dataYear) } };
  });
}

function populationSpec(): DetailSpec {
  return {
    columns: POPULATION_COLUMNS,
    summary(ctx) { const rows = populationRows(ctx, populationHits(ctx)); const total = rows.reduce((sum, row) => sum + (number(row.cells.population) ?? 0), 0); return { title: catalogEntry("D27").title, subtitle: `${rows.length.toLocaleString("ko-KR")}개 격자`, fields: [{ label: "공개 인구 합계", value: total > 0 ? `${Math.round(total)}명` : null }], source: sourceLine(ctx, "reference", ["sgis_grid"]) }; },
    rows(ctx) { return populationRows(ctx, populationHits(ctx)); },
    at(ctx, lng, lat) { const hit = populationHits(ctx).find((candidate) => pointInGeometry(lng, lat, candidate.geometry)); return hit ? { card: { title: "인구 격자", fields: [], source: sourceLine(ctx, "reference", ["sgis_grid"]) }, fid: String(hit.featureId) } : null; },
  };
}

export const ZONE_SPECS: Partial<Record<string, DetailSpec>> = {
  D08: featureSpec("D08", zoningHits, (ctx) => ctx.sources("reference", ZONING_SOURCES)),
  D11: featureSpec("D11", districtHits, (ctx) => ctx.sources("reference", sourceIdsWithPrefix(ctx, "reference", "district_"))),
  D23: featureSpec("D23", maintenanceHits, (ctx) => [
    ...ctx.sources("reference", ["maintenance_zone"]),
    ...ctx.sources("reference", ["maintenance_integrated", "maintenance_std"]),
    ...ctx.sources("reference", sourceIdsWithPrefix(ctx, "reference", "mzone_")),
    ...ctx.sources("market", ["maintenance_zone"]),
    ...ctx.sources("market", ["maintenance_integrated", "maintenance_std"]),
    ...ctx.sources("market", sourceIdsWithPrefix(ctx, "market", "mzone_")),
  ]),
  D12: facilitySpec(),
  D26: schoolSpec(),
  D27: populationSpec(),
};
