import { getBoundingBox, haversineDistance } from "../geo";
import type { MaintenanceProject, MaintenanceStage } from "../types";
import { getDb } from "./database";

const SEOUL_OPEN_API_URL = "http://openapi.seoul.go.kr:8088";
const SEOUL_SERVICE = "upisRebuild";
const SEOUL_DATASET_URL = "https://data.seoul.go.kr/dataList/OA-20281/S/1/datasetView.do";
const BUSAN_API_URL = "http://apis.data.go.kr/6260000/MaintenanceBusinessStatus1/getMaintenanceBusiness1";
const NCP_REVERSE_GEO_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const NCP_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

const API_TIMEOUT_MS = 18_000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SEOUL_PAGE_SIZE = 1000;
const SEOUL_SAMPLE_PAGE_SIZE = 5;

interface AdminRegion {
  sido: string;
  sigungu: string;
  dong: string;
}

interface SeoulRow {
  RPT_MNG_CD?: string;
  PRJC_CD?: string;
  LOGVM?: string;
  RPT_TYPE?: string;
  LCLSF?: string;
  MCLSF?: string;
  SCLSF?: string;
  PSTN_NM?: string;
  RGN_NM?: string;
  AREA_EXS?: string | number;
  AREA_CHG_AFTR?: string | number;
  DCSN_ANCMNT_MNG_CD?: string;
}

type RawRow = Record<string, unknown>;

let seoulCache: { expiresAt: number; rows: SeoulRow[]; isSample: boolean } | null = null;
let busanCache: { expiresAt: number; rows: RawRow[] } | null = null;

