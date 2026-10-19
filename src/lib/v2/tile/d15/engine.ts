/** D15 가구 — 도로 중심선으로 폐합된 블록의 면적·반경 교차 구성. */
import { difference, featureCollection, lineString, polygon } from "@turf/turf";
import type { Geometry, Position } from "geojson";
import { toUtmk } from "../../crs";
import type { FeatureHit } from "../../data/features";
import type { TileResult } from "../../tile-result";
import type { EngineContext, Limitation } from "../../engine/context";
import { makeTile, missing, obs, polygonCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { areaInCircle, polygonArea } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";
import { mergedRoadLines, type MergedRoadLine } from "../../engine/tiles/topo-roads";

const ROAD_SOURCES = ["osm_roads"] as const;
const BLOCK_LAYERS = ["block_lt05", "block_05_1", "block_1_2", "block_2_5", "block_ge5", "block_open"] as const;

/** Q7: 자동차 도로만 사용하고, 읽기 범위를 분석 반경에서 500m 넓힌다. */
export const BLOCK_ROAD_FILTER: { includePedestrian: boolean; bufferM: number } = {
  includePedestrian: false,
  bufferM: 500,
};

const BLOCK_CLASSES = [
  { suffix: "lt05", layer: "block_lt05", label: "0.5ha 미만", matches: (ha: number) => ha < 0.5 },
  { suffix: "05_1", layer: "block_05_1", label: "0.5~1ha", matches: (ha: number) => ha >= 0.5 && ha < 1 },
  { suffix: "1_2", layer: "block_1_2", label: "1~2ha", matches: (ha: number) => ha >= 1 && ha < 2 },
  { suffix: "2_5", layer: "block_2_5", label: "2~5ha", matches: (ha: number) => ha >= 2 && ha < 5 },
  { suffix: "ge5", layer: "block_ge5", label: "5ha 이상", matches: (ha: number) => ha >= 5 },
] as const;

type Bbox = [minX: number, minY: number, maxX: number, maxY: number];
type Segment = [number, number][];
type RoadLine = { id: number; feature: ReturnType<typeof lineString>; bbox: Bbox };
type Block = { id: number; rings: number[][][]; areaM2: number };
type MeasuredBlock = Block & { crossAreaM2: number; clipped: number[][][][] };

const EPS = 1e-7;
const NODE_BUCKET_M = 250;

function hierarchyOf(value: unknown): string {
  return typeof value === "string" ? value : "기타";
}

function lineParts(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates as number[][]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as number[][][];
  return [];
}

function bboxOf(points: number[][]): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  }
  return [minX, minY, maxX, maxY];
}

function bboxOverlaps(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] + EPS && a[2] + EPS >= b[0] && a[1] <= b[3] + EPS && a[3] + EPS >= b[1];
}

function coordinateKey(point: number[]): string {
  return `${Math.round(point[0] * 1e6)},${Math.round(point[1] * 1e6)}`;
}

function uniquePoints(points: number[][]): number[][] {
  return [...new Map(points.map((point) => [coordinateKey(point), [point[0], point[1]]])).values()];
}

/** Liang–Barsky로 한 선분을 읽기 사각형에 잘라낸다. */
function clipSegment(a: number[], b: number[], bounds: Bbox): Segment | null {
  const [minX, minY, maxX, maxY] = bounds;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let from = 0;
  let to = 1;
  const tests: Array<[number, number]> = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ];
  for (const [p, q] of tests) {
    if (Math.abs(p) <= EPS) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to + EPS) return null;
  }
  const start: [number, number] = [a[0] + from * dx, a[1] + from * dy];
  const end: [number, number] = [a[0] + to * dx, a[1] + to * dy];
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= EPS) return null;
  return [start, end];
}

function roadLines(hits: FeatureHit[], bounds: Bbox): RoadLine[] {
  const lines: RoadLine[] = [];
  let id = 1;
  for (const hit of hits) {
    if (!BLOCK_ROAD_FILTER.includePedestrian && hierarchyOf(hit.properties.hierarchy) === "보행·자전거") continue;
    for (const part of lineParts(hit.geometry)) {
      for (let i = 1; i < part.length; i++) {
        const clipped = clipSegment(part[i - 1], part[i], bounds);
        if (!clipped) continue;
        const feature = lineString(clipped as Position[]);
        lines.push({ id: hit.featureId * 100000 + id++, feature, bbox: bboxOf(clipped) });
      }
    }
  }
  return lines;
}

function mergedLineParts(geometry: MergedRoadLine["geometry"]): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  return geometry.coordinates;
}

