import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  booleanIntersects,
  booleanPointInPolygon,
  booleanValid,
  circle,
  kinks,
  lineString,
  multiPolygon,
  point,
  pointOnFeature,
  pointToLineDistance,
  polygon,
} from "@turf/turf";
import type { Feature, MultiPolygon, Point, Polygon } from "geojson";
import { z } from "zod";

import type { MaintenanceBoundary } from "../../types";
import type { MaintenanceBoundaryProperties } from "./boundary-build";

const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z.array(positionSchema).min(4);
const polygonCoordinatesSchema = z.array(ringSchema).min(1);
const boundarySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygonCoordinatesSchema }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonCoordinatesSchema).min(1) }),
]);
const propertiesSchema = z.object({
  source_feature_id: z.string().min(1),
  source_dataset_id: z.union([z.literal("30335"), z.literal("30336")]),
  source_layer: z.union([z.literal("UD602"), z.literal("UD501")]),
  name: z.string().optional(),
  sido: z.string().optional(),
  sigungu: z.string().optional(),
  area_sqm: z.number().finite().optional(),
  designation_date: z.string().optional(),
  notice_ids: z.array(z.string()),
  original_crs: z.union([z.literal("EPSG:5186"), z.literal("EPSG:2097"), z.literal("EPSG:5174")]),
  source_url: z.string().min(1),
  source_updated_at: z.string().optional(),
  retrieved_at: z.string().min(1),
  bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
});
const artifactSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    geometry: boundarySchema,
    properties: propertiesSchema,
  })).min(1),
});

export interface MaintenanceBoundaryFeature {
  readonly type: "Feature";
  readonly geometry: MaintenanceBoundary;
  readonly properties: MaintenanceBoundaryProperties;
}

export interface LocatedMaintenanceBoundary extends MaintenanceBoundaryFeature {
  readonly distance_m: number;
  readonly representative_lat: number;
  readonly representative_lng: number;
}

export type MaintenanceBoundarySearchQuery = {
  readonly lat: number;
  readonly lng: number;
  readonly radiusM: number;
};

type ArtifactCacheEntry = {
  readonly mtimeMs: number;
  readonly features: readonly MaintenanceBoundaryFeature[];
};

export class MaintenanceBoundaryArtifactError extends Error {
  readonly name = "MaintenanceBoundaryArtifactError";
  constructor(
    readonly code: "UNREADABLE" | "MALFORMED" | "INVALID_SCHEMA",
    readonly artifactPath: string,
    cause: unknown,
  ) {
    super(`Maintenance boundary artifact ${code.toLowerCase()}: ${artifactPath}`, { cause });
  }
}

class InvalidMaintenanceBoundaryError extends Error {
  readonly name = "InvalidMaintenanceBoundaryError";
  constructor(
    readonly sourceFeatureId: string,
    readonly reason: "UNCLOSED_RING" | "COORDINATE_OUT_OF_BOUNDS" | "BBOX_MISMATCH" | "INVALID_GEOMETRY",
  ) {
    super(`Invalid maintenance boundary ${sourceFeatureId}: ${reason.toLowerCase()}`);
  }
}

const artifactCache = new Map<string, ArtifactCacheEntry>();

function readArtifact(artifactPath: string): readonly MaintenanceBoundaryFeature[] {
  let raw: string;
  try {
    raw = readFileSync(artifactPath, "utf8");
  } catch (error) {
    throw new MaintenanceBoundaryArtifactError("UNREADABLE", artifactPath, error);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new MaintenanceBoundaryArtifactError("MALFORMED", artifactPath, error);
  }
  const parsed = artifactSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new MaintenanceBoundaryArtifactError("INVALID_SCHEMA", artifactPath, parsed.error);
  }
  try {
    for (const feature of parsed.data.features) validateBoundaryFeature(feature);
  } catch (error) {
    if (error instanceof InvalidMaintenanceBoundaryError) {
      throw new MaintenanceBoundaryArtifactError("INVALID_SCHEMA", artifactPath, error);
    }
    throw error;
  }
  return parsed.data.features;
}

export function loadMaintenanceBoundaryArtifact(
  artifactPath = join(process.cwd(), "data/maintenance/processed/boundaries.geojson"),
): readonly MaintenanceBoundaryFeature[] {
  const absolutePath = resolve(artifactPath);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(absolutePath).mtimeMs;
  } catch (error) {
    throw new MaintenanceBoundaryArtifactError("UNREADABLE", absolutePath, error);
  }
  const cached = artifactCache.get(absolutePath);
  if (cached?.mtimeMs === mtimeMs) return cached.features;
  const features = readArtifact(absolutePath);
  artifactCache.set(absolutePath, { mtimeMs, features });
  return features;
}

