export type PoiCategory = "subway" | "school" | "park" | "mountain" | "apartment";

export interface PoiBase {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly category: PoiCategory;
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

export interface Park extends PoiBase {
  readonly category: "park";
  readonly area_sqm: number;
  readonly type: string;
}

export interface Mountain extends PoiBase {
  readonly category: "mountain";
  readonly elevation_m: number;
}

export interface Apartment extends PoiBase {
  readonly category: "apartment";
  readonly units: number;
  readonly price_per_pyeong: number;
  readonly sale_date: string;
  readonly distance_m: number;
}

export type Poi = SubwayStation | School | Park | Mountain | Apartment;

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
}

export const CATEGORY_COLORS: Record<PoiCategory, string> = {
  apartment: "#EF4444",
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
  background: "#F1F5F9", // Light grey background for the app frame if needed, or Navy
  sidebarBg: "#1E3A8A",
  accent: "#3B82F6",
} as const;

export const CATEGORY_LABELS: Record<PoiCategory, string> = {
  subway: "지하철역",
  school: "학교",
  park: "공원",
  mountain: "산",
  apartment: "분양 아파트",
} as const;
