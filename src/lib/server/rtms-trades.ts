import { haversineDistance } from "../geo";
import type { MaintenanceProject, Poi, RecentTradeSummary, ResidentialPoi } from "../types";
import { enrichApartments, type EnrichedAptData } from "./apt-enrichment";
import { getDb } from "./database";
import { parseJibunAddress } from "./maintenance/building-ledger";
import { resolveLegalDongCode } from "./maintenance-project-search";

/**
 * 국토부 아파트매매 실거래 상세(RTMSDataSvcAptTradeDev) 연동.
 * 시군구(LAWD_CD)·계약월(DEAL_YMD) 단위로 수집해 아파트 POI(이름 매칭)와
 * 정비구역(대표지번 매칭)에 최근 실거래 요약을 붙인다. 응답은 XML.
 */
const APT_TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";
const PAGE_ROWS = 1_000;
const MAX_PAGES = 3;
const RECENT_MONTH_TTL_SECONDS = 3 * 24 * 3_600;
const OLD_MONTH_TTL_SECONDS = 30 * 24 * 3_600;
export const RTMS_SUMMARY_MONTHS = 6;
/** 팝업 펼침 목록 상한 — 응답 페이로드가 비대해지지 않게 한다 */
const TRADE_DETAIL_LIMIT = 10;

export interface RtmsTrade {
  readonly apt_name: string;
  readonly dong: string;
  readonly jibun: string;
  /** 거래금액(만원) */
  readonly price_manwon: number;
  readonly area_sqm: number;
  readonly deal_date: string; // YYYY-MM-DD
  readonly floor?: number;
  readonly build_year?: number;
  /** 구조화 지번 코드 (집GPT 방식 — 텍스트 지번보다 견고) */
  readonly umd_cd?: string;
  readonly bonbun?: string;
  readonly bubun?: string;
}

function tagText(itemXml: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "u").exec(itemXml);
  return (match?.[1] ?? "").replaceAll("<![CDATA[", "").replaceAll("]]>", "").trim();
}

function tagNumber(itemXml: string, tag: string): number {
  const value = Number(tagText(itemXml, tag).replaceAll(",", ""));
  return Number.isFinite(value) ? value : 0;
}

export function parseRtmsTradePage(xml: string): { readonly trades: readonly RtmsTrade[]; readonly totalCount: number } {
  if (!/<response[\s>]/u.test(xml)) {
    throw new Error("RTMS 응답 형식 오류 (response 루트 없음)");
  }
  const resultCode = /<resultCode>\s*(\S+?)\s*<\/resultCode>/u.exec(xml)?.[1] ?? "";
  if (resultCode && resultCode !== "00" && resultCode !== "000") {
    const message = /<resultMsg>([\s\S]*?)<\/resultMsg>/u.exec(xml)?.[1]?.trim() ?? "";
    throw new Error(`RTMS 오류 ${resultCode} ${message}`.trim());
  }
  const trades: RtmsTrade[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gu)) {
    const item = match[1] ?? "";
    const aptName = tagText(item, "aptNm");
    const price = tagNumber(item, "dealAmount");
    if (!aptName || price <= 0) continue;
    const year = tagNumber(item, "dealYear");
    const month = tagNumber(item, "dealMonth");
    const day = tagNumber(item, "dealDay");
    if (year < 2000 || month < 1 || month > 12) continue;
    const floor = tagNumber(item, "floor");
    const buildYear = tagNumber(item, "buildYear");
    const umdCd = tagText(item, "umdCd");
    const bonbun = tagText(item, "bonbun");
    const bubun = tagText(item, "bubun");
    const jibunText = tagText(item, "jibun");
    trades.push({
      apt_name: aptName,
      dong: tagText(item, "umdNm"),
      jibun: jibunText || (/^\d+$/.test(bonbun) && Number(bonbun) > 0
        ? (Number(bubun) > 0 ? `${Number(bonbun)}-${Number(bubun)}` : String(Number(bonbun)))
        : ""),
      price_manwon: price,
      area_sqm: tagNumber(item, "excluUseAr"),
      deal_date: `${year}-${String(month).padStart(2, "0")}-${String(Math.max(day, 1)).padStart(2, "0")}`,
      ...(floor > 0 ? { floor } : {}),
      ...(buildYear > 1900 ? { build_year: buildYear } : {}),
      ...(umdCd ? { umd_cd: umdCd } : {}),
      ...(bonbun ? { bonbun } : {}),
      ...(bubun ? { bubun } : {}),
    });
  }
  const totalCount = tagNumber(xml, "totalCount");
  return { trades, totalCount: totalCount > 0 ? totalCount : trades.length };
}

