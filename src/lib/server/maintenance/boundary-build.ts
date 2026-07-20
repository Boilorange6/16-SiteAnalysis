import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";

import { booleanValid, kinks } from "@turf/turf";
import proj4 from "proj4";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

export type SupportedCrs = "EPSG:5186" | "EPSG:2097";
export type SourceDatasetId = "30335" | "30336";
export type SourceLayer = "UD602" | "UD501";

export interface MaintenanceBoundaryProperties {
  readonly source_feature_id: string;
  readonly source_dataset_id: SourceDatasetId;
  readonly source_layer: SourceLayer;
  readonly name?: string;
  readonly sido?: string;
  readonly sigungu?: string;
  readonly area_sqm?: number;
  readonly designation_date?: string;
  readonly notice_ids: readonly string[];
  readonly original_crs: SupportedCrs;
  readonly source_url: string;
  readonly source_updated_at?: string;
  readonly retrieved_at: string;
  readonly bbox: readonly [number, number, number, number];
}

export interface BoundaryBuildReport {
  readonly schema_version: 1;
  readonly input_sha256: readonly { readonly file: string; readonly sha256: string }[];
  readonly input_feature_count: number;
  readonly output_feature_count: number;
  readonly quarantined_feature_count: number;
  readonly crs_counts: Readonly<Record<string, number>>;
  readonly bbox: readonly [number, number, number, number];
  readonly source_updated_at: string | null;
  readonly transformed_at: string;
  readonly large_change_accepted: boolean;
}

export interface ArchiveLayer {
  readonly basename: string;
  readonly shp: string;
  readonly shx: string;
  readonly dbf: string;
  readonly prj: string;
}

export interface BoundarySource {
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly sourceDatasetId: SourceDatasetId;
  readonly sourceLayer: SourceLayer;
  readonly sourceUpdatedAt?: string;
}

type SourceGeometry =
  | { readonly type: "Polygon"; readonly coordinates: readonly (readonly (readonly [number, number])[])[] }
  | { readonly type: "MultiPolygon"; readonly coordinates: readonly (readonly (readonly (readonly [number, number])[])[])[] };

export interface BoundarySourceFeature {
  readonly geometry: SourceGeometry;
  readonly properties: Readonly<Record<string, unknown>>;
}

export type QuarantineReason = "non_finite_coordinate" | "coordinate_out_of_bounds" | "ring_too_short" | "invalid_geometry";

export interface BoundaryQuarantine {
  readonly reason: QuarantineReason;
  readonly source_feature_id: string;
  readonly raw_properties: Readonly<Record<string, unknown>>;
}

export interface BoundaryTransformResult {
  readonly feature: Feature<Polygon | MultiPolygon, MaintenanceBoundaryProperties>;
  readonly quarantine: BoundaryQuarantine | null;
}

export class BoundaryBuildError extends Error {
  readonly name = "BoundaryBuildError";
  constructor(readonly code: "INCOMPLETE_ARCHIVE" | "UNSUPPORTED_CRS", message: string) {
    super(message);
  }
}

proj4.defs("EPSG:5186", "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs");
proj4.defs("EPSG:2097", "+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-146.43,507.89,681.46 +units=m +no_defs");

