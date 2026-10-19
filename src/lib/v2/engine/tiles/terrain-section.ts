import type { Geometry, Polygon } from "geojson";
import { toLngLat, toUtmk } from "../../crs";
import { demReader } from "./terrain-shared";
import type { EngineContext } from "../context";

export type TerrainSectionAxis = "EW" | "NS";
export type TerrainCrossingKind = "retaining" | "cut_fill" | "fence";

export interface TerrainSectionSample {
  d: number;
  z: number | null;
}

export interface TerrainSectionCrossing {
  d: number;
  kind: TerrainCrossingKind;
  heightM: number | null;
}

export interface Section {
  axis: TerrainSectionAxis;
  from: [number, number];
  to: [number, number];
  samples: TerrainSectionSample[];
  siteSpan: [number, number];
  crossings: TerrainSectionCrossing[];
}

export interface TerrainSections {
  A: Section;
  B: Section;
}

const SECTION_HALF_FACTOR = 1.2;
const SECTION_STEP_M = 5;
const CROSSING_EPSILON_M = 1e-7;
const TOPO_STEP_KINDS = ["topo_retaining", "topo_cut_fill", "topo_fence"] as const;

type UTMPoint = [number, number];
type TerrainDemReader = { elevation: (lng: number, lat: number) => number | null };

function finitePoint(value: unknown): value is UTMPoint {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function ringCentroid(ring: readonly number[][]): { x: number; y: number; area: number } | null {
  const origin = ring.find(finitePoint);
  if (!origin) return null;
  let twiceArea = 0;
  let xSum = 0;
  let ySum = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1];
    const b = ring[index];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    // EPSG:5179 coordinates are around 1e6. Translate the ring before the
    // shoelace products so a small parcel does not lose its centroid to
    // cancellation between large nearly-equal products.
    const ax = a[0] - origin[0];
    const ay = a[1] - origin[1];
    const bx = b[0] - origin[0];
    const by = b[1] - origin[1];
    const cross = ax * by - bx * ay;
    twiceArea += cross;
    xSum += (ax + bx) * cross;
    ySum += (ay + by) * cross;
  }
  if (Math.abs(twiceArea) <= CROSSING_EPSILON_M) return null;
  return {
    x: origin[0] + xSum / (3 * twiceArea),
    y: origin[1] + ySum / (3 * twiceArea),
    area: Math.abs(twiceArea) / 2,
  };
}

/** 대지 외곽선과 홀을 면적 가중해 EPSG:5179 평면 중심으로 만든다. */
function siteCentroid(site: Polygon): UTMPoint {
  const parts = site.coordinates.map((ring) => ring as readonly number[][]);
  const outer = ringCentroid(parts[0] ?? []);
  if (!outer) {
    const points = parts.flat().filter(finitePoint);
    if (points.length === 0) throw new TypeError("site polygon has no finite coordinates");
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }

  let area = outer.area;
  let xSum = outer.x * outer.area;
  let ySum = outer.y * outer.area;
  for (const ring of parts.slice(1)) {
    const hole = ringCentroid(ring);
    if (!hole) continue;
    area -= hole.area;
    xSum -= hole.x * hole.area;
    ySum -= hole.y * hole.area;
  }
  if (area <= CROSSING_EPSILON_M) return [outer.x, outer.y];
  return [xSum / area, ySum / area];
}

function lineSegments(geometry: Geometry): Array<[UTMPoint, UTMPoint]> {
  if (geometry.type === "GeometryCollection") return geometry.geometries.flatMap(lineSegments);
  const segments: Array<[UTMPoint, UTMPoint]> = [];
  const addLine = (line: unknown): void => {
    if (!Array.isArray(line)) return;
    const points = line.filter(finitePoint).map((point) => [point[0], point[1]] as UTMPoint);
    for (let index = 1; index < points.length; index += 1) segments.push([points[index - 1], points[index]]);
  };
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    if (geometry.type === "LineString") addLine(geometry.coordinates);
    else for (const line of geometry.coordinates) addLine(line);
  } else if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
    for (const ring of rings) addLine(ring);
  }
  return segments;
}

function positionOnSection(point: UTMPoint, axis: TerrainSectionAxis, from: UTMPoint): number {
  return (axis === "EW" ? point[0] - from[0] : point[1] - from[1]);
}

