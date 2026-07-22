import ky, { type KyInstance } from "ky";

import { haversineDistance } from "../../geo";
import type { MaintenanceStage } from "../../types";
import type { RegionalMaintenanceRecord, SelectedMaintenanceRegion } from "./merge-contracts";
import { isJsonObject, readText, type JsonObject } from "./national-provider-normalization";

const SEOUL_URL = "http://openapi.seoul.go.kr:8088";
const SEOUL_SERVICE = "upisRebuild";
const SEOUL_DATASET_URL = "https://data.seoul.go.kr/dataList/OA-20281/S/1/datasetView.do";
const BUSAN_URL = "http://apis.data.go.kr/6260000/MaintenanceBusinessStatus1/getMaintenanceBusiness1";
const SEOUL_PAGE_SIZE = 1_000;
const API_TIMEOUT_MS = 18_000;

export type MaintenanceGeocoder = (address: string) => Promise<{ readonly lat: number; readonly lng: number } | null>;

export interface RegionalProviderQuery {
  readonly center: { readonly lat: number; readonly lng: number };
  readonly radiusM: number;
  readonly regions: readonly SelectedMaintenanceRegion[];
}

interface RegionalProviderOptions {
  readonly query: RegionalProviderQuery;
  readonly httpClient?: KyInstance;
  readonly geocoder?: MaintenanceGeocoder;
  readonly serviceKey?: string;
}

export class RegionalProviderRequestError extends Error {
  readonly name = "RegionalProviderRequestError";
  constructor(readonly source: "seoul" | "busan") {
    super(`${source} maintenance provider transport request failed`);
  }
}

async function requestRegionalJson(request: {
  readonly source: "seoul" | "busan";
  readonly execute: () => Promise<unknown>;
}): Promise<unknown> {
  try {
    return await request.execute();
  } catch {
    throw new RegionalProviderRequestError(request.source);
  }
}

function client(value?: KyInstance): KyInstance {
  return value ?? ky.create({ timeout: API_TIMEOUT_MS, retry: { limit: 1, methods: ["get"] } });
}

