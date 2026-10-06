import { toLngLat, toUtmk } from "../crs";
import type { FeatureHit } from "../data/features";
import {
  SCENE_VERSION,
  SCENE_MAX_BUILDINGS,
  SCENE_MAX_PARCELS,
  SCENE_GRID_MAX,
  parseScene,
  toLocalRing,
  type Ring,
  type Scene,
  type SceneBuilding,
  type SceneContext,
  type SceneParcel,
} from "../scene";
import type { EngineContext, SourceRef } from "./context";
import { buildingRows, buildingRetirementLimitations, BUILDING_SOURCES } from "./tiles/buildings-shared";
import { areaInCircle, clipLineToCircle, linePathLength, polygonArea, polygonParts } from "./tiles/geo";
import { hitPoint } from "./tiles/common";
import { demReader, demSources, DEM_LIMITATION } from "./tiles/terrain-shared";
import type { LocalGrid } from "./tiles/raster-grid";

function localRings(hit: FeatureHit, origin: { x: number; y: number }): Ring[] {
  return polygonParts(hit.geometry).flatMap((rings) => rings.map((ring) => toLocalRing(ring, origin)));
}

function hitDistanceM(hit: FeatureHit, center: readonly [number, number]): number {
  const [x, y] = toUtmk(hitPoint(hit));
  const [cx, cy] = toUtmk(center);
  return Math.hypot(x - cx, y - cy);
}

function finiteArea(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parcelArea(hit: FeatureHit): number {
  return finiteArea(hit.properties.areaM2);
}

function sourceKey(source: SourceRef): string {
  return `${source.sourceId}:${source.releaseId}`;
}

function uniqueSources(...groups: SourceRef[][]): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const source of groups.flat()) {
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function roundCentimeter(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function sceneCellM(radiusM: number): number {
  let cellM = Math.max(30, Math.ceil((2 * radiusM) / 64));
  // The local-grid padding can add one cell. Keep the serialized Scene within
  // its contract for the largest supported radius without changing the 800 m
  // fixture (30 m, 56 × 56).
  while (Math.floor((2 * (radiusM + cellM)) / cellM) + 1 > SCENE_GRID_MAX) cellM++;
  return cellM;
}

function sceneDemGrid(
  reader: NonNullable<ReturnType<typeof demReader>>,
  center: readonly [number, number],
  radiusM: number,
  cellM: number,
): LocalGrid {
  const [cx, cy] = toUtmk(center);
  const cols = Math.floor((2 * (radiusM + cellM)) / cellM) + 1;
  const rows = cols;
  const x0 = -((cols - 1) * cellM) / 2;
  const y0 = -((rows - 1) * cellM) / 2;
  const values = new Float64Array(cols * rows);
  values.fill(Number.NaN);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const [lng, lat] = toLngLat([cx + x0 + col * cellM, cy + y0 + row * cellM]);
      const value = reader.elevation(lng, lat);
      values[row * cols + col] = value === null || !Number.isFinite(value) ? Number.NaN : value;
    }
  }
  return { cx, cy, cellM, cols, rows, x0: cx + x0, y0: cy + y0, values };
}

type TerrainForScene = { reader: NonNullable<ReturnType<typeof demReader>>; originZ: number };

function makeBuilding(
  row: NonNullable<ReturnType<typeof buildingRows>>[number],
  origin: { x: number; y: number },
  terrain: TerrainForScene | null,
): SceneBuilding {
  const elevation = terrain?.reader.elevation(...hitPoint(row.hit)) ?? null;
  return {
    id: row.hit.stableId,
    rings: localRings(row.hit, origin),
    baseZ: elevation === null || terrain === null ? null : roundCentimeter(elevation - terrain.originZ),
    heightM: row.heightM,
    heightMethod: row.heightMethod,
    floorsAbove: row.floorsAbove,
    useCode: row.useCode,
    approvalDate: row.approvalDate,
  };
}

