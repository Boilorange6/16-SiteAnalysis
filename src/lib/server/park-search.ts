import type { Park, ParkQuality } from "../types";
import { getBoundingBox, haversineDistance } from "../geo";
import { overpassFetch } from "./overpass-fetch";

const OFFICIAL_PARK_URL = "http://api.data.go.kr/openapi/tn_pubr_public_cty_park_info_api";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const API_TIMEOUT_MS = 25_000;
const OFFICIAL_PAGE_SIZE = 1000;
const MAX_OFFICIAL_PAGES = 80;

type OsmPark = Park & { boundary?: readonly [number, number][] };

interface OfficialParkRow {
  MANAGE_NO?: string;
  PARK_NM?: string;
  PARK_SE?: string;
  RDNMADR?: string;
  LNMADR?: string;
  LATITUDE?: string | number;
  LONGITUDE?: string | number;
  PARK_AR?: string | number;
  MVM_FCLTY?: string;
  AMSMT_FCLTY?: string;
  CNVNNC_FCLTY?: string;
  CLTR_FCLTY?: string;
  ETC_FCLTY?: string;
  INSTITUTION_NM?: string;
  PHONE_NUMBER?: string;
  REFERENCE_DATE?: string;
}

interface OfficialCache {
  expiresAt: number;
  parks: Park[];
}

let officialCache: OfficialCache | null = null;
let officialFailureUntil = 0;

function rawApiKey(key: string): string {
  return key.includes("%") ? decodeURIComponent(key) : key;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeName(name: string): string {
  return name.replace(/<[^>]+>/g, "").replace(/\s+/g, "").replace(/[()（）ㆍ·:：-]/g, "").toLowerCase();
}

function splitFacilities(...values: Array<string | undefined>): string[] {
  return values
    .flatMap((value) => String(value ?? "").split(/[+,/]|ㆍ|·/))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8);
}

function classifyQuality(type: string, areaSqm: number, name = ""): ParkQuality {
  const hint = `${type} ${name}`;
  if (areaSqm >= 100_000 || /대공원|한강공원|도시자연|체육공원/.test(hint)) return "major";
  if (/근린공원/.test(hint) || areaSqm >= 10_000) return "neighborhood";
  if (/어린이공원/.test(hint)) return "children";
  if (/소공원/.test(hint) || (areaSqm > 0 && areaSqm < 3_000)) return "small";
  if (/녹지|광장|정원|garden/i.test(hint)) return "green";
  return "unknown";
}

function estimatedRadiusM(areaSqm: number): number {
  if (!areaSqm || areaSqm <= 0) return 0;
  return Math.sqrt(areaSqm / Math.PI);
}

function isPointInsidePolygon(lat: number, lng: number, points: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [latI, lngI] = points[i];
    const [latJ, lngJ] = points[j];
    const intersects = ((lngI > lng) !== (lngJ > lng))
      && (lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI || Number.EPSILON) + latI);
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegmentM(
  originLat: number,
  originLng: number,
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(originLat * Math.PI / 180);
  const toPoint = ([lat, lng]: readonly [number, number]) => ({
    x: (lng - originLng) * metersPerDegLng,
    y: (lat - originLat) * metersPerDegLat,
  });
  const a = toPoint(start);
  const b = toPoint(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= Number.EPSILON) return Math.hypot(a.x, a.y);
  const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSq));
  return Math.hypot(a.x + t * dx, a.y + t * dy);
}

function distanceToBoundaryM(
  centerLat: number,
  centerLng: number,
  boundary?: readonly [number, number][],
): number | undefined {
  if (!boundary || boundary.length < 3) return undefined;
  if (isPointInsidePolygon(centerLat, centerLng, boundary)) return 0;

  let nearest = Infinity;
  for (let i = 0; i < boundary.length; i++) {
    nearest = Math.min(nearest, distanceToSegmentM(centerLat, centerLng, boundary[i], boundary[(i + 1) % boundary.length]));
  }
  return Number.isFinite(nearest) ? nearest : undefined;
}