function rawApiKey(key: string): string {
  return key.includes("%") ? decodeURIComponent(key) : key;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getField(row: RawRow, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeStage(value: string): MaintenanceStage {
  if (/준공|완료|해제/.test(value)) return "준공";
  if (/착공|공사/.test(value)) return "착공";
  if (/관리처분/.test(value)) return "관리처분";
  if (/사업시행|시행인가/.test(value)) return "사업시행인가";
  if (/조합/.test(value)) return "조합설립";
  if (/추진위|추진위원/.test(value)) return "추진위";
  if (/지정|변경|정비구역|고시/.test(value)) return "구역지정/변경";
  return "미확인";
}

function buildProjectType(value: string): string {
  const text = value || "정비사업";
  if (/재건축/.test(text)) return "재건축";
  if (/재개발/.test(text)) return "재개발";
  if (/주거환경/.test(text)) return "주거환경개선";
  if (/도시환경/.test(text)) return "도시환경정비";
  if (/가로주택/.test(text)) return "가로주택정비";
  if (/소규모/.test(text)) return "소규모정비";
  return text.replace(/사업지구|정비사업|지구/g, "").trim() || "정비사업";
}

function getCachedCoord(address: string): { lat: number; lng: number } | null {
  try {
    const row = getDb().prepare("SELECT lat, lng FROM geocode_cache WHERE address = ?")
      .get(address) as { lat: number; lng: number } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function setCachedCoord(address: string, lat: number, lng: number): void {
  try {
    getDb().prepare("INSERT OR REPLACE INTO geocode_cache (address, lat, lng, created_at) VALUES (?, ?, ?, ?)")
      .run(address, lat, lng, Date.now() / 1000);
  } catch {
    // Non-fatal cache failure.
  }
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<RawRow> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<RawRow>;
}

async function geocodeAddress(address: string, ncpId: string, ncpSecret: string): Promise<{ lat: number; lng: number } | null> {
  const cleaned = address.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const cached = getCachedCoord(`maintenance:${cleaned}`);
  if (cached) return cached;

  try {
    const data = await fetchJson(`${NCP_GEOCODE_URL}?query=${encodeURIComponent(cleaned)}`, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const addresses = data["addresses"] as Array<Record<string, string>> | undefined;
    const first = addresses?.[0];
    if (!first) return null;
    const lat = Number(first.y);
    const lng = Number(first.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    setCachedCoord(`maintenance:${cleaned}`, lat, lng);
    return { lat, lng };
  } catch {
    return null;
  }
}

async function reverseGeocodeAdmin(lat: number, lng: number, ncpId: string, ncpSecret: string): Promise<AdminRegion | null> {
  try {
    const data = await fetchJson(`${NCP_REVERSE_GEO_URL}?coords=${lng},${lat}&output=json&orders=legalcode,addr`, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const results = data.results as Array<RawRow> | undefined;
    const first = results?.[0];
    const region = first?.region as RawRow | undefined;
    if (!region) return null;
    return {
      sido: String((region.area1 as RawRow | undefined)?.name ?? ""),
      sigungu: String((region.area2 as RawRow | undefined)?.name ?? ""),
      dong: String((region.area3 as RawRow | undefined)?.name ?? ""),
    };
  } catch {
    return null;
  }
}

async function findAdminRegionsInRadius(centerLat: number, centerLng: number, radiusM: number, ncpId: string, ncpSecret: string): Promise<AdminRegion[]> {
  const offsetDeg = radiusM / 111000;
  const samples = [
    [centerLat, centerLng],
    [centerLat + offsetDeg, centerLng],
    [centerLat - offsetDeg, centerLng],
    [centerLat, centerLng + offsetDeg],
    [centerLat, centerLng - offsetDeg],
    [centerLat + offsetDeg * 0.7, centerLng + offsetDeg * 0.7],
    [centerLat + offsetDeg * 0.7, centerLng - offsetDeg * 0.7],
    [centerLat - offsetDeg * 0.7, centerLng + offsetDeg * 0.7],
    [centerLat - offsetDeg * 0.7, centerLng - offsetDeg * 0.7],
  ];
  const regions = await Promise.all(samples.map(([lat, lng]) => reverseGeocodeAdmin(lat, lng, ncpId, ncpSecret)));
  const seen = new Set<string>();
  return regions.filter((region): region is AdminRegion => {
    if (!region) return false;
    const key = `${region.sido}-${region.sigungu}-${region.dong}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSeoulRows(): Promise<{ rows: SeoulRow[]; isSample: boolean }> {
  if (seoulCache && seoulCache.expiresAt > Date.now()) {
    return { rows: seoulCache.rows, isSample: seoulCache.isSample };
  }

  const apiKey = process.env.SEOUL_OPEN_API_KEY || "sample";
  const isSample = apiKey === "sample";
  const rows: SeoulRow[] = [];
  let start = 1;
  let total = isSample ? SEOUL_SAMPLE_PAGE_SIZE : Infinity;

  while (start <= total) {
    const end = isSample ? SEOUL_SAMPLE_PAGE_SIZE : start + SEOUL_PAGE_SIZE - 1;
    const url = `${SEOUL_OPEN_API_URL}/${apiKey}/json/${SEOUL_SERVICE}/${start}/${end}/`;
    const data = await fetchJson(url);
    const payload = data[SEOUL_SERVICE] as { list_total_count?: number; RESULT?: { CODE?: string; MESSAGE?: string }; row?: SeoulRow[] } | undefined;
    if (!payload) break;
    const code = payload.RESULT?.CODE;
    if (code && code !== "INFO-000") throw new Error(payload.RESULT?.MESSAGE ?? code);
    rows.push(...(payload.row ?? []));
    total = isSample ? SEOUL_SAMPLE_PAGE_SIZE : Number(payload.list_total_count ?? rows.length);
    if (isSample || end >= total || !payload.row?.length) break;
    start = end + 1;
  }

  seoulCache = { expiresAt: Date.now() + CACHE_TTL_MS, rows, isSample };
  return { rows, isSample };
}

function seoulCandidateRows(rows: readonly SeoulRow[], regions: readonly AdminRegion[], isSample: boolean): SeoulRow[] {
  if (isSample) return rows.slice(0, SEOUL_SAMPLE_PAGE_SIZE);
  const tokens = new Set<string>();
  for (const region of regions) {
    for (const value of [region.sigungu, region.dong]) {
      const token = value.replace(/제\d+동$/, "").replace(/\d+동$/, "동").trim();
      if (token.length >= 2) tokens.add(token);
      if (value.length >= 2) tokens.add(value);
    }
  }
  if (tokens.size === 0) return rows.slice(0, 200);
  return rows.filter((row) => {
    const haystack = `${row.PSTN_NM ?? ""} ${row.RGN_NM ?? ""}`;
    for (const token of tokens) {
      if (haystack.includes(token)) return true;
    }
    return false;
  });
}

function buildSeoulProject(
  row: SeoulRow,
  coord: { lat: number; lng: number },
  centerLat: number,
  centerLng: number,
): MaintenanceProject {
  const type = buildProjectType(row.SCLSF ?? row.MCLSF ?? row.LCLSF ?? "");
  const stage = normalizeStage(`${row.RPT_TYPE ?? ""} ${row.MCLSF ?? ""} ${row.SCLSF ?? ""}`);
  const name = (row.RGN_NM || row.PSTN_NM || "서울 정비사업").trim();
  const address = `서울특별시 ${String(row.PSTN_NM ?? "").trim()}`.trim();
  const distanceM = haversineDistance(centerLat, centerLng, coord.lat, coord.lng);
  const area = parseNumber(row.AREA_CHG_AFTR) || parseNumber(row.AREA_EXS);
  return {
    id: `maintenance-seoul-${row.RPT_MNG_CD || row.PRJC_CD || normalizeName(`${name}-${address}`)}`,
    name,
    lat: coord.lat,
    lng: coord.lng,
    category: "maintenance",
    type,
    stage,
    address,
    area_sqm: Math.round(area),
    notice_code: row.DCSN_ANCMNT_MNG_CD || undefined,
    notice_url: row.DCSN_ANCMNT_MNG_CD ? SEOUL_DATASET_URL : undefined,
    source: "seoul_open_data",
    boundary_status: "unavailable",
    distance_m: Math.round(distanceM),
  };
}

async function searchSeoulProjects(centerLat: number, centerLng: number, radiusM: number, regions: readonly AdminRegion[], ncpId: string, ncpSecret: string): Promise<MaintenanceProject[]> {
  if (!regions.some((region) => region.sido.includes("서울"))) return [];
  const { rows, isSample } = await fetchSeoulRows();
  const candidates = seoulCandidateRows(rows, regions, isSample).slice(0, 250);
  const projects: MaintenanceProject[] = [];

  for (const row of candidates) {
    const position = String(row.PSTN_NM ?? "").trim();
    if (!position) continue;
    const coord = await geocodeAddress(`서울특별시 ${position}`, ncpId, ncpSecret)
      || await geocodeAddress(position, ncpId, ncpSecret);
    if (!coord) continue;
    if (haversineDistance(centerLat, centerLng, coord.lat, coord.lng) > radiusM) continue;
    projects.push(buildSeoulProject(row, coord, centerLat, centerLng));
  }

  return projects;
}

function normalizeBusanRows(data: RawRow): RawRow[] {
  const body = (data.response as RawRow | undefined)?.body as RawRow | undefined;
  const items = body?.items as RawRow | undefined;
  const item = items?.item;
  if (Array.isArray(item)) return item as RawRow[];
  if (item && typeof item === "object") return [item as RawRow];
  if (Array.isArray(data.getMaintenanceBusiness1)) return data.getMaintenanceBusiness1 as RawRow[];
  return [];
}

async function fetchBusanRows(): Promise<RawRow[]> {
  if (busanCache && busanCache.expiresAt > Date.now()) return busanCache.rows;
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) return [];

  const rows: RawRow[] = [];
  let page = 1;
  while (page <= 20) {
    const params = new URLSearchParams({
      serviceKey: rawApiKey(apiKey),
      pageNo: String(page),
      numOfRows: "100",
      resultType: "json",
    });
    try {
      const data = await fetchJson(`${BUSAN_API_URL}?${params.toString()}`);
      const body = (data.response as RawRow | undefined)?.body as RawRow | undefined;
      const pageRows = normalizeBusanRows(data);
      rows.push(...pageRows);
      const total = parseNumber(body?.totalCount) || rows.length;
      if (rows.length >= total || pageRows.length === 0) break;
      page += 1;
    } catch (error) {
      console.error("[maintenance-project-search] Busan API failed:", error);
      break;
    }
  }
  busanCache = { expiresAt: Date.now() + CACHE_TTL_MS, rows };
  return rows;
}

function pickBusanName(row: RawRow): string {
  return getField(row, ["zoneNm", "bsnsNm", "busiNm", "projectName", "구역명", "사업명", "AREA_NM", "name"]) || "부산 정비사업";
}

function pickBusanAddress(row: RawRow): string {
  const address = getField(row, ["addr", "address", "siteAddr", "lc", "position", "위치", "주소"]);
  return address.startsWith("부산") ? address : `부산광역시 ${address}`.trim();
}

function buildBusanProject(row: RawRow, coord: { lat: number; lng: number }, centerLat: number, centerLng: number): MaintenanceProject {
  const name = pickBusanName(row);
  const address = pickBusanAddress(row);
  const typeText = getField(row, ["bsnsSe", "bizType", "businessType", "사업구분", "사업유형", "type"]);
  const stageText = getField(row, ["prgrsSttus", "prgrsStts", "stage", "사업추진단계", "추진단계", "status"]);
  return {
    id: `maintenance-busan-${normalizeName(`${name}-${address}`)}`,
    name,
    lat: coord.lat,
    lng: coord.lng,
    category: "maintenance",
    type: buildProjectType(typeText || name),
    stage: normalizeStage(stageText),
    address,
    area_sqm: Math.round(parseNumber(getField(row, ["zoneArea", "area", "구역면적", "사업면적"]))),
    source: "busan_data_go_kr",
    boundary_status: "unavailable",
    distance_m: Math.round(haversineDistance(centerLat, centerLng, coord.lat, coord.lng)),
    planned_households: parseNumber(getField(row, ["houseHolds", "plannedHouseholds", "세대수"])) || undefined,
    floor_area_ratio: parseNumber(getField(row, ["floorAreaRatio", "용적률"])) || undefined,
    building_coverage_ratio: parseNumber(getField(row, ["buildingCoverageRatio", "건폐율"])) || undefined,
    contractor: getField(row, ["constructor", "contractor", "시공자"]) || undefined,
    architect: getField(row, ["architect", "설계자"]) || undefined,
    union_members: parseNumber(getField(row, ["unionMembers", "조합원수"])) || undefined,
  };
}

async function searchBusanProjects(centerLat: number, centerLng: number, radiusM: number, regions: readonly AdminRegion[], ncpId: string, ncpSecret: string): Promise<MaintenanceProject[]> {
  if (!regions.some((region) => region.sido.includes("부산"))) return [];
  const rows = await fetchBusanRows();
  const regionTokens = new Set(regions.flatMap((region) => [region.sigungu, region.dong]).filter(Boolean));
  const candidates = rows.filter((row) => {
    const haystack = `${pickBusanName(row)} ${pickBusanAddress(row)}`;
    if (regionTokens.size === 0) return true;
    for (const token of regionTokens) {
      if (token.length >= 2 && haystack.includes(token)) return true;
    }
    return false;
  }).slice(0, 250);

  const projects: MaintenanceProject[] = [];
  for (const row of candidates) {
    const address = pickBusanAddress(row);
    const coord = await geocodeAddress(address, ncpId, ncpSecret);
    if (!coord) continue;
    if (haversineDistance(centerLat, centerLng, coord.lat, coord.lng) > radiusM) continue;
    projects.push(buildBusanProject(row, coord, centerLat, centerLng));
  }
  return projects;
}

function mergeProjects(projects: readonly MaintenanceProject[]): MaintenanceProject[] {
  const merged: MaintenanceProject[] = [];
  for (const project of projects) {
    const key = normalizeName(project.name);
    const existingIndex = merged.findIndex((candidate) =>
      normalizeName(candidate.name) === key ||
      (normalizeName(candidate.address) === normalizeName(project.address) &&
        haversineDistance(candidate.lat, candidate.lng, project.lat, project.lng) <= 120)
    );
    if (existingIndex < 0) {
      merged.push(project);
      continue;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      ...project,
      id: existing.id,
      area_sqm: Math.max(existing.area_sqm || 0, project.area_sqm || 0),
      boundary: existing.boundary ?? project.boundary,
      boundary_status: existing.boundary_status === "confirmed" || project.boundary_status === "confirmed" ? "confirmed" : "unavailable",
      notice_code: existing.notice_code ?? project.notice_code,
      notice_url: existing.notice_url ?? project.notice_url,
    };
  }
  return merged.sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
}

export async function searchMaintenanceProjects(centerLat: number, centerLng: number, radiusM: number): Promise<MaintenanceProject[]> {
  const ncpId = process.env.NCP_CLIENT_ID;
  const ncpSecret = process.env.NCP_CLIENT_SECRET;
  if (!ncpId || !ncpSecret) return [];

  const regions = await findAdminRegionsInRadius(centerLat, centerLng, radiusM, ncpId, ncpSecret);
  if (regions.length === 0) return [];

  const bbox = getBoundingBox(centerLat, centerLng, radiusM + 200);
  const [seoulProjects, busanProjects] = await Promise.all([
    searchSeoulProjects(centerLat, centerLng, radiusM, regions, ncpId, ncpSecret).catch((error) => {
      console.error("[maintenance-project-search] Seoul provider failed:", error);
      return [] as MaintenanceProject[];
    }),
    searchBusanProjects(centerLat, centerLng, radiusM, regions, ncpId, ncpSecret).catch((error) => {
      console.error("[maintenance-project-search] Busan provider failed:", error);
      return [] as MaintenanceProject[];
    }),
  ]);

  return mergeProjects([...seoulProjects, ...busanProjects]).filter((project) =>
    project.lat >= bbox.south &&
    project.lat <= bbox.north &&
    project.lng >= bbox.west &&
    project.lng <= bbox.east &&
    (project.distance_m ?? haversineDistance(centerLat, centerLng, project.lat, project.lng)) <= radiusM
  );
}
