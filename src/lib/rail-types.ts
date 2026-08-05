import type { SubwayMapResponse } from "./osm-subway-overlay";
import type { SourceStatus, SubwayRoute } from "./types";

export type RailLineMembership = {
  readonly lineId: string;
  readonly lineRef: string;
  readonly lineName: string;
  readonly color: string;
};

export type RailStation = {
  readonly id: string;
  readonly osmId: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly memberships: readonly RailLineMembership[];
};

export type RailLine = {
  readonly id: string;
  readonly osmId: string;
  readonly lineRef: string;
  readonly name: string;
  readonly color: string;
  readonly geometry: unknown;
};

export type PlannedRailGeometry =
  | {
    readonly type: "LineString";
    readonly coordinates: readonly (readonly [number, number])[];
  }
  | {
    readonly type: "MultiLineString";
    readonly coordinates: readonly (readonly (readonly [number, number])[])[];
  };

export type PlannedRailEvidence = {
  readonly url: string;
  readonly publisher: string;
  readonly retrievedAt: string;
  readonly publishedAt?: string;
  readonly sha256?: string;
  readonly pageOrSection: string;
  readonly crs: string;
  readonly extractionMethod: string;
};

export type PlannedRailSegment = {
  readonly segmentId: string;
  readonly lifecycle: "operating" | "under_construction" | "planned" | "proposed";
  readonly operatingOverlap: "none" | "partial" | "full";
};

export type PlannedRailProject = {
  readonly projectId: string;
  readonly lineName: string;
  readonly lifecycleStatus: "proposed" | "approved" | "under_construction" | "opening_confirmed";
  readonly statusEvidence: readonly PlannedRailEvidence[];
  readonly geometryEvidence: readonly PlannedRailEvidence[];
  readonly reviewStatus: "reviewed" | "pending" | "deferred";
  readonly nextReviewAt: string;
  readonly segments: readonly PlannedRailSegment[];
  readonly geometry: PlannedRailGeometry;
  readonly stations: readonly { readonly name: string; readonly lat: number; readonly lng: number }[];
  readonly sourceUrl: string;
  readonly geometrySourceUrl?: string;
  readonly geometrySourceLabel?: string;
  readonly sourceType: "official_gis" | "official_notice" | "georeferenced_pdf" | "approximation";
  readonly confidenceLabel: "high" | "medium" | "low";
  readonly lastVerifiedAt: string;
};

export type RailNetworkResponse = {
  readonly snapshotVersion: string;
  readonly stations: readonly RailStation[];
  readonly lines: readonly RailLine[];
  readonly routes: readonly SubwayRoute[];
  readonly plannedProjects: readonly PlannedRailProject[];
  readonly mapData: SubwayMapResponse;
  readonly source: SourceStatus;
};
