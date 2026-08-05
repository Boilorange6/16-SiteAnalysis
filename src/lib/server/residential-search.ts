/**
 * 건축물대장 기반 주거시설 검색.
 *
 * OSM 대신 건축물대장 총괄표제부를 데이터 소스로 사용하여
 * 아파트/오피스텔/기타주거 POI를 반환합니다.
 *
 * 흐름:
 *   1. NCP 역지오코딩 → 반경 내 법정동 목록
 *   2. 법정동별 건축물대장 전체 조회 → 공동주택 필터
 *   3. NCP 지오코딩 → 좌표 변환 (SQLite 캐시)
 *   4. 반경 필터링 → POI 반환
 *
 * 필요 env: DATA_GO_KR_API_KEY, NCP_CLIENT_ID, NCP_CLIENT_SECRET
 */

import { getDb } from "./database";
import { enrichKaptExtras } from "./apt-enrichment";
import { buildLedgerUrl, buildLedgerTitleUrl, LEDGER_PAGE_SIZE } from "./ledger-url";
import { readOfficetelFromTitleRow } from "./residential/officetel";
import { isRecentMiss, readGeocode, readLegalCode, recordGeocodeMiss, writeGeocode, writeLegalCode } from "./geocode-cache";
import { readLedgerDong, readLedgerRowsByPurpose, upsertLedgerDong, type LedgerRow, type LedgerPurpose } from "./ledger-store";
import { buildingDedupeKey, sampleDongPoints } from "./residential/complex-identity";
import type { Apartment, Officetel, ResidentialOther, ResidentialPoi } from "../types";

const NCP_REVERSE_GEO_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const NCP_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

const API_TIMEOUT_MS = 20_000;

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

function encodeApiKey(key: string): string {
  const raw = key.includes("%") ? decodeURIComponent(key) : key;
  return encodeURIComponent(raw);
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

// ─── NCP 역지오코딩 → 법정동 목록 ────────────────────────────────────────────

interface DongCode {
  sigunguCd: string;
  bjdongCd: string;
}

async function reverseGeocodeToDong(
  lat: number, lng: number, ncpId: string, ncpSecret: string,
): Promise<DongCode | null> {
  try {
    const cached = readLegalCode(getDb(), lat, lng);
    if (cached) return { sigunguCd: cached.sigunguCd, bjdongCd: cached.bjdongCd };
  } catch { /* 캐시 실패는 조회를 막지 않는다 */ }

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
    const dong = { sigunguCd: codeId.slice(0, 5), bjdongCd: codeId.slice(5, 10) };
    try {
      writeLegalCode(getDb(), lat, lng, { ...dong, areaName: "" }, Date.now());
    } catch { /* non-fatal */ }
    return dong;
  } catch {
    return null;
  }
}

