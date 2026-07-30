export type PoiCategory = "subway" | "school" | "park" | "mountain" | "apartment" | "officetel" | "residential" | "maintenance";

/** 외부 데이터 소스 식별자 (1단계 데이터 신뢰성) */
export type PoiSourceId =
  | "osm"
  | "park"
  | "maintenance"
  | "maintenance_attributes"
  | "maintenance_boundaries"
  | "maintenance_seoul"
  | "maintenance_seoul_cleanup"
  | "maintenance_busan"
  | "residential"
  | "planned-residential"
  | "subway-routes"
  | "rail-network";

export const MAINTENANCE_SOURCE_IDS = [
  "maintenance_boundaries",
  "maintenance_attributes",
  "maintenance_seoul",
  "maintenance_seoul_cleanup",
  "maintenance_busan",
] as const;

export interface SourceStatus {
  readonly source: PoiSourceId;
  /** "fresh"=방금 수집, "cached"=저장본 사용, "failed"=수집 실패·저장본도 없음 */
  readonly status: "fresh" | "cached" | "failed";
  /** 수집 시각(epoch ms). failed면 null */
  readonly fetchedAt: number | null;
}

export const POI_SOURCE_CATEGORIES: Record<PoiSourceId, readonly PoiCategory[]> = {
  osm: ["subway", "school", "mountain"],
  park: ["park"],
  maintenance: ["maintenance"],
  maintenance_attributes: ["maintenance"],
  maintenance_boundaries: ["maintenance"],
  maintenance_seoul: ["maintenance"],
  maintenance_seoul_cleanup: ["maintenance"],
  maintenance_busan: ["maintenance"],
  residential: ["apartment", "officetel", "residential"],
  "planned-residential": ["apartment", "officetel", "residential"],
  "subway-routes": ["subway"],
  "rail-network": ["subway"],
};

export const POI_SOURCE_LABELS: Record<PoiSourceId, string> = {
  osm: "지하철역·학교·산",
  park: "공원",
  maintenance: "정비사업",
  maintenance_attributes: "국토부 전국 정비사업",
  maintenance_boundaries: "국토부 정비구역 경계",
  maintenance_seoul: "서울 정비사업 상세",
  maintenance_seoul_cleanup: "서울 정비사업 정보몽땅",
  maintenance_busan: "부산 정비사업 상세",
  residential: "주거 단지",
  "planned-residential": "분양 예정",
  "subway-routes": "지하철 노선",
  "rail-network": "철도 노선",
};

export interface PoiBase {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly category: PoiCategory;
}

export type ResidentialStatus = "existing" | "planned";
export type ResidentialSource = "ledger" | "applyhome" | "housing_permit";

export interface ResidentialFloorplan {
  readonly housing_type: string;
  readonly area_sqm?: number;
  readonly image_url?: string;
  readonly source_url: string;
  readonly status: "thumbnail" | "link_only";
}

interface ResidentialFields {
  readonly units: number;
  readonly parking_count: number;
  readonly sale_date: string;
  readonly distance_m: number;
  readonly status: ResidentialStatus;
  readonly source: ResidentialSource;
  readonly max_floor?: number;
  /** K-APT 동수 */
  readonly dong_count?: number;
  /** K-APT 시공사 */
  readonly constructor_name?: string;
  /** K-APT 부대복리시설 목록 (쉼표 구분 원문) */
  readonly welfare_facilities?: string;
  readonly move_in_month?: string;
  readonly homepage_url?: string;
  readonly notice_url?: string;
  readonly floorplans?: readonly ResidentialFloorplan[];
}

export interface SubwayStation extends PoiBase {
  readonly category: "subway";
  readonly line: string;
  readonly lineColor: string;
}

export interface School extends PoiBase {
  readonly category: "school";
  readonly level: "elementary" | "middle" | "high";
}

export type ParkQuality = "major" | "neighborhood" | "children" | "small" | "green" | "unknown";
export type ParkSource = "official" | "osm";

export interface Park extends PoiBase {
  readonly category: "park";
  readonly area_sqm: number;
  readonly type: string;
  readonly park_type?: string;
  readonly distance_m?: number;
  readonly access_distance_m?: number;
  readonly address?: string;
  readonly facilities?: readonly string[];
  readonly source?: ParkSource;
  readonly quality?: ParkQuality;
  readonly boundary?: readonly [number, number][];
}

export interface Mountain extends PoiBase {
  readonly category: "mountain";
  readonly elevation_m: number;
}

export interface Apartment extends PoiBase, ResidentialFields {
  readonly category: "apartment";
}

export interface Officetel extends PoiBase, ResidentialFields {
  readonly category: "officetel";
}

export interface ResidentialOther extends PoiBase, ResidentialFields {
  readonly category: "residential";
}

/** Any POI with residential fields (apartment, officetel, residential) */
export type ResidentialPoi = Apartment | Officetel | ResidentialOther;

export type MaintenanceStage =
  | "구역지정/변경"
  | "추진위"
  | "조합설립"
  | "사업시행인가"
  | "관리처분"
  | "착공"
  | "준공"
  | "미확인";

export type MaintenanceBoundary =
  | {
      readonly type: "Polygon";
      readonly coordinates: readonly (readonly (readonly [number, number])[])[];
    }
  | {
      readonly type: "MultiPolygon";
      readonly coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[];
    };