function roadLinesFromMerged(lines: MergedRoadLine[], bounds: Bbox): RoadLine[] {
  const output: RoadLine[] = [];
  let id = 1;
  for (const line of lines) {
    if (line.source === "osm_roads" && !BLOCK_ROAD_FILTER.includePedestrian && hierarchyOf(line.hierarchy) === "보행·자전거") continue;
    for (const part of mergedLineParts(line.geometry)) {
      for (let index = 1; index < part.length; index += 1) {
        const clipped = clipSegment(part[index - 1], part[index], bounds);
        if (!clipped) continue;
        output.push({ id: id++, feature: lineString(clipped as Position[]), bbox: bboxOf(clipped) });
      }
    }
  }
  return output;
}

function pointOnSegment(point: number[], a: number[], b: number[]): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPS) return Math.hypot(point[0] - a[0], point[1] - a[1]) <= 1e-5;
  const distance = Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length;
  if (distance > 1e-5) return false;
  return (point[0] - a[0]) * (point[0] - b[0]) + (point[1] - a[1]) * (point[1] - b[1]) <= 1e-5;
}

function cross(a: number[], b: number[]): number {
  return a[0] * b[1] - a[1] * b[0];
}

/** 2점 선분끼리의 교차점. Turf lineIntersect보다 싸고, 겹치는 선분의 끝점도 노드로 보존한다. */
function segmentIntersections(a: number[], b: number[], c: number[], d: number[]): number[][] {
  const left = (first: number[], second: number[]) => first[0] < second[0] || (first[0] === second[0] && first[1] < second[1]) ? first : second;
  const first = left(a, b);
  const second = first === a ? b : a;
  const third = left(c, d);
  const fourth = third === c ? d : c;
  const x1 = first[0];
  const y1 = first[1];
  const x2 = second[0];
  const y2 = second[1];
  const x3 = third[0];
  const y3 = third[1];
  const x4 = fourth[0];
  const y4 = fourth[1];
  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const dx2 = x4 - x3;
  const dy2 = y4 - y3;
  // 기존 Turf sweepline의 선분 교차식과 같은 연산 순서를 사용해 교차점 반올림
  // 경계에서도 기존 노드 좌표를 보존한다.
  const denominator = (dy2 * dx1) - (dx2 * dy1);
  if (denominator !== 0) {
    const numeratorA = (dx2 * (y1 - y3)) - (dy2 * (x1 - x3));
    const numeratorB = (dx1 * (y1 - y3)) - (dy1 * (x1 - x3));
    const parameterA = numeratorA / denominator;
    const parameterB = numeratorB / denominator;
    if (parameterA < 0 || parameterA > 1 || parameterB < 0 || parameterB > 1) return [];
    // 끝점 접촉은 endpointTouches가 원래 끝점 좌표로 보존한다.
    if (parameterA === 0 || parameterA === 1 || parameterB === 0 || parameterB === 1) return [];
    return [[x1 + parameterA * dx1, y1 + parameterA * dy1]];
  }

  // 평행·비공선이면 교차하지 않는다. 공선 겹침은 양쪽 끝점 중 선분 위에 있는 것만 남긴다.
  if (cross([c[0] - a[0], c[1] - a[1]], [dx1, dy1]) !== 0) return [];
  return uniquePoints([
    ...(pointOnSegment(a, c, d) ? [a] : []),
    ...(pointOnSegment(b, c, d) ? [b] : []),
    ...(pointOnSegment(c, a, b) ? [c] : []),
    ...(pointOnSegment(d, a, b) ? [d] : []),
  ]);
}

function lineEndpoints(line: RoadLine): number[][] {
  const coordinates = line.feature.geometry.coordinates as number[][];
  return [coordinates[0], coordinates[coordinates.length - 1]];
}

function snapToSegment(point: number[], a: number[], b: number[]): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 <= EPS ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return [a[0] + t * dx, a[1] + t * dy];
}

function splitParameters(points: number[][], a: number[], b: number[]): number[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const values = [0, 1, ...points.map((point) =>
    length2 <= EPS ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)))];
  values.sort((x, y) => x - y);
  return values.filter((value, index) => index === 0 || value - values[index - 1] > 1e-9);
}

function manualLineSplit(a: number[], b: number[], points: number[][]): Array<ReturnType<typeof lineString>> {
  const parameters = splitParameters(points, a, b);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return parameters.slice(1).map((to, index) => {
    const from = parameters[index];
    return lineString([
      [a[0] + from * dx, a[1] + from * dy],
      [a[0] + to * dx, a[1] + to * dy],
    ] as Position[]);
  });
}

/** lineSplit의 2점 선분 경로를 로컬 좌표에서 재현한다(끝점은 원래 선분 좌표를 유지). */
function manualPointSplit(a: number[], b: number[], points: number[][]): Array<ReturnType<typeof lineString>> {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const entries = [
    { parameter: 0, point: a },
    { parameter: 1, point: b },
    ...points.map((point) => ({
      parameter: length2 <= EPS ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2)),
      point,
    })),
  ];
  entries.sort((left, right) => left.parameter - right.parameter);
  const unique = entries.filter((entry, index) => index === 0 || entry.parameter - entries[index - 1].parameter > 1e-9);
  return unique.slice(1).map((to, index) => lineString([unique[index].point, to.point] as Position[]));
}

