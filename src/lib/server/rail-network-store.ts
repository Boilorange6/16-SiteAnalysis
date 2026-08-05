import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { haversineDistance } from "@/lib/geo";
import type { SubwayMapResponse, SubwayMapStation, SubwayStationAxis } from "@/lib/osm-subway-overlay";
import type { PlannedRailGeometry, PlannedRailProject, RailLine, RailLineMembership, RailNetworkResponse, RailStation } from "@/lib/rail-types";
import type { SourceStatus, SubwayRoute } from "@/lib/types";

const coordinateSchema = z.tuple([z.number(), z.number()]);
const plannedRailGeometrySchema = z.union([
  z.object({ type: z.literal("LineString"), coordinates: z.array(coordinateSchema).min(2) }),
  z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(coordinateSchema).min(2)).min(1) }),
]);
const plannedRailEvidenceSchema = z.object({
  url: z.string().url(),
  publisher: z.string().min(1),
  retrievedAt: z.string().date(),
  publishedAt: z.string().date().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/iu).optional(),
  pageOrSection: z.string().min(1),
  crs: z.string().min(1),
  extractionMethod: z.string().min(1),
});
const plannedRailSegmentSchema = z.object({
  segmentId: z.string().min(1),
  lifecycle: z.enum(["operating", "under_construction", "planned", "proposed"]),
  operatingOverlap: z.enum(["none", "partial", "full"]),
}).refine(
  (segment) => segment.operatingOverlap !== "full" || segment.lifecycle === "operating",
).refine(
  (segment) => segment.lifecycle !== "operating" || segment.operatingOverlap !== "none",
);
const legacySnapshotSchema = z.object({
  source: z.string(),
  license: z.string(),
  generated_at: z.string(),
  stations: z.array(z.object({ osm_id: z.string(), station_name: z.string(), lat: z.number(), lng: z.number() })),
  entrances: z.array(z.object({ osm_id: z.string().optional(), station_name: z.string(), entrance_name: z.string().optional(), entrance_ref: z.string().optional(), lat: z.number(), lng: z.number() })),
  lines: z.array(z.object({ osm_id: z.string(), line_ref: z.string(), line_name: z.string(), color: z.string(), lat: z.number(), lng: z.number(), geometry: z.unknown() })),
  station_axes: z.array(z.object({ station_osm_id: z.string().optional(), station_name: z.string(), line_ref: z.string(), line_name: z.string(), color: z.string(), lat: z.number(), lng: z.number(), distance_m: z.number().optional(), endpoints: z.tuple([coordinateSchema, coordinateSchema]) })),
});

const plannedProjectSchema = z.object({
  projectId: z.string(),
  lineName: z.string(),
  lifecycleStatus: z.enum(["proposed", "approved", "under_construction", "opening_confirmed"]),
  statusEvidence: z.array(plannedRailEvidenceSchema).min(1),
  geometryEvidence: z.array(plannedRailEvidenceSchema).min(1),
  reviewStatus: z.enum(["reviewed", "pending", "deferred"]),
  nextReviewAt: z.string().date(),
  segments: z.array(plannedRailSegmentSchema).min(1),
  geometry: plannedRailGeometrySchema,
  stations: z.array(z.object({ name: z.string(), lat: z.number(), lng: z.number() })),
  sourceUrl: z.string().url(),
  geometrySourceUrl: z.string().url().optional(),
  geometrySourceLabel: z.string().optional(),
  sourceType: z.enum(["official_gis", "official_notice", "georeferenced_pdf", "approximation"]),
  confidenceLabel: z.enum(["high", "medium", "low"]),
  lastVerifiedAt: z.string(),
});

type LegacySnapshot = z.infer<typeof legacySnapshotSchema>;
type RailQuery = { readonly lat: number; readonly lng: number; readonly radiusM: number };

const DEFAULT_DATA_PATH = join(process.cwd(), "public", "data", "osm-subway.json");
const DEFAULT_PLANNED_PATH = join(process.cwd(), "public", "data", "rail", "planned.json");
const SNAPSHOT_VERSION = "2026-05-26-osm-migration-v1";

let cachedSnapshot: LegacySnapshot | null = null;
let cachedPlanned: readonly PlannedRailProject[] | null = null;

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadLegacySnapshot(path: string): LegacySnapshot {
  if (path === DEFAULT_DATA_PATH && cachedSnapshot) return cachedSnapshot;
  const parsed = legacySnapshotSchema.parse(readJsonFile(path));
  if (path === DEFAULT_DATA_PATH) cachedSnapshot = parsed;
  return parsed;
}

function loadPlannedProjects(path: string): readonly PlannedRailProject[] {
  if (path === DEFAULT_PLANNED_PATH && cachedPlanned) return cachedPlanned;
  const raw = readJsonFile(path);
  const parsed = z.array(plannedProjectSchema).parse(raw);
  if (path === DEFAULT_PLANNED_PATH) cachedPlanned = parsed;
  return parsed;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/gu, "").replace(/역$/u, "");
}

