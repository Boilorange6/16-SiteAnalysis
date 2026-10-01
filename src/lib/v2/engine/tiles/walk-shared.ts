/** OSM 도로 중심선에서 보행망 최단거리와 도달 등시선 격자를 만드는 순수 엔진. */
import type { Geometry } from "geojson";
import { toUtmk, type LngLat, type XY } from "../../crs";
import type { SourceRef, EngineContext } from "../context";
import type { FeatureHit } from "../../data/features";
import type { LocalGrid } from "./raster-grid";

export const WALK_SPEED_M_PER_MIN = 80;
export const WALK_SNAP_M = 150;
/** 15분(1,200 m) 등시선에 여유를 더해 도로를 조회하는 반경. */
export const WALK_BUFFER_M = 1500;
/** OSM에서 보행 금지 성격이 강한 차도. trunk 본선은 보도 태그 부재 때문에 보존한다. */
export const WALK_EXCLUDED_FCLASS = new Set(["motorway", "motorway_link", "trunk_link"]);

export interface WalkRoute {
  distanceM: number;
  minutes: number;
  /** EPSG:5179 미터 좌표의 정점 경로. */
  path: number[][];
}

export interface WalkField {
  distTo(xy: XY): WalkRoute | null;
  nodes: number;
  edges: number;
  /** maxM 안에서 적어도 한 끝점에 도달할 수 있는 원본 간선과 양 끝 최단거리. */
  reachable(maxM: number): Array<{ a: XY; b: XY; da: number; db: number }>;
}

type Point = [number, number];

interface GraphEdge {
  a: number;
  b: number;
  lengthM: number;
}

interface Graph {
  points: Point[];
  edges: GraphEdge[];
  adjacency: Array<Array<{ to: number; lengthM: number }>>;
}

interface HeapEntry {
  node: number;
  distanceM: number;
}

/** 최소 힙. Dijkstra에서 decrease-key 대신 stale entry를 버리는 방식으로 쓴다. */
class MinHeap {
  private readonly items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: HeapEntry): void {
    const items = this.items;
    let index = items.length;
    items.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].distanceM <= entry.distanceM) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const first = items[0];
    const last = items.pop()!;
    if (items.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= items.length) break;
      const right = left + 1;
      let child = left;
      if (right < items.length && items[right].distanceM < items[left].distanceM) child = right;
      if (items[child].distanceM >= last.distanceM) break;
      items[index] = items[child];
      index = child;
    }
    items[index] = last;
    return first;
  }
}

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates as number[][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as number[][][];
  return [];
}

function finitePoint(point: readonly number[]): point is [number, number] {
  return point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

/** 0.1 m 키로 정점을 합치되 대표 좌표는 첫 원본 좌표를 보존한다. */
function vertexKey(point: readonly number[]): string {
  return `${Math.round(point[0] * 10)},${Math.round(point[1] * 10)}`;
}

function buildGraph(hits: readonly FeatureHit[]): Graph {
  const points: Point[] = [];
  const adjacency: Array<Array<{ to: number; lengthM: number }>> = [];
  const edges: GraphEdge[] = [];
  const nodeByKey = new Map<string, number>();
  const edgeByKey = new Set<string>();

  const nodeFor = (point: readonly number[]): number => {
    const key = vertexKey(point);
    const existing = nodeByKey.get(key);
    if (existing !== undefined) return existing;
    const index = points.length;
    nodeByKey.set(key, index);
    points.push([point[0], point[1]]);
    adjacency.push([]);
    return index;
  };

  const addEdge = (a: number, b: number): void => {
    if (a === b) return;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `${low}:${high}`;
    if (edgeByKey.has(key)) return;
    const pa = points[a];
    const pb = points[b];
    const lengthM = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (!Number.isFinite(lengthM) || lengthM <= 0) return;
    edgeByKey.add(key);
    edges.push({ a, b, lengthM });
    adjacency[a].push({ to: b, lengthM });
    adjacency[b].push({ to: a, lengthM });
  };

  for (const hit of hits) {
    const fclass = typeof hit.properties.fclass === "string" ? hit.properties.fclass.trim().toLowerCase() : "";
    if (WALK_EXCLUDED_FCLASS.has(fclass)) continue;
    for (const part of lineParts(hit.geometry)) {
      let previous: number | null = null;
      for (const coordinate of part) {
        if (!finitePoint(coordinate)) {
          previous = null;
          continue;
        }
        const current = nodeFor(coordinate);
        if (previous !== null) addEdge(previous, current);
        previous = current;
      }
    }
  }

  return { points, edges, adjacency };
}

function nearestNode(points: readonly Point[], target: XY, maxDistanceM: number): number | null {
  let best: number | null = null;
  let bestDistance = maxDistanceM;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const distance = Math.hypot(point[0] - target[0], point[1] - target[1]);
    if (distance <= bestDistance) {
      if (best === null || distance < bestDistance || index < best) {
        best = index;
        bestDistance = distance;
      }
    }
  }
  return best;
}