function estimateAccessDistanceM(
  centerLat: number,
  centerLng: number,
  parkLat: number,
  parkLng: number,
  areaSqm: number,
  boundary?: readonly [number, number][],
): number {
  const boundaryDistanceM = distanceToBoundaryM(centerLat, centerLng, boundary);
  if (boundaryDistanceM != null) return boundaryDistanceM;

  const distanceM = haversineDistance(centerLat, centerLng, parkLat, parkLng);
  return Math.max(0, distanceM - estimatedRadiusM(areaSqm));
}

function buildPark(
  id: string,
  name: string,
  lat: number,
  lng: number,
  areaSqm: number,
  parkType: string,
  source: "official" | "osm",
  centerLat: number,
  centerLng: number,
  extras: Partial<Park> = {},
): Park {
  const distanceM = haversineDistance(centerLat, centerLng, lat, lng);
  const accessDistanceM = estimateAccessDistanceM(centerLat, centerLng, lat, lng, areaSqm, extras.boundary);
  const quality = classifyQuality(parkType, areaSqm, name);
  return {
    id,
    name,
    lat,
    lng,
    category: "park",
    area_sqm: Math.round(areaSqm),
    type: parkType || "공원",
    park_type: parkType || "공원",
    distance_m: Math.round(distanceM),
    access_distance_m: Math.round(accessDistanceM),
    source,
    quality,
    ...extras,
  };
}

function isUsefulOsmPark(name: string, areaSqm: number, tags: Record<string, string>): boolean {
  if (!name || /^park-\d+$/i.test(name)) return false;
  if (name === "놀이터" || /playground|운동장|아파트|단지|주차장/i.test(name)) return false;
  if (!/[가-힣A-Za-z]/.test(name)) return false;
  const access = tags["access"] ?? "";
  if (/private|no/i.test(access)) return false;
  return areaSqm >= 800 || /공원|숲|정원|광장|녹지|park|garden/i.test(name);
}

function polygonAreaSqm(points: readonly [number, number][]): number {
  if (points.length < 3) return 0;
  const lat0 = points.reduce((sum, [lat]) => sum + lat, 0) / points.length;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(lat0 * Math.PI / 180);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];
    const x1 = lng1 * metersPerDegLng;
    const y1 = lat1 * metersPerDegLat;
    const x2 = lng2 * metersPerDegLng;
    const y2 = lat2 * metersPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area / 2);
}

function geometryCenter(points: readonly [number, number][]): { lat: number; lon: number } | undefined {
  if (points.length === 0) return undefined;
  return {
    lat: points.reduce((sum, [lat]) => sum + lat, 0) / points.length,
    lon: points.reduce((sum, [, lng]) => sum + lng, 0) / points.length,
  };
}

