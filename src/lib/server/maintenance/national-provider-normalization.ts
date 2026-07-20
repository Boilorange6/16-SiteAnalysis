import type { MaintenanceStage } from "@/lib/types";

export type JsonObject = Record<string, unknown>;
export type AttributeSource = "molit_integrated" | "public_standard";

export interface MaintenanceAttributeRecord {
  readonly source_record_id: string;
  readonly source: AttributeSource;
  readonly sido: string;
  readonly sigungu: string;
  readonly name: string;
  readonly type: string;
  readonly stage: MaintenanceStage;
  readonly implementer?: string;
  readonly planned_households?: number;
  readonly area_sqm?: number;
  readonly land_use_zone?: string;
  readonly building_coverage_ratio?: number;
  readonly floor_area_ratio?: number;
  readonly designation_date?: string;
  readonly management_agency?: string;
  readonly source_updated_at?: string;
  readonly lat?: number;
  readonly lng?: number;
}

interface Aliases {
  readonly sido: readonly string[];
  readonly sigungu: readonly string[];
  readonly name: readonly string[];
  readonly recordId: readonly string[];
  readonly type: readonly string[];
  readonly stage: readonly string[];
  readonly implementer: readonly string[];
  readonly households: readonly string[];
  readonly area: readonly string[];
  readonly landUseZone: readonly string[];
  readonly coverageRatio: readonly string[];
  readonly floorAreaRatio: readonly string[];
  readonly designationDate: readonly string[];
  readonly managementAgency: readonly string[];
  readonly updatedAt: readonly string[];
  readonly lat: readonly string[];
  readonly lng: readonly string[];
}

const INTEGRATED_ALIASES: Aliases = {
  sido: ["시도", "시도명", "광역시도"], sigungu: ["시군구", "시군구명", "자치구"],
  name: ["구역명칭", "구역명", "정비구역명", "사업명"], recordId: ["사업번호", "정비사업코드", "구역코드", "관리번호"],
  type: ["정비사업유형", "사업유형", "정비사업종류"],
  stage: ["현 사업추진단계", "현사업추진단계", "추진단계", "사업단계", "진행단계"],
  implementer: ["시행자", "사업시행자", "조합명"],
  households: ["공급 예정 세대수", "공급예정세대수", "예정세대수", "계획세대수", "세대수"],
  area: ["정비구역면적", "구역면적", "면적"], landUseZone: ["용도지역", "토지이용구역"],
  coverageRatio: ["건폐율", "건폐율(%)"], floorAreaRatio: ["용적률", "용적률(%)"],
  designationDate: ["정비구역지정일자", "구역지정일", "지정일자"],
  managementAgency: ["관리기관", "관리기관명", "담당기관"],
  updatedAt: ["데이터기준일자", "기준일자", "최종수정일"],
  lat: ["위도", "latitude", "LAT"], lng: ["경도", "longitude", "LNG"],
};

