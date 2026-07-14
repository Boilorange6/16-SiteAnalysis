/**
 * 주거시설 정보 보강 — 건축물대장 법정동 전체 조회 + K-APT 보조 + SQLite 캐시.
 *
 * 흐름:
 *   1. SQLite 영구 캐시 (30일 TTL)
 *   2. NCP 역지오코딩 → sigunguCd + bjdongCd
 *   3. 건축물대장 법정동 전체 조회 → 이름 매칭 사전 → OSM 이름 매칭
 *   4. K-APT API (보조) — 건축물대장에서 못 찾은 것
 *
 * 필요 env: DATA_GO_KR_API_KEY, NCP_CLIENT_ID, NCP_CLIENT_SECRET
 * 선택 env: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (K-APT fallback용)
 */

import { getDb } from "./database";

const LEDGER_URL =
  "https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo";
const LIST_URL =
  "https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3";
const INFO_URL =
  "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4";
const DETAIL_URL =
  "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusDtlInfoV4";
const NAVER_SEARCH_URL =
  "https://openapi.naver.com/v1/search/local.json";
const NCP_REVERSE_GEO_URL =
  "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";

const API_TIMEOUT_MS = 20_000;
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const PAGE_SIZE = 500;
const DONG_PREFIX_RE = /^[가-힣]+[동읍면리가]/;
const JUNK_NAME_RE = /^[A-Za-z가-힣]?동$|^\d{1,4}동?$/;
const RESIDENTIAL_SUFFIX_RE = /\s*(아파트단지|주공아파트|임대아파트|아파트|빌라트|주상복합|스튜디오|오피스텔)\s*$/;

export interface EnrichedAptData {
  readonly units: number;
  readonly parking_count: number;
  readonly sale_date: string;
}

/**
 * K-APT 기본정보(BASS)+상세정보(DTL)에서 뽑는 단지 상세 필드.
 * 주의: BASS의 kaptdaCnt는 주차대수가 아니라 세대수와 동일 값(2026-07-14 실측) —
 * 실제 주차는 DTL의 kaptdPcnt(지상)+kaptdPcntu(지하)를 쓴다.
 */
export interface KaptExtras {
  readonly top_floor: number;
  readonly dong_count: number;
  readonly constructor_name: string;
  /** 부대복리시설 목록 원문 (쉼표 구분, 없으면 "") */
  readonly welfare_facilities: string;
  /** 지상+지하 주차대수 합 */
  readonly parking_total: number;
  /** 사용승인일 YYYY-MM (kaptUsedate) */
  readonly use_date: string;
}

// ─── SQLite 영구 캐시 ─────────────────────────────────────────────────────────