function dijkstra(graph: Graph, start: number): { distances: Float64Array; previous: Int32Array } {
  const distances = new Float64Array(graph.points.length);
  distances.fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(graph.points.length);
  previous.fill(-1);
  distances[start] = 0;

  const heap = new MinHeap();
  heap.push({ node: start, distanceM: 0 });
  while (heap.size > 0) {
    const current = heap.pop()!;
    if (current.distanceM !== distances[current.node]) continue;
    for (const next of graph.adjacency[current.node]) {
      const candidate = current.distanceM + next.lengthM;
      if (candidate < distances[next.to]) {
        distances[next.to] = candidate;
        previous[next.to] = current.node;
        heap.push({ node: next.to, distanceM: candidate });
      }
    }
  }
  return { distances, previous };
}

function pathTo(graph: Graph, previous: Int32Array, start: number, target: number): number[][] {
  const path: number[][] = [];
  let current = target;
  while (current >= 0) {
    path.push([...graph.points[current]]);
    if (current === start) break;
    current = previous[current];
  }
  path.reverse();
  return path;
}

function makeWalkField(graph: Graph, start: number): WalkField {
  const { distances, previous } = dijkstra(graph, start);
  const nearest = (xy: XY): number | null => nearestNode(graph.points, xy, WALK_SNAP_M);

  return {
    nodes: graph.points.length,
    edges: graph.edges.length,
    distTo(xy) {
      if (!xy || xy.length < 2 || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null;
      const target = nearest(xy);
      if (target === null || !Number.isFinite(distances[target])) return null;
      return {
        distanceM: distances[target],
        minutes: walkMinutes(distances[target]),
        path: pathTo(graph, previous, start, target),
      };
    },
    reachable(maxM) {
      if (!Number.isFinite(maxM) || maxM < 0) return [];
      const reached: Array<{ a: XY; b: XY; da: number; db: number }> = [];
      for (const edge of graph.edges) {
        const da = distances[edge.a];
        const db = distances[edge.b];
        if (Math.min(da, db) > maxM) continue;
        reached.push({ a: [...graph.points[edge.a]], b: [...graph.points[edge.b]], da, db });
      }
      return reached;
    },
  };
}

export function walkField(ctx: EngineContext): WalkField | null {
  return ctx.memo("walk:field", () => {
    const searchRadius = Math.min(5000, Math.max(1, ctx.input.radiusM + WALK_BUFFER_M));
    const hits = ctx.hits("reference", ["road"], searchRadius);
    const graph = buildGraph(hits);
    if (graph.points.length === 0) return null;
    const [cx, cy] = toUtmk(ctx.input.center);
    const start = nearestNode(graph.points, [cx, cy], WALK_SNAP_M);
    return start === null ? null : makeWalkField(graph, start);
  });
}

export const walkMinutes = (m: number) => Math.round(m / WALK_SPEED_M_PER_MIN);

export function walkSources(ctx: EngineContext): SourceRef[] {
  return ctx.sources("reference", ["osm_roads"]);
}

interface ReachableInterval {
  startT: number;
  endT: number;
}

/** 한 간선에서 maxM 안에 있는 t 구간. 양 끝 경로가 모두 가까워도 중간에 끊길 수 있다. */
function reachableIntervals(da: number, db: number, lengthM: number, maxM: number): ReachableInterval[] {
  if (lengthM <= 0) return [];
  const intervals: ReachableInterval[] = [];
  if (Number.isFinite(da) && da <= maxM) intervals.push({ startT: 0, endT: Math.min(1, (maxM - da) / lengthM) });
  if (Number.isFinite(db) && db <= maxM) intervals.push({ startT: Math.max(0, 1 - (maxM - db) / lengthM), endT: 1 });
  return intervals.filter((interval) => interval.endT >= interval.startT - 1e-9);
}

function markSegment(
  seeds: Float64Array,
  grid: LocalGrid,
  a: XY,
  b: XY,
  da: number,
  db: number,
  lengthM: number,
  interval: ReachableInterval,
): void {
  const ax = a[0] + (b[0] - a[0]) * interval.startT;
  const ay = a[1] + (b[1] - a[1]) * interval.startT;
  const bx = a[0] + (b[0] - a[0]) * interval.endT;
  const by = a[1] + (b[1] - a[1]) * interval.endT;
  const segmentLength = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(segmentLength / Math.max(0.5, grid.cellM * 0.5)));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;

  for (let step = 0; step <= steps; step++) {
    const localT = step / steps;
    const t = interval.startT + (interval.endT - interval.startT) * localT;
    const x = a[0] + dx * t;
    const y = a[1] + dy * t;
    const col = Math.round((x - grid.x0) / grid.cellM);
    const row = Math.round((y - grid.y0) / grid.cellM);
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue;
    const index = row * grid.cols + col;
    const projectionT = lengthSquared <= 0
      ? t
      : Math.max(0, Math.min(1, ((grid.x0 + col * grid.cellM - a[0]) * dx + (grid.y0 + row * grid.cellM - a[1]) * dy) / lengthSquared));
    const travelM = Math.min(da + projectionT * lengthM, db + (1 - projectionT) * lengthM);
    if (Number.isFinite(travelM) && travelM < seeds[index]) seeds[index] = travelM;
  }
}