function turfFeature(boundary: MaintenanceBoundary): Feature<Polygon | MultiPolygon> {
  switch (boundary.type) {
    case "Polygon":
      return polygon(boundary.coordinates.map((ring) => ring.map(([lng, lat]) => [lng, lat])));
    case "MultiPolygon":
      return multiPolygon(boundary.coordinates.map((part) =>
        part.map((ring) => ring.map(([lng, lat]) => [lng, lat])),
      ));
  }
}

function validateBoundaryFeature(feature: MaintenanceBoundaryFeature): void {
  const parts = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let geometryWest = Number.POSITIVE_INFINITY;
  let geometrySouth = Number.POSITIVE_INFINITY;
  let geometryEast = Number.NEGATIVE_INFINITY;
  let geometryNorth = Number.NEGATIVE_INFINITY;
  for (const part of parts) {
    for (const ring of part) {
      const first = ring[0];
      const last = ring.at(-1);
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        throw new InvalidMaintenanceBoundaryError(feature.properties.source_feature_id, "UNCLOSED_RING");
      }
      for (const [lng, lat] of ring) {
        if (lng < 124 || lng > 132 || lat < 33 || lat > 39.5) {
          throw new InvalidMaintenanceBoundaryError(feature.properties.source_feature_id, "COORDINATE_OUT_OF_BOUNDS");
        }
        geometryWest = Math.min(geometryWest, lng);
        geometrySouth = Math.min(geometrySouth, lat);
        geometryEast = Math.max(geometryEast, lng);
        geometryNorth = Math.max(geometryNorth, lat);
      }
    }
  }
  const [west, south, east, north] = feature.properties.bbox;
  if (west > east || south > north
    || west !== geometryWest || south !== geometrySouth || east !== geometryEast || north !== geometryNorth) {
    throw new InvalidMaintenanceBoundaryError(feature.properties.source_feature_id, "BBOX_MISMATCH");
  }
  const geometryFeature = turfFeature(feature.geometry);
  if (!booleanValid(geometryFeature) || kinks(geometryFeature).features.length > 0) {
    throw new InvalidMaintenanceBoundaryError(feature.properties.source_feature_id, "INVALID_GEOMETRY");
  }
}

function boundaryDistanceM(boundary: MaintenanceBoundary, center: Feature<Point>): number {
  const polygons = boundary.type === "Polygon" ? [boundary.coordinates] : boundary.coordinates;
  let minimum = Number.POSITIVE_INFINITY;
  for (const part of polygons) {
    for (const ring of part) {
      minimum = Math.min(
        minimum,
        pointToLineDistance(center, lineString(ring.map(([lng, lat]) => [lng, lat])), { units: "meters" }),
      );
    }
  }
  return minimum;
}

function normalizedName(feature: MaintenanceBoundaryFeature): string {
  return (feature.properties.name ?? "").normalize("NFKC").trim().replaceAll(/\s+/g, " ");
}

export function searchMaintenanceBoundaries(
  features: readonly MaintenanceBoundaryFeature[],
  query: MaintenanceBoundarySearchQuery,
): readonly LocatedMaintenanceBoundary[] {
  const center = point([query.lng, query.lat]);
  const searchCircle = circle(center, query.radiusM, { units: "meters" });
  const circleCoordinates = searchCircle.geometry.coordinates[0] ?? [];
  const lngs = circleCoordinates.map(([lng]) => lng);
  const lats = circleCoordinates.map(([, lat]) => lat);
  const searchBbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as const;
  const located: LocatedMaintenanceBoundary[] = [];

  for (const feature of features) {
    const [west, south, east, north] = feature.properties.bbox;
    if (east < searchBbox[0] || west > searchBbox[2] || north < searchBbox[1] || south > searchBbox[3]) continue;
    const geometryFeature = turfFeature(feature.geometry);
    if (!booleanIntersects(geometryFeature, searchCircle)) continue;
    const distanceM = booleanPointInPolygon(center, geometryFeature)
      ? 0
      : boundaryDistanceM(feature.geometry, center);
    const representative = pointOnFeature(geometryFeature).geometry.coordinates;
    const [representativeLng, representativeLat] = representative;
    located.push({
      ...feature,
      distance_m: distanceM,
      representative_lat: representativeLat,
      representative_lng: representativeLng,
    });
  }

  return located.toSorted((left, right) =>
    left.distance_m - right.distance_m
    || normalizedName(left).localeCompare(normalizedName(right), "ko-KR")
    || left.properties.source_feature_id.localeCompare(right.properties.source_feature_id),
  );
}