export type MaintenanceBoundaryStatus = "confirmed" | "unmatched" | "unavailable";
export type MaintenanceSource =
  | "molit_integrated"
  | "public_standard"
  | "molit_spatial"
  | "seoul_open_data"
  | "busan_data_go_kr";

export interface MaintenanceCatalogProject {
  readonly id: string;
  readonly name: string;
  readonly sido: string;
  readonly sigungu: string;
  readonly type: string;
  readonly stage: MaintenanceStage;
  readonly source: MaintenanceSource;
  readonly source_updated_at?: string;
  readonly implementer?: string;
  readonly planned_households?: number;
  readonly area_sqm?: number;
  readonly designation_date?: string;
  readonly management_agency?: string;
  readonly spatial_status: "not_located";
}

export interface MaintenanceProject extends PoiBase {
  readonly category: "maintenance";
  readonly type: string;
  readonly stage: MaintenanceStage;
  /** 정보몽땅 세분 단계 원문(예: "조합해산", "이전고시") — stage보다 상세 */
  readonly stage_detail?: string;
  readonly address: string;
  readonly area_sqm: number;
  readonly boundary?: MaintenanceBoundary;
  readonly notice_code?: string;
  readonly notice_url?: string;
  readonly source: MaintenanceSource;
  readonly source_updated_at?: string;
  readonly boundary_status: MaintenanceBoundaryStatus;
  readonly boundary_source_url?: string;
  readonly boundary_source_id?: string;
  readonly boundary_retrieved_at?: string;
  readonly boundary_original_crs?: string;
  readonly distance_m?: number;
  readonly implementer?: string;
  readonly planned_households?: number;
  readonly floor_area_ratio?: number;
  readonly building_coverage_ratio?: number;
  readonly designation_date?: string;
  readonly land_use_zone?: string;
  readonly management_agency?: string;
  readonly contractor?: string;
  readonly architect?: string;
  readonly union_members?: number;
}

export type Poi = SubwayStation | School | Park | Mountain | Apartment | Officetel | ResidentialOther | MaintenanceProject;

export interface SubwayRoute {
  readonly line: string;
  readonly lineColor: string;
  readonly stationIds: readonly string[];
  readonly coordinates?: readonly [number, number][]; // [lat, lng] — 실제 경로의 모든 점
}

export interface PoiPosition {
  readonly poi: Poi;
  readonly nx: number;
  readonly ny: number;
}

export interface RadiusPosition {
  readonly centerNx: number;
  readonly centerNy: number;
  readonly radiusNx: number;
  readonly radiusNy: number;
}

export interface AnalysisConfig {
  readonly centerName: string;
  readonly centerLat: number;
  readonly centerLng: number;
  readonly radiusKm: number;
}

export interface LayerVisibility {
  readonly subway: boolean;
  readonly school: boolean;
  readonly park: boolean;
  readonly mountain: boolean;
  readonly apartment: boolean;
  readonly officetel: boolean;
  readonly residential: boolean;
  readonly maintenance: boolean;
}

export interface RegionData {
  readonly regionCode: string;
  readonly regionName: string;
  readonly address: string;
  readonly aliases: readonly string[];
  readonly defaultConfig: AnalysisConfig;
  readonly subwayStations: readonly SubwayStation[];
  readonly schools: readonly School[];
  readonly parks: readonly Park[];
  readonly mountains: readonly Mountain[];
  readonly apartments: readonly Apartment[];
  readonly officetels: readonly Officetel[];
  readonly residentialOthers: readonly ResidentialOther[];
  readonly maintenanceProjects: readonly MaintenanceProject[];
  readonly maintenanceCatalog: readonly MaintenanceCatalogProject[];
  readonly subwayRoutes: readonly SubwayRoute[];
  /** 1단계 데이터 신뢰성: 소스별 수집 상태(fresh/cached/failed) — 사이드바 재시도 UI(Task 6)에서 사용 */
  readonly sourceStatuses: readonly SourceStatus[];
}

export const CATEGORY_COLORS: Record<PoiCategory, string> = {
  apartment: "#EF4444",
  officetel: "#F97316",
  residential: "#A855F7",
  maintenance: "#EC4899",
  subway: "#F59E0B",
  school: "#3B82F6",
  park: "#10B981",
  mountain: "#10B981",
} as const;

export const THEME_COLORS = {
  primaryNavy: "#1E3A8A",
  secondaryNavy: "#3B82F6",
  pureWhite: "#FFFFFF",
  overlayDark: "#0F172A",
  overlayLight: "#F8FAFC",
  background: "#F1F5F9",
  sidebarBg: "#1E3A8A",
  accent: "#3B82F6",
} as const;

export const CATEGORY_LABELS: Record<PoiCategory, string> = {
  subway: "지하철역",
  school: "학교",
  park: "공원",
  mountain: "산",
  apartment: "아파트단지",
  officetel: "오피스텔",
  residential: "기타 주거시설",
  maintenance: "정비사업",
} as const;

/** Categories that share the residential year filter */
export const RESIDENTIAL_CATEGORIES: readonly PoiCategory[] = ["apartment", "officetel", "residential"] as const;