export interface MonthlyTradesResult {
  readonly trades: readonly RtmsTrade[];
  /** 페이지 상한에 걸려 일부만 읽었으면 true — 조용한 과소 집계를 막기 위해 노출한다 */
  readonly truncated: boolean;
}

/** 요청 하나당 타임아웃 — 응답 없는 원천이 전체 검색을 잡아두지 않게 한다 */
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchMonthlyTrades(options: {
  readonly serviceKey: string;
  readonly lawdCd: string;
  readonly dealYm: string;
  /** 테스트 주입용 — 기본 global fetch (data.go.kr는 ky 기본 헤더에 NPE를 반환한다) */
  readonly fetchImpl?: typeof fetch;
  readonly maxPages?: number;
  readonly signal?: AbortSignal;
}): Promise<MonthlyTradesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? MAX_PAGES;
  const pageUrl = (pageNo: number) =>
    // data.go.kr는 serviceKey 인코딩에 민감 — URL을 직접 구성한다
    `${APT_TRADE_URL}?serviceKey=${encodeURIComponent(options.serviceKey)}`
    + `&LAWD_CD=${options.lawdCd}&DEAL_YMD=${options.dealYm}`
    + `&numOfRows=${PAGE_ROWS}&pageNo=${pageNo}`;

  const readPage = async (pageNo: number) => {
    const response = await fetchWithTimeout(pageUrl(pageNo), fetchImpl, options.signal);
    if (!response.ok) throw new Error(`RTMS HTTP ${response.status}`);
    return parseRtmsTradePage(await response.text());
  };

  const first = await readPage(1);
  const totalPages = Math.max(1, Math.ceil(first.totalCount / PAGE_ROWS));
  const readablePages = Math.min(totalPages, maxPages);
  if (readablePages === 1) {
    return { trades: first.trades, truncated: totalPages > maxPages };
  }

  // 남은 페이지는 동시에 — 월 6회 순차 호출이 체감 대기의 주범이었다
  const rest = await Promise.all(
    Array.from({ length: readablePages - 1 }, (_, index) => readPage(index + 2)),
  );
  return {
    trades: [first.trades, ...rest.map((page) => page.trades)].flat(),
    truncated: totalPages > maxPages,
  };
}

type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cachedMonth(cacheKey: string, maxAgeSeconds: number): readonly RtmsTrade[] | undefined {
  try {
    const row = getDb().prepare("SELECT value_json, created_at FROM building_ledger_cache WHERE cache_key = ?").get(cacheKey);
    if (!isObject(row) || typeof row.value_json !== "string" || typeof row.created_at !== "number") return undefined;
    if (Date.now() / 1_000 - row.created_at > maxAgeSeconds) return undefined;
    const parsed: unknown = JSON.parse(row.value_json);
    return Array.isArray(parsed) ? (parsed as readonly RtmsTrade[]) : undefined;
  } catch {
    return undefined;
  }
}

function storeMonth(cacheKey: string, trades: readonly RtmsTrade[]): void {
  try {
    getDb().prepare("INSERT OR REPLACE INTO building_ledger_cache (cache_key, value_json, created_at) VALUES (?, ?, ?)")
      .run(cacheKey, JSON.stringify(trades), Date.now() / 1_000);
  } catch {
  }
}

