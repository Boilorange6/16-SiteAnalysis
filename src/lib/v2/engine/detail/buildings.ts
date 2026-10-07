import { booleanPointInPolygon } from "@turf/turf";
import { toUtmk } from "../../crs";
import { sourceLineOf } from "../../ui/tile-view";
import { catalogEntry } from "../../ui/tile-catalog";
import { buildingRows, BUILDING_SOURCES, isCounted, type BuildingRow } from "../tiles/buildings-shared";
import { hitPoint } from "../tiles/common";
import { useClassOf } from "../tiles/d03";
import type { DetailCard, DetailColumn, DetailRow, DetailSpec, DetailContext } from "./registry";

const BUILDING_CODES = ["D02", "D03", "D04", "D05", "D06", "D07"] as const;
const USE_COLORS: Record<string, string> = {
  주거: "#2563EB",
  근린생활: "#0F766E",
  업무: "#7C3AED",
  판매: "#C2410C",
  숙박: "#BE185D",
  문화집회: "#A16207",
  교육복지: "#15803D",
  공업: "#475569",
  기타: "#64748B",
  미상: "#6B7280",
};

export const BUILDING_COLUMNS: DetailColumn[] = [
  { key: "name", label: "이름", kind: "text" },
  { key: "address", label: "주소", kind: "text" },
  { key: "primary_use", label: "주용도", kind: "category" },
  { key: "use_class", label: "용도 분류", kind: "category" },
  { key: "floors_above", label: "지상층", kind: "number" },
  { key: "floors_below", label: "지하층", kind: "number", csvOnly: true },
  { key: "height_m", label: "높이(m)", kind: "number" },
  { key: "gross_floor_m2", label: "연면적(㎡)", kind: "number" },
  { key: "footprint_m2", label: "건축면적(㎡)", kind: "number", csvOnly: true },
  { key: "site_area_m2", label: "대지면적(㎡)", kind: "number", csvOnly: true },
  { key: "coverage_pct", label: "건폐율(%)", kind: "number", csvOnly: true },
  { key: "floor_area_ratio_pct", label: "용적률(%)", kind: "number", csvOnly: true },
  { key: "structure", label: "구조", kind: "text", csvOnly: true },
  { key: "approval_date", label: "사용승인일", kind: "date", csvOnly: true },
  { key: "zoning", label: "용도지역", kind: "text", csvOnly: true },
  { key: "pnu", label: "PNU", kind: "text", csvOnly: true },
  { key: "note", label: "비고", kind: "text", csvOnly: true },
];

type Fact = Record<string, unknown> & { feature_id?: number };
type BuildingDetail = { row: BuildingRow; fact: Fact };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function propertyText(detail: BuildingDetail, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = text(detail.row.hit.properties[key]) ?? text(detail.fact[key]);
    if (value !== null) return value;
  }
  return null;
}

function propertyNumber(detail: BuildingDetail, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = number(detail.row.hit.properties[key]) ?? number(detail.fact[key]);
    if (value !== null) return value;
  }
  return null;
}

function factRows(ctx: DetailContext, rows: readonly BuildingRow[]): Map<number, Fact> {
  const db = ctx.db("buildings");
  if (!db || rows.length === 0) return new Map();
  const facts = new Map<number, Fact>();
  for (let offset = 0; offset < rows.length; offset += 500) {
    const chunk = rows.slice(offset, offset + 500);
    const records = db.prepare(`SELECT * FROM building_fact WHERE feature_id IN (${chunk.map(() => "?").join(",")})`).all(...chunk.map((row) => row.hit.featureId)) as Fact[];
    for (const fact of records) if (typeof fact.feature_id === "number") facts.set(fact.feature_id, fact);
  }
  return facts;
}

function details(ctx: DetailContext, countedOnly = false): BuildingDetail[] | null {
  const all = buildingRows(ctx);
  const rows = all && countedOnly ? all.filter((row) => isCounted(ctx, row)) : all; // 표·동수는 중심점이 반경 안인 건물만, 지도 클릭은 교차 전부
  if (rows === null) return null;
  const facts = factRows(ctx, rows);
  return rows.map((row) => ({ row, fact: facts.get(row.hit.featureId) ?? {} }));
}

