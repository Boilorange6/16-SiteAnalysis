import { getDb } from "./database";
import type { Apartment, Officetel, ResidentialOther, ResidentialFloorplan, ResidentialPoi } from "../types";

const APPLYHOME_BASE_URL = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
const LEDGER_URL = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo";
const NCP_REVERSE_GEO_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const NCP_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

const API_TIMEOUT_MS = 18_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PLANNED_LOOKBACK_DAYS = 540;
const PLANNED_LOOKAHEAD_DAYS = 730;
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
    return { sigunguCd, bjdongCd: codeId.slice(5, 10), areaName };
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
    // cache misses are non-fatal
  }
}

async function geocodeAddress(address: string, ncpId: string, ncpSecret: string): Promise<{ lat: number; lng: number } | null> {
  const cached = getCachedCoord(address);
  if (cached) return cached;

  try {
    const url = `${NCP_GEOCODE_URL}?query=${encodeURIComponent(address)}`;
    const data = await fetchJson(url, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const addrs = data["addresses"] as Array<Record<string, string>> | undefined;
    if (!addrs?.[0]) return null;
    const lat = Number(addrs[0]["y"]);
    const lng = Number(addrs[0]["x"]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    setCachedCoord(address, lat, lng);
    return { lat, lng };
  } catch {
    return null;
  }
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

  while (page <= 5) {
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

async function searchApplyhomeComplexes(areaNames: readonly string[], serviceKey: string): Promise<ApplyhomeComplex[]> {
  const detailSpecs: Array<{ endpoint: string; kind: ApplyhomeKind; modelEndpoint: string }> = [
    { endpoint: "getAPTLttotPblancDetail", kind: "apartment", modelEndpoint: "getAPTLttotPblancMdl" },
    { endpoint: "getUrbtyOfctlLttotPblancDetail", kind: "officetel", modelEndpoint: "getUrbtyOfctlLttotPblancMdl" },
    { endpoint: "getPblPvtRentLttotPblancDetail", kind: "residential", modelEndpoint: "getPblPvtRentLttotPblancMdl" },
  ];
  const complexes = new Map<string, ApplyhomeComplex>();

  for (const areaName of areaNames) {
    for (const spec of detailSpecs) {
      const rows = await queryApplyhome(spec.endpoint, areaName, serviceKey);
      for (const row of rows) {
        const complex = rowToComplex(row, spec.kind);
        if (!complex) continue;
        const key = `${complex.houseManageNo}:${complex.pblancNo}:${normalizeName(complex.name)}`;
        if (!complexes.has(key)) {
          complex.housingTypes = await queryApplyhomeModels(spec.modelEndpoint, serviceKey, complex.houseManageNo, complex.pblancNo);
          complexes.set(key, complex);
        }
      }
    }
  }

  return [...complexes.values()];
}

async function queryLedgerEnhancementsForDong(sigunguCd: string, bjdongCd: string, encodedApiKey: string): Promise<LedgerEnhancement[]> {
  const cacheKey = `${sigunguCd}-${bjdongCd}`;
  const cached = ledgerDongCache.get(cacheKey);
  if (cached) return cached;

  const buildings: LedgerEnhancement[] = [];
  let page = 1;
  while (page <= 5) {
    const url = `${LEDGER_URL}?serviceKey=${encodedApiKey}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&numOfRows=100&pageNo=${page}`;
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

export async function searchPlannedResidential(centerLat: number, centerLng: number, radiusM: number): Promise<ResidentialPoi[]> {
  const apiKey = getDataGoKrApiKey();
  const ncpId = process.env.NCP_CLIENT_ID;
  const ncpSecret = process.env.NCP_CLIENT_SECRET;
  if (!apiKey || !ncpId || !ncpSecret) return [];

  const cacheKey = `${centerLat.toFixed(4)}:${centerLng.toFixed(4)}:${Math.round(radiusM)}`;
  const cached = plannedSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.pois;

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

  const pois: ResidentialPoi[] = [];
  for (const complex of complexes) {
    const coord = await geocodeAddress(complex.address, ncpId, ncpSecret);
    if (!coord) continue;
    const dist = haversine(centerLat, centerLng, coord.lat, coord.lng);
    if (dist > radiusM) continue;

    const region = await reverseGeocodeToRegion(coord.lat, coord.lng, ncpId, ncpSecret);
    const enhancements = region
      ? await queryLedgerEnhancementsForDong(region.sigunguCd, region.bjdongCd, encodedApiKey)
      : [];
    const enhancement = matchLedgerEnhancement(complex, enhancements);
    const floorplans = await buildFloorplans(complex);
    pois.push(complexToPoi(complex, coord, dist, enhancement, floorplans));
  }

  plannedSearchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, pois });
  return pois;
}

function isResidentialDuplicate(a: ResidentialPoi, b: ResidentialPoi): boolean {
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  const sameName = !!nameA && !!nameB && (nameA.includes(nameB) || nameB.includes(nameA));
  const near = haversine(a.lat, a.lng, b.lat, b.lng) <= 180;
  return near && (a.category === b.category || sameName);
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
    const idx = merged.findIndex((existing) => isResidentialDuplicate(existing, planned));
    if (idx >= 0) {
      merged[idx] = mergeResidential(merged[idx], planned);
    } else {
      merged.push(planned);
    }
  }
  return merged;
}