export function recentDealMonths(now: Date, months: number): readonly string[] {
  const list: string[] = [];
  for (let index = 0; index < months; index += 1) {
    const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    list.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return list;
}

function normalizeAptName(value: string): string {
  return value.normalize("NFKC").replaceAll(/\([^)]*\)/gu, "").replaceAll(/[^\p{L}\p{N}]/gu, "")
    .replaceAll(/아파트$/gu, "");
}

function jibunKey(dong: string, bun: string, ji: string): string {
  const suffix = ji && ji !== "0" ? `-${Number(ji)}` : "";
  return `${dong}|${Number(bun)}${suffix}`;
}

export function summarizeTrades(trades: readonly RtmsTrade[]): RecentTradeSummary | undefined {
  if (!trades.length) return undefined;
  const sorted = trades.toSorted((left, right) => right.deal_date.localeCompare(left.deal_date));
  const latest = sorted[0];
  if (!latest) return undefined;
  return {
    count: trades.length,
    months: RTMS_SUMMARY_MONTHS,
    latest_price_manwon: latest.price_manwon,
    latest_date: latest.deal_date,
    latest_area_sqm: latest.area_sqm,
    ...(latest.floor ? { latest_floor: latest.floor } : {}),
    max_price_manwon: Math.max(...trades.map((trade) => trade.price_manwon)),
    ...(trades.some((trade) => trade.build_year)
      ? { max_build_year: Math.max(...trades.map((trade) => trade.build_year ?? 0)) }
      : {}),
    recent_list: sorted.slice(0, TRADE_DETAIL_LIMIT).map((trade) => ({
      deal_date: trade.deal_date,
      price_manwon: trade.price_manwon,
      area_sqm: trade.area_sqm,
      ...(trade.floor ? { floor: trade.floor } : {}),
    })),
  };
}

export interface RtmsTradeIndex {
  readonly byName: ReadonlyMap<string, readonly RtmsTrade[]>;
  readonly byJibun: ReadonlyMap<string, readonly RtmsTrade[]>;
}

export function buildTradeIndex(trades: readonly RtmsTrade[]): RtmsTradeIndex {
  const byName = new Map<string, RtmsTrade[]>();
  const byJibun = new Map<string, RtmsTrade[]>();
  for (const trade of trades) {
    const nameKey = normalizeAptName(trade.apt_name);
    if (nameKey.length >= 2) {
      const list = byName.get(nameKey) ?? [];
      list.push(trade);
      byName.set(nameKey, list);
    }
    if (trade.dong && trade.jibun) {
      const [bun = "", ji = "0"] = trade.jibun.split("-");
      if (/^\d+$/.test(bun)) {
        const key = jibunKey(trade.dong, bun, ji || "0");
        const list = byJibun.get(key) ?? [];
        list.push(trade);
        byJibun.set(key, list);
      }
    }
  }
  return { byName, byJibun };
}

function residentialSummary(poi: ResidentialPoi, index: RtmsTradeIndex): RecentTradeSummary | undefined {
  if (poi.status === "planned") return undefined;
  const key = normalizeAptName(poi.name);
  if (key.length < 2) return undefined;
  return summarizeTrades(index.byName.get(key) ?? []);
}

function maintenanceSummary(project: MaintenanceProject, index: RtmsTradeIndex): RecentTradeSummary | undefined {
  const jibun = parseJibunAddress(project.address);
  if (!jibun) return undefined;
  return summarizeTrades(index.byJibun.get(jibunKey(jibun.dong, jibun.bun, jibun.ji)) ?? []);
}

function isResidentialPoi(poi: Poi): poi is ResidentialPoi {
  return poi.category === "apartment" || poi.category === "officetel" || poi.category === "residential";
}

