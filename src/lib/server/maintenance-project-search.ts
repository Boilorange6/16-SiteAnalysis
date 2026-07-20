import ky, { type KyInstance } from "ky";

import type { MaintenanceCatalogProject, MaintenanceProject, SourceStatus } from "../types";
import { getDb } from "./database";
import {
  loadMaintenanceBoundaryArtifact,
  searchMaintenanceBoundaries,
  type MaintenanceBoundaryFeature,
} from "./maintenance/boundary-store";
import { mergeMaintenanceData, type RegionalMaintenanceRecord, type SelectedMaintenanceRegion } from "./maintenance/merge";
import { fetchNationalMaintenanceAttributes, type MaintenanceAttributeRecord } from "./maintenance/national-provider";
import {
  fetchBusanMaintenanceRecords,
  fetchSeoulMaintenanceRecords,
  type MaintenanceGeocoder,
  type RegionalProviderQuery,
} from "./maintenance/regional-provider";
import { resolveSource, type ResolvedSource } from "./poi-cache";

const NCP_REVERSE_GEO_URL = "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";
const NCP_GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

type AttributePayload = {
  readonly integrated: readonly MaintenanceAttributeRecord[];
  readonly standard: readonly MaintenanceAttributeRecord[];
};

export interface MaintenanceSearchResult {
  readonly projects: readonly MaintenanceProject[];
  readonly catalog: readonly MaintenanceCatalogProject[];
  readonly sources: readonly SourceStatus[];
  readonly warnings: readonly string[];
}

export interface MaintenanceSearchQuery {
  readonly center: { readonly lat: number; readonly lng: number };
  readonly radiusM: number;
  readonly refresh: boolean;
}

export interface MaintenanceSearchDependencies {
  readonly resolveBoundaries?: (query: MaintenanceSearchQuery) => Promise<ResolvedSource<readonly MaintenanceBoundaryFeature[]>>;
  readonly resolveAttributes?: (refresh: boolean) => Promise<ResolvedSource<AttributePayload>>;
  readonly resolveSeoul?: (query: RegionalProviderQuery) => Promise<ResolvedSource<readonly RegionalMaintenanceRecord[]>>;
  readonly resolveBusan?: (query: RegionalProviderQuery) => Promise<ResolvedSource<readonly RegionalMaintenanceRecord[]>>;
  readonly reverseGeocodeAdmin?: (center: MaintenanceSearchQuery["center"]) => Promise<SelectedMaintenanceRegion | null>;
}