/** 격자 버킷으로 후보를 줄인 뒤, 겹치는 bbox 쌍만 Turf 교차를 호출한다. */
function candidatePairs(lines: RoadLine[], bounds: Bbox): Array<[number, number]> {
  const buckets = new Map<string, number[]>();
  const [minX, minY] = bounds;
  lines.forEach((line, index) => {
    const x0 = Math.floor((line.bbox[0] - minX) / NODE_BUCKET_M);
    const x1 = Math.floor((line.bbox[2] - minX) / NODE_BUCKET_M);
    const y0 = Math.floor((line.bbox[1] - minY) / NODE_BUCKET_M);
    const y1 = Math.floor((line.bbox[3] - minY) / NODE_BUCKET_M);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x},${y}`;
        const list = buckets.get(key) ?? [];
        list.push(index);
        buckets.set(key, list);
      }
    }
  });
  const pairs = new Set<string>();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = Math.min(list[i], list[j]);
        const b = Math.max(list[i], list[j]);
        if (a !== b && bboxOverlaps(lines[a].bbox, lines[b].bbox)) pairs.add(`${a}:${b}`);
      }
    }
  }
  return [...pairs]
    .map((key) => key.split(":").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Turf polygonize의 전제인 끝점 노드 그래프를 만든다. */
function nodeRoadLines(lines: RoadLine[], bounds: Bbox): Array<ReturnType<typeof lineString>> {
  const splitPoints = lines.map(() => [] as number[][]);
  const pairs = candidatePairs(lines, bounds);
  for (const [i, j] of pairs) {
    const a = lines[i];
    const b = lines[j];
    const aEndpoints = lineEndpoints(a);
    const bEndpoints = lineEndpoints(b);
    const intersections = segmentIntersections(aEndpoints[0], aEndpoints[1], bEndpoints[0], bEndpoints[1]);
    const endpointTouches = [
      ...aEndpoints.filter((point) => pointOnSegment(point, bEndpoints[0], bEndpoints[1])),
      ...bEndpoints.filter((point) => pointOnSegment(point, aEndpoints[0], aEndpoints[1])),
    ];
    splitPoints[i].push(...intersections, ...endpointTouches);
    splitPoints[j].push(...intersections, ...endpointTouches);
  }

  const result: Array<ReturnType<typeof lineString>> = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const [start, end] = lineEndpoints(lines[i]);
    const points = uniquePoints(splitPoints[i].map((point) => snapToSegment(point, start, end)));
    const [originX, originY] = bounds;
    const localStart: [number, number] = [start[0] - originX, start[1] - originY];
    const localEnd: [number, number] = [end[0] - originX, end[1] - originY];
    const truncatedLocalPoints = uniquePoints(points.map(([x, y]) => [
      Math.round((x - originX) * 1e7) / 1e7,
      Math.round((y - originY) * 1e7) / 1e7,
    ]));
    const inLineBbox = (point: number[]) => point[0] >= Math.min(localStart[0], localEnd[0]) && point[0] <= Math.max(localStart[0], localEnd[0])
      && point[1] >= Math.min(localStart[1], localEnd[1]) && point[1] <= Math.max(localStart[1], localEnd[1]);
    const internalTruncatedPoints = truncatedLocalPoints.filter((point) => inLineBbox(point)
      && !(point[0] === localStart[0] && point[1] === localStart[1])
      && !(point[0] === localEnd[0] && point[1] === localEnd[1]));
    const expected = splitParameters(points, start, end).length - 1;
    const split = internalTruncatedPoints.length + 1 === expected
      ? manualPointSplit(localStart, localEnd, internalTruncatedPoints).map((piece) => lineString(
        (piece.geometry.coordinates as number[][]).map(([x, y]) => [x + originX, y + originY]) as Position[],
      ))
      : manualLineSplit(start, end, points);
    for (const piece of split) {
      const coordinates = piece.geometry.coordinates as number[][];
      if (coordinates.length < 2) continue;
      const a = coordinates[0];
      const b = coordinates[coordinates.length - 1];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) <= EPS) continue;
      const canonical = (point: number[]): [number, number] => [Math.round(point[0] * 1e6) / 1e6, Math.round(point[1] * 1e6) / 1e6];
      const normalized = coordinates.map(canonical);
      const forward = coordinateKey(normalized[0]) <= coordinateKey(normalized[normalized.length - 1])
        ? [normalized[0], normalized[normalized.length - 1]]
        : [normalized[normalized.length - 1], normalized[0]];
      const key = `${coordinateKey(forward[0])}:${coordinateKey(forward[1])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(lineString(normalized as Position[]));
    }
  }
  return result;
}