export function identifySupportedCrs(wkt: string): SupportedCrs {
  const normalized = wkt.replaceAll(/\s+/g, " ").toUpperCase();
  const explicit5186 = /EPSG[\s":,]+5186/.test(normalized);
  const signature5186 = normalized.includes("KOREA 2000 / CENTRAL BELT 2010") && normalized.includes("GRS 1980");
  if (explicit5186 || signature5186) return "EPSG:5186";
  const explicit2097 = /EPSG[\s":,]+2097/.test(normalized);
  const signature2097 = normalized.includes("KOREAN 1985 / CENTRAL BELT") && normalized.includes("KOREAN 1985");
  if (explicit2097 || signature2097) return "EPSG:2097";
  throw new BoundaryBuildError("UNSUPPORTED_CRS", "Unsupported CRS: only EPSG:5186 and EPSG:2097 are accepted");
}

type PartialLayer = { basename: string; shp?: string; shx?: string; dbf?: string; prj?: string };

export function validateArchiveMembers(memberNames: readonly string[]): readonly ArchiveLayer[] {
  const groups = new Map<string, PartialLayer>();
  for (const member of memberNames) {
    const extension = extname(member).toLowerCase();
    if (![".shp", ".shx", ".dbf", ".prj"].includes(extension)) continue;
    const stem = basename(member, extname(member));
    const key = join(dirname(member), stem).replaceAll("\\", "/").toLowerCase();
    const group = groups.get(key) ?? { basename: key };
    switch (extension) {
      case ".shp": group.shp = member; break;
      case ".shx": group.shx = member; break;
      case ".dbf": group.dbf = member; break;
      case ".prj": group.prj = member; break;
    }
    groups.set(key, group);
  }
  if (groups.size === 0) throw new BoundaryBuildError("INCOMPLETE_ARCHIVE", "Archive has no SHP layer");
  return [...groups.values()].map((group) => {
    const missing = [group.shp ? "" : "SHP", group.shx ? "" : "SHX", group.dbf ? "" : "DBF", group.prj ? "" : "PRJ"].filter(Boolean);
    if (missing.length > 0 || !group.shp || !group.shx || !group.dbf || !group.prj) {
      throw new BoundaryBuildError("INCOMPLETE_ARCHIVE", `Incomplete SHP layer ${group.basename}: missing ${missing.join(", ")}`);
    }
    return { basename: group.basename, shp: group.shp, shx: group.shx, dbf: group.dbf, prj: group.prj };
  });
}

const ALIASES = {
  id: ["ID", "MGT_NO", "MGM_NO", "OBJECTID", "FID"],
  name: ["NAME", "ZONE_NM", "AREA_NM", "DGM_NM", "BSNS_NM"],
  sido: ["SIDO", "SIDO_NM", "CTP_KOR_NM"],
  sigungu: ["SIGUNGU", "SIGUNGU_NM", "SIG_KOR_NM"],
  area: ["AREA", "AREA_SQM", "SHAPE_AREA"],
  date: ["DESIGNATION_DATE", "DGM_YMD", "NTFC_DE"],
  notice: ["NOTICE_ID", "NTFC_NO", "PBLANC_NO"],
} as const;

function readAlias(properties: Readonly<Record<string, unknown>>, aliases: readonly string[]): unknown {
  const entries = Object.entries(properties);
  for (const alias of aliases) {
    const found = entries.find(([key]) => key.toUpperCase() === alias);
    if (found) return found[1];
  }
  return undefined;
}

function textAlias(properties: Readonly<Record<string, unknown>>, aliases: readonly string[]): string | undefined {
  const value = readAlias(properties, aliases);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberAlias(properties: Readonly<Record<string, unknown>>, aliases: readonly string[]): number | undefined {
  const value = readAlias(properties, aliases);
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replaceAll(",", "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

type GeometryResult = { readonly geometry: Polygon | MultiPolygon; readonly reason: QuarantineReason | null };

function transformRing(ring: readonly (readonly [number, number])[], crs: SupportedCrs): { readonly ring: Position[]; readonly reason: QuarantineReason | null } {
  const transformed: Position[] = [];
  for (const [x, y] of ring) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ring: transformed, reason: "non_finite_coordinate" };
    const point = proj4(crs, "EPSG:4326", { x, y });
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { ring: transformed, reason: "non_finite_coordinate" };
    if (point.x < 124 || point.x > 132 || point.y < 33 || point.y > 39.5) return { ring: transformed, reason: "coordinate_out_of_bounds" };
    transformed.push([point.x, point.y]);
  }
  const first = transformed[0];
  const last = transformed.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) transformed.push([...first]);
  return { ring: transformed, reason: transformed.length < 4 ? "ring_too_short" : null };
}

function transformGeometry(geometry: SourceGeometry, crs: SupportedCrs): GeometryResult {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const output: Position[][][] = [];
  for (const polygon of polygons) {
    const outputRings: Position[][] = [];
    for (const ring of polygon) {
      const transformed = transformRing(ring, crs);
      if (transformed.reason) return { geometry: { type: "Polygon", coordinates: [transformed.ring] }, reason: transformed.reason };
      outputRings.push(transformed.ring);
    }
    output.push(outputRings);
  }
  return geometry.type === "Polygon"
    ? { geometry: { type: "Polygon", coordinates: output[0] ?? [] }, reason: null }
    : { geometry: { type: "MultiPolygon", coordinates: output }, reason: null };
}

function geometryBbox(geometry: Polygon | MultiPolygon): readonly [number, number, number, number] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const positions = polygons.flat(2).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  if (positions.length === 0) return [0, 0, 0, 0];
  return [Math.min(...positions.map(([lng]) => lng)), Math.min(...positions.map(([, lat]) => lat)), Math.max(...positions.map(([lng]) => lng)), Math.max(...positions.map(([, lat]) => lat))];
}

export function transformBoundaryFeature(input: BoundarySourceFeature, crs: SupportedCrs, source: BoundarySource): BoundaryTransformResult {
  const geometryResult = transformGeometry(input.geometry, crs);
  const sourceFeatureId = textAlias(input.properties, ALIASES.id)
    ?? createHash("sha256").update(JSON.stringify(input.geometry)).digest("hex").slice(0, 20);
  const noticeText = textAlias(input.properties, ALIASES.notice);
  const bbox = geometryBbox(geometryResult.geometry);
  const properties: MaintenanceBoundaryProperties = {
    source_feature_id: sourceFeatureId,
    source_dataset_id: source.sourceDatasetId,
    source_layer: source.sourceLayer,
    ...(textAlias(input.properties, ALIASES.name) ? { name: textAlias(input.properties, ALIASES.name) } : {}),
    ...(textAlias(input.properties, ALIASES.sido) ? { sido: textAlias(input.properties, ALIASES.sido) } : {}),
    ...(textAlias(input.properties, ALIASES.sigungu) ? { sigungu: textAlias(input.properties, ALIASES.sigungu) } : {}),
    ...(numberAlias(input.properties, ALIASES.area) !== undefined ? { area_sqm: numberAlias(input.properties, ALIASES.area) } : {}),
    ...(textAlias(input.properties, ALIASES.date) ? { designation_date: textAlias(input.properties, ALIASES.date) } : {}),
    notice_ids: noticeText ? noticeText.split(/[,;|]/).map((value) => value.trim()).filter(Boolean) : [],
    original_crs: crs,
    source_url: source.sourceUrl,
    ...(source.sourceUpdatedAt ? { source_updated_at: source.sourceUpdatedAt } : {}),
    retrieved_at: source.retrievedAt,
    bbox,
  };
  const feature: Feature<Polygon | MultiPolygon, MaintenanceBoundaryProperties> = { type: "Feature", geometry: geometryResult.geometry, properties, bbox: [...bbox] };
  const reason = geometryResult.reason ?? (booleanValid(feature) && kinks(feature).features.length === 0 ? null : "invalid_geometry");
  return { feature, quarantine: reason ? { reason, source_feature_id: sourceFeatureId, raw_properties: input.properties } : null };
}