function makeParcel(hit: FeatureHit, origin: { x: number; y: number }, sitePnu: string | null): SceneParcel | null {
  if (!hit.pnu) return null;
  const jimok = typeof hit.properties.jimok === "string" ? hit.properties.jimok : null;
  const areaM2 = typeof hit.properties.areaM2 === "number" && Number.isFinite(hit.properties.areaM2) && hit.properties.areaM2 >= 0
    ? hit.properties.areaM2
    : null;
  return {
    pnu: hit.pnu,
    rings: localRings(hit, origin),
    jimok,
    areaM2,
    isSite: hit.pnu === sitePnu,
  };
}

export const SCENE_MAX_ROADS = 4000;
export const SCENE_MAX_CONTEXT_POLYGONS = 2000;

/** OSM hierarchy별 장면 표현 폭. OSM 차로 수·maxspeed는 장면 폭에 사용하지 않는다. */
export const ROAD_WIDTH_M: Readonly<Record<string, number>> = Object.freeze({
  고속도로: 25,
  간선: 20,
  보조간선: 15,
  집산: 10,
  국지: 6,
  "보행·자전거": 3,
  기타: 6,
});

export function roadWidthM(hierarchy: unknown): number {
  const key = typeof hierarchy === "string" ? hierarchy.trim() : "";
  return ROAD_WIDTH_M[key] ?? ROAD_WIDTH_M["기타"];
}

function roadHierarchy(hit: FeatureHit): string {
  const hierarchy = hit.properties.hierarchy;
  return typeof hierarchy === "string" && hierarchy.trim() !== "" ? hierarchy.trim() : "기타";
}

function localContextPoint(point: readonly number[], origin: { x: number; y: number }): [number, number] {
  return [roundCentimeter(point[0] - origin.x), roundCentimeter(point[1] - origin.y)];
}

function localContextPath(path: number[][], origin: { x: number; y: number }): [number, number][] {
  const out: [number, number][] = [];
  for (const point of path) {
    if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    const local = localContextPoint(point, origin);
    const previous = out.at(-1);
    if (!previous || previous[0] !== local[0] || previous[1] !== local[1]) out.push(local);
  }
  return out.length >= 2 ? out : [];
}

function localContextPolygons(
  hit: FeatureHit,
  center: readonly [number, number],
  radiusM: number,
  origin: { x: number; y: number },
): Ring[][] {
  const clipped = areaInCircle(center, radiusM, hit.geometry);
  if (!clipped) return [];
  return clipped.parts
    .map((polygon) => polygon
      .map((ring) => toLocalRing(ring, origin))
      .filter((ring) => ring.length >= 4))
    .filter((polygon) => polygon.length > 0 && polygonArea(polygon) > 0);
}

type RoadCandidate = { road: SceneContext["roads"][number]; lengthM: number; order: number };
type PolygonCandidate = { kind: "green" | "water"; polygon: Ring[]; areaM2: number; order: number };

interface SceneContextBuild {
  context?: SceneContext;
  sources: SourceRef[];
  limitations: Scene["limitations"];
}