function numberValue(row: JsonObject, aliases: readonly string[]): number | undefined {
  const value = readText(row, aliases);
  if (!value) return undefined;
  const parsed = Number(value.replaceAll(",", "").replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optional(value: string | number | readonly string[] | undefined, key: string): JsonObject {
  return value === undefined || value === "" ? {} : { [key]: value };
}

function stage(value: string | undefined): MaintenanceStage {
  const text = value?.replaceAll(" ", "") ?? "";
  if (/준공|완료|해제/.test(text)) return "준공";
  if (/착공|공사/.test(text)) return "착공";
  if (text.includes("관리처분")) return "관리처분";
  if (/사업시행|시행인가/.test(text)) return "사업시행인가";
  if (text.includes("조합")) return "조합설립";
  if (/추진위|추진위원/.test(text)) return "추진위";
  if (/지정|변경|정비구역|고시/.test(text)) return "구역지정/변경";
  return "미확인";
}

function projectType(value: string): string {
  if (value.includes("재건축")) return "재건축";
  if (value.includes("재개발")) return "재개발";
  if (value.includes("주거환경")) return "주거환경개선";
  if (value.includes("도시환경")) return "도시환경정비";
  if (value.includes("가로주택")) return "가로주택정비";
  if (value.includes("소규모")) return "소규모정비";
  return value.replace(/사업지구|정비사업|지구/g, "").trim() || "정비사업";
}

function inRegion(query: RegionalProviderQuery, sido: string): boolean {
  return query.regions.some((region) => region.sido.includes(sido));
}

function selectedRegion(options: {
  readonly row: JsonObject;
  readonly haystack: string;
  readonly query: RegionalProviderQuery;
  readonly cityToken: string;
}): SelectedMaintenanceRegion | null {
  const rowSido = readText(options.row, ["SIDO_NM", "CTPV_NM", "sido", "sidoNm", "시도", "시도명"]);
  const rowSigungu = readText(options.row, ["SGG_NM", "SIGUNGU_NM", "sigungu", "sigunguNm", "guNm", "자치구", "시군구", "시군구명"]);
  if (rowSido && !rowSido.includes(options.cityToken)) return null;
  return options.query.regions.find((region) => {
    if (!region.sido.includes(options.cityToken)) return false;
    if (rowSigungu) return rowSigungu === region.sigungu;
    return options.haystack.includes(region.sigungu);
  }) ?? null;
}

function uniqueTexts(row: JsonObject, aliases: readonly string[]): readonly string[] {
  const values = aliases.flatMap((alias) => {
    const value = row[alias];
    if (typeof value !== "string" && typeof value !== "number") return [];
    const normalized = String(value).trim();
    return normalized ? [normalized] : [];
  });
  return [...new Set(values)];
}

async function coordinateFields(options: {
  readonly address: string;
  readonly geocoder?: MaintenanceGeocoder;
  readonly query: RegionalProviderQuery;
}): Promise<JsonObject> {
  if (!options.geocoder || !options.address) return {};
  const coordinate = await options.geocoder(options.address);
  if (!coordinate) return {};
  if (haversineDistance(options.query.center.lat, options.query.center.lng, coordinate.lat, coordinate.lng) > options.query.radiusM) return {};
  return { lat: coordinate.lat, lng: coordinate.lng };
}

function seoulRows(root: unknown): { readonly total: number; readonly rows: readonly JsonObject[] } {
  if (!isJsonObject(root) || !isJsonObject(root[SEOUL_SERVICE])) throw new Error("서울 정비사업 API 응답 형식이 올바르지 않습니다");
  const payload = root[SEOUL_SERVICE];
  if (!isJsonObject(payload)) throw new Error("서울 정비사업 API 응답 형식이 올바르지 않습니다");
  const result = payload.RESULT;
  if (isJsonObject(result) && readText(result, ["CODE"]) !== "INFO-000") {
    throw new Error("서울 정비사업 API 요청이 실패했습니다");
  }
  const rows = Array.isArray(payload.row) ? payload.row.filter(isJsonObject) : [];
  return { total: numberValue(payload, ["list_total_count"]) ?? rows.length, rows };
}

export async function fetchSeoulMaintenanceRecords(options: RegionalProviderOptions): Promise<readonly RegionalMaintenanceRecord[]> {
  if (!inRegion(options.query, "서울")) return [];
  const serviceKey = (options.serviceKey ?? process.env.SEOUL_OPEN_API_KEY ?? "").trim();
  if (!serviceKey) throw new Error("SEOUL_OPEN_API_KEY is not configured");
  const http = client(options.httpClient);
  const rawRows: JsonObject[] = [];
  for (let start = 1, total = Number.POSITIVE_INFINITY; start <= total; start += SEOUL_PAGE_SIZE) {
    const end = start + SEOUL_PAGE_SIZE - 1;
    const page = seoulRows(await requestRegionalJson({
      source: "seoul",
      execute: () => http.get(`${SEOUL_URL}/${encodeURIComponent(serviceKey)}/json/${SEOUL_SERVICE}/${start}/${end}/`).json<unknown>(),
    }));
    rawRows.push(...page.rows);
    total = page.total;
    if (!page.rows.length) break;
  }
  const records: RegionalMaintenanceRecord[] = [];
  for (const row of rawRows) {
    const position = readText(row, ["PSTN_NM", "ADDR", "ADDRESS", "주소"]) ?? "";
    const name = readText(row, ["RGN_NM", "PSTN_NM"]);
    if (!name) continue;
    const region = selectedRegion({ row, haystack: `${position} ${name}`, query: options.query, cityToken: "서울" });
    if (!region) continue;
    const address = position.startsWith("서울") ? position : `서울특별시 ${position}`.trim();
    const officialIds = uniqueTexts(row, ["RPT_MNG_CD", "PRJC_CD", "DCSN_ANCMNT_MNG_CD", "NTFC_SN", "WTNNC_SN", "NOTICE_ID", "고시번호"]);
    const id = officialIds[0] ?? `서울특별시|${region.sigungu}|${name}`;
    const typeText = readText(row, ["SCLSF", "MCLSF", "LCLSF"]) ?? "정비사업";
    const stageText = ["RPT_TYPE", "MCLSF", "SCLSF"].map((key) => readText(row, [key])).filter(Boolean).join(" ");
    records.push({
      source_record_id: id, source: "seoul_open_data", official_ids: officialIds, sido: region.sido,
      sigungu: region.sigungu, name, type: projectType(typeText), stage: stage(stageText), address,
      ...optional(numberValue(row, ["AREA_CHG_AFTR", "AREA_EXS"]), "area_sqm"),
      ...optional(readText(row, ["DCSN_ANCMNT_MNG_CD"]), "notice_code"),
      ...optional(SEOUL_DATASET_URL, "notice_url"),
      ...await coordinateFields({ address, geocoder: options.geocoder, query: options.query }),
    });
  }
  return records;
}

function busanPage(root: unknown): { readonly rows: readonly JsonObject[]; readonly total: number } {
  if (!isJsonObject(root)) throw new Error("부산 정비사업 API 응답 형식이 올바르지 않습니다");
  const response = root.response;
  if (isJsonObject(response)) {
    if (!isJsonObject(response.header)) throw new Error("부산 정비사업 API 응답 형식이 올바르지 않습니다");
    const resultCode = readText(response.header, ["resultCode"]);
    if (!resultCode || !["00", "0000", "INFO-000"].includes(resultCode)) {
      throw new Error(`부산 정비사업 API 요청이 실패했습니다${resultCode ? ` (${resultCode})` : ""}`);
    }
  }
  const body = isJsonObject(response) && isJsonObject(response.body) ? response.body : undefined;
  const nested = body && isJsonObject(body.items) ? body.items.item : undefined;
  const direct = root.getMaintenanceBusiness1;
  const value = nested ?? direct;
  const rows = Array.isArray(value) ? value.filter(isJsonObject) : isJsonObject(value) ? [value] : [];
  return { rows, total: body ? numberValue(body, ["totalCount"]) ?? rows.length : rows.length };
}

export async function fetchBusanMaintenanceRecords(options: RegionalProviderOptions): Promise<readonly RegionalMaintenanceRecord[]> {
  if (!inRegion(options.query, "부산")) return [];
  const serviceKey = (options.serviceKey ?? process.env.DATA_GO_KR_API_KEY ?? "").trim();
  if (!serviceKey) throw new Error("DATA_GO_KR_API_KEY is not configured");
  const http = client(options.httpClient);
  const rows: JsonObject[] = [];
  for (let pageNo = 1, total = Number.POSITIVE_INFINITY; rows.length < total && pageNo <= 20; pageNo += 1) {
    const page = busanPage(await requestRegionalJson({
      source: "busan",
      execute: () => http.get(BUSAN_URL, { searchParams: {
        serviceKey, pageNo: String(pageNo), numOfRows: "100", resultType: "json",
      } }).json<unknown>(),
    }));
    rows.push(...page.rows);
    total = page.total;
    if (!page.rows.length) break;
  }
  const records: RegionalMaintenanceRecord[] = [];
  for (const row of rows) {
    const name = readText(row, ["zoneNm", "bsnsNm", "busiNm", "projectName", "구역명", "사업명", "AREA_NM", "name"]);
    if (!name) continue;
    const rawAddress = readText(row, ["addr", "address", "siteAddr", "lc", "position", "위치", "주소"]) ?? "";
    const region = selectedRegion({ row, haystack: `${rawAddress} ${name}`, query: options.query, cityToken: "부산" });
    if (!region) continue;
    const address = rawAddress.startsWith("부산") ? rawAddress : `부산광역시 ${rawAddress}`.trim();
    const id = readText(row, ["bsnsNo", "zoneNo", "manageNo", "projectId"]) ?? `부산광역시|${name}|${address}`;
    records.push({
      source_record_id: id, source: "busan_data_go_kr", official_ids: [id], sido: region.sido,
      sigungu: region.sigungu,
      name, type: projectType(readText(row, ["bsnsSe", "bizType", "businessType", "사업구분", "사업유형", "type"]) ?? name),
      stage: stage(readText(row, ["prgrsSttus", "prgrsStts", "stage", "사업추진단계", "추진단계", "status"])), address,
      ...optional(numberValue(row, ["zoneArea", "area", "구역면적", "사업면적"]), "area_sqm"),
      ...optional(numberValue(row, ["houseHolds", "plannedHouseholds", "세대수"]), "planned_households"),
      ...optional(numberValue(row, ["floorAreaRatio", "용적률"]), "floor_area_ratio"),
      ...optional(numberValue(row, ["buildingCoverageRatio", "건폐율"]), "building_coverage_ratio"),
      ...optional(readText(row, ["constructor", "contractor", "시공자"]), "contractor"),
      ...optional(readText(row, ["architect", "설계자"]), "architect"),
      ...optional(numberValue(row, ["unionMembers", "조합원수"]), "union_members"),
      ...await coordinateFields({ address, geocoder: options.geocoder, query: options.query }),
    });
  }
  return records;
}