function stationMemberships(snapshot: LegacySnapshot, station: LegacySnapshot["stations"][number]): readonly RailLineMembership[] {
  const axes = snapshot.station_axes.filter((axis) =>
    (axis.station_osm_id && axis.station_osm_id === station.osm_id) || normalizeName(axis.station_name) === normalizeName(station.station_name)
  );
  const seen = new Set<string>();
  return axes.filter((axis) => {
    const key = `${axis.line_ref}|${axis.line_name}|${axis.color}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((axis) => ({
    lineId: `${axis.line_ref}|${axis.line_name}`,
    lineRef: axis.line_ref,
    lineName: axis.line_name,
    color: axis.color,
  }));
}

function toRailStation(snapshot: LegacySnapshot, station: LegacySnapshot["stations"][number]): RailStation {
  return {
    id: `rail-${station.osm_id}`,
    osmId: station.osm_id,
    name: station.station_name,
    lat: station.lat,
    lng: station.lng,
    memberships: stationMemberships(snapshot, station),
  };
}

function toRailLine(line: LegacySnapshot["lines"][number]): RailLine {
  return {
    id: `rail-${line.osm_id}`,
    osmId: line.osm_id,
    lineRef: line.line_ref,
    name: line.line_name,
    color: line.color,
    geometry: line.geometry,
  };
}

function near(query: RailQuery, lat: number, lng: number, paddingM = 0): boolean {
  return haversineDistance(query.lat, query.lng, lat, lng) <= query.radiusM + paddingM;
}

function plannedRailGeometryTouchesQuery(geometry: PlannedRailGeometry, query: RailQuery): boolean {
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  return lines.some((line) => line.some(([lng, lat]) => near(query, lat, lng, 600)));
}

function mapDataForQuery(snapshot: LegacySnapshot, query: RailQuery): SubwayMapResponse {
  const stations = snapshot.stations.filter((station) => near(query, station.lat, station.lng)).map((station): SubwayMapStation => ({
    station_name: station.station_name,
    lat: station.lat,
    lng: station.lng,
  }));
  const stationNames = new Set(stations.map((station) => normalizeName(station.station_name)));
  const stationAxes = snapshot.station_axes.filter((axis): axis is SubwayStationAxis => stationNames.has(normalizeName(axis.station_name)));
  const lines = snapshot.lines.filter((line) => near(query, line.lat, line.lng, query.radiusM));
  const entrances = snapshot.entrances.filter((entrance) => stationNames.has(normalizeName(entrance.station_name)) && near(query, entrance.lat, entrance.lng, 220));
  return { source: snapshot.source, license: snapshot.license, generated_at: snapshot.generated_at, stations, entrances, lines, station_axes: stationAxes };
}

export function loadRailNetworkSnapshot(dataPath = DEFAULT_DATA_PATH, plannedPath = DEFAULT_PLANNED_PATH): RailNetworkResponse {
  const snapshot = loadLegacySnapshot(dataPath);
  const stations = snapshot.stations.map((station) => toRailStation(snapshot, station));
  const lines = snapshot.lines.map(toRailLine);
  const routes = toSubwayRoutes(snapshot);
  const source: SourceStatus = { source: "rail-network", status: "cached", fetchedAt: Date.parse(snapshot.generated_at) || null };
  const firstQuery = { lat: 37.5665, lng: 126.978, radiusM: 500000 } as const;
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    stations,
    lines,
    routes,
    plannedProjects: loadPlannedProjects(plannedPath),
    mapData: mapDataForQuery(snapshot, firstQuery),
    source,
  };
}

function toSubwayRoutes(snapshot: LegacySnapshot): readonly SubwayRoute[] {
  const routes: SubwayRoute[] = [];
  for (const line of snapshot.lines) {
    const geometry = z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(coordinateSchema)) }).safeParse(line.geometry);
    if (!geometry.success) continue;
    geometry.data.coordinates.forEach((segment) => {
      if (segment.length < 2) return;
      routes.push({
        line: line.line_ref || line.line_name,
        lineColor: line.color,
        stationIds: [],
        coordinates: segment.map(([lng, lat]) => [lat, lng]),
      });
    });
  }
  return routes;
}

export function queryRailNetwork(snapshot: RailNetworkResponse, query: RailQuery): RailNetworkResponse {
  const raw = loadLegacySnapshot(DEFAULT_DATA_PATH);
  const stations = snapshot.stations.filter((station) => near(query, station.lat, station.lng));
  const lineCoordinates = new Map<string, LegacySnapshot["lines"][number]>(raw.lines.map((line) => [`rail-${line.osm_id}`, line]));
  const lines = snapshot.lines.filter((line) => {
    const rawLine = lineCoordinates.get(line.id);
    return rawLine ? near(query, rawLine.lat, rawLine.lng, query.radiusM) : false;
  });
  const routes = snapshot.routes.filter((route) => route.coordinates?.some(([lat, lng]) => near(query, lat, lng, 500)) ?? false);
  const mapData = mapDataForQuery(raw, query);
  return {
    ...snapshot,
    stations,
    lines,
    routes,
    plannedProjects: snapshot.plannedProjects.filter((project) =>
      project.stations.some((station) => near(query, station.lat, station.lng)) || plannedRailGeometryTouchesQuery(project.geometry, query)
    ),
    mapData,
    source: { ...snapshot.source, status: "cached" },
  };
}

export function toSubwayStations(snapshot: RailNetworkResponse): readonly import("@/lib/types").SubwayStation[] {
  return snapshot.stations.map((station) => {
    const memberships = station.memberships;
    const first = memberships[0];
    const lineNames = memberships.map((membership) => membership.lineRef || membership.lineName).filter(Boolean);
    return {
      id: station.id,
      name: station.name,
      lat: station.lat,
      lng: station.lng,
      category: "subway",
      line: lineNames.join("·") || "미확인",
      lineColor: first?.color || "#64748B",
      lineNames,
    };
  });
}

export function clearRailNetworkStoreCache(): void {
  cachedSnapshot = null;
  cachedPlanned = null;
}
