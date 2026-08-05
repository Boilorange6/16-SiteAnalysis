import { getDb } from "./database";
import { buildLedgerUrl } from "./ledger-url";
import { buildGeocodeCandidates, findResidentialMatchIndex, isPlannedComplexCurrent, toYearMonth } from "./planned-residential-filter";
import { isRecentMiss, readGeocode, readLegalCode, recordGeocodeMiss, writeGeocode, writeLegalCode } from "./geocode-cache";
import { PLANNED_HOUSING_SPEC, bboxFromRadius, queryDatasetInBbox, readIngestRun } from "./dataset-store";
import type { Apartment, Officetel, ResidentialOther, ResidentialFloorplan, ResidentialPoi } from "../types";

const APPLYHOME_BASE_URL = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
const NCP_REVERSE_GEO_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const NCP_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

const API_TIMEOUT_MS = 18_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * 모집공고일 하한. 분양~입주는 보통 30~40개월이므로, 입주예정월 기준 유예(24개월)를
 * 채우려면 공고일은 6년까지 거슬러 올라가야 한다. 실제 편입 여부는
 * isPlannedComplexCurrent()가 입주예정월로 판단한다.
 */
const PLANNED_LOOKBACK_DAYS = 2190;
const PLANNED_LOOKAHEAD_DAYS = 730;
/** 광역 단위(예: "경기") 조회라 페이지가 많다. 6년치를 담으려면 500행으로는 부족하다. */
const APPLYHOME_MAX_PAGES = 20;
const FLOORPLAN_IMAGE_HINT_RE = /(평면|floor|plan|unit|type|house|pyung|pyeong|84a|84b|59a|59b|74a|74b)/i;

const plannedSearchCache = new Map<string, { expiresAt: number; pois: ResidentialPoi[] }>();
const ledgerDongCache = new Map<string, LedgerEnhancement[]>();

type ApplyhomeKind = "apartment" | "officetel" | "residential";

interface RegionCode {
  sigunguCd: string;
  bjdongCd: string;
  areaName: string;
}

interface ApplyhomeComplex {
  houseManageNo: string;
  pblancNo: string;
  name: string;
  address: string;
  units: number;
  saleDate: string;
  moveInMonth: string;
  homepageUrl: string;
  noticeUrl: string;
  kind: ApplyhomeKind;
  housingTypes: PlannedHousingType[];
}

interface PlannedHousingType {
  housingType: string;
  areaSqm?: number;
  supplyUnits: number;
  priceText?: string;
}

interface LedgerEnhancement {
  name: string;
  address: string;
  units: number;
  parking: number;
  maxFloor: number;
}

function encodeApiKey(key: string): string {
  const raw = key.includes("%") ? decodeURIComponent(key) : key;
  return encodeURIComponent(raw);
}

