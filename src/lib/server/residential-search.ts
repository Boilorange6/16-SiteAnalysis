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
import { buildLedgerUrl } from "./ledger-url";
import { isRecentMiss, readGeocode, readLegalCode, recordGeocodeMiss, writeGeocode, writeLegalCode } from "./geocode-cache";
import { readLedgerDong, upsertLedgerDong, type LedgerRow } from "./ledger-store";
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

function classifyResidential(bldNm: string, units: number): "apartment" | "officetel" | "residential" {
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
}

/**
 * 한 법정동의 공동주택을 가져온다.
 * 적재분이 신선하면 좌표까지 붙은 채로 바로 쓰고, 아니면 API로 채워 좌표를 붙인다.
 * 저장 여부는 호출자가 결정한다 (모든 법정동이 0건이면 상류 장애이므로 저장하지 않는다).
 */
async function loadDongRows(
  dong: DongCode, encodedApiKey: string, ncpId: string, ncpSecret: string,
): Promise<DongRows> {
  try {
    const cached = readLedgerDong(getDb(), dong.sigunguCd, dong.bjdongCd, Date.now());
    if (cached !== null) return { dong, rows: cached, fromCache: true };
  } catch { /* 캐시 실패는 API 조회로 이어간다 */ }

  const buildings = await queryLedgerForDong(dong.sigunguCd, dong.bjdongCd, encodedApiKey);
  const rows: LedgerRow[] = [];
  const BATCH_SIZE = 5;
  for (let i = 0; i < buildings.length; i += BATCH_SIZE) {
    const batch = buildings.slice(i, i + BATCH_SIZE);
    const coords = await Promise.all(batch.map(b => geocodeAddress(b.platPlc, ncpId, ncpSecret)));
    batch.forEach((b, j) => {
      const coord = coords[j];
      rows.push({
        id: `ledger-${b.sigunguCd}-${b.bjdongCd}-${b.bun}-${b.ji}`,
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
      });
    });
  }
  return { dong, rows, fromCache: false };
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
  const entry = await loadDongRows(dong, encodedApiKey, options.ncpId, options.ncpSecret);
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

      const category = classifyResidential(b.name, b.units);
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