/** 차수 2 노드를 통과하는 선분 연쇄를 하나의 LineString으로 합쳐 polygonize 간선을 줄인다. */
function mergeDegreeTwoChains(lines: Array<ReturnType<typeof lineString>>): Array<ReturnType<typeof lineString>> {
  type Edge = { a: string; b: string; coordinates: number[][] };
  const edges: Edge[] = [];
  const adjacency = new Map<string, number[]>();
  const points = new Map<string, number[]>();
  const addIncident = (key: string, edgeIndex: number) => {
    const incident = adjacency.get(key) ?? [];
    incident.push(edgeIndex);
    adjacency.set(key, incident);
  };

  for (const line of lines) {
    const coordinates = line.geometry.coordinates as number[][];
    if (coordinates.length < 2) continue;
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    const a = coordinateKey(start);
    const b = coordinateKey(end);
    if (a === b) continue;
    const edgeIndex = edges.length;
    edges.push({ a, b, coordinates: [start, end] });
    points.set(a, start);
    points.set(b, end);
    addIncident(a, edgeIndex);
    addIncident(b, edgeIndex);
  }

  const degree = (key: string) => adjacency.get(key)?.length ?? 0;
  const visited = new Set<number>();
  const merged: Array<ReturnType<typeof lineString>> = [];

  const trace = (startNode: string, firstEdge: number) => {
    const startPoint = points.get(startNode);
    if (!startPoint) return;
    const path = [startPoint];
    let node = startNode;
    let edgeIndex = firstEdge;
    while (!visited.has(edgeIndex)) {
      visited.add(edgeIndex);
      const edge = edges[edgeIndex];
      const forward = edge.a === node;
      const oriented = forward ? edge.coordinates : [...edge.coordinates].reverse();
      for (const point of oriented.slice(1)) path.push(point);
      node = forward ? edge.b : edge.a;
      if (node === startNode || degree(node) !== 2) break;
      const next = adjacency.get(node)?.find((candidate) => candidate !== edgeIndex && !visited.has(candidate));
      if (next === undefined) break;
      edgeIndex = next;
    }
    if (path.length >= 2) merged.push(lineString(path as Position[]));
  };

  // 끝점·교차점·분기점에서 시작하면 모든 단순 연쇄를 한 번씩 걷는다.
  for (const [node, incident] of adjacency) {
    if (degree(node) === 2) continue;
    for (const edgeIndex of incident) if (!visited.has(edgeIndex)) trace(node, edgeIndex);
  }
  // 모든 노드가 차수 2인 고립 순환도로도 누락시키지 않는다.
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
    if (!visited.has(edgeIndex)) trace(edges[edgeIndex].a, edgeIndex);
  }
  return merged;
}

/**
 * Turf polygonize의 배열 splice 기반 그래프 대신, 이미 노딩된 선망의 반쪽 변을
 * 각 노드의 각도 순서로 한 번씩 순회한다. 시계방향의 단순 면만 반환하므로
 * 열린 외곽·댕글·bridge는 폐합 블록으로 승격되지 않는다.
 */