/** 반경 내 법정동 목록을 수집 (중심 + 8방향 샘플링) */
async function findDongsInRadius(
  centerLat: number, centerLng: number, radiusM: number,
  ncpId: string, ncpSecret: string,
): Promise<DongCode[]> {
  // cos(위도) 보정 + 반경별 링 밀도 — complex-identity.ts 참조
  const points = sampleDongPoints(centerLat, centerLng, radiusM);

  const results = await Promise.all(
    points.map(({ lat, lng }) => reverseGeocodeToDong(lat, lng, ncpId, ncpSecret))
  );

  const seen = new Set<string>();
  const dongs: DongCode[] = [];
  for (const r of results) {
    if (!r) continue;
    const key = `${r.sigunguCd}-${r.bjdongCd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dongs.push(r);
  }
  return dongs;
}

// ─── 건축물대장 법정동 전체 조회 ──────────────────────────────────────────────

interface LedgerBuilding {
  bldNm: string;
  platPlc: string; // 지번 주소
  units: number;
  parking: number;
  maxFloor: number;
  useAprDay: string;
  sigunguCd: string;
  bjdongCd: string;
  bun: string;
  ji: string;
}

async function queryLedgerForDong(
  sigunguCd: string, bjdongCd: string, encodedApiKey: string,
): Promise<LedgerBuilding[]> {
  const buildings: LedgerBuilding[] = [];
  let page = 1;
  while (true) {
    const url = buildLedgerUrl({ sigunguCd, bjdongCd, pageNo: page, encodedApiKey });
    try {
      const xml = await fetchXml(url);
      const items = parseXmlItems(xml);
      if (items.length === 0) break;
      for (const it of items) {
        const purps = it["mainPurpsCdNm"] ?? "";
        if (purps !== "공동주택") continue;
        const bldNm = it["bldNm"] ?? "";
        if (!bldNm) continue;
        const units = parseInt(it["hhldCnt"] ?? "0", 10) || 0;
        if (units === 0) continue; // skip buildings without unit data
        buildings.push({
          bldNm,
          platPlc: (it["platPlc"] ?? "").replace(/번지$/, "").trim(),
          units,
          parking: parseInt(it["totPkngCnt"] ?? "0", 10) || 0,
          maxFloor: parseInt(it["grndFlrCnt"] ?? "0", 10) || 0,
          useAprDay: it["useAprDay"] ?? "",
          sigunguCd,
          bjdongCd,
          bun: it["bun"] ?? "",
          ji: it["ji"] ?? "",
        });
      }
      const total = parseInt(xml.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] ?? "0", 10);
      if (page * 100 >= total) break;
      page += 1;
    } catch { break; }
  }
  return buildings;
}

/**
 * 표제부 페이지 동시 조회 수.
 *
 * 1이다. 6으로 올려 봤더니 상류가 50페이지 중 33~37페이지를 끊었고 오피스텔이
 * 조용히 사라졌다(역삼동 7건 → 0건). 콜드 조회 3~4초를 아끼자고 데이터를
 * 잃을 수는 없다. 어차피 법정동당 30일에 한 번이다.
 */
const OFFICETEL_PAGE_CONCURRENCY = 1;
/** 폭주 방지 상한. 국내 최대 밀집 법정동(역삼동)이 50페이지다. */
const OFFICETEL_MAX_PAGES = 80;
/** 상류가 동시 요청을 간헐적으로 끊는다 — 조용한 누락보다 재시도가 싸다 */
const OFFICETEL_PAGE_RETRIES = 3;

/** 표제부를 다 못 읽었다는 신호. 부분 결과를 캐시에 굳히지 않으려고 던진다. */
class IncompleteOfficetelScanError extends Error {
  constructor(sigunguCd: string, bjdongCd: string, readonly failedPages: number) {
    super(`표제부 조회 불완전: ${sigunguCd}-${bjdongCd} (${failedPages}페이지 실패)`);
  }
}

/**
 * 같은 법정동의 오피스텔을 표제부에서 가져온다. **배치 적재 전용이다.**
 *
 * 총괄표제부에는 오피스텔이 없다 — 거기 "업무시설"은 세대·호수가 0인 순수 업무빌딩뿐이다.
 * 오피스텔은 표제부에만 있고, 대신 표제부는 단지가 아니라 동 단위라 행 수가 훨씬 많다
 * (역삼동 기준 총괄표제부 85행 vs 표제부 4,962행 = 50페이지).
 *
 * 처음엔 실시간 검색 경로에서 같이 긁었는데, 3km 분석이 법정동 14개를 잡는 탓에
 * 요청 한 번에 상류 700회를 때리게 됐다. 운영에서 동시 스캔이 동당 17~24페이지씩
 * 끊겼고, 끊긴 동은 캐시하지 않으니 모든 요청이 매번 30초씩 재조회하는 상태가 됐다.
 * 그래서 실시간 경로에서는 빼고 배치(ingest:ledger)에서만 채운다. 적재된 법정동은
 * 검색이 DB에서 그대로 읽으므로 오피스텔이 함께 나온다.
 */
async function queryOfficetelsForDong(
  sigunguCd: string, bjdongCd: string, encodedApiKey: string,
): Promise<LedgerBuilding[]> {
  const collect = (xml: string): LedgerBuilding[] => {
    const found: LedgerBuilding[] = [];
    for (const item of parseXmlItems(xml)) {
      const officetel = readOfficetelFromTitleRow(item);
      if (!officetel) continue;
      found.push({
        bldNm: officetel.name,
        platPlc: officetel.platPlc,
        units: officetel.units,
        parking: officetel.parking,
        maxFloor: officetel.maxFloor,
        useAprDay: officetel.useAprDay,
        sigunguCd,
        bjdongCd,
        bun: officetel.bun,
        ji: officetel.ji,
      });
    }
    return found;
  };

  // 동시 조회를 올리면 상류가 간헐적으로 끊는다. 실패한 페이지를 그냥 버리면
  // 오피스텔이 조용히 줄어들기만 해서(측정 중 7→5건) 재시도로 메운다.
  const fetchPage = async (pageNo: number): Promise<string | null> => {
    for (let attempt = 0; attempt < OFFICETEL_PAGE_RETRIES; attempt += 1) {
      try {
        return await fetchXml(buildLedgerTitleUrl({ sigunguCd, bjdongCd, pageNo, encodedApiKey }));
      } catch {
        if (attempt < OFFICETEL_PAGE_RETRIES - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        }
      }
    }
    return null;
  };

  const firstPage = await fetchPage(1);
  // 첫 페이지 실패를 빈 결과로 돌려주면 "오피스텔 없는 동"으로 30일 굳는다.
  // 상류가 잠깐 흔들린 것과 진짜 0건은 반드시 구분해야 한다.
  if (!firstPage) throw new IncompleteOfficetelScanError(sigunguCd, bjdongCd, 1);

  const total = parseInt(firstPage.match(/<totalCount>(\d+)<\/totalCount>/)?.[1] ?? "0", 10);
  const pageCount = Math.min(Math.ceil(total / LEDGER_PAGE_SIZE), OFFICETEL_MAX_PAGES);
  const officetels = collect(firstPage);
  let failedPages = 0;

  // 표제부는 동 단위라 밀집 지역은 50페이지를 넘는다(역삼동 4,962행).
  // 순차로 돌면 콜드 조회가 8초쯤 걸려서 제한된 동시성으로 나눠 받는다.
  for (let start = 2; start <= pageCount; start += OFFICETEL_PAGE_CONCURRENCY) {
    const batch = [];
    for (let pageNo = start; pageNo < start + OFFICETEL_PAGE_CONCURRENCY && pageNo <= pageCount; pageNo += 1) {
      batch.push(fetchPage(pageNo));
    }
    for (const xml of await Promise.all(batch)) {
      if (xml) officetels.push(...collect(xml));
      else failedPages += 1;
    }
  }

  // 일부 페이지를 끝내 못 받았다면 이 법정동은 불완전하다. 조용히 적은 건수를
  // 정상인 양 30일 캐시에 굳히는 것이 최악이라 캐시하지 않도록 알린다.
  if (failedPages > 0) {
    console.warn(
      `[ledger-search] ${sigunguCd}-${bjdongCd} 표제부 ${failedPages}페이지 실패 — 오피스텔이 누락된 상태이므로 적재하지 않습니다`,
    );
    throw new IncompleteOfficetelScanError(sigunguCd, bjdongCd, failedPages);
  }
  return officetels;
}

// ─── NCP 지오코딩 + SQLite 캐시 ──────────────────────────────────────────────

function getCachedCoord(address: string): { lat: number; lng: number } | null {
  try {
    return readGeocode(getDb(), address);
  } catch { return null; }
}

function setCachedCoord(address: string, lat: number, lng: number): void {
  try {
    writeGeocode(getDb(), address, lat, lng, Date.now());
  } catch { /* non-fatal */ }
}

async function geocodeAddress(
  address: string, ncpId: string, ncpSecret: string,
): Promise<{ lat: number; lng: number } | null> {
  // Cache check
  const cached = getCachedCoord(address);
  if (cached) return cached;
  // 최근 실패한 주소는 다시 왕복하지 않는다
  try {
    if (isRecentMiss(getDb(), address, Date.now())) return null;
  } catch { /* non-fatal */ }

  try {
    const url = `${NCP_GEOCODE_URL}?query=${encodeURIComponent(address)}`;
    const data = await fetchJson(url, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const addrs = data["addresses"] as Array<Record<string, string>> | undefined;
    if (!addrs || addrs.length === 0) {
      rememberMiss(address);
      return null;
    }
    const lat = parseFloat(addrs[0]["y"]);
    const lng = parseFloat(addrs[0]["x"]);
    if (isNaN(lat) || isNaN(lng)) {
      rememberMiss(address);
      return null;
    }
    setCachedCoord(address, lat, lng);
    return { lat, lng };
  } catch {
    return null;
  }
}

function rememberMiss(address: string): void {
  try {
    recordGeocodeMiss(getDb(), address, Date.now());
  } catch { /* non-fatal */ }
}

// ─── 분류 ─────────────────────────────────────────────────────────────────────

/**
 * 대장 용도가 이름보다 우선한다. 이름에 "오피스텔"이 없는 오피스텔이 대부분이라
 * (역삼동 54건 중 이름에 그 단어가 든 건 없다) 이름 규칙만으로는 거의 못 잡는다.
 */
function classifyResidential(
  bldNm: string, units: number, purpose: LedgerPurpose = "공동주택",
): "apartment" | "officetel" | "residential" {
  if (purpose === "오피스텔") return "officetel";
  const name = bldNm.toLowerCase();
  if (name.includes("오피스텔")) return "officetel";
  if (units >= 50 || name.includes("아파트") || name.includes("자이") || name.includes("래미안")
    || name.includes("힐스테이트") || name.includes("푸르지오") || name.includes("더샵")
    || name.includes("롯데캐슬") || name.includes("e편한세상")) return "apartment";
  return "residential";
}

// ─── 법정동 read-through ──────────────────────────────────────────────────────

interface DongRows {
  dong: DongCode;
  rows: LedgerRow[];
  /** 적재분을 그대로 쓴 경우 true — 다시 저장할 필요가 없다 */
  fromCache: boolean;
  /** 표제부를 다 못 읽어 오피스텔이 빠진 상태 — 30일 캐시에 굳히면 안 된다 */
  incomplete?: boolean;
}

/**
 * 한 법정동의 공동주택을 가져온다.
 * 적재분이 신선하면 좌표까지 붙은 채로 바로 쓰고, 아니면 API로 채워 좌표를 붙인다.
 * 저장 여부는 호출자가 결정한다 (모든 법정동이 0건이면 상류 장애이므로 저장하지 않는다).
 */
async function loadDongRows(
  dong: DongCode, encodedApiKey: string, ncpId: string, ncpSecret: string,
  includeOfficetels = false, force = false,
): Promise<DongRows> {
  // force일 때 캐시로 빠지면 배치가 오피스텔 스캔을 통째로 건너뛴다.
  // 적재분은 공동주택만 있던 시절 것일 수 있어서, 다시 채우라는 요청은 존중해야 한다.
  if (!force) {
    try {
      const cached = readLedgerDong(getDb(), dong.sigunguCd, dong.bjdongCd, Date.now());
      if (cached !== null) return { dong, rows: cached, fromCache: true };
    } catch { /* 캐시 실패는 API 조회로 이어간다 */ }
  }

  // 오피스텔 조회가 불완전해도 공동주택은 살린다. 대신 이 법정동은 캐시하지 않아
  // 다음 배치에서 다시 채우게 한다 — 빠진 채로 30일 굳는 것이 가장 나쁘다.
  let incomplete = false;
  const apartments = await queryLedgerForDong(dong.sigunguCd, dong.bjdongCd, encodedApiKey);
  const officetels = includeOfficetels
    ? await queryOfficetelsForDong(dong.sigunguCd, dong.bjdongCd, encodedApiKey).catch(() => {
        incomplete = true;
        return [] as LedgerBuilding[];
      })
    : [];

  // 실시간 경로는 오피스텔을 조회하지 않는다(비용). 그런데 upsert는 법정동을 통째로
  // 갈아치우므로, 이대로 두면 TTL이 만료될 때마다 배치가 채운 오피스텔이 지워진다.
  // 이미 적재된 오피스텔을 그대로 실어 보낸다 — 다음 배치가 갱신할 때까지 유지된다.
  const carriedOfficetels: LedgerRow[] = includeOfficetels
    ? []
    : (() => {
        try {
          return readLedgerRowsByPurpose(getDb(), dong.sigunguCd, dong.bjdongCd, "오피스텔");
        } catch { return []; }
      })();
  const buildings = [
    ...apartments.map((building) => ({ building, purpose: "공동주택" as const })),
    ...officetels.map((building) => ({ building, purpose: "오피스텔" as const })),
  ];
  const rows: LedgerRow[] = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < buildings.length; i += BATCH_SIZE) {
    const batch = buildings.slice(i, i + BATCH_SIZE);
    const coords = await Promise.all(batch.map(({ building }) => geocodeAddress(building.platPlc, ncpId, ncpSecret)));
    batch.forEach(({ building: b, purpose }, j) => {
      const coord = coords[j];
      rows.push({
        // 오피스텔과 공동주택이 같은 지번을 쓰는 경우가 있어 용도를 키에 넣는다
        id: `ledger-${b.sigunguCd}-${b.bjdongCd}-${b.bun}-${b.ji}${purpose === "오피스텔" ? "-offi" : ""}`,
        name: b.bldNm,
        address: b.platPlc,
        units: b.units,
        parking: b.parking,
        maxFloor: b.maxFloor,
        useAprDay: b.useAprDay,
        bun: b.bun,
        ji: b.ji,
        lat: coord ? coord.lat : null,
        lng: coord ? coord.lng : null,
        purpose,
      });
    });
  }
  return { dong, rows: [...rows, ...carriedOfficetels], fromCache: false, incomplete };
}

// ─── 배치 워밍용 공개 헬퍼 ────────────────────────────────────────────────────

/** 중심 좌표 주변의 법정동 목록 (배치 스크립트가 대상을 정할 때 쓴다) */
export async function resolveDongsAround(
  lat: number, lng: number, radiusM: number, ncpId: string, ncpSecret: string,
): Promise<DongCode[]> {
  return findDongsInRadius(lat, lng, radiusM, ncpId, ncpSecret);
}

export interface WarmOptions {
  apiKey: string;
  ncpId: string;
  ncpSecret: string;
  now: number;
  /** true면 TTL이 남아 있어도 다시 조회한다 */
  force?: boolean;
}

/** 한 법정동을 미리 채운다. 급감이면 거부하고 기존 데이터를 지킨다. */
export async function warmLedgerDong(
  db: ReturnType<typeof getDb>, dong: DongCode, options: WarmOptions,
): Promise<{ status: "ok" | "rejected"; rowCount: number; message?: string }> {
  if (!options.force) {
    const cached = readLedgerDong(db, dong.sigunguCd, dong.bjdongCd, options.now);
    if (cached !== null) return { status: "ok", rowCount: cached.length };
  }
  const encodedApiKey = encodeApiKey(options.apiKey);
  // 오피스텔 표제부 스캔은 배치에서만 한다 — 아래 주석 참조
  const entry = await loadDongRows(
    dong, encodedApiKey, options.ncpId, options.ncpSecret, true, options.force ?? false,
  );
  if (entry.incomplete) {
    return {
      status: "rejected",
      rowCount: entry.rows.length,
      message: `${dong.sigunguCd}-${dong.bjdongCd} 표제부 조회가 불완전해 적재하지 않았습니다 (오피스텔 누락)`,
    };
  }
  const result = upsertLedgerDong(db, dong.sigunguCd, dong.bjdongCd, entry.rows, options.now);
  return { status: result.status, rowCount: result.rowCount, message: result.message };
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

export async function searchResidentialFromLedger(
  centerLat: number, centerLng: number, radiusM: number,
): Promise<ResidentialPoi[]> {
  const apiKey = process.env.DATA_GO_KR_API_KEY;
  const ncpId = process.env.NCP_CLIENT_ID;
  const ncpSecret = process.env.NCP_CLIENT_SECRET;
  if (!apiKey || !ncpId || !ncpSecret) return [];

  const encodedApiKey = encodeApiKey(apiKey);

  // Step 1: 반경 내 법정동 목록
  const dongs = await findDongsInRadius(centerLat, centerLng, radiusM, ncpId, ncpSecret);
  console.log(`[ledger-search] ${dongs.length} dongs found in radius`);
  if (dongs.length === 0) return [];

  // Step 2~3: 법정동별로 적재분을 읽거나(read-through) API로 채운다.
  // 적재분에는 좌표가 이미 들어 있어 지오코딩 왕복이 통째로 사라진다.
  const perDong = await Promise.all(
    dongs.map(d => loadDongRows(d, encodedApiKey, ncpId, ncpSecret)),
  );

  const fetched = perDong.filter(r => !r.fromCache);
  const totalRows = perDong.reduce((sum, r) => sum + r.rows.length, 0);

  // 새로 조회한 법정동이 여럿인데 전부 0건이면 상류 장애다.
  // (건축물대장 응답 기본 포맷이 XML→JSON으로 바뀌었을 때 전국이 조용히 0건이 됐다)
  const looksLikeUpstreamFailure = fetched.length >= 2 && fetched.every(r => r.rows.length === 0);
  if (looksLikeUpstreamFailure) {
    console.warn(
      `[ledger-search] ${fetched.length} dongs returned zero apartments — suspect an upstream response-format change; not persisting`,
    );
  } else {
    for (const entry of fetched) {
      // 표제부를 다 못 읽은 법정동은 오피스텔이 빠져 있다. 30일 TTL로 굳히면
      // 다음 달까지 누락이 고정되므로 이번 응답에만 쓰고 저장은 건너뛴다.
      if (entry.incomplete) continue;
      const result = upsertLedgerDong(getDb(), entry.dong.sigunguCd, entry.dong.bjdongCd, entry.rows, Date.now());
      if (result.status === "rejected") console.warn(`[ledger-search] ${result.message}`);
    }
  }

  console.log(`[ledger-search] ${totalRows} residential buildings (cache hit ${perDong.length - fetched.length}/${perDong.length} dongs)`);
  if (totalRows === 0) return [];

  // Step 4: 반경 필터 + POI 생성
  const pois: ResidentialPoi[] = [];
  const seenNames = new Set<string>();
  const sigunguByName = new Map<string, string>();
  for (const entry of perDong) {
    for (const b of entry.rows) {
      if (b.lat === null || b.lng === null) continue;

      const dist = haversine(centerLat, centerLng, b.lat, b.lng);
      if (dist > radiusM) continue;

      // 지번 코드 기반 식별 — 이름만 쓰면 서로 다른 "현대아파트"가 병합된다
      const dedupeKey = buildingDedupeKey({
        bldNm: b.name,
        sigunguCd: entry.dong.sigunguCd,
        bjdongCd: entry.dong.bjdongCd,
        bun: b.bun,
        ji: b.ji,
        lat: b.lat,
        lng: b.lng,
      });
      if (seenNames.has(dedupeKey)) continue;
      seenNames.add(dedupeKey);

      const category = classifyResidential(b.name, b.units, b.purpose);
      const rawDate = b.useAprDay;
      let saleDate = "";
      if (rawDate.length >= 6) saleDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}`;
      else if (rawDate.length === 4) saleDate = rawDate;

      const base = {
        id: b.id,
        name: b.name,
        lat: b.lat,
        lng: b.lng,
        units: b.units,
        parking_count: b.parking,
        sale_date: saleDate,
        distance_m: Math.round(dist),
        status: "existing" as const,
        source: "ledger" as const,
        ...(b.maxFloor > 0 ? { max_floor: b.maxFloor } : {}),
      };

      if (category === "apartment") {
        pois.push({ ...base, category: "apartment" } as Apartment);
        sigunguByName.set(b.name, entry.dong.sigunguCd);
      } else if (category === "officetel") {
        pois.push({ ...base, category: "officetel" } as Officetel);
      } else {
        pois.push({ ...base, category: "residential" } as ResidentialOther);
      }
    }
  }

  // Step 5: K-APT 단지 상세 보강 — 아파트만 (K-APT는 의무관리 공동주택 대상이라
  // 오피스텔/소규모 주거는 이름 매칭이 안 되므로 조회 자체를 걸지 않는다).
  // 총괄표제부에 없는 최고층수/동수/시공사/부대시설을 채우고, 주차 0·준공일 공란을 보정.
  try {
    const extras = await enrichKaptExtras(
      [...sigunguByName.entries()].map(([name, sigunguCode]) => ({ name, sigunguCode }))
    );
    if (extras.size > 0) {
      for (let i = 0; i < pois.length; i++) {
        const e = extras.get(pois[i].name);
        if (!e) continue;
        const p = pois[i];
        pois[i] = {
          ...p,
          ...(e.top_floor > 0 && !p.max_floor ? { max_floor: e.top_floor } : {}),
          ...(e.dong_count > 0 ? { dong_count: e.dong_count } : {}),
          ...(e.constructor_name ? { constructor_name: e.constructor_name } : {}),
          ...(e.welfare_facilities ? { welfare_facilities: e.welfare_facilities } : {}),
          ...(p.parking_count <= 0 && e.parking_total > 0 ? { parking_count: e.parking_total } : {}),
          ...(!p.sale_date && e.use_date ? { sale_date: e.use_date } : {}),
        } as ResidentialPoi;
      }
      console.log(`[ledger-search] K-APT extras merged for ${extras.size} complexes`);
    }
  } catch { /* 보강 실패는 비치명 — 대장 데이터만으로 진행 */ }

  console.log(`[ledger-search] ${pois.length} residential POIs after radius filter`);
  return pois;
}
