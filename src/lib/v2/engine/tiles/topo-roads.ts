import type { Geometry, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import type { FeatureHit } from "../../data/features";
import type { EngineContext } from "../context";
import { clipLineToCircle, distanceToLineM } from "./geo";

export type MergedRoadLine = {
  geometry: LineString | MultiLineString;
  widthM: number | null;
  lanes: number | null;
  source: "ngii_topo" | "osm_roads";
  hierarchy: string | null;
};

export type RoadLineMeta = {
  featureId: number;
  name: string | null;
  pathIndex: number;
};

const ROAD_META = Symbol("v2-road-line-meta");
const EPS = 1e-7;
type Bbox = [minX: number, minY: number, maxX: number, maxY: number];

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function numberValue(value: unknown, positive = false): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || (positive && number <= 0)) return null;
  return number;
}

function roadHierarchy(hit: FeatureHit): string | null {
  const value = hit.properties.hierarchy;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function roadName(hit: FeatureHit): string | null {
  const value = typeof hit.name === "string" && hit.name.trim() !== "" ? hit.name : hit.properties.name;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pointDistance(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function addCut(cuts: number[], value: number): void {
  if (value > EPS && value < 1 - EPS && Number.isFinite(value)) cuts.push(value);
}

function outsideBbox(point: number[], bbox: Bbox): boolean {
  return point[0] < bbox[0] - EPS || point[0] > bbox[2] + EPS || point[1] < bbox[1] - EPS || point[1] > bbox[3] + EPS;
}

/** Return pieces outside the coverage rectangle; the boundary itself belongs to topo. */
function outsideBboxPaths(part: number[][], bbox: Bbox): number[][][] {
  const paths: number[][][] = [];
  for (let index = 1; index < part.length; index += 1) {
    const a = part[index - 1];
    const b = part[index];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (Math.hypot(dx, dy) <= EPS) continue;
    const cuts = [0, 1];
    if (dx !== 0) {
      addCut(cuts, (bbox[0] - a[0]) / dx);
      addCut(cuts, (bbox[2] - a[0]) / dx);
    }
    if (dy !== 0) {
      addCut(cuts, (bbox[1] - a[1]) / dy);
      addCut(cuts, (bbox[3] - a[1]) / dy);
    }
    cuts.sort((left, right) => left - right);
    const uniqueCuts = cuts.filter((value, cutIndex) => cutIndex === 0 || Math.abs(value - cuts[cutIndex - 1]) > EPS);
    for (let cutIndex = 1; cutIndex < uniqueCuts.length; cutIndex += 1) {
      const from = uniqueCuts[cutIndex - 1];
      const to = uniqueCuts[cutIndex];
      const middle = (from + to) / 2;
      const midpoint = [a[0] + dx * middle, a[1] + dy * middle];
      if (!outsideBbox(midpoint, bbox)) continue;
      const start = [a[0] + dx * from, a[1] + dy * from];
      const end = [a[0] + dx * to, a[1] + dy * to];
      const previous = paths.at(-1);
      if (previous && pointDistance(previous.at(-1)!, start) <= EPS) previous.push(end);
      else paths.push([start, end]);
    }
  }
  return paths.filter((path) => path.length >= 2);
}

function outsideGeometry(geometry: Geometry, bbox: Bbox): LineString | MultiLineString | null {
  const paths = lineParts(geometry).flatMap((part) => outsideBboxPaths(part, bbox));
  if (paths.length === 0) return null;
  return paths.length === 1 ? { type: "LineString", coordinates: paths[0] } : { type: "MultiLineString", coordinates: paths };
}

function circlePaths(center: readonly [number, number], radiusM: number, geometry: Geometry): number[][][] {
  return clipLineToCircle(center, radiusM, geometry).filter((path) => path.length >= 2);
}

function withMeta(line: MergedRoadLine, meta: RoadLineMeta): MergedRoadLine {
  Object.defineProperty(line, ROAD_META, { configurable: false, enumerable: false, value: meta });
  return line;
}

export function roadLineMeta(line: MergedRoadLine): RoadLineMeta | null {
  return (line as MergedRoadLine & { [ROAD_META]?: RoadLineMeta })[ROAD_META] ?? null;
}

function polygonParts(geometry: Polygon | MultiPolygon): number[][][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function pointOnSegment(point: number[], a: number[], b: number[]): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPS) return pointDistance(point, a) <= EPS;
  if (Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length > EPS) return false;
  return (point[0] - a[0]) * (point[0] - b[0]) + (point[1] - a[1]) * (point[1] - b[1]) <= EPS;
}

function pointInRing(point: number[], ring: number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index];
    const prior = ring[previous];
    if (pointOnSegment(point, prior, current)) return true;
    const intersects = (current[1] > point[1]) !== (prior[1] > point[1])
      && point[0] < ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: number[], rings: number[][][]): boolean {
  return pointInRing(point, rings[0] ?? []) && !rings.slice(1).some((ring) => pointInRing(point, ring));
}

function orientation(a: number[], b: number[], c: number[]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsIntersect(a: number[], b: number[], c: number[], d: number[]): boolean {
  const ab1 = orientation(a, b, c);
  const ab2 = orientation(a, b, d);
  const cd1 = orientation(c, d, a);
  const cd2 = orientation(c, d, b);
  if (Math.abs(ab1) <= EPS && pointOnSegment(c, a, b)) return true;
  if (Math.abs(ab2) <= EPS && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cd1) <= EPS && pointOnSegment(a, c, d)) return true;
  if (Math.abs(cd2) <= EPS && pointOnSegment(b, c, d)) return true;
  return (ab1 > 0) !== (ab2 > 0) && (cd1 > 0) !== (cd2 > 0);
}

function pointToSegmentDistance(point: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 <= EPS ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
}

function segmentDistance(a: number[], b: number[], c: number[], d: number[]): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointToSegmentDistance(a, c, d), pointToSegmentDistance(b, c, d), pointToSegmentDistance(c, a, b), pointToSegmentDistance(d, a, b));
}

