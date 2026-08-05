import type {
  Poi,
  PoiSourceId,
  RegionData,
  SourceStatus,
  SubwayRoute,
  SubwayStation,
  School,
  Park,
  Mountain,
  Apartment,
  Officetel,
  ResidentialOther,
  MaintenanceProject,
} from "./types";
import { POI_SOURCE_CATEGORIES } from "./types";
import type {
  AnalysisProjectPayload,
  AnalysisProjectRecord,
  AnalysisProjectSummary,
  ApiKeyStatusResponse,
} from "./project-types";
import { authFetch } from "./auth-fetch";
import type { RailNetworkResponse } from "./rail-types";

const dynamicCache = new Map<string, RegionData>();

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/site";

export function resolvePath(path: string): string {
  if (typeof window === "undefined") return path;
  if (path.startsWith("http")) return path;
  return `${BASE_PATH}${path}`;
}

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isApiRoute = path.startsWith("/api/");
  const url = resolvePath(path);
  let res: Response;

  if (isApiRoute && typeof window !== "undefined") {
    res = await authFetch(url, options);
  } else {
    res = await fetch(url, options);
  }

  if (!res.ok) {
    const responseText = await res.text();
    let errorBody: { error?: string } | null = null;

    if (responseText) {
      try {
        errorBody = JSON.parse(responseText) as { error?: string };
      } catch {
        errorBody = { error: responseText };
      }
    }

    throw new Error(errorBody?.error ?? `Failed to fetch ${path}: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function mapRailStations(response: RailNetworkResponse): readonly SubwayStation[] {
  return response.stations.map((station) => {
    const firstMembership = station.memberships[0];
    const lineNames = station.memberships
      .map((membership) => membership.lineRef || membership.lineName)
      .filter((name) => name.length > 0);
    return {
      id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      category: "subway",
      line: lineNames.join("·") || "미확인",
      lineColor: firstMembership?.color || "#64748B",
      lineNames,
    } satisfies SubwayStation;
  });
}

export interface AddressSearchResult {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
}

/**
 * 좌표 → 법정동 주소명("강남구 개포동"). 좌표만 수동 수정된 분석의 보고서 제목 갱신용.
 * 실패 시 null — 호출부가 기존 이름 유지 여부를 결정한다.
 */
export async function reverseGeocodeName(lat: number, lng: number): Promise<string | null> {
  try {
    const response = await fetchJson<{ name: string }>(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
    return response.name || null;
  } catch {
    return null;
  }
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

export async function loadDynamicRegion(
  lat: number,
  lng: number,
  radiusKm: number,
  opts: { forceRefresh?: boolean } = {},
): Promise<RegionData> {
  const cacheKey = `dynamic-${lat.toFixed(4)}-${lng.toFixed(4)}-${radiusKm}`;
  const cached = dynamicCache.get(cacheKey);
  // 1단계 데이터 신뢰성: forceRefresh면 클라이언트 메모리 캐시를 무시하고 새로 수집(아래 set에서 갱신)
  if (!opts.forceRefresh && cached) return cached;

  const radiusM = Math.round(radiusKm * 1000);
  const routeRadiusM = Math.round(radiusM * 1.8); // wider radius so lines extend beyond the analysis circle
  const refreshQs = opts.forceRefresh ? "&refresh=true" : "";

  const poiParams = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius: String(radiusM),
    categories: "subway,school,park,mountain,apartment,officetel,residential,maintenance",
    planned: "true",
  });
  const routeParams = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    radius: String(routeRadiusM),
  });

  const poiResponsePromise = fetchJson<{ pois: Poi[]; warnings: string[]; sources: SourceStatus[] }>(
    `/api/poi-search?${poiParams.toString()}${refreshQs}`
  ).catch(() => ({
    pois: [] as Poi[],
    warnings: ["POI API를 사용할 수 없어 철도 네트워크만 표시합니다."],
    sources: (["osm", "park", "maintenance", "residential", "planned-residential"] as const).map(
      (source): SourceStatus => ({ source, status: "failed", fetchedAt: null })
    ),
  }));

  const [poiResponse, routeResponse] = await Promise.all([
    poiResponsePromise,
    fetchJson<RailNetworkResponse>(
      `/api/rail-network?${routeParams.toString()}&include=operational,planned${refreshQs}`
    ).catch(() => null),
  ]);

  const railResponse = routeResponse;
  const railSource = railResponse?.source ?? {
    source: "rail-network" as const,
    status: "failed" as const,
    fetchedAt: null,
  };
  const subwayStations = railResponse ? mapRailStations(railResponse) : [];
  const nonSubwayPois = poiResponse.pois.filter((poi) => poi.category !== "subway");

  const regionData: RegionData = {
    regionCode: "custom",
    regionName: "실시간 검색 결과",
    address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    aliases: [],
    defaultConfig: {
      centerName: "실시간 검색",
      centerLat: lat,
      centerLng: lng,
      radiusKm,
    },
    subwayStations,
    schools: nonSubwayPois.filter((poi): poi is School => poi.category === "school"),
    parks: nonSubwayPois.filter((poi): poi is Park => poi.category === "park"),
    mountains: nonSubwayPois.filter((poi): poi is Mountain => poi.category === "mountain"),
    apartments: nonSubwayPois.filter((poi): poi is Apartment => poi.category === "apartment"),
    officetels: nonSubwayPois.filter((poi): poi is Officetel => poi.category === "officetel"),
    residentialOthers: nonSubwayPois.filter((poi): poi is ResidentialOther => poi.category === "residential"),
    maintenanceProjects: nonSubwayPois.filter((poi): poi is MaintenanceProject => poi.category === "maintenance"),
    subwayRoutes: railResponse?.routes ?? [],
    sourceStatuses: [...poiResponse.sources, railSource],
    railSnapshotVersion: railResponse?.snapshotVersion,
    subwayMapData: railResponse?.mapData,
    plannedRailProjects: railResponse?.plannedProjects ?? [],
  };

  dynamicCache.set(cacheKey, regionData);
  return regionData;
}

/**
 * 1단계 데이터 신뢰성: 소스 단독 재수집(재시도).
 * subway-routes는 routes를 별도로 반환하고(pois는 빈 배열), 그 외 소스는 poi-search의
 * sources 전체를 allSources로 함께 반환한다 — residential/planned-residential이 같은 카테고리를
 * 공유해 함께 재수집되므로, 호출측에서 두 소스 상태를 모두 갱신할 수 있도록 하기 위함.
 */
export async function reloadSource(
  lat: number,
  lng: number,
  radiusKm: number,
  source: PoiSourceId,
): Promise<{ pois: Poi[]; routes?: SubwayRoute[]; status: SourceStatus; allSources?: SourceStatus[] }> {
  const radiusM = Math.round(radiusKm * 1000);

  if (source === "subway-routes") {
    const routeRadiusM = Math.round(radiusM * 1.8);
    // 주의: fetchJson이 내부에서 resolvePath를 호출하므로 여기서 미리 감싸면 안 됨(authFetch 판별용 "/api/" 접두 검사가 깨짐)
    const res = await fetchJson<{ routes: SubwayRoute[]; source: SourceStatus }>(
      `/api/subway-routes?lat=${lat}&lng=${lng}&radius=${routeRadiusM}&refresh=true`
    );
    return { pois: [], routes: res.routes, status: res.source };
  }

  const cats = POI_SOURCE_CATEGORIES[source].join(",");
  const res = await fetchJson<{ pois: Poi[]; sources: SourceStatus[] }>(
    `/api/poi-search?lat=${lat}&lng=${lng}&radius=${radiusM}&categories=${cats}&refresh=true`
  );
  const status = res.sources.find((s) => s.source === source) ?? { source, status: "failed" as const, fetchedAt: null };
  return { pois: res.pois, status, allSources: res.sources };
}

export function clearDynamicRegionCache(): void {
  dynamicCache.clear();
}

export async function getApiKeyStatus(): Promise<ApiKeyStatusResponse> {
  return fetchJson<ApiKeyStatusResponse>("/api/user/api-key-status");
}

export async function listAnalysisProjects(): Promise<readonly AnalysisProjectSummary[]> {
  const response = await fetchJson<{ projects: AnalysisProjectSummary[] }>("/api/projects");
  return response.projects;
}

export async function saveAnalysisProject(
  title: string,
  payload: AnalysisProjectPayload,
  projectId?: number,
): Promise<AnalysisProjectRecord> {
  const response = await fetchJson<{ project: AnalysisProjectRecord }>(
    projectId ? `/api/projects/${projectId}` : "/api/projects",
    {
      method: projectId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, payload }),
    } as RequestInit,
  );
  return response.project;
}

export async function loadAnalysisProject(projectId: number): Promise<AnalysisProjectRecord> {
  const response = await fetchJson<{ project: AnalysisProjectRecord }>(`/api/projects/${projectId}`);
  return response.project;
}

export async function deleteAnalysisProject(projectId: number): Promise<void> {
  await fetchJson<{ ok: boolean }>(`/api/projects/${projectId}`, { method: "DELETE" } as RequestInit);
}
