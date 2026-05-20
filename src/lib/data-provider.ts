import type {
  Poi,
  RegionData,
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
import type {
  AnalysisProjectPayload,
  AnalysisProjectRecord,
  AnalysisProjectSummary,
  ApiKeyStatusResponse,
} from "./project-types";
import { authFetch } from "./auth-fetch";

const dynamicCache = new Map<string, RegionData>();

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/site";

function resolvePath(path: string): string {
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

export interface AddressSearchResult {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly lat: number;
  readonly lng: number;
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

export async function loadDynamicRegion(lat: number, lng: number, radiusKm: number): Promise<RegionData> {
  const cacheKey = `dynamic-${lat.toFixed(4)}-${lng.toFixed(4)}-${radiusKm}`;
  const cached = dynamicCache.get(cacheKey);
  if (cached) return cached;

  const radiusM = Math.round(radiusKm * 1000);
  const routeRadiusM = Math.round(radiusM * 1.8); // wider radius so lines extend beyond the analysis circle

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

  const [poiResponse, routeResponse] = await Promise.all([
    fetchJson<{ pois: Poi[] }>(`/api/poi-search?${poiParams.toString()}`),
    fetchJson<{ routes: SubwayRoute[] }>(`/api/subway-routes?${routeParams.toString()}`).catch(
      () => ({ routes: [] as SubwayRoute[] })
    ),
  ]);

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
    subwayStations: poiResponse.pois.filter((poi): poi is SubwayStation => poi.category === "subway"),
    schools: poiResponse.pois.filter((poi): poi is School => poi.category === "school"),
    parks: poiResponse.pois.filter((poi): poi is Park => poi.category === "park"),
    mountains: poiResponse.pois.filter((poi): poi is Mountain => poi.category === "mountain"),
    apartments: poiResponse.pois.filter((poi): poi is Apartment => poi.category === "apartment"),
    officetels: poiResponse.pois.filter((poi): poi is Officetel => poi.category === "officetel"),
    residentialOthers: poiResponse.pois.filter((poi): poi is ResidentialOther => poi.category === "residential"),
    maintenanceProjects: poiResponse.pois.filter((poi): poi is MaintenanceProject => poi.category === "maintenance"),
    subwayRoutes: routeResponse.routes,
  };

  dynamicCache.set(cacheKey, regionData);
  return regionData;
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