function lineToSiteDistance(line: Geometry, site: Polygon | MultiPolygon): number {
  const polygons = polygonParts(site);
  let best = Number.POSITIVE_INFINITY;
  for (const part of lineParts(line)) {
    for (const point of part) if (polygons.some((rings) => pointInPolygon(point, rings))) return 0;
    for (let index = 1; index < part.length; index += 1) {
      const a = part[index - 1];
      const b = part[index];
      for (const rings of polygons) {
        for (const ring of rings) {
          for (let ringIndex = 1; ringIndex < ring.length; ringIndex += 1) {
            best = Math.min(best, segmentDistance(a, b, ring[ringIndex - 1], ring[ringIndex]));
            if (best <= EPS) return 0;
          }
        }
      }
    }
  }
  return best;
}

/** Merge topo roads inside the coverage bbox with OSM pieces outside that bbox. */
export function mergedRoadLines(ctx: EngineContext, radiusM: number): MergedRoadLine[] {
  const output: MergedRoadLine[] = [];
  const center = ctx.input.center;
  const topo = ctx.topo;
  if (topo) {
    for (const hit of topo.hits(["topo_road"], radiusM)) {
      const paths = circlePaths(center, radiusM, hit.geometry);
      const widthM = numberValue(hit.properties.widthM, true);
      const lanes = numberValue(hit.properties.lanes, true);
      for (const [pathIndex, path] of paths.entries()) {
        const line = { geometry: { type: "LineString", coordinates: path } as LineString, widthM, lanes, source: "ngii_topo" as const, hierarchy: null } satisfies MergedRoadLine;
        output.push(withMeta(line, { featureId: hit.featureId, name: roadName(hit), pathIndex }));
      }
    }
  }

  const bbox = topo?.summary.bboxUtmk as Bbox | undefined;
  for (const hit of ctx.hits("reference", ["road"], radiusM)) {
    const outside = bbox ? outsideGeometry(hit.geometry, bbox) : hit.geometry;
    if (!outside) continue;
    const paths = circlePaths(center, radiusM, outside);
    const lanes = numberValue(hit.properties.lanes, true);
    for (const [pathIndex, path] of paths.entries()) {
      const line = { geometry: { type: "LineString", coordinates: path } as LineString, widthM: null, lanes, source: "osm_roads" as const, hierarchy: roadHierarchy(hit) } satisfies MergedRoadLine;
      output.push(withMeta(line, { featureId: hit.featureId, name: roadName(hit), pathIndex }));
    }
  }
  return output;
}

/** Topo width null is explicitly the smallest band; OSM never calls this helper. */
export function widthBand(widthM: number | null): "12+" | "8-12" | "4-8" | "<4" {
  if (widthM !== null && Number.isFinite(widthM)) {
    if (widthM >= 12) return "12+";
    if (widthM >= 8) return "8-12";
    if (widthM >= 4) return "4-8";
  }
  return "<4";
}

/** Maximum topo centerline width within width/2 + 3 m of the selected site. */
export function topoFrontageWidthM(ctx: EngineContext, radiusM = ctx.input.radiusM): number | null {
  if (!ctx.topo) return null;
  const site = ctx.input.site.geometry;
  let maximum: number | null = null;
  for (const hit of ctx.topo.hits(["topo_road"], radiusM)) {
    const widthM = numberValue(hit.properties.widthM, true);
    if (widthM === null) continue;
    const distance = site
      ? lineToSiteDistance(hit.geometry, site)
      : distanceToLineM(ctx.input.center, hit.geometry);
    if (distance !== null && distance <= widthM / 2 + 3 + EPS && (maximum === null || widthM > maximum)) maximum = widthM;
  }
  return maximum;
}