function getDataGoKrApiKey(): string | undefined {
  return process.env.APPLYHOME_API_KEY || process.env.DATA_GO_KR_ODCLOUD_API_KEY || process.env.DATA_GO_KR_API_KEY;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const str = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(str);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function parseArea(value: unknown): number | undefined {
  const str = String(value ?? "").replace(/,/g, "");
  const match = str.match(/[0-9]+(?:\.[0-9]+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getField(row: Record<string, unknown>, keys: readonly string[]): string {
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
    .replace(/(아파트|공동주택|오피스텔|도시형생활주택|민간임대|분양|신축|단지)$/g, "");
}

function normalizeAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseXmlItems(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item: Record<string, string> = {};
    for (const t of m[1].matchAll(/<(\w+)>([^<]*)<\/\w+>/g)) {
      item[t[1]] = t[2].trim();
    }
    items.push(item);
  }
  return items;
}

function dateStringFromOffset(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function areaNameFromSigungu(sigunguCd: string): string {
  const prefix = sigunguCd.slice(0, 2);
  const map: Record<string, string> = {
    "11": "서울",
    "26": "부산",
    "27": "대구",
    "28": "인천",
    "29": "광주",
    "30": "대전",
    "31": "울산",
    "36": "세종",
    "41": "경기",
    "42": "강원",
    "43": "충북",
    "44": "충남",
    "45": "전북",
    "46": "전남",
    "47": "경북",
    "48": "경남",
    "50": "제주",
    "51": "강원",
    "52": "전북",
  };
  return map[prefix] ?? "";
}

async function reverseGeocodeToRegion(lat: number, lng: number, ncpId: string, ncpSecret: string): Promise<RegionCode | null> {
  // 단지마다 호출되는 지점이라 캐시 적중률이 곧 응답 시간이다.
  try {
    const cached = readLegalCode(getDb(), lat, lng);
    if (cached) return cached;
  } catch {
    // 캐시 실패는 조회를 막지 않는다
  }

  const url = `${NCP_REVERSE_GEO_URL}?coords=${lng},${lat}&output=json&orders=legalcode`;
  try {
    const data = await fetchJson(url, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const results = data["results"] as Array<Record<string, unknown>> | undefined;
    const first = results?.[0];
    const codeId = String((first?.["code"] as Record<string, unknown> | undefined)?.["id"] ?? "");
    if (codeId.length < 10) return null;
    const sigunguCd = codeId.slice(0, 5);
    const areaName = areaNameFromSigungu(sigunguCd);
    if (!areaName) return null;
    const region = { sigunguCd, bjdongCd: codeId.slice(5, 10), areaName };
    try {
      writeLegalCode(getDb(), lat, lng, region, Date.now());
    } catch {
      // 캐시 실패는 결과에 영향 없다
    }
    return region;
  } catch {
    return null;
  }
}

async function findRegionsInRadius(centerLat: number, centerLng: number, radiusM: number, ncpId: string, ncpSecret: string): Promise<RegionCode[]> {
  const offsetDeg = radiusM / 111000;
  const points = [
    [centerLat, centerLng],
    [centerLat + offsetDeg, centerLng],
    [centerLat - offsetDeg, centerLng],
    [centerLat, centerLng + offsetDeg],
    [centerLat, centerLng - offsetDeg],
  ];
  const results = await Promise.all(points.map(([lat, lng]) => reverseGeocodeToRegion(lat, lng, ncpId, ncpSecret)));
  const seen = new Set<string>();
  const regions: RegionCode[] = [];
  for (const region of results) {
    if (!region) continue;
    const key = `${region.sigunguCd}-${region.bjdongCd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    regions.push(region);
  }
  return regions;
}

function getCachedCoord(address: string): { lat: number; lng: number } | null {
  try {
    return readGeocode(getDb(), address);
  } catch {
    return null;
  }
}

function setCachedCoord(address: string, lat: number, lng: number): void {
  try {
    writeGeocode(getDb(), address, lat, lng, Date.now());
  } catch {
    // cache misses are non-fatal
  }
}

/** 최근에 실패한 주소는 다시 왕복하지 않는다 (후보 폴백 도입 후 주소당 최대 3회로 늘었다) */
function isKnownGeocodeMiss(address: string): boolean {
  try {
    return isRecentMiss(getDb(), address, Date.now());
  } catch {
    return false;
  }
}

function rememberGeocodeMiss(address: string): void {
  try {
    recordGeocodeMiss(getDb(), address, Date.now());
  } catch {
    // non-fatal
  }
}

async function geocodeOnce(query: string, ncpId: string, ncpSecret: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `${NCP_GEOCODE_URL}?query=${encodeURIComponent(query)}`;
    const data = await fetchJson(url, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const addrs = data["addresses"] as Array<Record<string, string>> | undefined;
    if (!addrs?.[0]) return null;
    const lat = Number(addrs[0]["y"]);
    const lng = Number(addrs[0]["x"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * 청약홈 공급위치는 "경기도 남양주시 다산신도시 상업 2BL (다산동 6192-1번지)"처럼
 * 택지지구·블록 표기가 섞여 원문 그대로는 지오코딩이 실패한다.
 * 후보를 순서대로 시도해 첫 성공을 쓴다.
 */
async function geocodeAddress(address: string, ncpId: string, ncpSecret: string): Promise<{ lat: number; lng: number } | null> {
  const cached = getCachedCoord(address);
  if (cached) return cached;
  if (isKnownGeocodeMiss(address)) return null;

  for (const candidate of buildGeocodeCandidates(address)) {
    const coord = await geocodeOnce(candidate, ncpId, ncpSecret);
    if (coord) {
      setCachedCoord(address, coord.lat, coord.lng);
      return coord;
    }
  }
  rememberGeocodeMiss(address);
  return null;
}

function sanitizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^javascript:/i.test(trimmed)) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return "";
}

function resolveMaybeRelativeUrl(src: string, baseUrl: string): string {
  try {
    return new URL(src, baseUrl).toString();
  } catch {
    return "";
  }
}

async function findFloorplanThumbnail(sourceUrl: string): Promise<string | undefined> {
  const url = sanitizeUrl(sourceUrl);
  if (!url || /\.pdf(?:$|[?#])/i.test(url)) return undefined;
  try {
    const html = await fetchText(url);
    const candidates: string[] = [];
    for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>/gi)) {
      candidates.push(m[1]);
    }
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? "";
      const alt = tag.match(/\balt=["']([^"']+)["']/i)?.[1] ?? "";
      if (src && FLOORPLAN_IMAGE_HINT_RE.test(`${src} ${alt}`)) candidates.push(src);
    }
    for (const candidate of candidates) {
      const resolved = resolveMaybeRelativeUrl(candidate, url);
      if (!resolved) continue;
      if (FLOORPLAN_IMAGE_HINT_RE.test(resolved)) return resolved;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function classifyApplyhomeKind(row: Record<string, unknown>, fallback: ApplyhomeKind): ApplyhomeKind {
  const text = `${getField(row, ["HOUSE_DTL_SECD_NM", "주택상세구분코드명"])} ${getField(row, ["HOUSE_SECD_NM", "주택구분코드명"])} ${getField(row, ["HOUSE_NM", "주택명"])}`;
  if (/오피스텔/i.test(text)) return "officetel";
  if (/도시형|민간임대|생활숙박|연립|다세대/i.test(text)) return "residential";
  return fallback;
}

function rawApiKey(key: string): string {
  return key.includes("%") ? decodeURIComponent(key) : key;
}

async function queryApplyhome(endpoint: string, areaName: string, serviceKey: string): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const startDate = dateStringFromOffset(-PLANNED_LOOKBACK_DAYS);
  const endDate = dateStringFromOffset(PLANNED_LOOKAHEAD_DAYS);
  let page = 1;

  while (page <= APPLYHOME_MAX_PAGES) {
    const params = new URLSearchParams({
      page: String(page),
      perPage: "100",
      returnType: "JSON",
      serviceKey,
    });
    params.set("cond[SUBSCRPT_AREA_CODE_NM::EQ]", areaName);
    params.set("cond[RCRIT_PBLANC_DE::GTE]", startDate);
    params.set("cond[RCRIT_PBLANC_DE::LTE]", endDate);

    try {
      const data = await fetchJson(`${APPLYHOME_BASE_URL}/${endpoint}?${params.toString()}`);
      const dataRows = data["data"] as Array<Record<string, unknown>> | undefined;
      if (!dataRows || dataRows.length === 0) break;
      rows.push(...dataRows);
      const total = parseNumber(data["totalCount"]);
      if (page * 100 >= total) break;
      page += 1;
    } catch {
      break;
    }
  }

  return rows;
}

async function queryApplyhomeModels(endpoint: string, serviceKey: string, houseManageNo: string, pblancNo: string): Promise<PlannedHousingType[]> {
  if (!houseManageNo && !pblancNo) return [];
  const params = new URLSearchParams({
    page: "1",
    perPage: "100",
    returnType: "JSON",
    serviceKey,
  });
  if (houseManageNo) params.set("cond[HOUSE_MANAGE_NO::EQ]", houseManageNo);
  if (pblancNo) params.set("cond[PBLANC_NO::EQ]", pblancNo);

  try {
    const data = await fetchJson(`${APPLYHOME_BASE_URL}/${endpoint}?${params.toString()}`);
    const rows = data["data"] as Array<Record<string, unknown>> | undefined;
    return (rows ?? []).map((row) => {
      const supplyUnits = parseNumber(getField(row, [
        "SUPLY_HSHLDCO",
        "GNRL_SUPLY_HSHLDCO",
        "SPSPLY_HSHLDCO",
        "공급세대수",
        "일반공급세대수",
      ]));
      return {
        housingType: getField(row, ["HOUSE_TY", "주택형", "MODEL_NO", "모델번호"]) || "주택형",
        areaSqm: parseArea(getField(row, ["SUPLY_AR", "주택공급면적"])),
        supplyUnits,
        priceText: getField(row, ["LTTOT_TOP_AMOUNT", "공급금액_분양최고금액"]),
      };
    }).filter((item) => item.housingType);
  } catch {
    return [];
  }
}

function rowToComplex(row: Record<string, unknown>, kind: ApplyhomeKind): ApplyhomeComplex | null {
  const name = getField(row, ["HOUSE_NM", "주택명"]);
  const address = getField(row, ["HSSPLY_ADRES", "공급위치"]);
  if (!name || !address) return null;

  return {
    houseManageNo: getField(row, ["HOUSE_MANAGE_NO", "주택관리번호"]),
    pblancNo: getField(row, ["PBLANC_NO", "공고번호"]),
    name,
    address,
    units: parseNumber(getField(row, ["TOT_SUPLY_HSHLDCO", "공급규모"])),
    saleDate: getField(row, ["RCRIT_PBLANC_DE", "모집공고일"]),
    moveInMonth: getField(row, ["MVN_PREARNGE_YM", "입주예정월"]),
    homepageUrl: sanitizeUrl(getField(row, ["HMPG_ADRES", "홈페이지주소"])),
    noticeUrl: sanitizeUrl(getField(row, ["PBLANC_URL", "모집공고홈페이지주소"])),
    kind: classifyApplyhomeKind(row, kind),
    housingTypes: [],
  };
}

const APPLYHOME_DETAIL_SPECS: Array<{ endpoint: string; kind: ApplyhomeKind; modelEndpoint: string }> = [
  { endpoint: "getAPTLttotPblancDetail", kind: "apartment", modelEndpoint: "getAPTLttotPblancMdl" },
  { endpoint: "getUrbtyOfctlLttotPblancDetail", kind: "officetel", modelEndpoint: "getUrbtyOfctlLttotPblancMdl" },
  { endpoint: "getPblPvtRentLttotPblancDetail", kind: "residential", modelEndpoint: "getPblPvtRentLttotPblancMdl" },
];

/**
 * 한 시도의 분양 공고를 가져온다. 평면도용 주택형(housingTypes)은 채우지 않는다.
 *
 * 전국 배치가 단지마다 주택형까지 조회하면 수천 번을 왕복한다.
 * 주택형은 실제로 반경 안에 든 소수 단지에 대해서만 읽기 시점에 채운다.
 */
export async function fetchApplyhomeComplexesForArea(
  areaName: string,
  serviceKey: string,
): Promise<ApplyhomeComplex[]> {
  const complexes = new Map<string, ApplyhomeComplex>();
  for (const spec of APPLYHOME_DETAIL_SPECS) {
    const rows = await queryApplyhome(spec.endpoint, areaName, serviceKey);
    for (const row of rows) {
      const complex = rowToComplex(row, spec.kind);
      if (!complex) continue;
      const key = `${complex.houseManageNo}:${complex.pblancNo}:${normalizeName(complex.name)}`;
      if (!complexes.has(key)) complexes.set(key, complex);
    }
  }
  return [...complexes.values()];
}

/** 반경 안에 든 단지에만 주택형을 채운다 (평면도 생성용) */
async function fillHousingTypes(complex: ApplyhomeComplex, serviceKey: string): Promise<void> {
  if (complex.housingTypes.length > 0) return;
  const spec = APPLYHOME_DETAIL_SPECS.find((s) => s.kind === complex.kind) ?? APPLYHOME_DETAIL_SPECS[0];
  complex.housingTypes = await queryApplyhomeModels(
    spec.modelEndpoint, serviceKey, complex.houseManageNo, complex.pblancNo,
  );
}

async function searchApplyhomeComplexes(areaNames: readonly string[], serviceKey: string): Promise<ApplyhomeComplex[]> {
  const complexes: ApplyhomeComplex[] = [];
  for (const areaName of areaNames) {
    complexes.push(...await fetchApplyhomeComplexesForArea(areaName, serviceKey));
  }
  return complexes;
}

async function queryLedgerEnhancementsForDong(sigunguCd: string, bjdongCd: string, encodedApiKey: string): Promise<LedgerEnhancement[]> {
  const cacheKey = `${sigunguCd}-${bjdongCd}`;
  const cached = ledgerDongCache.get(cacheKey);
  if (cached) return cached;

  const buildings: LedgerEnhancement[] = [];
  let page = 1;
  while (page <= 5) {
    const url = buildLedgerUrl({ sigunguCd, bjdongCd, pageNo: page, encodedApiKey });
    try {
      const xml = await fetchText(url);
      const items = parseXmlItems(xml);
      if (items.length === 0) break;
      for (const it of items) {
        const purps = it["mainPurpsCdNm"] ?? "";
        if (purps !== "공동주택") continue;
        buildings.push({
          name: it["bldNm"] ?? "",
          address: (it["platPlc"] ?? "").replace(/번지$/, "").trim(),
          units: parseNumber(it["hhldCnt"]),
          parking: parseNumber(it["totPkngCnt"]),
          maxFloor: parseNumber(it["grndFlrCnt"]),
        });
      }
      const total = parseNumber(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1]);
      if (page * 100 >= total) break;
      page += 1;
    } catch {
      break;
    }
  }

  ledgerDongCache.set(cacheKey, buildings);
  return buildings;
}

function matchLedgerEnhancement(complex: ApplyhomeComplex, candidates: readonly LedgerEnhancement[]): LedgerEnhancement | undefined {
  const complexName = normalizeName(complex.name);
  const complexAddress = normalizeAddress(complex.address);
  return candidates.find((candidate) => {
    const candidateName = normalizeName(candidate.name);
    const candidateAddress = normalizeAddress(candidate.address);
    return (
      (!!complexName && !!candidateName && (complexName.includes(candidateName) || candidateName.includes(complexName))) ||
      (!!complexAddress && !!candidateAddress && (complexAddress.includes(candidateAddress) || candidateAddress.includes(complexAddress)))
    );
  });
}

async function buildFloorplans(complex: ApplyhomeComplex): Promise<ResidentialFloorplan[] | undefined> {
  const sourceUrl = complex.homepageUrl || complex.noticeUrl;
  if (!sourceUrl) return undefined;
  const thumbnail = await findFloorplanThumbnail(sourceUrl);
  const housingTypes = complex.housingTypes.length > 0
    ? complex.housingTypes
    : [{ housingType: "평면도", supplyUnits: complex.units } satisfies PlannedHousingType];
  return housingTypes.slice(0, 8).map((item) => ({
    housing_type: item.housingType,
    ...(item.areaSqm ? { area_sqm: item.areaSqm } : {}),
    ...(thumbnail ? { image_url: thumbnail } : {}),
    source_url: sourceUrl,
    status: thumbnail ? "thumbnail" : "link_only",
  }));
}

function complexToPoi(complex: ApplyhomeComplex, coord: { lat: number; lng: number }, dist: number, enhancement?: LedgerEnhancement, floorplans?: ResidentialFloorplan[]): ResidentialPoi {
  const source = enhancement ? "housing_permit" : "applyhome";
  const base = {
    id: `applyhome-${complex.houseManageNo || "house"}-${complex.pblancNo || normalizeName(complex.name)}`,
    name: complex.name,
    lat: coord.lat,
    lng: coord.lng,
    units: complex.units || enhancement?.units || 0,
    parking_count: enhancement?.parking ?? 0,
    sale_date: complex.saleDate,
    distance_m: Math.round(dist),
    status: "planned" as const,
    source: source as "applyhome" | "housing_permit",
    ...(enhancement?.maxFloor ? { max_floor: enhancement.maxFloor } : {}),
    ...(complex.moveInMonth ? { move_in_month: complex.moveInMonth } : {}),
    ...(complex.homepageUrl ? { homepage_url: complex.homepageUrl } : {}),
    ...(complex.noticeUrl ? { notice_url: complex.noticeUrl } : {}),
    ...(floorplans && floorplans.length > 0 ? { floorplans } : {}),
  };

  if (complex.kind === "officetel") {
    return { ...base, category: "officetel" } as Officetel;
  }
  if (complex.kind === "residential") {
    return { ...base, category: "residential" } as ResidentialOther;
  }
  return { ...base, category: "apartment" } as Apartment;
}

/** 반경 안에 든 단지 하나를 POI로 만든다 (건축물대장 보강 + 평면도) */
async function buildPlannedPoi(
  complex: ApplyhomeComplex,
  coord: { lat: number; lng: number },
  dist: number,
  encodedApiKey: string,
  ncpId: string,
  ncpSecret: string,
): Promise<ResidentialPoi> {
  const region = await reverseGeocodeToRegion(coord.lat, coord.lng, ncpId, ncpSecret);
  const enhancements = region
    ? await queryLedgerEnhancementsForDong(region.sigunguCd, region.bjdongCd, encodedApiKey)
    : [];
  const enhancement = matchLedgerEnhancement(complex, enhancements);
  const floorplans = await buildFloorplans(complex);
  return complexToPoi(complex, coord, dist, enhancement, floorplans);
}

/** 적재분이 이보다 오래되면 실시간 API 경로로 되돌아간다 */
const PLANNED_DATASET_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function datasetRowToComplex(row: Record<string, unknown>): ApplyhomeComplex {
  const [houseManageNo = "", pblancNo = ""] = String(row["id"] ?? "").split(":");
  return {
    houseManageNo,
    pblancNo,
    name: String(row["name"] ?? ""),
    address: String(row["address"] ?? ""),
    units: Number(row["units"] ?? 0),
    saleDate: String(row["sale_date"] ?? ""),
    moveInMonth: String(row["move_in_month"] ?? ""),
    homepageUrl: String(row["homepage_url"] ?? ""),
    noticeUrl: String(row["notice_url"] ?? ""),
    kind: (String(row["kind"] ?? "apartment") as ApplyhomeKind),
    housingTypes: [],
  };
}

/**
 * 적재된 전국 분양 데이터에서 반경 안 단지를 읽는다.
 * 적재분이 없거나 오래됐으면 null을 돌려 실시간 경로로 넘긴다.
 */
async function searchPlannedFromDataset(
  centerLat: number, centerLng: number, radiusM: number,
  serviceKey: string, encodedApiKey: string, ncpId: string, ncpSecret: string,
): Promise<ResidentialPoi[] | null> {
  let rows: Array<Record<string, unknown>>;
  try {
    const db = getDb();
    const run = readIngestRun(db, PLANNED_HOUSING_SPEC.dataset);
    if (!run || run.status !== "ok" || run.lastSuccessAt === null) return null;
    if (Date.now() - run.lastSuccessAt > PLANNED_DATASET_MAX_AGE_MS) {
      console.warn("[planned-residential-search] 적재분이 오래돼 실시간 조회로 전환합니다");
      return null;
    }
    rows = queryDatasetInBbox(db, PLANNED_HOUSING_SPEC, bboxFromRadius(centerLat, centerLng, radiusM));
  } catch {
    return null;
  }

  const nowYm = toYearMonth(new Date());
  const pois: ResidentialPoi[] = [];
  for (const row of rows) {
    const complex = datasetRowToComplex(row);
    if (!isPlannedComplexCurrent({ moveInMonth: complex.moveInMonth, saleDate: complex.saleDate }, nowYm)) continue;
    const lat = Number(row["lat"]);
    const lng = Number(row["lng"]);
    const dist = haversine(centerLat, centerLng, lat, lng);
    if (dist > radiusM) continue;

    await fillHousingTypes(complex, serviceKey);
    pois.push(await buildPlannedPoi(complex, { lat, lng }, dist, encodedApiKey, ncpId, ncpSecret));
  }
  return pois;
}

export async function searchPlannedResidential(centerLat: number, centerLng: number, radiusM: number): Promise<ResidentialPoi[]> {
  const apiKey = getDataGoKrApiKey();
  const ncpId = process.env.NCP_CLIENT_ID;
  const ncpSecret = process.env.NCP_CLIENT_SECRET;
  if (!apiKey || !ncpId || !ncpSecret) return [];

  const cacheKey = `${centerLat.toFixed(4)}:${centerLng.toFixed(4)}:${Math.round(radiusM)}`;
  const cached = plannedSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.pois;

  const serviceKeyEarly = rawApiKey(apiKey);
  const encodedApiKeyEarly = encodeApiKey(apiKey);
  const fromDataset = await searchPlannedFromDataset(
    centerLat, centerLng, radiusM, serviceKeyEarly, encodedApiKeyEarly, ncpId, ncpSecret,
  );
  if (fromDataset) {
    plannedSearchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, pois: fromDataset });
    return fromDataset;
  }

  const regions = await findRegionsInRadius(centerLat, centerLng, radiusM, ncpId, ncpSecret);
  const areaNames = [...new Set(regions.map((region) => region.areaName))];
  if (areaNames.length === 0) return [];

  const serviceKey = rawApiKey(apiKey);
  const encodedApiKey = encodeApiKey(apiKey);
  const complexes = await searchApplyhomeComplexes(areaNames, serviceKey);
  if (complexes.length === 0) {
    plannedSearchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, pois: [] });
    return [];
  }

  const nowYm = toYearMonth(new Date());
  const currentComplexes = complexes.filter((complex) =>
    isPlannedComplexCurrent({ moveInMonth: complex.moveInMonth, saleDate: complex.saleDate }, nowYm),
  );

  const pois: ResidentialPoi[] = [];
  let geocodeFailures = 0;
  for (const complex of currentComplexes) {
    const coord = await geocodeAddress(complex.address, ncpId, ncpSecret);
    if (!coord) {
      geocodeFailures += 1;
      continue;
    }
    const dist = haversine(centerLat, centerLng, coord.lat, coord.lng);
    if (dist > radiusM) continue;

    await fillHousingTypes(complex, serviceKey);
    const poi = await buildPlannedPoi(complex, coord, dist, encodedApiKey, ncpId, ncpSecret);
    pois.push(poi);
  }

  if (geocodeFailures > 0) {
    console.warn(
      `[planned-residential-search] ${geocodeFailures}/${currentComplexes.length} complexes dropped: geocoding failed`,
    );
  }

  plannedSearchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, pois });
  return pois;
}

function mergeResidential(existing: ResidentialPoi, planned: ResidentialPoi): ResidentialPoi {
  const merged = {
    ...existing,
    ...planned,
    units: planned.units || existing.units,
    parking_count: planned.parking_count || existing.parking_count,
    sale_date: planned.sale_date || existing.sale_date,
    distance_m: Math.min(existing.distance_m, planned.distance_m),
    status: "planned" as const,
    source: planned.source,
    max_floor: planned.max_floor ?? existing.max_floor,
    move_in_month: planned.move_in_month ?? existing.move_in_month,
    homepage_url: planned.homepage_url ?? existing.homepage_url,
    notice_url: planned.notice_url ?? existing.notice_url,
    floorplans: planned.floorplans ?? existing.floorplans,
  };
  return merged as ResidentialPoi;
}

export function mergeResidentialPois(existingPois: readonly ResidentialPoi[], plannedPois: readonly ResidentialPoi[]): ResidentialPoi[] {
  const merged: ResidentialPoi[] = [...existingPois];
  for (const planned of plannedPois) {
    const idx = findResidentialMatchIndex(merged, planned);
    if (idx >= 0) {
      merged[idx] = mergeResidential(merged[idx], planned);
    } else {
      merged.push(planned);
    }
  }
  return merged;
}
