import type { AnalysisConfig, LayerVisibility, Poi } from "./types";

export interface SavedApartmentFilter {
  readonly enabled: boolean;
  readonly minYear: number;
}

export interface AnalysisProjectPayload {
  readonly config: AnalysisConfig;
  readonly layers: LayerVisibility;
  readonly manualPois: readonly Poi[];
  readonly apartmentFilter: SavedApartmentFilter;
}

export interface AnalysisProjectRecord {
  readonly id: number;
  readonly title: string;
  readonly centerName: string;
  readonly centerLat: number;
  readonly centerLng: number;
  readonly radiusKm: number;
  readonly payload: AnalysisProjectPayload;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AnalysisProjectSummary {
  readonly id: number;
  readonly title: string;
  readonly centerName: string;
  readonly centerLat: number;
  readonly centerLng: number;
  readonly radiusKm: number;
  readonly manualPoiCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ApiKeyStatusItem {
  readonly key: string;
  readonly label: string;
  readonly configured: boolean;
  readonly masked?: string;
  readonly requiredFor: string;
}

export interface ApiKeyStatusResponse {
  readonly ready: boolean;
  readonly configuredCount: number;
  readonly totalCount: number;
  readonly items: readonly ApiKeyStatusItem[];
}