const STANDARD_ALIASES: Aliases = {
  sido: ["CTPV_NM", "시도명", "시도", "광역시도명"],
  sigungu: ["SGG_NM", "시군구명", "시군구", "자치구명"],
  name: ["ZONE_NM", "정비구역명", "구역명", "사업명"], recordId: ["정비사업코드", "정비구역코드", "관리번호"],
  type: ["정비사업유형", "정비사업종류", "사업유형"],
  stage: ["PRGRS_STP_CN", "추진단계", "사업단계", "진행단계"],
  implementer: ["사업시행자", "시행자", "조합명"],
  households: ["HH_CNT", "계획세대수", "예정세대수", "세대수"],
  area: ["정비구역면적", "구역면적", "면적"],
  landUseZone: ["USG_RGN", "용도지역", "토지이용구역"],
  coverageRatio: ["BDCVRT", "건폐율", "건폐율(%)"],
  floorAreaRatio: ["GFA", "용적률", "용적률(%)"],
  designationDate: ["DSGN_YMD", "정비구역지정일자", "정비구역지정일", "지정일자"],
  managementAgency: ["MNG_INST_NM", "관리기관명", "관리기관", "담당기관"],
  updatedAt: ["DATA_CRTR_YMD", "데이터기준일자", "기준일자", "최종수정일"],
  lat: ["위도", "latitude", "LAT"], lng: ["경도", "longitude", "LNG"],
};

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readText(row: JsonObject, aliases: readonly string[]): string | undefined {
  for (const alias of aliases) {
    const value = row[alias];
    if (typeof value !== "string" && typeof value !== "number") continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return undefined;
}

function readNumber(row: JsonObject, aliases: readonly string[]): number | undefined {
  const text = readText(row, aliases);
  if (!text) return undefined;
  const value = Number(text.replaceAll(",", "").replace(/%$/, "").trim());
  return Number.isFinite(value) ? value : undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(value?.trim().replace(/[./]/g, "-") ?? "");
  if (!match) return undefined;
  const [, year, month, day] = match;
  const validMonth = Number(month) >= 1 && Number(month) <= 12;
  const validDay = Number(day) >= 1 && Number(day) <= 31;
  return validMonth && validDay ? `${year}-${month}-${day}` : undefined;
}

function normalizeStage(value: string | undefined): MaintenanceStage {
  const compact = value?.replaceAll(" ", "") ?? "";
  if (compact.includes("준공")) return "준공";
  if (compact.includes("착공")) return "착공";
  if (compact.includes("관리처분")) return "관리처분";
  if (compact.includes("사업시행")) return "사업시행인가";
  if (compact.includes("조합설립")) return "조합설립";
  if (compact.includes("추진위") || compact.includes("추진위원")) return "추진위";
  if (compact.includes("구역지정") || compact.includes("정비구역")) return "구역지정/변경";
  return "미확인";
}

function normalizeType(value: string | undefined): string {
  if (!value) return "미확인";
  const compact = value.replaceAll(" ", "");
  if (compact.includes("재개발")) return "재개발";
  if (compact.includes("재건축")) return "재건축";
  if (compact.includes("주거환경개선")) return "주거환경개선";
  if (compact.includes("가로주택")) return "가로주택정비";
  return value.trim();
}

function optional(value: string | number | undefined, key: string): JsonObject {
  return value === undefined ? {} : { [key]: value };
}

function normalizeRow(options: {
  readonly row: JsonObject;
  readonly source: AttributeSource;
  readonly aliases: Aliases;
}): MaintenanceAttributeRecord | null {
  const { row, source, aliases } = options;
  const sido = readText(row, aliases.sido);
  const sigungu = readText(row, aliases.sigungu);
  const name = readText(row, aliases.name);
  if (!sido || !sigungu || !name) return null;
  return {
    source_record_id: readText(row, aliases.recordId) ?? `${sido}|${sigungu}|${name}`,
    source, sido, sigungu, name,
    type: normalizeType(readText(row, aliases.type)),
    stage: normalizeStage(readText(row, aliases.stage)),
    ...optional(readText(row, aliases.implementer), "implementer"),
    ...optional(readNumber(row, aliases.households), "planned_households"),
    ...optional(readNumber(row, aliases.area), "area_sqm"),
    ...optional(readText(row, aliases.landUseZone), "land_use_zone"),
    ...optional(readNumber(row, aliases.coverageRatio), "building_coverage_ratio"),
    ...optional(readNumber(row, aliases.floorAreaRatio), "floor_area_ratio"),
    ...optional(normalizeDate(readText(row, aliases.designationDate)), "designation_date"),
    ...optional(readText(row, aliases.managementAgency), "management_agency"),
    ...optional(normalizeDate(readText(row, aliases.updatedAt)), "source_updated_at"),
    ...optional(readNumber(row, aliases.lat), "lat"),
    ...optional(readNumber(row, aliases.lng), "lng"),
  };
}

export function normalizeIntegratedRow(row: JsonObject): MaintenanceAttributeRecord | null {
  return normalizeRow({ row, source: "molit_integrated", aliases: INTEGRATED_ALIASES });
}

export function normalizeStandardRow(row: JsonObject): MaintenanceAttributeRecord | null {
  return normalizeRow({ row, source: "public_standard", aliases: STANDARD_ALIASES });
}