function buildSceneContext(ctx: EngineContext, origin: { x: number; y: number }): SceneContextBuild {
  const roadSources = ctx.sources("reference", ["osm_roads"]);
  const greenSources = ctx.sources("reference", ["osm_landuse"]);
  const waterSources = ctx.sources("reference", ["osm_water"]);
  const sources = uniqueSources(roadSources, greenSources, waterSources);
  if (sources.length === 0) return { sources: [], limitations: [] };

  const roadCandidates: RoadCandidate[] = [];
  let roadOrder = 0;
  if (roadSources.length > 0) {
    for (const hit of ctx.hits("reference", ["road"])) {
      const hierarchy = roadHierarchy(hit);
      const paths = clipLineToCircle(ctx.input.center, ctx.input.radiusM, hit.geometry);
      for (const path of paths) {
        const points = localContextPath(path, origin);
        if (points.length < 2) continue;
        roadCandidates.push({
          road: { points, widthM: roadWidthM(hierarchy), hierarchy },
          lengthM: linePathLength(path),
          order: roadOrder++,
        });
      }
    }
  }

  const polygonCandidates: PolygonCandidate[] = [];
  let polygonOrder = 0;
  const addPolygons = (kind: "green" | "water", sourceReady: boolean, hits: FeatureHit[]) => {
    if (!sourceReady) return;
    for (const hit of hits) {
      for (const polygon of localContextPolygons(hit, ctx.input.center, ctx.input.radiusM, origin)) {
        polygonCandidates.push({ kind, polygon, areaM2: Math.max(0, polygonArea(polygon)), order: polygonOrder++ });
      }
    }
  };
  addPolygons("green", greenSources.length > 0, ctx.hits("reference", ["landuse"]));
  addPolygons("water", waterSources.length > 0, ctx.hits("reference", ["water"]));

  const roads = roadCandidates
    .sort((a, b) => b.lengthM - a.lengthM || a.order - b.order)
    .slice(0, SCENE_MAX_ROADS)
    .map(({ road }) => road);
  const polygons = polygonCandidates
    .sort((a, b) => b.areaM2 - a.areaM2 || a.order - b.order)
    .slice(0, SCENE_MAX_CONTEXT_POLYGONS);
  const green = polygons.filter((candidate) => candidate.kind === "green").map((candidate) => candidate.polygon);
  const water = polygons.filter((candidate) => candidate.kind === "water").map((candidate) => candidate.polygon);

  const limitations: Scene["limitations"] = [];
  if (roadCandidates.length > SCENE_MAX_ROADS) {
    limitations.push({ kind: "partial", note: `반경 안 도로 ${roadCandidates.length.toLocaleString()}개 중 장면에는 ${SCENE_MAX_ROADS.toLocaleString()}개까지 포함했습니다.` });
  }
  if (polygonCandidates.length > SCENE_MAX_CONTEXT_POLYGONS) {
    limitations.push({ kind: "partial", note: `반경 안 녹지·수계 면 ${polygonCandidates.length.toLocaleString()}개 중 면적이 큰 ${SCENE_MAX_CONTEXT_POLYGONS.toLocaleString()}개까지 장면에 포함했습니다.` });
  }
  if (roadSources.length === 0) limitations.push({ kind: "not_provided", note: "OSM 도로 자료 미적재 — 장면 도로 맥락층 없음" });
  if (greenSources.length === 0) limitations.push({ kind: "not_provided", note: "OSM 녹지 면 자료 미적재 — 장면 녹지 맥락층 없음" });
  if (waterSources.length === 0) limitations.push({ kind: "not_provided", note: "OSM 수계 면 자료 미적재 — 장면 수계 맥락층 없음" });

  return { context: { roads, green, water }, sources, limitations };
}

