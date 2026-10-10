/** Geofabrik OSM free shapefile의 녹지·수계 면 → reference feature. */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";

type Db = BetterSqlite3.Database;

export const OSM_LANDUSE_SOURCE_ID = "osm_landuse";
export const OSM_WATER_SOURCE_ID = "osm_water";
export const OSM_GREEN_LAYERS = ["gis_osm_landuse_a_free_1", "gis_osm_natural_a_free_1"] as const;
export const OSM_WATER_LAYERS = ["gis_osm_water_a_free_1"] as const;
export const GREEN_CLASSES = ["forest", "park", "grass", "orchard"] as const;

type GreenClass = (typeof GREEN_CLASSES)[number];
type AreaKind = "landuse" | "water";

const GREEN_CLASS_BY_FCLASS: Readonly<Record<string, GreenClass>> = {
  forest: "forest",
  wood: "forest",
  park: "park",
  nature_reserve: "park",
  recreation_ground: "park",
  garden: "park",
  grass: "grass",
  meadow: "grass",
  heath: "grass",
  scrub: "grass",
  orchard: "orchard",
  vineyard: "orchard",
  allotments: "orchard",
};

const WATER_CLASS_BY_FCLASS: Readonly<Record<string, "water" | "wetland">> = {
  water: "water",
  reservoir: "water",
  river: "water",
  riverbank: "water",
  wetland: "wetland",
  basin: "water",
};

const text = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = value.replace(/\u0000/g, "").trim();
    return normalized === "" ? null : normalized;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

function normalizedClass(value: unknown): string | null {
  const raw = text(value);
  return raw ? raw.toLowerCase() : null;
}

/** OSM fclass를 도판용 녹지 분류로 접는다. 녹지가 아니면 null이다. */
export function greenClassOf(fclass: unknown): GreenClass | null {
  return GREEN_CLASS_BY_FCLASS[normalizedClass(fclass) ?? ""] ?? null;
}

/** OSM fclass를 수계·습지 분류로 접는다. 수계가 아니면 null이다. */
export function waterClassOf(fclass: unknown): "water" | "wetland" | null {
  return WATER_CLASS_BY_FCLASS[normalizedClass(fclass) ?? ""] ?? null;
}

function polygonParts(geometry: Geometry): number[][][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates as number[][][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as number[][][][];
  return [];
}

function validPolygon(geometry: Geometry | null): geometry is Geometry & ({ type: "Polygon" } | { type: "MultiPolygon" }) {
  if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) return false;
  const parts = polygonParts(geometry);
  return parts.length > 0 && parts.every((polygon) => polygon.length > 0 && polygon.every((ring) =>
    ring.length >= 4 && ring.every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))));
}

function firstPoint(geometry: Geometry): [number, number] | null {
  for (const polygon of polygonParts(geometry)) {
    for (const ring of polygon) {
      for (const point of ring) {
        if (Number.isFinite(point[0]) && Number.isFinite(point[1])) return [point[0], point[1]];
      }
    }
  }
  return null;
}

const inKorea = (lng: number, lat: number) => lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39;

function defaultLayer(kind: AreaKind): string {
  return kind === "water" ? OSM_WATER_LAYERS[0] : OSM_GREEN_LAYERS[0];
}

function areaLayer(props: Record<string, unknown>, kind: AreaKind): string {
  const supplied = text(props.layer);
  const allowed = kind === "water" ? OSM_WATER_LAYERS : OSM_GREEN_LAYERS;
  return supplied && (allowed as readonly string[]).includes(supplied) ? supplied : defaultLayer(kind);
}

export interface OsmAreaProperties extends Record<string, unknown> {
  osmId: string;
  fclass: string;
  cls: GreenClass | "water" | "wetland";
  name: string | null;
  layer: string;
}

/**
 * 녹지(landuse/natural) 또는 수계(water) SHP를 reference feature로 적재한다.
 * 비대상 fclass·비면 도형은 rejected로 남기며, 원천 레이어가 없는 호출은 kind별
 * 첫 레이어로 안정적으로 기록한다. data-build는 레코드에 실제 레이어를 주입한다.
 */
export async function buildOsmAreas(
  db: Db,
  records: AsyncIterable<ShpRecord>,
  releaseId: string,
  kind: AreaKind,
): Promise<SourceStats> {
  const sourceId = kind === "water" ? OSM_WATER_SOURCE_ID : OSM_LANDUSE_SOURCE_ID;
  const stats = new SourceStats(sourceId, releaseId, ["name"]);
  const seen = new Set<string>();

  await batched(db, records, (record) => {
    stats.read();
    const props = record.properties ?? {};
    const geometry = record.geometry;
    if (!validPolygon(geometry)) return stats.reject();
    const point = firstPoint(geometry);
    const osmId = text(props.osm_id);
    const fclass = normalizedClass(props.fclass);
    if (!osmId || !fclass || !point || !inKorea(point[0], point[1])) return stats.reject();

    const cls = kind === "water" ? waterClassOf(fclass) : greenClassOf(fclass);
    if (!cls) return stats.reject();

    const layer = areaLayer(props, kind);
    const stableId = `osm:${layer}:${osmId}`;
    if (seen.has(stableId)) return stats.reject();
    seen.add(stableId);

    const featureProps: OsmAreaProperties = {
      osmId,
      fclass,
      cls,
      name: text(props.name),
      layer,
    };
    insertFeature(db, {
      stableId,
      kind,
      sourceKey: osmId,
      releaseId,
      geometry,
      name: featureProps.name,
      properties: featureProps,
    });
    stats.accept(featureProps, "(미상)", cls);
  });

  return stats;
}