async function fetchOfficialParks(): Promise<Park[]> {
  if (officialCache && officialCache.expiresAt > Date.now()) return officialCache.parks;
  if (officialFailureUntil > Date.now()) return [];

  const apiKey = process.env.DATA_GO_KR_API_KEY;
  if (!apiKey) return [];

  const serviceKey = rawApiKey(apiKey);
  const parks: Park[] = [];
  let totalCount = Infinity;

  try {
    for (let page = 1; page <= MAX_OFFICIAL_PAGES && parks.length < totalCount; page++) {
      const params = new URLSearchParams({
        serviceKey,
        pageNo: String(page),
        numOfRows: String(OFFICIAL_PAGE_SIZE),
        type: "json",
      });
      const res = await fetch(`${OFFICIAL_PARK_URL}?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        response?: {
          header?: { resultCode?: string; resultMsg?: string };
          body?: { totalCount?: number; items?: OfficialParkRow[] | { item?: OfficialParkRow[] | OfficialParkRow } };
        };
      };
      const code = data.response?.header?.resultCode;
      if (code && code !== "00") throw new Error(data.response?.header?.resultMsg ?? `resultCode ${code}`);
      totalCount = parseNumber(data.response?.body?.totalCount) || totalCount;
      const rawItems = data.response?.body?.items;
      const itemValue = Array.isArray(rawItems) ? rawItems : rawItems?.item;
      const items = Array.isArray(itemValue) ? itemValue : itemValue ? [itemValue] : [];
      if (items.length === 0) break;

      for (const row of items) {
        const lat = parseNumber(row.LATITUDE);
        const lng = parseNumber(row.LONGITUDE);
        const name = String(row.PARK_NM ?? "").trim();
        if (!lat || !lng || !name) continue;
        const parkType = String(row.PARK_SE ?? "공원").trim() || "공원";
        parks.push({
          id: `official-park-${row.MANAGE_NO || `${lat}-${lng}-${normalizeName(name)}`}`,
          name,
          lat,
          lng,
          category: "park",
          area_sqm: Math.round(parseNumber(row.PARK_AR)),
          type: parkType,
          park_type: parkType,
          address: String(row.RDNMADR || row.LNMADR || "").trim() || undefined,
          facilities: splitFacilities(row.MVM_FCLTY, row.AMSMT_FCLTY, row.CNVNNC_FCLTY, row.CLTR_FCLTY, row.ETC_FCLTY),
          source: "official",
          quality: classifyQuality(parkType, parseNumber(row.PARK_AR), name),
        });
      }
    }
    officialCache = { expiresAt: Date.now() + CACHE_TTL_MS, parks };
    return parks;
  } catch (error) {
    console.error("[park-search] official park API failed:", error);
    officialFailureUntil = Date.now() + 10 * 60 * 1000;
    return officialCache?.parks ?? [];
  }
}

async function fetchOsmParks(lat: number, lng: number, radiusM: number): Promise<OsmPark[]> {
  const query = `
[out:json][timeout:25];
(
  node["leisure"~"^(park|garden)$"](around:${radiusM},${lat},${lng});
  way["leisure"~"^(park|garden)$"](around:${radiusM},${lat},${lng});
  relation["leisure"~"^(park|garden)$"](around:${radiusM},${lat},${lng});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](around:${radiusM},${lat},${lng});
);
out center geom tags;
`;
  try {
    const data = await overpassFetch(query, { timeoutMs: API_TIMEOUT_MS + 5_000 }) as {
      elements?: Array<{
        type: "node" | "way" | "relation";
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        geometry?: Array<{ lat: number; lon: number }>;
        tags?: Record<string, string>;
      }>;
    };
    const parks: OsmPark[] = [];
    for (const el of data.elements ?? []) {
      const tags = el.tags ?? {};
      const name = (tags["name:ko"] ?? tags.name ?? tags.official_name ?? "").trim();
      const boundary = (el.geometry ?? []).map(({ lat: la, lon }) => [la, lon] as [number, number]);
      const center = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : undefined) ?? geometryCenter(boundary);
      if (!center || !isUsefulOsmPark(name, 0, tags)) continue;
      const areaSqm = parseNumber(tags.area) || polygonAreaSqm(boundary);
      if (!isUsefulOsmPark(name, areaSqm, tags)) continue;
      const parkType = tags.leisure === "garden" ? "정원" : tags.landuse ? "녹지" : "공원";
      parks.push(buildPark(
        `osm-park-${el.type}-${el.id}`,
        name,
        center.lat,
        center.lon,
        areaSqm,
        parkType,
        "osm",
        lat,
        lng,
        { boundary: boundary.length >= 3 ? boundary : undefined },
      ));
    }
    return parks;
  } catch (error) {
    console.error("[park-search] OSM park search failed:", error);
    return [];
  }
}

function mergeParks(official: readonly Park[], osm: readonly Park[], centerLat: number, centerLng: number): Park[] {
  const merged: Park[] = [];
  const byName = new Map<string, Park[]>();

  for (const park of official) {
    const withDistances = buildPark(
      park.id,
      park.name,
      park.lat,
      park.lng,
      park.area_sqm,
      park.park_type ?? park.type,
      "official",
      centerLat,
      centerLng,
      park,
    );
    merged.push(withDistances);
    const key = normalizeName(park.name);
    byName.set(key, [...(byName.get(key) ?? []), withDistances]);
  }

  for (const osmPark of osm) {
    const key = normalizeName(osmPark.name);
    const matched = (byName.get(key) ?? []).find((officialPark) =>
      haversineDistance(officialPark.lat, officialPark.lng, osmPark.lat, osmPark.lng) <= 150
    );
    if (matched) {
      const index = merged.findIndex((park) => park.id === matched.id);
      if (index >= 0 && osmPark.boundary) {
        const existing = merged[index];
        merged[index] = {
          ...existing,
          boundary: osmPark.boundary,
          access_distance_m: Math.round(estimateAccessDistanceM(
            centerLat,
            centerLng,
            existing.lat,
            existing.lng,
            existing.area_sqm,
            osmPark.boundary,
          )),
        };
      }
      continue;
    }
    merged.push(osmPark);
  }

  return dedupeNearbySameNameParks(merged).sort((a, b) =>
    (a.access_distance_m ?? a.distance_m ?? Infinity) - (b.access_distance_m ?? b.distance_m ?? Infinity)
  );
}

function qualityRank(quality: ParkQuality | undefined): number {
  switch (quality) {
    case "major": return 5;
    case "neighborhood": return 4;
    case "children": return 3;
    case "green": return 2;
    case "small": return 1;
    default: return 0;
  }
}

function dedupeNearbySameNameParks(parks: readonly Park[]): Park[] {
  const result: Park[] = [];
  for (const park of parks) {
    const key = normalizeName(park.name);
    const existingIndex = result.findIndex((candidate) =>
      normalizeName(candidate.name) === key &&
      haversineDistance(candidate.lat, candidate.lng, park.lat, park.lng) <= 800
    );
    if (existingIndex < 0) {
      result.push(park);
      continue;
    }

    const existing = result[existingIndex];
    const preferPark = (park.access_distance_m ?? park.distance_m ?? Infinity) < (existing.access_distance_m ?? existing.distance_m ?? Infinity)
      ? park
      : existing;
    const facilities = [...new Set([...(existing.facilities ?? []), ...(park.facilities ?? [])])].slice(0, 8);
    const quality = qualityRank(park.quality) > qualityRank(existing.quality) ? park.quality : existing.quality;
    result[existingIndex] = {
      ...preferPark,
      id: existing.source === "official" ? existing.id : preferPark.id,
      source: existing.source === "official" || park.source === "official" ? "official" : "osm",
      area_sqm: Math.round((existing.area_sqm || 0) + (park.area_sqm || 0)),
      facilities,
      quality,
      boundary: existing.boundary ?? park.boundary,
    };
  }
  return result;
}

export async function searchParks(lat: number, lng: number, radiusM: number): Promise<Park[]> {
  const bbox = getBoundingBox(lat, lng, radiusM + 300);
  const [officialAll, osmParks] = await Promise.all([
    fetchOfficialParks(),
    fetchOsmParks(lat, lng, radiusM),
  ]);

  const officialNearby = officialAll.filter((park) => {
    if (park.lat < bbox.south || park.lat > bbox.north || park.lng < bbox.west || park.lng > bbox.east) return false;
    const distanceM = haversineDistance(lat, lng, park.lat, park.lng);
    const accessDistanceM = Math.max(0, distanceM - estimatedRadiusM(park.area_sqm));
    return accessDistanceM <= radiusM;
  });

  return mergeParks(officialNearby, osmParks, lat, lng).filter((park) =>
    (park.access_distance_m ?? park.distance_m ?? Infinity) <= radiusM
  );
}
