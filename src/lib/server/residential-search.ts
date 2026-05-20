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
import type { Apartment, Officetel, ResidentialOther, ResidentialPoi } from "../types";

const LEDGER_URL = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrRecapTitleInfo";
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
    return { sigunguCd: codeId.slice(0, 5), bjdongCd: codeId.slice(5, 10) };
  } catch {
    return null;
  }
}

/** 반경 내 법정동 목록을 수집 (중심 + 8방향 샘플링) */
async function findDongsInRadius(
  centerLat: number, centerLng: number, radiusM: number,
  ncpId: string, ncpSecret: string,
): Promise<DongCode[]> {
  const offsetDeg = (radiusM / 111000); // rough degree offset
  const points = [
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

  const results = await Promise.all(
    points.map(([lat, lng]) => reverseGeocodeToDong(lat, lng, ncpId, ncpSecret))
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
    const url = `${LEDGER_URL}?serviceKey=${encodedApiKey}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}&numOfRows=100&pageNo=${page}`;
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
    const db = getDb();
    const row = db.prepare("SELECT lat, lng FROM geocode_cache WHERE address = ?")
      .get(address) as { lat: number; lng: number } | undefined;
    return row ?? null;
  } catch { return null; }
}

function setCachedCoord(address: string, lat: number, lng: number): void {
  try {
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO geocode_cache (address, lat, lng, created_at) VALUES (?, ?, ?, ?)")
      .run(address, lat, lng, Date.now() / 1000);
  } catch { /* non-fatal */ }
}

async function geocodeAddress(
  address: string, ncpId: string, ncpSecret: string,
): Promise<{ lat: number; lng: number } | null> {
  // Cache check
  const cached = getCachedCoord(address);
  if (cached) return cached;

  try {
    const url = `${NCP_GEOCODE_URL}?query=${encodeURIComponent(address)}`;
    const data = await fetchJson(url, {
      "X-NCP-APIGW-API-KEY-ID": ncpId,
      "X-NCP-APIGW-API-KEY": ncpSecret,
    });
    const addrs = data["addresses"] as Array<Record<string, string>> | undefined;
    if (!addrs || addrs.length === 0) return null;
    const lat = parseFloat(addrs[0]["y"]);
    const lng = parseFloat(addrs[0]["x"]);
    if (isNaN(lat) || isNaN(lng)) return null;
    setCachedCoord(address, lat, lng);
    return { lat, lng };
  } catch {
    return null;
  }
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

  // Step 2: 법정동별 건축물대장 조회 (병렬)
  const allBuildings = await Promise.all(
    dongs.map(d => queryLedgerForDong(d.sigunguCd, d.bjdongCd, encodedApiKey))
  );
  const buildings = allBuildings.flat();
  console.log(`[ledger-search] ${buildings.length} residential buildings from ledger`);
  if (buildings.length === 0) return [];

  // Step 3: 좌표 변환 (배치, 최대 동시 5개)
  const BATCH_SIZE = 5;
  const coordResults: ({ lat: number; lng: number } | null)[] = new Array(buildings.length).fill(null);
  for (let i = 0; i < buildings.length; i += BATCH_SIZE) {
    const batch = buildings.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(b => geocodeAddress(b.platPlc, ncpId, ncpSecret))
    );
    for (let j = 0; j < results.length; j++) {
      coordResults[i + j] = results[j];
    }
  }

  // Step 4: 반경 필터 + POI 생성
  const pois: ResidentialPoi[] = [];
  const seenNames = new Set<string>();
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    const coord = coordResults[i];
    if (!coord) continue;

    const dist = haversine(centerLat, centerLng, coord.lat, coord.lng);
    if (dist > radiusM) continue;

    // Deduplicate by name (same complex may have multiple entries)
    const dedupeKey = b.bldNm.replace(/\s+[\dA-Za-z]+동$/, "").trim();
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);

    const category = classifyResidential(b.bldNm, b.units);
    const rawDate = b.useAprDay;
    let saleDate = "";
    if (rawDate.length >= 6) saleDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}`;
    else if (rawDate.length === 4) saleDate = rawDate;

    const base = {
      id: `ledger-${b.sigunguCd}-${b.bjdongCd}-${b.bun}-${b.ji}`,
      name: b.bldNm,
      lat: coord.lat,
      lng: coord.lng,
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
    } else if (category === "officetel") {
      pois.push({ ...base, category: "officetel" } as Officetel);
    } else {
      pois.push({ ...base, category: "residential" } as ResidentialOther);
    }
  }

  console.log(`[ledger-search] ${pois.length} residential POIs after radius filter`);
  return pois;
}
