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
  subway: "#2196F3",
  school: "#4CAF50",
  park: "#66BB6A",
  mountain: "#8D6E63",
  apartment: "#FF7043",
} as const;

export const CATEGORY_LABELS: Record<PoiCategory, string> = {
  subway: "지하철역",
  school: "학교",
  park: "공원",
  mountain: "산",
  apartment: "분양 아파트",
} as const;