/** 건물·필지 도형을 내보내기와 S01이 함께 쓰는 대지 중심 로컬 장면으로 만든다. */
export function buildScene(ctx: EngineContext): Scene | null {
  const rows = buildingRows(ctx);
  if (!rows) return null;

  const reader = demReader(ctx);
  const grid = reader ? sceneDemGrid(reader, ctx.input.center, ctx.input.radiusM, sceneCellM(ctx.input.radiusM)) : null;
  const finiteGround = grid
    ? Array.from(grid.values).filter((value): value is number => Number.isFinite(value))
    : [];
  const originZ = reader
    ? reader.elevation(...ctx.input.center) ?? median(finiteGround)
    : null;
  const terrain = reader && grid && originZ !== null ? { reader, originZ } : null;
  const ground: Scene["ground"] = terrain && grid
    ? {
        kind: "dem",
        cellM: grid.cellM,
        cols: grid.cols,
        rows: grid.rows,
        originZ: terrain.originZ,
        z: Array.from(grid.values, (value) => Number.isFinite(value) ? roundCentimeter(value - terrain.originZ) : null),
        resolutionM: 30,
        vertical: terrain.reader.verticalDatum() ?? "EGM2008",
        sourceId: "terrain_tiles",
      }
    : { kind: "flat" };

  const [originX, originY] = toUtmk(ctx.input.center);
  const origin = { x: originX, y: originY };
  const context = buildSceneContext(ctx, origin);
  const buildingsByDistance = [...rows].sort((a, b) =>
    hitDistanceM(a.hit, ctx.input.center) - hitDistanceM(b.hit, ctx.input.center) || a.hit.featureId - b.hit.featureId,
  );
  const buildingHits = buildingsByDistance.slice(0, SCENE_MAX_BUILDINGS);
  const buildings = buildingHits.map((row) => makeBuilding(row, origin, terrain));

  const parcelsDb = ctx.db("parcels");
  const parcelHits = parcelsDb ? ctx.hits("parcels", ["parcel"]) : [];
  const parcelsByArea = [...parcelHits].sort((a, b) => parcelArea(b) - parcelArea(a) || a.featureId - b.featureId);
  const parcelHitsIncluded = parcelsByArea.slice(0, SCENE_MAX_PARCELS);
  const parcels = parcelHitsIncluded.map((hit) => makeParcel(hit, origin, ctx.input.pnu)).filter((parcel): parcel is SceneParcel => parcel !== null);
  const siteHit = parcelHits.find((hit) => hit.pnu === ctx.input.pnu);

  const limitations: Scene["limitations"] = [];
  limitations.push(...buildingRetirementLimitations(ctx));
  if (rows.length > SCENE_MAX_BUILDINGS) {
    limitations.push({ kind: "partial", note: `건물 도형은 가까운 ${SCENE_MAX_BUILDINGS.toLocaleString()}동까지 장면에 포함했습니다.` });
  }
  if (parcelHits.length > SCENE_MAX_PARCELS) {
    limitations.push({ kind: "partial", note: `필지 도형은 면적이 큰 ${SCENE_MAX_PARCELS.toLocaleString()}필지까지 장면에 포함했습니다.` });
  }
  const unknownHeightCount = buildings.filter((building) => building.heightM === null).length;
  if (unknownHeightCount > 0) {
    limitations.push({ kind: "incomplete", note: `높이 미상 건물 ${unknownHeightCount.toLocaleString()}동은 바닥 모양만 포함했습니다.` });
  }
  if (ground.kind === "dem") {
    limitations.push(DEM_LIMITATION);
    const missingBaseZ = buildings.filter((building) => building.baseZ === null).length;
    if (missingBaseZ > 0) {
      limitations.push({ kind: "incomplete", note: `지형 결측으로 건물 ${missingBaseZ.toLocaleString()}동의 바닥 표고를 확인하지 못했습니다.` });
    }
  } else {
    limitations.push({ kind: "not_provided", note: "지형(DEM) 미적재 — 평탄 지반" });
  }
  if (!parcelsDb) {
    limitations.push({ kind: "not_provided", note: "필지 도형 미적재" });
  }

  const scene = {
    version: SCENE_VERSION,
    analysisId: ctx.analysisId,
    manifestHash: ctx.manifestHash,
    origin: { epsg: "EPSG:5179" as const, x: originX, y: originY, lng: ctx.input.center[0], lat: ctx.input.center[1] },
    radiusM: ctx.input.radiusM,
    ground,
    site: siteHit ? localRings(siteHit, origin) : null,
    buildings,
    parcels,
    counts: {
      buildingsTotal: rows.length,
      buildingsIncluded: buildings.length,
      parcelsTotal: parcelHits.length,
      parcelsIncluded: parcels.length,
    },
    sources: uniqueSources(
      ctx.sources("buildings", BUILDING_SOURCES),
      parcelsDb ? ctx.sources("parcels", ["parcel_polygon"]) : [],
      terrain ? demSources(ctx) : [],
      context.sources,
    ),
    limitations: [...limitations, ...context.limitations],
    ...(context.context ? { context: context.context } : {}),
  } satisfies Scene;
  return parseScene(scene);
}