// ─── 건축물대장 누락 신축 단지 보강 ──────────────────────────────────────────
// 건축HUB에 총괄·동별 표제부가 아직 없는 신축 대단지(예: 디에이치 퍼스티어 아이파크)가
// 있다 — 실거래에는 잡히므로 RTMS 그룹에서 지오코딩으로 아파트 POI를 합성한다.
const SYNTHETIC_MIN_BUILD_YEAR = 2015;
const SYNTHETIC_MAX_COMPLEXES = 10;
/** 시군구 전체 거래에서 뽑은 후보 중 지오코딩을 시도할 최대 수(반경 밖 다수 대비) */
const SYNTHETIC_MAX_GEOCODE_ATTEMPTS = 60;

export type NearbyGeocoder = (
  query: string,
  center: { readonly lat: number; readonly lng: number },
) => Promise<{ readonly lat: number; readonly lng: number } | null>;

function defaultNearbyGeocoder(): NearbyGeocoder {
  const id = process.env.NCP_CLIENT_ID?.trim();
  const secret = process.env.NCP_CLIENT_SECRET?.trim();
  if (!id || !secret) return async () => null;
  return async (query, center) => {
    try {
      const db = getDb();
      const cached = db.prepare("SELECT lat, lng FROM geocode_cache WHERE address = ?").get(query) as
        | { lat: number; lng: number } | undefined;
      if (cached) return cached;
      const url = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"
        + `?query=${encodeURIComponent(query)}&coordinate=${center.lng},${center.lat}`;
      const response = await fetch(url, {
        headers: { "X-NCP-APIGW-API-KEY-ID": id, "X-NCP-APIGW-API-KEY": secret },
      });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!isObject(data) || !Array.isArray(data.addresses) || !isObject(data.addresses[0])) return null;
      const lat = Number(data.addresses[0].y);
      const lng = Number(data.addresses[0].x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      db.prepare("INSERT OR REPLACE INTO geocode_cache (address, lat, lng, created_at) VALUES (?, ?, ?, ?)")
        .run(query, lat, lng, Date.now() / 1_000);
      return { lat, lng };
    } catch {
      return null;
    }
  };
}

/**
 * 네이버 지역검색으로 단지 장소를 찾는다 (집GPT 방식 — 아파트 카테고리 우선).
 * 지번 지오코딩보다 정확한 실제 단지 좌표·정식 명칭을 얻는다.
 */
export type ComplexPlaceResolver = (
  name: string,
  center: { readonly lat: number; readonly lng: number },
) => Promise<{ readonly lat: number; readonly lng: number } | null>;

function defaultComplexPlaceResolver(): ComplexPlaceResolver {
  const id = process.env.NAVER_CLIENT_ID?.trim();
  const secret = process.env.NAVER_CLIENT_SECRET?.trim();
  if (!id || !secret) return async () => null;
  return async (name) => {
    const cacheKey = `place:${name}`;
    try {
      const db = getDb();
      const cached = db.prepare("SELECT lat, lng FROM geocode_cache WHERE address = ?").get(cacheKey) as
        | { lat: number; lng: number } | undefined;
      if (cached) return cached;
      const response = await fetch(
        `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(name)}&display=5`,
        { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } },
      );
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!isObject(data) || !Array.isArray(data.items)) return null;
      const items = data.items.filter(isObject);
      const preferred = items.find((item) => String(item.category ?? "").includes("아파트")) ?? items[0];
      if (!preferred) return null;
      // mapx/mapy는 WGS84 × 1e7 정수
      const lng = Number(preferred.mapx) / 1e7;
      const lat = Number(preferred.mapy) / 1e7;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 33 || lat > 39) return null;
      db.prepare("INSERT OR REPLACE INTO geocode_cache (address, lat, lng, created_at) VALUES (?, ?, ?, ?)")
        .run(cacheKey, lat, lng, Date.now() / 1_000);
      return { lat, lng };
    } catch {
      return null;
    }
  };
}