function getCached(name: string): EnrichedAptData | null {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT units, parking_count, sale_date FROM apt_enrichment_cache WHERE cache_key = ? AND created_at > ?")
      .get(name, Date.now() / 1000 - CACHE_TTL_SECONDS) as { units: number; parking_count: number; sale_date: string } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function setCache(name: string, data: EnrichedAptData, source: string): void {
  try {
    const db = getDb();
    db.prepare(
      "INSERT OR REPLACE INTO apt_enrichment_cache (cache_key, units, parking_count, sale_date, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(name, data.units, data.parking_count, data.sale_date, source, Date.now() / 1000);
  } catch { /* non-fatal */ }
}

function getCachedExtras(name: string): KaptExtras | null {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT top_floor, dong_count, constructor_name, welfare_facilities, parking_total, use_date FROM kapt_extras_cache WHERE cache_key = ? AND created_at > ?")
      .get(name, Date.now() / 1000 - CACHE_TTL_SECONDS) as
        { top_floor: number; dong_count: number; constructor_name: string; welfare_facilities: string; parking_total: number; use_date: string } | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function setCachedExtras(name: string, data: KaptExtras): void {
  try {
    const db = getDb();
    db.prepare(
      "INSERT OR REPLACE INTO kapt_extras_cache (cache_key, top_floor, dong_count, constructor_name, welfare_facilities, parking_total, use_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(name, data.top_floor, data.dong_count, data.constructor_name, data.welfare_facilities, data.parking_total, data.use_date, Date.now() / 1000);
  } catch { /* non-fatal */ }
}

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

function encodeApiKey(key: string): string {
  const raw = key.includes("%") ? decodeURIComponent(key) : key;
  return encodeURIComponent(raw);
}

function normalize(name: string): string {
  return name.replace(/[\s\-·]/g, "").toLowerCase();
}

function stripSuffix(name: string): string {
  return name.replace(RESIDENTIAL_SUFFIX_RE, "").trim();
}

function stripDongPrefix(name: string): string {
  const stripped = name.replace(DONG_PREFIX_RE, "").trim();
  return stripped || name;
}

async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response> {
  return fetch(url, { headers: { ...headers }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(url, { Accept: "application/json", ...headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchXml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url);
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

// ─── NCP 역지오코딩 ───────────────────────────────────────────────────────────

interface GeoResult {
  sigunguCd: string; // 5자리
  bjdongCd: string;  // 5자리
  dong: string;      // 법정동 이름
}

async function reverseGeocode(
  lat: number, lng: number, ncpId: string, ncpSecret: string,
): Promise<GeoResult | null> {
  const url = `${NCP_REVERSE_GEO_URL}?coords=${lng},${lat}&output=json&orders=legalcode`;
  try {
    const data = await fetchJson(url, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const results = data["results"] as Array<Record<string, unknown>> | undefined;
    const first = results?.[0];
    if (!first) return null;
    const codeId = String((first["code"] as Record<string, unknown> | undefined)?.["id"] ?? "");
    if (codeId.length < 10) return null;
    const region = first["region"] as Record<string, Record<string, unknown>> | undefined;
    const dong = String(region?.["area3"]?.["name"] ?? "");
    return { sigunguCd: codeId.slice(0, 5), bjdongCd: codeId.slice(5, 10), dong };
  } catch {
    return null;
  }
}

// ─── 건축물대장 법정동 전체 조회 + 이름 매칭 ──────────────────────────────────

interface LedgerEntry {
  readonly bldNm: string;
  readonly units: number;
  readonly parking: number;
  readonly useAprDay: string;
}

const ledgerDongCache = new Map<string, { entries: LedgerEntry[]; ts: number }>();
const LEDGER_DONG_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_LEDGER_DONG_CACHE = 50;

async function getLedgerEntriesForDong(
  sigunguCd: string, bjdongCd: string, encodedApiKey: string,
): Promise<LedgerEntry[]> {
  const cacheKey = `${sigunguCd}-${bjdongCd}`;
  const cached = ledgerDongCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LEDGER_DONG_CACHE_TTL_MS) return cached.entries;

  const entries: LedgerEntry[] = [];
  let page = 1;
  while (true) {
    const url = `${LEDGER_URL}?serviceKey=${encodedApiKey}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&numOfRows=100&pageNo=${page}`;
    try {
      const xml = await fetchXml(url);
      const items = parseXmlItems(xml);
      if (items.length === 0) break;
      for (const it of items) {
        const bldNm = it["bldNm"] ?? "";
        if (!bldNm) continue;
        const units = parseInt(it["hhldCnt"] ?? "0", 10) || 0;
        const parking = parseInt(it["totPkngCnt"] ?? "0", 10) || 0;
        const useAprDay = it["useAprDay"] ?? "";
        if (units > 0 || parking > 0) {
          entries.push({ bldNm, units, parking, useAprDay });
        }
      }
      const total = parseInt(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] ?? "0", 10);
      if (page * 100 >= total) break;
      page += 1;
    } catch { break; }
  }

  if (ledgerDongCache.size >= MAX_LEDGER_DONG_CACHE) {
    const oldest = ledgerDongCache.keys().next().value;
    if (oldest) ledgerDongCache.delete(oldest);
  }
  ledgerDongCache.set(cacheKey, { entries, ts: Date.now() });
  return entries;
}

function matchLedgerByName(aptName: string, entries: LedgerEntry[]): EnrichedAptData | null {
  const stripped = stripSuffix(aptName);
  const normOsm = normalize(stripped);
  const normOsmFull = normalize(aptName);

  // Pass 1: exact normalized match
  for (const e of entries) {
    const normLedger = normalize(e.bldNm);
    if (normLedger === normOsm || normLedger === normOsmFull) {
      return toLedgerData(e);
    }
  }

  // Pass 2: substring match (4+ chars)
  if (normOsm.length >= 4) {
    for (const e of entries) {
      const normLedger = normalize(e.bldNm);
      if (normLedger.length < 4) continue;
      if (normOsm.includes(normLedger) || normLedger.includes(normOsm)) {
        return toLedgerData(e);
      }
    }
  }

  // Pass 3: stripped prefix match
  const normNoPrefix = normalize(stripDongPrefix(stripped));
  if (normNoPrefix !== normOsm && normNoPrefix.length >= 4) {
    for (const e of entries) {
      const normLedger = normalize(e.bldNm);
      if (normLedger.includes(normNoPrefix) || normNoPrefix.includes(normLedger)) {
        return toLedgerData(e);
      }
    }
  }

  return null;
}

function toLedgerData(e: LedgerEntry): EnrichedAptData {
  const raw = e.useAprDay;
  let saleDate = "";
  if (raw.length >= 6) saleDate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  else if (raw.length === 4) saleDate = raw;
  return { units: e.units, parking_count: e.parking, sale_date: saleDate };
}

// ─── K-APT API (보조) ─────────────────────────────────────────────────────────

const sigunguMapCache = new Map<string, { map: Map<string, string>; ts: number }>();
const MAX_SIGUNGU_CACHE = 100;
const KAPT_CACHE_TTL_MS = 60 * 60 * 1000;

async function buildKaptNameMap(sigunguCode: string, encodedApiKey: string): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  let page = 1;
  while (true) {
    const url = `${LIST_URL}?serviceKey=${encodedApiKey}&sigunguCode=${encodeURIComponent(sigunguCode)}&pageNo=${page}&numOfRows=${PAGE_SIZE}&_type=json`;
    try {
      const data = await fetchJson(url);
      const body = ((data["response"] as Record<string, unknown>)?.["body"] as Record<string, unknown>) ?? {};
      let items = body["items"] as unknown;
      if (!items) break;
      if (!Array.isArray(items)) items = [items];
      for (const item of items as Array<Record<string, unknown>>) {
        const kaptCode = String(item["kaptCode"] ?? "");
        const kaptName = String(item["kaptName"] ?? "");
        const dong = String(item["as3"] ?? "");
        if (!kaptCode || !kaptName) continue;
        const norm = normalize(kaptName);
        const normNoPrefix = normalize(stripDongPrefix(kaptName));
        mapping.set(`${dong}|${norm}`, kaptCode);
        if (normNoPrefix !== norm) mapping.set(`${dong}|${normNoPrefix}`, kaptCode);
        if (!mapping.has(`|${norm}`)) mapping.set(`|${norm}`, kaptCode);
        if (normNoPrefix !== norm && !mapping.has(`|${normNoPrefix}`)) mapping.set(`|${normNoPrefix}`, kaptCode);
      }
      const total = Number(body["totalCount"] ?? 0);
      if (page * PAGE_SIZE >= total) break;
      page += 1;
    } catch { break; }
  }
  return mapping;
}

function findKaptCode(aptName: string, dong: string, nameMap: Map<string, string>): string | null {
  const stripped = stripSuffix(aptName);
  const candidates = stripped !== aptName ? [aptName, stripped] : [aptName];
  for (const candidate of candidates) {
    const norm = normalize(candidate);
    const normNoNum = norm.replace(/\d+$/, "");
    const normNoPrefix = normalize(stripDongPrefix(candidate));
    for (const k of new Set([norm, normNoNum, normNoPrefix])) {
      if (!k) continue;
      if (dong) { const m = nameMap.get(`${dong}|${k}`); if (m) return m; }
      const f = nameMap.get(`|${k}`); if (f) return f;
    }
  }
  // Partial substring match
  const normOsm = normalize(stripSuffix(aptName));
  if (normOsm.length >= 4) {
    if (dong) {
      for (const [key, code] of nameMap) {
        const [kd, kn] = key.split("|", 2);
        if (kd !== dong || !kn || kn.length < 4) continue;
        if (normOsm.includes(kn) || kn.includes(normOsm)) return code;
      }
    }
    for (const [key, code] of nameMap) {
      const [, kn] = key.split("|", 2);
      if (!kn || kn.length < 4) continue;
      if (normOsm.includes(kn) || kn.includes(normOsm)) return code;
    }
  }
  return null;
}

async function fetchKaptItem(url: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await fetchJson(url);
    const body = ((data["response"] as Record<string, unknown>)?.["body"] as Record<string, unknown>) ?? {};
    let item = body["item"] as Record<string, unknown> | undefined;
    if (Array.isArray(item)) item = item[0] as Record<string, unknown>;
    return item ?? null;
  } catch {
    return null;
  }
}

/** null/"None"/"null" 방어 — K-APT는 빈 값을 문자열 "None"으로 주기도 한다(2026-07-14 실측). */
function kaptText(v: unknown): string {
  const s = String(v ?? "").trim();
  return s === "None" || s === "null" ? "" : s;
}

/** K-APT 기본정보+상세정보를 병렬 조회해 단지 상세 필드로 정규화. */
async function fetchKaptFull(kaptCode: string, encodedApiKey: string): Promise<{ units: number; extras: KaptExtras }> {
  const code = encodeURIComponent(kaptCode);
  const [bass, dtl] = await Promise.all([
    fetchKaptItem(`${INFO_URL}?serviceKey=${encodedApiKey}&kaptCode=${code}&_type=json`),
    fetchKaptItem(`${DETAIL_URL}?serviceKey=${encodedApiKey}&kaptCode=${code}&_type=json`),
  ]);
  const units = parseInt(String(bass?.["hoCnt"] ?? "0"), 10) || 0;
  const rawUse = kaptText(bass?.["kaptUsedate"]);
  let useDate = "";
  if (rawUse.length >= 6) useDate = rawUse.includes("-") ? rawUse.slice(0, 7) : `${rawUse.slice(0, 4)}-${rawUse.slice(4, 6)}`;
  else if (rawUse.length === 4) useDate = rawUse;
  const parkingGround = parseInt(String(dtl?.["kaptdPcnt"] ?? "0"), 10) || 0;
  const parkingUnder = parseInt(String(dtl?.["kaptdPcntu"] ?? "0"), 10) || 0;
  return {
    units,
    extras: {
      top_floor: parseInt(String(bass?.["kaptTopFloor"] ?? "0"), 10) || 0,
      dong_count: parseInt(String(bass?.["kaptDongCnt"] ?? "0"), 10) || 0,
      constructor_name: kaptText(bass?.["kaptBcompany"]),
      welfare_facilities: kaptText(dtl?.["welfareFacility"]),
      parking_total: parkingGround + parkingUnder,
      use_date: useDate,
    },
  };
}

async function fetchKaptInfo(kaptCode: string, encodedApiKey: string): Promise<EnrichedAptData> {
  const { units, extras } = await fetchKaptFull(kaptCode, encodedApiKey);
  return { units, parking_count: extras.parking_total, sale_date: extras.use_date };
}

// ─── 통합 보강 (공개 API) ─────────────────────────────────────────────────────

export async function enrichApartments(
  apartments: readonly { name: string; lat: number; lng: number }[],
): Promise<Map<string, EnrichedAptData>> {
  const result = new Map<string, EnrichedAptData>();
  if (apartments.length === 0) return result;

  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) return result;

  const encodedApiKey = encodeApiKey(apiKey);
  const ncpId = process.env.NCP_CLIENT_ID ?? "";
  const ncpSecret = process.env.NCP_CLIENT_SECRET ?? "";
  const naverId = process.env.NAVER_CLIENT_ID ?? "";
  const naverSecret = process.env.NAVER_CLIENT_SECRET ?? "";

  // Filter junk names
  const validApts = apartments.filter(a => !JUNK_NAME_RE.test(a.name));

  // ── Phase 0: SQLite 캐시 ───────────────────────────────────────────────────
  const uncached: { name: string; lat: number; lng: number }[] = [];
  for (const apt of validApts) {
    const cached = getCached(apt.name);
    if (cached) {
      result.set(apt.name, cached);
    } else {
      uncached.push(apt);
    }
  }
  console.log(`[enrich] ${validApts.length} valid, ${result.size} cached, ${uncached.length} uncached`);
  if (uncached.length === 0) return result;

  // ── Phase 1: 건축물대장 법정동 전체 조회 + 이름 매칭 ───────────────────────
  if (ncpId && ncpSecret) {
    // 역지오코딩 (병렬)
    const geoResults = await Promise.all(
      uncached.map(apt => reverseGeocode(apt.lat, apt.lng, ncpId, ncpSecret))
    );

    // 법정동별 그룹화
    type AptWithGeo = { name: string; geo: GeoResult };
    const byDong = new Map<string, AptWithGeo[]>();
    for (let i = 0; i < uncached.length; i++) {
      const geo = geoResults[i];
      if (!geo) continue;
      const key = `${geo.sigunguCd}-${geo.bjdongCd}`;
      if (!byDong.has(key)) byDong.set(key, []);
      byDong.get(key)!.push({ name: uncached[i].name, geo });
    }

    // 법정동별 건축물대장 조회 + 이름 매칭 (병렬)
    const dongEntries = [...byDong.entries()];
    const ledgerResults = await Promise.all(
      dongEntries.map(([, apts]) =>
        getLedgerEntriesForDong(apts[0].geo.sigunguCd, apts[0].geo.bjdongCd, encodedApiKey)
      )
    );

    for (let i = 0; i < dongEntries.length; i++) {
      const [, apts] = dongEntries[i];
      const entries = ledgerResults[i];
      if (entries.length === 0) continue;
      for (const apt of apts) {
        if (result.has(apt.name)) continue;
        const data = matchLedgerByName(apt.name, entries);
        if (data) {
          result.set(apt.name, data);
          setCache(apt.name, data, "building_ledger");
        }
      }
    }
  }

  // ── Phase 2: K-APT 보조 (건축물대장에서 못 찾은 것) ────────────────────────
  const stillMissing = uncached.filter(a => !result.has(a.name));
  if (stillMissing.length > 0) {
    await enrichViaKapt(stillMissing, encodedApiKey, ncpId, ncpSecret, naverId, naverSecret, result);
  }

  console.log(`[enrich] Final: ${result.size}/${validApts.length} enriched`);
  return result;
}

// ─── K-APT 보조 로직 ─────────────────────────────────────────────────────────

async function enrichViaKapt(
  apartments: readonly { name: string; lat: number; lng: number }[],
  encodedApiKey: string,
  ncpId: string, ncpSecret: string,
  naverId: string, naverSecret: string,
  result: Map<string, EnrichedAptData>,
): Promise<void> {
  if (apartments.length === 0) return;

  type AptWithGeo = { name: string; sigunguCode: string; dong: string };
  let aptsWithGeo: AptWithGeo[];

  if (ncpId && ncpSecret) {
    const geoResults = await Promise.all(
      apartments.map(apt => reverseGeocode(apt.lat, apt.lng, ncpId, ncpSecret))
    );
    aptsWithGeo = apartments
      .map((apt, i) => ({ name: apt.name, sigunguCode: geoResults[i]?.sigunguCd ?? "", dong: geoResults[i]?.dong ?? "" }))
      .filter(a => a.sigunguCode !== "");
  } else if (naverId && naverSecret) {
    const firstCode = await getSigunguCodeByName(apartments.map(a => a.name), naverId, naverSecret);
    if (!firstCode) return;
    aptsWithGeo = apartments.map(apt => ({ name: apt.name, sigunguCode: firstCode, dong: "" }));
  } else {
    return;
  }

  if (aptsWithGeo.length === 0) return;

  const byCode = new Map<string, AptWithGeo[]>();
  for (const apt of aptsWithGeo) {
    if (!byCode.has(apt.sigunguCode)) byCode.set(apt.sigunguCode, []);
    byCode.get(apt.sigunguCode)!.push(apt);
  }

  const codeEntries = [...byCode.entries()];
  const nameMaps = await Promise.all(
    codeEntries.map(([code]) => {
      const cached = sigunguMapCache.get(code);
      if (cached && Date.now() - cached.ts < KAPT_CACHE_TTL_MS) return Promise.resolve(cached.map);
      return buildKaptNameMap(code, encodedApiKey).then(map => {
        if (sigunguMapCache.size >= MAX_SIGUNGU_CACHE) {
          const oldest = sigunguMapCache.keys().next().value;
          if (oldest) sigunguMapCache.delete(oldest);
        }
        sigunguMapCache.set(code, { map, ts: Date.now() });
        return map;
      });
    })
  );

  for (let i = 0; i < codeEntries.length; i++) {
    const [, apts] = codeEntries[i];
    const nameMap = nameMaps[i];
    if (nameMap.size === 0) continue;

    const kaptCodeByName = new Map<string, string>();
    for (const apt of apts) {
      if (result.has(apt.name)) continue;
      const kaptCode = findKaptCode(apt.name, apt.dong, nameMap);
      if (kaptCode) kaptCodeByName.set(apt.name, kaptCode);
    }
    if (kaptCodeByName.size === 0) continue;

    const entries = [...kaptCodeByName.entries()];
    const infos = await Promise.all(entries.map(([, code]) => fetchKaptInfo(code, encodedApiKey)));

    for (let j = 0; j < entries.length; j++) {
      const [name] = entries[j];
      const info = infos[j];
      if (info.units > 0 || info.parking_count > 0 || info.sale_date) {
        result.set(name, info);
        setCache(name, info, "kapt");
      }
    }
  }
}

// ─── K-APT 단지 상세 보강 (공개 API) ─────────────────────────────────────────

/**
 * 이름 매칭으로 K-APT 단지 상세(최고층수/동수/시공사/부대시설/실주차/사용승인일)를 조회.
 * 시군구 이름 사전은 1시간 메모리 캐시, 단지별 결과는 SQLite 30일 캐시.
 * 매칭 실패 단지는 결과 Map에 없음(호출 비용도 없음).
 */
export async function enrichKaptExtras(
  apts: readonly { name: string; sigunguCode: string; dong?: string }[],
): Promise<Map<string, KaptExtras>> {
  const result = new Map<string, KaptExtras>();
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey || apts.length === 0) return result;
  const encodedApiKey = encodeApiKey(apiKey);

  const uncached: typeof apts[number][] = [];
  for (const apt of apts) {
    if (result.has(apt.name)) continue;
    const cached = getCachedExtras(apt.name);
    if (cached) result.set(apt.name, cached);
    else uncached.push(apt);
  }
  if (uncached.length === 0) return result;

  const byCode = new Map<string, typeof apts[number][]>();
  for (const apt of uncached) {
    if (!apt.sigunguCode) continue;
    if (!byCode.has(apt.sigunguCode)) byCode.set(apt.sigunguCode, []);
    byCode.get(apt.sigunguCode)!.push(apt);
  }

  for (const [code, group] of byCode) {
    let nameMap: Map<string, string>;
    const cached = sigunguMapCache.get(code);
    if (cached && Date.now() - cached.ts < KAPT_CACHE_TTL_MS) {
      nameMap = cached.map;
    } else {
      nameMap = await buildKaptNameMap(code, encodedApiKey);
      if (sigunguMapCache.size >= MAX_SIGUNGU_CACHE) {
        const oldest = sigunguMapCache.keys().next().value;
        if (oldest) sigunguMapCache.delete(oldest);
      }
      sigunguMapCache.set(code, { map: nameMap, ts: Date.now() });
    }
    if (nameMap.size === 0) continue;

    const matched: Array<{ name: string; kaptCode: string }> = [];
    for (const apt of group) {
      const kaptCode = findKaptCode(apt.name, apt.dong ?? "", nameMap);
      if (kaptCode) matched.push({ name: apt.name, kaptCode });
    }
    if (matched.length === 0) continue;

    const fulls = await Promise.all(matched.map(m => fetchKaptFull(m.kaptCode, encodedApiKey)));
    for (let i = 0; i < matched.length; i++) {
      const extras = fulls[i].extras;
      const hasData = extras.top_floor > 0 || extras.dong_count > 0 || extras.constructor_name !== "" ||
        extras.welfare_facilities !== "" || extras.parking_total > 0 || extras.use_date !== "";
      if (!hasData) continue;
      result.set(matched[i].name, extras);
      setCachedExtras(matched[i].name, extras);
    }
  }
  return result;
}

async function getSigunguCodeByName(aptNames: readonly string[], naverId: string, naverSecret: string): Promise<string | null> {
  const SIDO_ALIAS: Record<string, string> = {
    "서울특별시": "11", "경기도": "41", "인천광역시": "28", "부산광역시": "26",
    "대구광역시": "27", "대전광역시": "30", "광주광역시": "29", "울산광역시": "31",
    "세종특별자치시": "36",
  };
  const SIGUNGU_CODES: Record<string, Record<string, string>> = {
    "11": { 종로구: "11110", 중구: "11140", 용산구: "11170", 성동구: "11200", 광진구: "11215", 동대문구: "11230", 중랑구: "11260", 성북구: "11290", 강북구: "11305", 도봉구: "11320", 노원구: "11350", 은평구: "11380", 서대문구: "11410", 마포구: "11440", 양천구: "11470", 강서구: "11500", 구로구: "11530", 금천구: "11545", 영등포구: "11560", 동작구: "11590", 관악구: "11620", 서초구: "11650", 강남구: "11680", 송파구: "11710", 강동구: "11740" },
    "41": { 성남시분당구: "41135", 고양시덕양구: "41281", 고양시일산동구: "41285", 수원시영통구: "41117", 용인시수지구: "41465", 화성시: "41590" },
  };
  for (const name of aptNames.slice(0, 5)) {
    const url = `${NAVER_SEARCH_URL}?query=${encodeURIComponent(name + " 아파트")}&display=1`;
    try {
      const data = await fetchJson(url, { "X-Naver-Client-Id": naverId, "X-Naver-Client-Secret": naverSecret });
      const items = data["items"] as Array<Record<string, unknown>> | undefined;
      const address = String(items?.[0]?.["address"] ?? "");
      const parts = address.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const sidoCode = SIDO_ALIAS[parts[0]];
      if (!sidoCode) continue;
      const guCodes = SIGUNGU_CODES[sidoCode];
      if (!guCodes) continue;
      if (guCodes[parts[1]]) return guCodes[parts[1]];
    } catch { /* next */ }
  }
  return null;
}