function addressOf(detail: BuildingDetail): string | null {
  return propertyText(detail, "address", "fullAddress", "jibunAddress", "roadAddress", "addressText") ?? detail.row.hit.name;
}

function primaryUseOf(detail: BuildingDetail): string | null {
  return propertyText(detail, "primaryUse", "mainUse", "useName", "buildingUse", "useCodeName") ?? detail.row.useCode;
}

function approvalDateOf(detail: BuildingDetail): string | null {
  return text(detail.fact.approval_date) ?? detail.row.approvalDate;
}

function approvalYear(value: string | null): number | null {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function sourceText(ctx: DetailContext): string {
  return sourceLineOf(ctx.sources("buildings", BUILDING_SOURCES));
}

function zoningAt(ctx: DetailContext, lng: number, lat: number): string | null {
  const db = ctx.db("reference");
  if (!db || ctx.sources("reference", ["zoning_urban", "zoning_management", "zoning_agri_forest", "zoning_nature", "zoning_other"]).length === 0) return null;
  const [x, y] = toUtmk([lng, lat]);
  const hits = ctx.hits("reference", ["zoning_area"], ctx.input.radiusM);
  for (const hit of hits) {
    if (booleanPointInPolygon([x, y] as [number, number], { type: "Feature", properties: {}, geometry: hit.geometry } as never)) {
      return text(hit.properties.zoningName) ?? hit.name;
    }
  }
  return null;
}

function cardFor(ctx: DetailContext, detail: BuildingDetail): DetailCard {
  const use = primaryUseOf(detail);
  const useClass = useClassOf(detail.row.useCode);
  const approval = approvalDateOf(detail);
  const above = detail.row.floorsAbove ?? number(detail.fact.floors_above);
  const below = number(detail.fact.floors_below) ?? propertyNumber(detail, "floorsBelow", "basementFloors");
  const height = detail.row.heightM ?? propertyNumber(detail, "heightM", "height_m");
  const structure = propertyText(detail, "structure", "structureName", "mainStructure");
  const zoning = zoningAt(ctx, ...hitPoint(detail.row.hit));
  const missing: string[] = [];
  if (height === null) missing.push("높이");
  if (propertyNumber(detail, "siteAreaM2", "landAreaM2", "site_area_m2") === null) missing.push("대지면적");
  if (propertyNumber(detail, "coveragePct", "buildingCoveragePct", "coverage_pct") === null) missing.push("건폐율");
  if (propertyNumber(detail, "floorAreaRatioPct", "floorRatioPct", "floor_area_ratio_pct") === null) missing.push("용적률");
  const approvalAge = approvalYear(approval);
  const analysisYear = Number(ctx.input.analysisDate.slice(0, 4));
  const age = approvalAge === null || !Number.isFinite(analysisYear) ? null : Math.max(0, analysisYear - approvalAge);
  const heightSource = height === null ? null : `${height}m (${detail.row.heightMethod === "floors_estimate" ? "지상층수 추정" : detail.row.heightMethod === "assumed_one_floor" ? "1층 가정(추정)" : detail.row.heightMethod === "source" || detail.row.heightMethod === "ledger_height" ? "원천" : "확인"})`;
  return {
    title: addressOf(detail) ?? "이름 없는 건물",
    subtitle: propertyText(detail, "roadName", "road_name", "street") ?? detail.row.hit.name ?? undefined,
    chip: { label: useClass, color: USE_COLORS[useClass] ?? USE_COLORS.미상 },
    fields: [
      { label: "용도", value: use },
      { label: "지상 / 지하", value: above === null ? null : `${above} / ${below ?? "—"}층` },
      { label: "연면적", value: detail.row.grossFloorM2 === null ? null : `${detail.row.grossFloorM2}㎡` },
      { label: "건축면적", value: detail.row.footprintM2 === null ? null : `${detail.row.footprintM2}㎡` },
      { label: "구조", value: structure },
      { label: "사용승인", value: approval === null ? null : `${approval}${age === null ? "" : ` (${age}년)`}` },
      { label: "용도지역", value: zoning },
      { label: "높이", value: heightSource },
    ],
    ...(missing.length > 0 ? { missing } : {}),
    source: sourceText(ctx),
  };
}

function contains(detail: BuildingDetail, lng: number, lat: number): boolean {
  const [x, y] = toUtmk([lng, lat]);
  try {
    return booleanPointInPolygon([x, y] as [number, number], { type: "Feature", properties: {}, geometry: detail.row.hit.geometry } as never);
  } catch {
    return false;
  }
}

function rowOf(ctx: DetailContext, detail: BuildingDetail): DetailRow {
  const use = primaryUseOf(detail);
  const approval = approvalDateOf(detail);
  const above = detail.row.floorsAbove ?? number(detail.fact.floors_above);
  const below = number(detail.fact.floors_below) ?? propertyNumber(detail, "floorsBelow", "basementFloors");
  const height = detail.row.heightM ?? propertyNumber(detail, "heightM", "height_m");
  const siteArea = propertyNumber(detail, "siteAreaM2", "landAreaM2", "site_area_m2");
  const coverage = propertyNumber(detail, "coveragePct", "buildingCoveragePct", "coverage_pct");
  const floorAreaRatio = propertyNumber(detail, "floorAreaRatioPct", "floorRatioPct", "floor_area_ratio_pct");
  const [lng, lat] = hitPoint(detail.row.hit);
  return {
    fid: String(detail.row.hit.featureId),
    lng,
    lat,
    cells: {
      name: detail.row.hit.name,
      address: addressOf(detail),
      primary_use: use,
      use_class: useClassOf(detail.row.useCode),
      floors_above: above,
      floors_below: below,
      height_m: height,
      gross_floor_m2: detail.row.grossFloorM2,
      footprint_m2: detail.row.footprintM2,
      site_area_m2: siteArea,
      coverage_pct: coverage,
      floor_area_ratio_pct: floorAreaRatio,
      structure: propertyText(detail, "structure", "structureName", "mainStructure"),
      approval_date: approval,
       zoning: propertyText(detail, "zoning", "zoningName") ?? zoningAt(ctx, ...hitPoint(detail.row.hit)),
      pnu: detail.row.hit.pnu,
      note: propertyText(detail, "note", "remark"),
    },
  };
}

function specFor(code: typeof BUILDING_CODES[number]): DetailSpec {
  const title = catalogEntry(code).title;
  return {
    columns: BUILDING_COLUMNS,
    summary(ctx) {
      const values = details(ctx, true);
      const rows = values ?? [];
      const knownUse = rows.filter((row) => useClassOf(row.row.useCode) !== "미상").length;
      const gross = rows.reduce((sum, row) => sum + (row.row.grossFloorM2 ?? 0), 0);
      return {
        title,
        subtitle: `건물 ${rows.length.toLocaleString("ko-KR")}동 · 용도 확인 ${knownUse.toLocaleString("ko-KR")}동`,
        fields: [
          { label: "연면적 합계", value: gross > 0 ? `${gross}㎡` : null },
          { label: "건물 수", value: `${rows.length.toLocaleString("ko-KR")}동` },
        ],
        source: sourceText(ctx),
        ...(values === null ? { missing: ["건물 자료"] } : {}),
      };
    },
    rows(ctx) {
      return (details(ctx, true) ?? []).map((detail) => rowOf(ctx, detail));
    },
    at(ctx, lng, lat) {
      const values = details(ctx) ?? [];
      const selected = values.find((value) => contains(value, lng, lat));
      if (!selected) return null;
      return { card: cardFor(ctx, selected), fid: String(selected.row.hit.featureId) };
    },
  };
}

export const BUILDING_SPECS: Partial<Record<typeof BUILDING_CODES[number], DetailSpec>> = Object.fromEntries(
  BUILDING_CODES.map((code) => [code, specFor(code)]),
) as Partial<Record<typeof BUILDING_CODES[number], DetailSpec>>;

export function isBuildingCode(code: string): code is typeof BUILDING_CODES[number] {
  return (BUILDING_CODES as readonly string[]).includes(code);
}