/** 실거래에는 있는데 주거 POI에 없는 신축 단지를 합성한다 */
export async function synthesizeMissingComplexes(options: {
  readonly pois: readonly Poi[];
  readonly index: RtmsTradeIndex;
  readonly center: { readonly lat: number; readonly lng: number };
  readonly radiusM: number;
  readonly lawdCd: string;
  readonly geocode: NearbyGeocoder;
  /** 우선 시도할 장소검색 (기본: 네이버 지역검색) */
  readonly searchPlace?: ComplexPlaceResolver;
  /** 세대수 보강 (기본: 건축물대장·K-APT 이름 매칭) */
  readonly enrich?: (
    apartments: readonly { name: string; lat: number; lng: number }[],
  ) => Promise<Map<string, EnrichedAptData>>;
}): Promise<readonly ResidentialPoi[]> {
  const existingNames = new Set(
    options.pois.filter(isResidentialPoi).map((poi) => normalizeAptName(poi.name)).filter((key) => key.length >= 2),
  );
  const candidates = [...options.index.byName.entries()]
    .filter(([key, trades]) => {
      if (existingNames.has(key)) return false;
      const buildYear = Math.max(...trades.map((trade) => trade.build_year ?? 0));
      const sample = trades[0];
      return buildYear >= SYNTHETIC_MIN_BUILD_YEAR && !!sample?.dong && !!sample.jibun;
    })
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, SYNTHETIC_MAX_GEOCODE_ATTEMPTS);
  const synthesized: ResidentialPoi[] = [];
  const searchPlace = options.searchPlace ?? defaultComplexPlaceResolver();
  for (const [, trades] of candidates) {
    if (synthesized.length >= SYNTHETIC_MAX_COMPLEXES) break;
    const sample = trades[0];
    if (!sample) continue;
    // 장소검색(정확한 단지 좌표) 우선, 실패 시 지번 지오코딩 폴백
    let coords = await searchPlace(sample.apt_name, options.center);
    if (coords && haversineDistance(options.center.lat, options.center.lng, coords.lat, coords.lng) > options.radiusM) {
      coords = null; // 동명이단지 오매칭 방지 — 반경 밖이면 지번 폴백
    }
    coords ??= await options.geocode(`${sample.dong} ${sample.jibun}`, options.center);
    if (!coords) continue;
    const distance = haversineDistance(options.center.lat, options.center.lng, coords.lat, coords.lng);
    if (distance > options.radiusM) continue;
    const buildYear = Math.max(...trades.map((trade) => trade.build_year ?? 0));
    const summary = summarizeTrades(trades);
    synthesized.push({
      id: `rtms-${options.lawdCd}-${sample.dong}-${sample.jibun}`,
      name: sample.apt_name,
      lat: coords.lat,
      lng: coords.lng,
      category: "apartment",
      units: 0,
      parking_count: 0,
      sale_date: buildYear > 0 ? String(buildYear) : "",
      distance_m: Math.round(distance),
      status: "existing",
      source: "rtms",
      ...(summary ? { recent_trades: summary } : {}),
    });
  }
  if (!synthesized.length) return synthesized;
  // 세대수·주차 보강 — 건축물대장 이름 매칭 + K-APT 폴백 (집GPT 방식)
  try {
    const enriched = await (options.enrich ?? enrichApartments)(
      synthesized.map(({ name, lat, lng }) => ({ name, lat, lng })),
    );
    return synthesized.map((poi) => {
      const extra = enriched.get(poi.name);
      if (!extra) return poi;
      return {
        ...poi,
        ...(extra.units > 0 ? { units: extra.units } : {}),
        ...(extra.parking_count > 0 ? { parking_count: extra.parking_count } : {}),
        ...(extra.sale_date ? { sale_date: extra.sale_date } : {}),
      };
    });
  } catch {
    return synthesized;
  }
}

export interface AttachTradesResult {
  readonly pois: readonly Poi[];
  readonly status: "fresh" | "cached" | "failed";
  readonly fetchedAt: number | null;
  /** 페이지 상한으로 일부 거래만 읽었으면 true */
  readonly truncated?: boolean;
}