/** 8방향 chamfer 거리변환. 단위는 미터이며 입력 유한값 셀이 seed다. */
function chamferDistance(seeds: Float64Array, cols: number, rows: number, cellM: number, maxSeedM: number): Float64Array {
  const distance = new Float64Array(seeds.length);
  distance.fill(Number.POSITIVE_INFINITY);
  for (let index = 0; index < seeds.length; index++) if (seeds[index] <= maxSeedM) distance[index] = 0;
  const diagonalM = cellM * Math.SQRT2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      let best = distance[index];
      if (col > 0) best = Math.min(best, distance[index - 1] + cellM);
      if (row > 0) best = Math.min(best, distance[index - cols] + cellM);
      if (col > 0 && row > 0) best = Math.min(best, distance[index - cols - 1] + diagonalM);
      if (col + 1 < cols && row > 0) best = Math.min(best, distance[index - cols + 1] + diagonalM);
      distance[index] = best;
    }
  }
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      const index = row * cols + col;
      let best = distance[index];
      if (col + 1 < cols) best = Math.min(best, distance[index + 1] + cellM);
      if (row + 1 < rows) best = Math.min(best, distance[index + cols] + cellM);
      if (col + 1 < cols && row + 1 < rows) best = Math.min(best, distance[index + cols + 1] + diagonalM);
      if (col > 0 && row + 1 < rows) best = Math.min(best, distance[index + cols - 1] + diagonalM);
      distance[index] = best;
    }
  }
  return distance;
}

/**
 * 도달 간선을 5 m 격자에 칠하고 bufferM만큼 chamfer 거리변환으로 넓힌다.
 * 값은 가장 작은 도달 분 상한(5/10/15 등)이고, 미도달은 NaN이다.
 */
export function isochroneGrid(
  field: WalkField,
  center: LngLat,
  minutes: readonly number[],
  opts: { cellM?: number; bufferM?: number } = {},
): LocalGrid {
  const thresholds = [...new Set(minutes)].sort((a, b) => a - b);
  if (thresholds.length === 0 || thresholds.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("minutes must contain finite non-negative thresholds");
  }
  const cellM = opts.cellM ?? 5;
  const bufferM = opts.bufferM ?? 30;
  if (!Number.isFinite(cellM) || cellM <= 0) throw new RangeError("cellM must be positive");
  if (!Number.isFinite(bufferM) || bufferM < 0) throw new RangeError("bufferM must be non-negative");

  const maxTravelM = thresholds[thresholds.length - 1] * WALK_SPEED_M_PER_MIN;
  const [cx, cy] = toUtmk(center);
  const span = maxTravelM + bufferM;
  const cols = Math.floor((2 * span) / cellM) + 1;
  const rows = cols;
  const grid: LocalGrid = {
    cx,
    cy,
    cellM,
    cols,
    rows,
    x0: cx - span,
    y0: cy - span,
    values: new Float64Array(cols * rows),
  };
  grid.values.fill(Number.NaN);
  const seeds = new Float64Array(grid.values.length);
  seeds.fill(Number.POSITIVE_INFINITY);
  const maxDistance = maxTravelM;

  for (const edge of field.reachable(maxDistance)) {
    const a = edge.a;
    const b = edge.b;
    const lengthM = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const intervals = reachableIntervals(edge.da, edge.db, lengthM, maxDistance);
    for (const interval of intervals) markSegment(seeds, grid, a, b, edge.da, edge.db, lengthM, interval);
  }

  const values = new Float64Array(grid.values.length);
  values.fill(Number.NaN);
  for (const threshold of thresholds) {
    const distance = chamferDistance(seeds, grid.cols, grid.rows, cellM, threshold * WALK_SPEED_M_PER_MIN);
    for (let index = 0; index < values.length; index++) {
      if (!Number.isFinite(values[index]) && distance[index] <= bufferM + 1e-6) values[index] = threshold;
    }
  }
  grid.values.set(values);
  return grid;
}