type NcpCredentials = { readonly id: string; readonly secret: string };
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function credentials(): NcpCredentials | null {
  const id = process.env.NCP_CLIENT_ID?.trim();
  const secret = process.env.NCP_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

function ncpClient(value: NcpCredentials): KyInstance {
  return ky.create({
    timeout: 10_000, retry: { limit: 1, methods: ["get"] },
    headers: { "X-NCP-APIGW-API-KEY-ID": value.id, "X-NCP-APIGW-API-KEY": value.secret },
  });
}

function cachedCoordinate(address: string): { readonly lat: number; readonly lng: number } | null {
  try {
    const row = getDb().prepare("SELECT lat, lng FROM geocode_cache WHERE address = ?").get(address);
    if (!isObject(row) || typeof row.lat !== "number" || typeof row.lng !== "number") return null;
    return { lat: row.lat, lng: row.lng };
  } catch {
    return null;
  }
}

function storeCoordinate(address: string, coordinate: { readonly lat: number; readonly lng: number }): void {
  try {
    getDb().prepare("INSERT OR REPLACE INTO geocode_cache (address, lat, lng, created_at) VALUES (?, ?, ?, ?)")
      .run(address, coordinate.lat, coordinate.lng, Date.now() / 1_000);
  } catch {
  }
}

function defaultGeocoder(): MaintenanceGeocoder | undefined {
  const auth = credentials();
  if (!auth) return undefined;
  const http = ncpClient(auth);
  return async (rawAddress) => {
    const address = rawAddress.replace(/\([^)]*\)/g, " ").replaceAll(/\s+/g, " ").trim();
    const cacheKey = `maintenance:${address}`;
    const cached = cachedCoordinate(cacheKey);
    if (cached) return cached;
    try {
      const root = await http.get(NCP_GEOCODE_URL, { searchParams: { query: address } }).json<unknown>();
      if (!isObject(root) || !Array.isArray(root.addresses) || !isObject(root.addresses[0])) return null;
      const lat = Number(root.addresses[0].y);
      const lng = Number(root.addresses[0].x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const coordinate = { lat, lng };
      storeCoordinate(cacheKey, coordinate);
      return coordinate;
    } catch {
      return null;
    }
  };
}

async function defaultReverseGeocode(center: MaintenanceSearchQuery["center"]): Promise<SelectedMaintenanceRegion | null> {
  const auth = credentials();
  if (!auth) return null;
  try {
    const root = await ncpClient(auth).get(NCP_REVERSE_GEO_URL, {
      searchParams: { coords: `${center.lng},${center.lat}`, output: "json", orders: "legalcode,addr" },
    }).json<unknown>();
    if (!isObject(root) || !Array.isArray(root.results) || !isObject(root.results[0])) return null;
    const region = root.results[0].region;
    if (!isObject(region) || !isObject(region.area1) || !isObject(region.area2)) return null;
    const sido = typeof region.area1.name === "string" ? region.area1.name : "";
    const sigungu = typeof region.area2.name === "string" ? region.area2.name : "";
    return sido && sigungu ? { sido, sigungu } : null;
  } catch {
    return null;
  }
}

async function defaultBoundaries(query: MaintenanceSearchQuery): Promise<ResolvedSource<readonly MaintenanceBoundaryFeature[]>> {
  return resolveSource({
    source: "maintenance_boundaries", lat: query.center.lat, lng: query.center.lng,
    radiusM: query.radiusM, refresh: query.refresh,
    fetcher: async () => searchMaintenanceBoundaries(loadMaintenanceBoundaryArtifact(), {
      lat: query.center.lat, lng: query.center.lng, radiusM: query.radiusM,
    }),
  });
}

async function defaultAttributes(refresh: boolean): Promise<ResolvedSource<AttributePayload>> {
  return resolveSource({
    source: "maintenance_attributes", lat: 0, lng: 0, radiusM: 0, refresh,
    fetcher: () => fetchNationalMaintenanceAttributes(),
  });
}

function defaultRegional(source: "maintenance_seoul" | "maintenance_busan", refresh: boolean) {
  return async (query: RegionalProviderQuery): Promise<ResolvedSource<readonly RegionalMaintenanceRecord[]>> => resolveSource({
    source, lat: query.center.lat, lng: query.center.lng, radiusM: query.radiusM, refresh,
    fetcher: () => source === "maintenance_seoul"
      ? fetchSeoulMaintenanceRecords({ query, geocoder: defaultGeocoder() })
      : fetchBusanMaintenanceRecords({ query, geocoder: defaultGeocoder() }),
  });
}

function regionsFromBoundaries(boundaries: readonly MaintenanceBoundaryFeature[]): SelectedMaintenanceRegion[] {
  const unique = new Map<string, SelectedMaintenanceRegion>();
  for (const boundary of boundaries) {
    const sido = boundary.properties.sido?.trim();
    const sigungu = boundary.properties.sigungu?.trim();
    if (sido && sigungu) unique.set(`${sido}|${sigungu}`, { sido, sigungu });
  }
  return [...unique.values()];
}

function status(source: SourceStatus["source"], result: ResolvedSource<unknown>): SourceStatus {
  return { source, status: result.status, fetchedAt: result.fetchedAt };
}

function failedWarnings(sources: readonly SourceStatus[]): string[] {
  return sources.filter(({ status: value }) => value === "failed")
    .map(({ source }) => `정비사업 소스 실패: ${source}`);
}

export async function searchMaintenanceProjects(
  query: MaintenanceSearchQuery,
  dependencies: MaintenanceSearchDependencies = {},
): Promise<MaintenanceSearchResult> {
  const boundaryPromise = (dependencies.resolveBoundaries ?? defaultBoundaries)(query);
  const attributePromise = (dependencies.resolveAttributes ?? defaultAttributes)(query.refresh);
  const [boundaryResult, attributeResult] = await Promise.all([boundaryPromise, attributePromise]);
  const boundaries = boundaryResult.value ?? [];
  let selectedRegions = regionsFromBoundaries(boundaries);
  if (!selectedRegions.length) {
    const region = await (dependencies.reverseGeocodeAdmin ?? defaultReverseGeocode)(query.center);
    selectedRegions = region ? [region] : [];
  }
  const regionalQuery = { center: query.center, radiusM: query.radiusM, regions: selectedRegions };
  const [seoulResult, busanResult] = await Promise.all([
    (dependencies.resolveSeoul ?? defaultRegional("maintenance_seoul", query.refresh))(regionalQuery),
    (dependencies.resolveBusan ?? defaultRegional("maintenance_busan", query.refresh))(regionalQuery),
  ]);
  const attributes = attributeResult.value;
  const merged = mergeMaintenanceData({
    boundaries, attributes: attributes ? [...attributes.integrated, ...attributes.standard] : [],
    regional: [...(seoulResult.value ?? []), ...(busanResult.value ?? [])], selectedRegions,
  });
  const sources = [
    status("maintenance_boundaries", boundaryResult), status("maintenance_attributes", attributeResult),
    status("maintenance_seoul", seoulResult), status("maintenance_busan", busanResult),
  ];
  const warnings = failedWarnings(sources);
  if (!selectedRegions.length) warnings.push("정비사업 행정구역을 확인할 수 없어 목록 데이터를 표시하지 않습니다");
  return { projects: merged.projects, catalog: merged.catalog, sources, warnings };
}