/** 반경 중심 시군구의 최근 6개월 실거래를 수집해 아파트·정비구역 POI에 요약을 붙인다 */
export async function attachRecentTrades(
  pois: readonly Poi[],
  center: { readonly lat: number; readonly lng: number },
  options: {
    readonly serviceKey?: string;
    readonly fetchImpl?: typeof fetch;
    readonly now?: Date;
    readonly resolveLawdCd?: (center: { readonly lat: number; readonly lng: number }) => Promise<string | null>;
    readonly signal?: AbortSignal;
    /** 지정 시 실거래에만 존재하는 신축 단지를 아파트 POI로 합성한다 */
    readonly radiusM?: number;
    readonly geocode?: NearbyGeocoder;
  } = {},
): Promise<AttachTradesResult> {
  const serviceKey = (options.serviceKey ?? process.env.DATA_GO_KR_API_KEY ?? "").trim();
  if (!serviceKey) return { pois, status: "failed", fetchedAt: null };
  const resolveLawd = options.resolveLawdCd
    ?? (async (value: { readonly lat: number; readonly lng: number }) => (await resolveLegalDongCode(value))?.slice(0, 5) ?? null);
  const lawdCd = await resolveLawd(center);
  if (!lawdCd) return { pois, status: "failed", fetchedAt: null };
  const months = recentDealMonths(options.now ?? new Date(), RTMS_SUMMARY_MONTHS);
  const trades: RtmsTrade[] = [];
  let anyFresh = false;
  let anyFailure = false;
  let anyTruncated = false;
  // 월별 수집은 서로 독립 — 순차 6회 호출이 체감 대기의 주범이었다
  const monthly = await Promise.all(months.map(async (dealYm, index) => {
    const cacheKey = `rtms:${lawdCd}:${dealYm}`;
    const ttl = index <= 1 ? RECENT_MONTH_TTL_SECONDS : OLD_MONTH_TTL_SECONDS;
    const cached = cachedMonth(cacheKey, ttl);
    if (cached) return { trades: cached, fresh: false, failed: false, truncated: false };
    try {
      const result = await fetchMonthlyTrades({
        serviceKey, lawdCd, dealYm,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      storeMonth(cacheKey, result.trades);
      return { trades: result.trades, fresh: true, failed: false, truncated: result.truncated };
    } catch {
      // 실패한 달은 만료 캐시라도 쓴다 — 요약이 통째로 비는 것보다 낫다
      const stale = cachedMonth(cacheKey, Number.POSITIVE_INFINITY);
      return { trades: stale ?? [], fresh: false, failed: true, truncated: false };
    }
  }));
  for (const month of monthly) {
    trades.push(...month.trades);
    if (month.fresh) anyFresh = true;
    if (month.failed) anyFailure = true;
    if (month.truncated) anyTruncated = true;
  }
  if (!trades.length && anyFailure) return { pois, status: "failed", fetchedAt: null };
  const index = buildTradeIndex(trades);
  const enhanced = pois.map((poi) => {
    if (isResidentialPoi(poi)) {
      const summary = residentialSummary(poi, index);
      return summary ? { ...poi, recent_trades: summary } : poi;
    }
    if (poi.category === "maintenance") {
      const summary = maintenanceSummary(poi, index);
      return summary ? { ...poi, recent_trades: summary } : poi;
    }
    return poi;
  });
  let synthesized: readonly ResidentialPoi[] = [];
  if (options.radiusM && options.radiusM > 0) {
    try {
      synthesized = await synthesizeMissingComplexes({
        pois, index, center, lawdCd,
        radiusM: options.radiusM,
        geocode: options.geocode ?? defaultNearbyGeocoder(),
      });
    } catch {
    }
  }
  return {
    pois: [...enhanced, ...synthesized],
    status: anyFresh ? "fresh" : "cached",
    fetchedAt: Date.now(),
    truncated: anyTruncated,
  };
}
