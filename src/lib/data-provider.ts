import type {
  AnalysisConfig,
  Poi,
  RegionData,
  RegionMetadata,
  SubwayStation,
  School,
  Park,
  Mountain,
  Apartment,
  SubwayRoute,
} from "./types";

const regionCache = new Map<string, RegionData>();
const dynamicCache = new Map<string, RegionData>();
let regionsIndex: readonly RegionMetadata[] | null = null;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errorBody?.error ?? `Failed to fetch ${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface AddressSearchResult {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
}

export async function getAvailableRegions(): Promise<readonly RegionMetadata[]> {
  if (regionsIndex) return regionsIndex;
  regionsIndex = await fetchJson<RegionMetadata[]>("/data/regions.json");
  return regionsIndex;
}

export async function loadRegion(regionCode: string): Promise<RegionData> {
  const cached = regionCache.get(regionCode);
  if (cached) return cached;

  const basePath = `/data/seed/${regionCode}`;

  const [regions, subwayStations, schools, parks, mountains, apartments, subwayRoutes] =
    await Promise.all([
      getAvailableRegions(),
      fetchJson<SubwayStation[]>(`${basePath}/subway-stations.json`),
      fetchJson<School[]>(`${basePath}/schools.json`),
      fetchJson<Park[]>(`${basePath}/parks.json`),
      fetchJson<Mountain[]>(`${basePath}/mountains.json`),
      fetchJson<Apartment[]>(`${basePath}/apartments.json`),
      fetchJson<SubwayRoute[]>(`${basePath}/subway-routes.json`),
    ]);

  const meta = regions.find((r) => r.regionCode === regionCode);
  if (!meta) throw new Error(`Region metadata not found: ${regionCode}`);

  const regionData: RegionData = {
    regionCode: meta.regionCode,
    regionName: meta.regionName,
    address: meta.address,
    aliases: meta.aliases,
    defaultConfig: meta.defaultConfig,
    subwayStations,
    schools,
    parks,
    mountains,
    apartments,
    subwayRoutes,
  };

  regionCache.set(regionCode, regionData);
  return regionData;
}

export async function searchAddresses(query: string, page = 1, size = 5): Promise<readonly AddressSearchResult[]> {
  const params = new URLSearchParams({
    query,
    page: String(page),
    size: String(size),
  });
  const response = await fetchJson<{ results: AddressSearchResult[] }>(`/api/address-search?${params.toString()}`);
  return response.results;
}

export const CUSTOM_REGION_CODE = "custom";

export async function loadDynamicRegion(lat: number, lng: number, radiusKm: number): Promise<RegionData> {
  const cacheKey = `dynamic-${lat.toFixed(4)}-${lng.toFixed(4)}-${radiusKm}`;
  const cached = dynamicCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius: String(Math.round(radiusKm * 1000)),
    categories: "subway,school,park,mountain,apartment",
  });
  const response = await fetchJson<{ pois: Poi[] }>(`/api/poi-search?${params.toString()}`);

  const regionData: RegionData = {
    regionCode: CUSTOM_REGION_CODE,
    regionName: "실시간 검색 결과",
    address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    aliases: [],
    defaultConfig: {
      centerName: "실시간 검색",
      centerLat: lat,
      centerLng: lng,
      radiusKm,
    },
    subwayStations: response.pois.filter((poi): poi is SubwayStation => poi.category === "subway"),
    schools: response.pois.filter((poi): poi is School => poi.category === "school"),
    parks: response.pois.filter((poi): poi is Park => poi.category === "park"),
    mountains: response.pois.filter((poi): poi is Mountain => poi.category === "mountain"),
    apartments: response.pois.filter((poi): poi is Apartment => poi.category === "apartment"),
    subwayRoutes: [],
  };

  dynamicCache.set(cacheKey, regionData);
  return regionData;
}

export const DEFAULT_REGION_CODE = "cheongwadae";
