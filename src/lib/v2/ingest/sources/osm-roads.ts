/** Geofabrik OSM free shapefile의 도로 중심선 → reference feature(road). */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry } from "geojson";
import { insertFeature } from "../../data/features";
import { batched, SourceStats } from "../build";
import type { ShpRecord } from "../shp";

type Db = BetterSqlite3.Database;

export const OSM_ROADS_SOURCE_ID = "osm_roads";
export const OSM_ROADS_LAYER = "gis_osm_roads_free_1";
export const ROAD_FEATURE_KIND = "road";
export const OSM_ROADS_RIGHTS = {
  license: "ODbL 1.0",
  attribution: "© OpenStreetMap contributors",
  provider: "Geofabrik GmbH",
  layer: OSM_ROADS_LAYER,
} as const;

export const ROAD_HIERARCHIES = ["고속도로", "간선", "보조간선", "집산", "국지", "보행·자전거", "기타"] as const;
export type RoadHierarchy = (typeof ROAD_HIERARCHIES)[number];

const FCLASS_BY_HIERARCHY: Readonly<Record<RoadHierarchy, readonly string[]>> = {
  고속도로: ["motorway", "motorway_link"],
  간선: ["trunk", "trunk_link", "primary", "primary_link"],
  보조간선: ["secondary", "secondary_link"],
  집산: ["tertiary", "tertiary_link"],
  국지: ["residential", "living_street", "unclassified", "service"],
  "보행·자전거": ["pedestrian", "footway", "path", "cycleway", "steps", "track", "bridleway", "corridor", "sidewalk", "crossing", "platform", "stile"],
  기타: [],
};

const HIERARCHY_BY_FCLASS = new Map<string, RoadHierarchy>(
  Object.entries(FCLASS_BY_HIERARCHY).flatMap(([hierarchy, fclasses]) => fclasses.map((fclass) => [fclass, hierarchy as RoadHierarchy])),
);

export function roadHierarchy(fclass: unknown): RoadHierarchy {
  const key = typeof fclass === "string" ? fclass.trim().toLowerCase() : "";
  return HIERARCHY_BY_FCLASS.get(key) ?? "기타";
}

type LegalCodeOf = (lng: number, lat: number) => string | null;

const text = (value: unknown): string | null => {
  if (typeof value === "string") {
    const s = value.trim();
    return s === "" ? null : s;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates as number[][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as number[][][];
  return [];
}

function firstPoint(geometry: Geometry): [number, number] | null {
  for (const part of lineParts(geometry)) {
    for (const point of part) {
      if (Number.isFinite(point[0]) && Number.isFinite(point[1])) return [point[0], point[1]];
    }
  }
  return null;
}

function validLine(geometry: Geometry | null): geometry is Geometry {
  if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) return false;
  const parts = lineParts(geometry);
  return parts.length > 0 && parts.every((part) => part.length >= 2 && part.every((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))) && firstPoint(geometry) !== null;
}

const inKorea = (lng: number, lat: number) => lng >= 124 && lng <= 132 && lat >= 33 && lat <= 39;
const regionOf = (legalCode: string | null) => legalCode ? legalCode.slice(0, 2) : "(미상)";

export interface OsmRoadBuildOptions {
  legalCodeOf?: LegalCodeOf;
}

/** SHP 레코드를 읽는 즉시 reference DB에 넣는다. fclass를 모르는 도로도 기타로 보존한다. */
export async function buildOsmRoads(
  db: Db,
  records: AsyncIterable<ShpRecord>,
  releaseId: string,
  options: OsmRoadBuildOptions = {},
): Promise<SourceStats> {
  const stats = new SourceStats(ROAD_FEATURE_KIND, releaseId, ["name", "ref", "bridge", "tunnel", "oneway"]);
  const legalCodeOf = options.legalCodeOf ?? (() => null);
  const seen = new Set<string>();

  await batched(db, records, (record) => {
    stats.read();
    const props = record.properties ?? {};
    const osmId = text(props.osm_id);
    const geometry = record.geometry;
    if (!geometry || !validLine(geometry)) return stats.reject();
    const point = firstPoint(geometry);
    if (!osmId || !point || !inKorea(point[0], point[1])) return stats.reject();

    const stableId = `${ROAD_FEATURE_KIND}:${osmId}`;
    if (seen.has(stableId)) return stats.reject();
    seen.add(stableId);

    const fclass = text(props.fclass);
    const hierarchy = roadHierarchy(fclass);
    const featureProps = {
      osmId,
      code: props.code ?? null,
      fclass,
      hierarchy,
      name: text(props.name),
      ref: text(props.ref),
      oneway: text(props.oneway),
      maxspeed: text(props.maxspeed),
      layer: props.layer ?? null,
      bridge: text(props.bridge),
      tunnel: text(props.tunnel),
    };
    const legalCode = legalCodeOf(point[0], point[1]);
    insertFeature(db, {
      stableId,
      kind: ROAD_FEATURE_KIND,
      sourceKey: osmId,
      releaseId,
      geometry,
      name: featureProps.name,
      legalCode,
      properties: featureProps,
    });
    stats.accept(featureProps, regionOf(legalCode), hierarchy);
  });

  return stats;
}