function polygonizeRoads(lines: Array<ReturnType<typeof lineString>>) {
  const exactKey = (point: number[]) => `${point[0]},${point[1]}`;
  type DirectedEdge = {
    from: string;
    to: string;
    sym: number;
    undirected: number;
    next: number;
    label: number;
    ring: number;
  };
  type Node = { point: number[]; outgoing: number[] };
  type UndirectedEdge = { a: string; b: string; active: boolean };
  const nodes = new Map<string, Node>();
  const edges: DirectedEdge[] = [];
  const undirectedEdges: UndirectedEdge[] = [];
  const incident = new Map<string, number[]>();
  const ensureNode = (point: number[]) => {
    const key = exactKey(point);
    let node = nodes.get(key);
    if (!node) {
      node = { point, outgoing: [] };
      nodes.set(key, node);
      incident.set(key, []);
    }
    return { key, node };
  };

  for (const line of lines) {
    const coordinates = line.geometry.coordinates as number[][];
    for (let i = 1; i < coordinates.length; i++) {
      const from = ensureNode(coordinates[i - 1]);
      const to = ensureNode(coordinates[i]);
      if (from.key === to.key) continue;
      const undirected = undirectedEdges.length;
      const forward = edges.length;
      const reverse = forward + 1;
      edges.push(
        { from: from.key, to: to.key, sym: reverse, undirected, next: -1, label: -1, ring: -1 },
        { from: to.key, to: from.key, sym: forward, undirected, next: -1, label: -1, ring: -1 },
      );
      undirectedEdges.push({ a: from.key, b: to.key, active: true });
      from.node.outgoing.push(forward);
      to.node.outgoing.push(reverse);
      incident.get(from.key)!.push(undirected);
      incident.get(to.key)!.push(undirected);
    }
  }
  const degree = new Map<string, number>();
  for (const [key, nodeEdges] of incident) degree.set(key, nodeEdges.length);
  const otherNode = (edgeIndex: number, key: string) => {
    const edge = undirectedEdges[edgeIndex];
    return edge.a === key ? edge.b : edge.a;
  };
  const dangleQueue = [...nodes.keys()].filter((key) => (degree.get(key) ?? 0) <= 1);
  const removedDangleNodes = new Set<string>();
  while (dangleQueue.length > 0) {
    const key = dangleQueue.pop()!;
    if (removedDangleNodes.has(key) || (degree.get(key) ?? 0) > 1) continue;
    removedDangleNodes.add(key);
    for (const edgeIndex of incident.get(key)!) {
      const edge = undirectedEdges[edgeIndex];
      if (!edge.active) continue;
      edge.active = false;
      const other = otherNode(edgeIndex, key);
      degree.set(key, (degree.get(key) ?? 1) - 1);
      degree.set(other, (degree.get(other) ?? 1) - 1);
      if ((degree.get(other) ?? 0) <= 1) dangleQueue.push(other);
    }
  }

  // Tarjan bridge detection removes cut edges in O(V + E), matching polygonize's
  // deleteCutEdges without its repeated directed-edge array filtering.
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const bridge = new Set<number>();
  let discoveryIndex = 0;
  for (const root of nodes.keys()) {
    if (discovery.has(root) || (degree.get(root) ?? 0) === 0) continue;
    discovery.set(root, discoveryIndex++);
    low.set(root, discovery.get(root)!);
    const stack: Array<{ key: string; parent: string | null; parentEdge: number; nextIncident: number }> = [
      { key: root, parent: null, parentEdge: -1, nextIncident: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const nodeEdges = incident.get(frame.key)!;
      while (frame.nextIncident < nodeEdges.length && !undirectedEdges[nodeEdges[frame.nextIncident]].active) frame.nextIncident++;
      if (frame.nextIncident >= nodeEdges.length) {
        stack.pop();
        if (frame.parent !== null) {
          low.set(frame.parent, Math.min(low.get(frame.parent)!, low.get(frame.key)!));
          if (low.get(frame.key)! > discovery.get(frame.parent)!) bridge.add(frame.parentEdge);
        }
        continue;
      }
      const edgeIndex = nodeEdges[frame.nextIncident++];
      if (edgeIndex === frame.parentEdge) continue;
      const other = otherNode(edgeIndex, frame.key);
      if (!discovery.has(other)) {
        discovery.set(other, discoveryIndex++);
        low.set(other, discovery.get(other)!);
        stack.push({ key: other, parent: frame.key, parentEdge: edgeIndex, nextIncident: 0 });
      } else {
        low.set(frame.key, Math.min(low.get(frame.key)!, discovery.get(other)!));
      }
    }
  }
  for (const edgeIndex of bridge) undirectedEdges[edgeIndex].active = false;

  const isActive = (edgeIndex: number) => undirectedEdges[edges[edgeIndex].undirected].active;
  const sameDirected = (left: number, right: number) => edges[left].from === edges[right].from && edges[left].to === edges[right].to;
  const compareEdges = (left: number, right: number, node: Node) => {
    const a = nodes.get(edges[left].to)!.point;
    const b = nodes.get(edges[right].to)!.point;
    const ax = a[0] - node.point[0];
    const ay = a[1] - node.point[1];
    const bx = b[0] - node.point[0];
    const by = b[1] - node.point[1];
    if (ax >= 0 && bx < 0) return 1;
    if (ax < 0 && bx >= 0) return -1;
    if (ax === 0 && bx === 0) {
      if (ay >= 0 || by >= 0) return ay - by;
      return by - ay;
    }
    const orientation = Math.sign(ax * (by - ay) - (bx - ax) * ay);
    if (orientation < 0) return 1;
    if (orientation > 0) return -1;
    return (ax * ax + ay * ay) - (bx * bx + by * by);
  };
  for (const node of nodes.values()) node.outgoing.sort((left, right) => compareEdges(left, right, node));

  const signedArea = (ring: number[][]) => {
    let sum = 0;
    for (let index = 1; index < ring.length; index++) {
      sum += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
    }
    return sum / 2;
  };
  const splitRepeatedRing = (keys: string[]) => {
    const result: string[][] = [];
    const stack: string[] = [];
    const positions = new Map<string, number>();
    for (const key of [...keys, keys[0]]) {
      const previous = positions.get(key);
      if (previous !== undefined) {
        const cycle = stack.slice(previous);
        if (cycle.length >= 3) result.push(cycle);
        stack.splice(previous + 1);
        positions.clear();
        stack.forEach((stackKey, index) => positions.set(stackKey, index));
        continue;
      }
      positions.set(key, stack.length);
      stack.push(key);
    }
    return result.length > 0 ? result : [keys];
  };
  const computeNextClockwise = () => {
    for (const node of nodes.values()) {
      const outgoing = node.outgoing.filter(isActive);
      for (let index = 0; index < outgoing.length; index++) {
        const previous = outgoing[(index === 0 ? outgoing.length : index) - 1];
        edges[edges[previous].sym].next = outgoing[index];
      }
    }
  };

  computeNextClockwise();
  const maximalRingStarts: number[] = [];
  let label = 0;
  for (let start = 0; start < edges.length; start++) {
    if (!isActive(start) || edges[start].label >= 0) continue;
    maximalRingStarts.push(start);
    let current = start;
    do {
      edges[current].label = label;
      current = edges[current].next;
    } while (!sameDirected(start, current));
    label++;
  }

  const computeNextCounterClockwise = (node: Node, ringLabel: number) => {
    const outgoing = node.outgoing.filter(isActive);
    let firstOut = -1;
    let previousIn = -1;
    for (let index = outgoing.length - 1; index >= 0; index--) {
      const directed = outgoing[index];
      const symmetric = edges[directed].sym;
      const out = edges[directed].label === ringLabel ? directed : -1;
      const incoming = edges[symmetric].label === ringLabel ? symmetric : -1;
      if (out < 0 && incoming < 0) continue;
      if (incoming >= 0) previousIn = incoming;
      if (out >= 0) {
        if (previousIn >= 0) {
          edges[previousIn].next = out;
          previousIn = -1;
        }
        if (firstOut < 0) firstOut = out;
      }
    }
    if (previousIn >= 0) edges[previousIn].next = firstOut;
  };

  for (const start of maximalRingStarts) {
    const ringLabel = edges[start].label;
    const intersectionNodes = new Set<string>();
    let current = start;
    do {
      const node = nodes.get(edges[current].from)!;
      if (node.outgoing.filter((edgeIndex) => isActive(edgeIndex) && edges[edgeIndex].label === ringLabel).length > 1) {
        intersectionNodes.add(edges[current].from);
      }
      current = edges[current].next;
    } while (!sameDirected(start, current));
    for (const key of intersectionNodes) computeNextCounterClockwise(nodes.get(key)!, ringLabel);
  }

  const rings: number[][] = [];
  for (let start = 0; start < edges.length; start++) {
    if (!isActive(start) || edges[start].ring >= 0) continue;
    const ring: number[] = [];
    let current = start;
    do {
      if (current < 0 || current >= edges.length || ring.length > edges.length) throw new Error(`invalid edge-ring traversal at ${start} -> ${current}`);
      ring.push(current);
      edges[current].ring = rings.length;
      current = edges[current].next;
    } while (!sameDirected(start, current));
    rings.push(ring);
  }

  const polygonRings = rings.flatMap((ring) => splitRepeatedRing(ring.map((edgeIndex) => edges[edgeIndex].from)).map((keys) => {
    const coordinates = keys.map((key) => nodes.get(key)!.point);
    const closed = [...coordinates, coordinates[0]];
    return { keys, coordinates: closed, area: signedArea(closed) };
  }));
  const polygons = polygonRings.filter((ring) => ring.keys.length >= 3 && ring.area < -1e-4).map((ring) => polygon([ring.coordinates as Position[]]));
  return featureCollection(polygons);
}

function touchesBoundary(rings: number[][][], bounds: Bbox): boolean {
  const [minX, minY, maxX, maxY] = bounds;
  return rings.some((ring) => ring.some(([x, y]) =>
    Math.abs(x - minX) <= 1e-5 || Math.abs(x - maxX) <= 1e-5 || Math.abs(y - minY) <= 1e-5 || Math.abs(y - maxY) <= 1e-5));
}

function closedBlocks(lines: RoadLine[], bounds: Bbox): { blocks: Block[]; polygonizeFailed: boolean } {
  if (lines.length === 0) return { blocks: [], polygonizeFailed: false };
  const noded = nodeRoadLines(lines, bounds);
  if (noded.length === 0) return { blocks: [], polygonizeFailed: false };
  const merged = mergeDegreeTwoChains(noded);
  let polygons: ReturnType<typeof polygonizeRoads>;
  try {
    polygons = polygonizeRoads(merged);
  } catch {
    return { blocks: [], polygonizeFailed: true };
  }
  const blocks: Block[] = [];
  for (const [index, feature] of polygons.features.entries()) {
    const rings = feature.geometry.coordinates as number[][][];
    const areaM2 = polygonArea(rings);
    if (areaM2 <= 1e-4 || touchesBoundary(rings, bounds)) continue;
    blocks.push({ id: index + 1, rings, areaM2 });
  }
  return { blocks, polygonizeFailed: false };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const percentText = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
const areaHaText = (value: number | null) => value === null ? "미상" : `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}ha`;
const mapAreaHaText = (areaM2: number) => `${(areaM2 / 10_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}ha`;

function framePolygon(bounds: Bbox) {
  const [minX, minY, maxX, maxY] = bounds;
  const ring: Position[] = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
  return polygon([ring]);
}

/** 읽기 사각형에서 폐합 블록을 뺀 잔여 면은 읽기 경계·외곽을 block_open으로 표시한다. */
function openGeometry(bounds: Bbox, blocks: Block[]): Geometry {
  const frame = framePolygon(bounds);
  if (blocks.length === 0) return frame.geometry;
  try {
    const result = difference(featureCollection([
      frame,
      ...blocks.map((block) => polygon(block.rings as Position[][])),
    ]));
    return result?.geometry ?? frame.geometry;
  } catch {
    return frame.geometry;
  }
}

function openCandidates(ctx: EngineContext, bounds: Bbox, blocks: Block[]): PolygonCandidate[] {
  const measured = areaInCircle(ctx.input.center, ctx.input.radiusM, openGeometry(bounds, blocks));
  if (!measured || measured.areaM2 <= 1e-4) return [];
  return measured.parts.flatMap((rings, index) => {
    const candidate = polygonCandidate(-index - 1, "block_open", rings, polygonArea(rings), null, {
      name: null,
      sublabel: mapAreaHaText(polygonArea(rings)),
      labelPriority: 0,
    });
    return candidate ? [candidate] : [];
  });
}

function measureBlocks(ctx: EngineContext, blocks: Block[]): { blocks: MeasuredBlock[]; failed: number } {
  const measured: MeasuredBlock[] = [];
  let failed = 0;
  for (const block of blocks) {
    const result = areaInCircle(ctx.input.center, ctx.input.radiusM, { type: "Polygon", coordinates: block.rings });
    if (!result) {
      failed++;
      continue;
    }
    if (result.areaM2 <= 1e-4) continue;
    measured.push({ ...block, crossAreaM2: result.areaM2, clipped: result.parts });
  }
  return { blocks: measured, failed };
}

export function d15(ctx: EngineContext): TileResult {
  const osmSources = ctx.sources("reference", ROAD_SOURCES);
  const sources = ctx.topo ? [ctx.topo.source, ...osmSources] : osmSources;
  if (sources.length === 0) return notProvided(ctx, "D15", "도로(OSM) 자료를 확인하지 못했습니다. 최신 자료 확인 후 제공됩니다.");

  const readRadiusM = ctx.input.radiusM + BLOCK_ROAD_FILTER.bufferM;
  const [cx, cy] = toUtmk(ctx.input.center);
  const bounds: Bbox = [cx - readRadiusM, cy - readRadiusM, cx + readRadiusM, cy + readRadiusM];
  const roads = ctx.topo
    ? roadLinesFromMerged(mergedRoadLines(ctx, readRadiusM), bounds)
    : roadLines(ctx.hits("reference", ["road"], readRadiusM), bounds);
  const closed = closedBlocks(roads, bounds);
  const { blocks, failed } = measureBlocks(ctx, closed.blocks);
  const circleAreaM2 = Math.PI * ctx.input.radiusM ** 2;
  const circleAreaRounded = Math.round(circleAreaM2);
  const closedAreaM2 = blocks.reduce((sum, block) => sum + block.crossAreaM2, 0);
  const openAreaM2 = Math.max(0, circleAreaM2 - closedAreaM2);
  const counts = BLOCK_CLASSES.map(() => 0);
  const crossAreas = BLOCK_CLASSES.map(() => 0);
  const originalAreasHa = blocks.map((block) => block.areaM2 / 10000);
  for (const block of blocks) {
    const classIndex = BLOCK_CLASSES.findIndex((item) => item.matches(block.areaM2 / 10000));
    if (classIndex < 0) continue;
    counts[classIndex]++;
    crossAreas[classIndex] += block.crossAreaM2;
  }

  const metrics: TileDraft["metrics"] = [
    obs("blocks", "반경과 교차하는 폐합 블록", blocks.length, "개", "d15-blocks@1:반경과 실제 교차하는 폐합 도로 블록 수", blocks.length, null),
    obs("fill_closed_pct", "폐합 블록 면적 채움률", pct(closedAreaM2, circleAreaM2), "%", "d15-fill-closed@1:폐합 블록의 반경 교차 면적÷π·r²", Math.round(closedAreaM2), circleAreaRounded),
    median(originalAreasHa) === null
      ? missing("median_block_ha", "폐합 블록 원래 면적 중앙값", "ha", "d15-median-area@1:반경과 교차하는 폐합 블록의 원래 도형 면적 중앙값")
      : obs("median_block_ha", "폐합 블록 원래 면적 중앙값", median(originalAreasHa)!, "ha", "d15-median-area@1:반경과 교차하는 폐합 블록의 원래 도형 면적 중앙값"),
  ];
  for (let i = 0; i < BLOCK_CLASSES.length; i++) {
    const item = BLOCK_CLASSES[i];
    metrics.push(
      blocks.length === 0
        ? missing(`share_count_${item.suffix}`, `${item.label} (블록 수)`, "%", "d15-share-count@1:원래 블록 면적 구간별 블록 수÷반경과 교차하는 폐합 블록 수")
        : obs(`share_count_${item.suffix}`, `${item.label} (블록 수)`, pct(counts[i], blocks.length), "%", "d15-share-count@1:원래 블록 면적 구간별 블록 수÷반경과 교차하는 폐합 블록 수", counts[i], blocks.length),
    );
    metrics.push(obs(`share_area_${item.suffix}`, `${item.label} (면적)`, pct(crossAreas[i], circleAreaM2), "%", "d15-share-area@1:원래 블록 면적 구간별 반경 교차 면적÷π·r²", Math.round(crossAreas[i]), circleAreaRounded));
  }
  metrics.push(obs("share_open_pct", "미폐합·읽기 경계 잔여 면적", pct(openAreaM2, circleAreaM2), "%", "d15-share-open@1:폐합 블록으로 덮이지 않은 반경 면적÷π·r²", Math.round(openAreaM2), circleAreaRounded));

  const coverage = ctx.coverage("reference", ROAD_SOURCES);
  const limitations: Limitation[] = [
    { kind: "partial", note: ctx.topo ? "수치지형도 중심선과 범위 밖 OSM 중심선 기준 폐합 — 도로 폭·사유 통로 미반영, 보행로 제외" : "OSM 중심선 기준 폐합 — 도로 폭·사유 통로 미반영, 보행로 제외" },
    { kind: "unknown", note: "폐합 블록 면적은 EPSG:5179 평면 도형 계산값이며 실제 대지·도로 폭·필지 경계를 뜻하지 않습니다." },
    { kind: "unknown", note: "© OpenStreetMap contributors · ODbL 1.0" },
    ...(closed.polygonizeFailed ? [{ kind: "partial" as const, note: "도로망 폐합 계산이 일부 실패해 폐합 블록을 산출하지 못했습니다. 지도·지표는 도로망의 나머지 부분만 반영할 수 있습니다." }] : []),
    ...(failed > 0 ? [{ kind: "partial" as const, note: `도형 오류로 반경 교차 면적을 계산하지 못한 ${failed}개 블록은 면적 구성에서 제외했습니다.` }] : []),
    ...coverage,
  ];
  const closedPct = pct(closedAreaM2, circleAreaM2);
  const openPct = pct(openAreaM2, circleAreaM2);
  const measuredSummary = `반경 ${ctx.input.radiusM.toLocaleString("en-US")}m 안 폐합 블록 ${blocks.length}개, 폐합 블록 면적 채움률 ${percentText(closedPct)}, 미폐합·읽기 경계 잔여 면적 ${percentText(openPct)}, 원래 면적 중앙값 ${areaHaText(median(originalAreasHa))}`;
  const sentence = blocks.length === 0
    ? `${measuredSummary} → 폐합 블록이 없어 도로망 공백과 미폐합 면을 구분할 수 없음 → 최신 OSM 도로망과 현장·공식 도면 확인 필요`
    : `${measuredSummary} → 도로 중심선으로 만든 가구 분포와 폐합 면적을 표시 → 도로 연결·사유 통로·실제 필지 경계는 최신 OSM과 공식 도면 확인 필요`;

  return makeTile(ctx, {
    code: "D15",
    type: "diagram",
    // OSM 중심선으로 폐합을 추정하는 타일은 자료가 있어도 항상 부분 결과다.
    status: "partial",
    metrics,
    judgment: { ruleId: "D15-block@1", basisMetricIds: ["blocks", "fill_closed_pct"], sentence, level: null, criteria: null },
    sources,
    layers: [...BLOCK_LAYERS],
    polygons: [
      ...blocks.flatMap((block) => {
        const classIndex = BLOCK_CLASSES.findIndex((item) => item.matches(block.areaM2 / 10000));
        const layer = classIndex >= 0 ? BLOCK_CLASSES[classIndex].layer : "block_open";
        return block.clipped.flatMap((rings) => {
          const candidate = polygonCandidate(block.id, layer, rings, polygonArea(rings), null, {
            name: null,
            sublabel: mapAreaHaText(block.areaM2),
            labelPriority: 0,
          });
          return candidate ? [candidate] : [];
        });
      }),
      ...openCandidates(ctx, bounds, blocks),
    ],
    limitations,
  });
}