function pointInRing(point: UTMPoint, ring: readonly number[][]): boolean {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1];
    const b = ring[index];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    const onSegment = Math.abs(cross) <= CROSSING_EPSILON_M
      && point[0] >= Math.min(a[0], b[0]) - CROSSING_EPSILON_M
      && point[0] <= Math.max(a[0], b[0]) + CROSSING_EPSILON_M
      && point[1] >= Math.min(a[1], b[1]) - CROSSING_EPSILON_M
      && point[1] <= Math.max(a[1], b[1]) + CROSSING_EPSILON_M;
    if (onSegment) return true;
    const crosses = (a[1] > point[1]) !== (b[1] > point[1]);
    if (crosses && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function siteContains(site: Polygon, point: UTMPoint): boolean {
  const [outer, ...holes] = site.coordinates;
  return !!outer && pointInRing(point, outer) && holes.every((hole) => !pointInRing(point, hole));
}

function scanlinePositions(site: Polygon, axis: TerrainSectionAxis, center: UTMPoint, from: UTMPoint, totalM: number): number[] {
  const fixed = axis === "EW" ? center[1] : center[0];
  const positions = [0, totalM];
  for (const ring of site.coordinates) {
    for (let index = 1; index < ring.length; index += 1) {
      const a = ring[index - 1];
      const b = ring[index];
      if (!finitePoint(a) || !finitePoint(b)) continue;
      const aFixed = axis === "EW" ? a[1] : a[0];
      const bFixed = axis === "EW" ? b[1] : b[0];
      const delta = bFixed - aFixed;
      if (Math.abs(delta) <= CROSSING_EPSILON_M) {
        if (Math.abs(aFixed - fixed) <= CROSSING_EPSILON_M) {
          positions.push(positionOnSection(a, axis, from), positionOnSection(b, axis, from));
        }
        continue;
      }
      const t = (fixed - aFixed) / delta;
      if (t < -CROSSING_EPSILON_M || t > 1 + CROSSING_EPSILON_M) continue;
      const point: UTMPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      positions.push(positionOnSection(point, axis, from));
    }
  }
  return [...new Set(positions.filter(Number.isFinite).map((value) => Math.max(0, Math.min(totalM, value)).toFixed(6)))].map(Number).sort((a, b) => a - b);
}

function spanForSite(site: Polygon, axis: TerrainSectionAxis, center: UTMPoint, from: UTMPoint, totalM: number): [number, number] {
  const positions = scanlinePositions(site, axis, center, from, totalM);
  const intervals: Array<[number, number]> = [];
  for (let index = 1; index < positions.length; index += 1) {
    const start = positions[index - 1];
    const end = positions[index];
    if (end <= start) continue;
    const midpoint = (start + end) / 2;
    const point: UTMPoint = axis === "EW" ? [from[0] + midpoint, from[1]] : [from[0], from[1] + midpoint];
    if (siteContains(site, point)) intervals.push([start, end]);
  }
  if (intervals.length === 0) return [0, 0];
  return [Math.min(...intervals.map(([start]) => start)), Math.max(...intervals.map(([, end]) => end))];
}

function crossingPositions(
  geometry: Geometry,
  axis: TerrainSectionAxis,
  center: UTMPoint,
  from: UTMPoint,
  totalM: number,
): number[] {
  const fixed = axis === "EW" ? center[1] : center[0];
  const values: number[] = [];
  for (const [a, b] of lineSegments(geometry)) {
    const aFixed = axis === "EW" ? a[1] : a[0];
    const bFixed = axis === "EW" ? b[1] : b[0];
    const delta = bFixed - aFixed;
    if (Math.abs(delta) <= CROSSING_EPSILON_M) {
      if (Math.abs(aFixed - fixed) > CROSSING_EPSILON_M) continue;
      const aPosition = positionOnSection(a, axis, from);
      const bPosition = positionOnSection(b, axis, from);
      const start = Math.max(0, Math.min(aPosition, bPosition));
      const end = Math.min(totalM, Math.max(aPosition, bPosition));
      if (end >= start - CROSSING_EPSILON_M) {
        values.push((start + end) / 2);
      }
      continue;
    }
    const t = (fixed - aFixed) / delta;
    if (t < -CROSSING_EPSILON_M || t > 1 + CROSSING_EPSILON_M) continue;
    const point: UTMPoint = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const position = positionOnSection(point, axis, from);
    if (position >= -CROSSING_EPSILON_M && position <= totalM + CROSSING_EPSILON_M) {
      values.push(Math.max(0, Math.min(totalM, position)));
    }
  }
  return [...new Set(values.map((value) => Math.round(value * 1000) / 1000))].sort((a, b) => a - b);
}

function crossingKind(kind: string): TerrainCrossingKind | null {
  if (kind === "topo_retaining") return "retaining";
  if (kind === "topo_cut_fill") return "cut_fill";
  if (kind === "topo_fence") return "fence";
  return null;
}

function heightOf(properties: Record<string, unknown>): number | null {
  const height = properties.heightM;
  return typeof height === "number" && Number.isFinite(height) ? height : null;
}

function crossingsFor(
  ctx: EngineContext,
  axis: TerrainSectionAxis,
  center: UTMPoint,
  from: UTMPoint,
  totalM: number,
): TerrainSectionCrossing[] {
  // The section extends 1.2R on each side even though the ordinary tile count
  // remains restricted to the analysis radius. Include the whole section line
  // so a facility at the profile edge is not silently omitted from the table.
  const hits = ctx.topo?.hits(TOPO_STEP_KINDS, ctx.input.radiusM * SECTION_HALF_FACTOR) ?? [];
  const crossings: Array<TerrainSectionCrossing & { featureId: number; positionKey: string }> = [];
  for (const hit of hits) {
    const kind = crossingKind(hit.kind);
    if (!kind) continue;
    for (const d of crossingPositions(hit.geometry, axis, center, from, totalM)) {
      crossings.push({ d, kind, heightM: heightOf(hit.properties), featureId: hit.featureId, positionKey: `${hit.featureId}:${d}` });
    }
  }
  crossings.sort((a, b) => a.d - b.d || a.featureId - b.featureId || a.kind.localeCompare(b.kind));
  const seen = new Set<string>();
  return crossings.filter((crossing) => {
    if (seen.has(crossing.positionKey)) return false;
    seen.add(crossing.positionKey);
    return true;
  }).map(({ d, kind, heightM }) => ({ d, kind, heightM }));
}

function makeSection(
  ctx: EngineContext,
  axis: TerrainSectionAxis,
  center: UTMPoint,
  site: Polygon,
  radiusM: number,
  reader: TerrainDemReader | null,
): Section {
  const totalM = radiusM * SECTION_HALF_FACTOR * 2;
  const halfM = totalM / 2;
  const from: UTMPoint = axis === "EW" ? [center[0] - halfM, center[1]] : [center[0], center[1] - halfM];
  const to: UTMPoint = axis === "EW" ? [center[0] + halfM, center[1]] : [center[0], center[1] + halfM];
  const sampleCount = Math.floor(totalM / SECTION_STEP_M) + 1;
  const samples: TerrainSectionSample[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const d = index * SECTION_STEP_M;
    const point: UTMPoint = axis === "EW" ? [from[0] + d, from[1]] : [from[0], from[1] + d];
    const z = reader ? reader.elevation(...toLngLat(point)) : null;
    samples.push({ d, z: typeof z === "number" && Number.isFinite(z) ? z : null });
  }
  return {
    axis,
    from,
    to,
    samples,
    siteSpan: spanForSite(site, axis, center, from, totalM),
    crossings: crossingsFor(ctx, axis, center, from, totalM),
  };
}

/** 대지 중심을 통과하는 동서·남북 단면. 표본 간격과 선 길이는 고정된 계약값이다. */
export function terrainSections(ctx: EngineContext, site: Polygon): TerrainSections {
  if (ctx.input.radiusM <= 0 || !Number.isFinite(ctx.input.radiusM)) throw new RangeError("radiusM must be positive");
  const center = siteCentroid(site);
  const reader = demReader(ctx);
  return {
    A: makeSection(ctx, "EW", center, site, ctx.input.radiusM, reader),
    B: makeSection(ctx, "NS", center, site, ctx.input.radiusM, reader),
  };
}
