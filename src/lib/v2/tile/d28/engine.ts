/** D28 도보권 — OSM 보행망에서 5·10·15분 도달 면을 만든다. */
import { difference, featureCollection } from "@turf/turf";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { toUtmk, type LngLat, type XY } from "../../crs";
import { MAX_MAP_LINES, type TileResult } from "../../tile-result";
import type { EngineContext } from "../../engine/context";
import { est, fmt, lineCandidate, makeTile, obs, polygonCandidate, type LineCandidate, type PolygonCandidate, type TileDraft } from "../../engine/tiles/common";
import { areaInCircle, polygonArea, polygonParts } from "../../engine/tiles/geo";
import { notProvided } from "../../engine/tiles/not-provided";
import { isochroneGrid, WALK_SPEED_M_PER_MIN, walkField, walkSources, type WalkField } from "../../engine/tiles/walk-shared";
import type { LocalGrid } from "../../engine/tiles/raster-grid";

const WALK_MINUTES = [5, 10, 15] as const;
const WALK_LAYERS = ["walk_5", "walk_10", "walk_15"] as const;
const WALK_SHARE_ITEMS = [
  { id: "share_walk_5", label: "도보 5분", layer: "walk_5" },
  { id: "share_walk_10", label: "도보 10분", layer: "walk_10" },
  { id: "share_walk_15", label: "도보 15분", layer: "walk_15" },
] as const;
const ISOCHRONE_CELL_M = 5;
const ISOCHRONE_BUFFER_M = 30;

interface ReachableInterval {
  startT: number;
  endT: number;
}

function reachableIntervals(da: number, db: number, lengthM: number, maxM: number): ReachableInterval[] {
  if (!Number.isFinite(lengthM) || lengthM <= 0) return [];
  const intervals: ReachableInterval[] = [];
  if (Number.isFinite(da) && da <= maxM) intervals.push({ startT: 0, endT: Math.min(1, (maxM - da) / lengthM) });
  if (Number.isFinite(db) && db <= maxM) intervals.push({ startT: Math.max(0, 1 - (maxM - db) / lengthM), endT: 1 });
  intervals.sort((a, b) => a.startT - b.startT || a.endT - b.endT);
  const merged: ReachableInterval[] = [];
  for (const interval of intervals) {
    if (interval.endT < interval.startT - 1e-9) continue;
    const previous = merged.at(-1);
    if (previous && interval.startT <= previous.endT + 1e-9) previous.endT = Math.max(previous.endT, interval.endT);
    else merged.push({ ...interval });
  }
  return merged;
}

function pointOn(a: XY, b: XY, t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clipSegmentToCircle(a: XY, b: XY, cx: number, cy: number, radiusM: number): [[number, number], [number, number]] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const aa = dx * dx + dy * dy;
  if (aa <= 1e-12) return Math.hypot(a[0] - cx, a[1] - cy) <= radiusM ? [[a[0], a[1]], [b[0], b[1]]] : null;
  const fx = a[0] - cx;
  const fy = a[1] - cy;
  const bb = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - radiusM * radiusM;
  const discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < 0) return cc <= 0 ? [[a[0], a[1]], [b[0], b[1]]] : null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const start = Math.max(0, (-bb - root) / (2 * aa));
  const end = Math.min(1, (-bb + root) / (2 * aa));
  if (end - start <= 1e-9) return null;
  return [pointOn(a, b, start), pointOn(a, b, end)];
}

/** 15분 안에 실제로 걸을 수 있는 간선 부분만 지도에 그린다. */
function walkLineCandidates(field: WalkField, cx: number, cy: number, radiusM: number): LineCandidate[] {
  const maxM = WALK_MINUTES.at(-1)! * WALK_SPEED_M_PER_MIN;
  const raw: Array<{ id: number; path: [[number, number], [number, number]]; lengthM: number }> = [];
  let id = 1;
  for (const edge of field.reachable(maxM)) {
    const lengthM = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]);
    for (const interval of reachableIntervals(edge.da, edge.db, lengthM, maxM)) {
      const a = pointOn(edge.a, edge.b, interval.startT);
      const b = pointOn(edge.a, edge.b, interval.endT);
      const clipped = clipSegmentToCircle(a, b, cx, cy, radiusM);
      if (!clipped) continue;
      const segmentLengthM = Math.hypot(clipped[1][0] - clipped[0][0], clipped[1][1] - clipped[0][1]);
      if (segmentLengthM <= 1e-6) continue;
      raw.push({ id: id++, path: clipped, lengthM: segmentLengthM });
    }
  }
  return raw
    .sort((a, b) => b.lengthM - a.lengthM || a.id - b.id)
    .slice(0, MAX_MAP_LINES)
    .map((item) => lineCandidate(item.id, "walk_net", [item.path[0], item.path[1]], item.lengthM, null, {
      name: null,
      sublabel: null,
      labelPriority: 0,
    }))
    .filter((item): item is LineCandidate => item !== null);
}

type EdgeIndex = 0 | 1 | 2 | 3;
type MarchingSegment = { aKey: string; bKey: string; a: [number, number]; b: [number, number] };

/** 이진 marching-squares case의 네 변: 0=아래, 1=오른쪽, 2=위, 3=왼쪽. */
const MARCHING_CASES = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [[3, 2], [0, 1]], [[0, 2]], [[3, 2]],
  [[2, 3]], [[0, 2]], [[0, 3], [1, 2]], [[1, 2]], [[1, 3]], [[0, 1]], [[3, 0]], [],
] as const satisfies readonly (readonly (readonly [EdgeIndex, EdgeIndex])[])[];

function edgePoint(grid: LocalGrid, col: number, row: number, edge: EdgeIndex): { key: string; point: [number, number] } {
  switch (edge) {
    case 0: return { key: `h:${col}:${row}`, point: [grid.x0 + (col + 0.5) * grid.cellM, grid.y0 + row * grid.cellM] };
    case 1: return { key: `v:${col + 1}:${row}`, point: [grid.x0 + (col + 1) * grid.cellM, grid.y0 + (row + 0.5) * grid.cellM] };
    case 2: return { key: `h:${col}:${row + 1}`, point: [grid.x0 + (col + 0.5) * grid.cellM, grid.y0 + (row + 1) * grid.cellM] };
    case 3: return { key: `v:${col}:${row}`, point: [grid.x0 + col * grid.cellM, grid.y0 + (row + 0.5) * grid.cellM] };
  }
}

function marchingLoops(grid: LocalGrid, minutes: number): number[][][] {
  const segments: MarchingSegment[] = [];
  const inside = (col: number, row: number): boolean => {
    if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return false;
    const value = grid.values[row * grid.cols + col];
    return Number.isFinite(value) && value <= minutes;
  };
  // One virtual outside row/column closes contours that reach the finite grid
  // boundary; the analysis-radius clip below removes that artificial edge.
  for (let row = -1; row < grid.rows; row++) {
    for (let col = -1; col < grid.cols; col++) {
      const mask = (inside(col, row) ? 1 : 0) | (inside(col + 1, row) ? 2 : 0) | (inside(col + 1, row + 1) ? 4 : 0) | (inside(col, row + 1) ? 8 : 0);
      for (const [fromEdge, toEdge] of MARCHING_CASES[mask]) {
        const from = edgePoint(grid, col, row, fromEdge);
        const to = edgePoint(grid, col, row, toEdge);
        segments.push({ aKey: from.key, bKey: to.key, a: from.point, b: to.point });
      }
    }
  }

  const byPoint = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    byPoint.set(segment.aKey, [...(byPoint.get(segment.aKey) ?? []), index]);
    byPoint.set(segment.bKey, [...(byPoint.get(segment.bKey) ?? []), index]);
  });
  const used = new Uint8Array(segments.length);
  const loops: number[][][] = [];
  for (let startIndex = 0; startIndex < segments.length; startIndex++) {
    if (used[startIndex]) continue;
    const start = segments[startIndex];
    const startKey = start.aKey;
    const ring: number[][] = [start.a];
    let segmentIndex = startIndex;
    let currentKey = startKey;
    let closed = false;
    for (let guard = 0; guard <= segments.length; guard++) {
      if (used[segmentIndex]) break;
      const segment = segments[segmentIndex];
      used[segmentIndex] = 1;
      const nextKey = segment.aKey === currentKey ? segment.bKey : segment.aKey;
      const nextPoint = segment.aKey === currentKey ? segment.b : segment.a;
      ring.push(nextPoint);
      if (nextKey === startKey) {
        closed = true;
        break;
      }
      const next = (byPoint.get(nextKey) ?? []).find((candidate) => !used[candidate]);
      if (next === undefined) break;
      currentKey = nextKey;
      segmentIndex = next;
    }
    if (closed && ring.length >= 4) loops.push(ring);
  }
  return loops;
}

function signedArea(ring: readonly number[][]): number {
  let area = 0;
  for (let index = 1; index < ring.length; index++) area += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  return area / 2;
}

function pointInRing(point: readonly number[], ring: readonly number[][]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x, y] = ring[index];
    const [px, py] = ring[previous];
    if ((y > point[1]) !== (py > point[1]) && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x) inside = !inside;
  }
  return inside;
}

/** Chaikin 두 번으로 5m 셀의 꺾임을 둥글게 만든다. 원본 raster는 면적 계산에만 쓰지 않는다. */
function smoothRing(ring: number[][]): number[][] {
  let open = ring.slice(0, -1);
  for (let pass = 0; pass < 2 && open.length >= 3; pass++) {
    const next: number[][] = [];
    for (let index = 0; index < open.length; index++) {
      const a = open[index];
      const b = open[(index + 1) % open.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    open = next;
  }
  return [...open, open[0]];
}

function capRing(ring: number[][], maxVertices = 192): number[][] {
  if (ring.length <= maxVertices) return ring;
  const unique = ring.length - 1;
  const sampled = Array.from({ length: maxVertices - 1 }, (_, index) => ring[Math.floor((index * unique) / (maxVertices - 1))]);
  return [...sampled, sampled[0]];
}

function contourGeometry(grid: LocalGrid, minutes: number): Geometry | null {
  const rings = marchingLoops(grid, minutes).map((ring) => capRing(smoothRing(ring))).filter((ring) => Math.abs(signedArea(ring)) > 1e-6);
  if (rings.length === 0) return null;
  const depths = rings.map((ring, index) => rings.reduce((depth, other, otherIndex) => {
    if (index === otherIndex || Math.abs(signedArea(other)) <= Math.abs(signedArea(ring))) return depth;
    return pointInRing(ring[0], other) ? depth + 1 : depth;
  }, 0));
  const polygons: number[][][][] = [];
  for (let index = 0; index < rings.length; index++) {
    if (depths[index] % 2 !== 0) continue;
    const holes = rings.filter((ring, holeIndex) => depths[holeIndex] === depths[index] + 1 && pointInRing(ring[0], rings[index]));
    polygons.push([rings[index], ...holes]);
  }
  if (polygons.length === 0) return null;
  return polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons };
}

function subtract(outer: Geometry | null, inner: Geometry | null): Geometry | null {
  if (!outer) return null;
  if (!inner) return outer;
  try {
    const result = difference(featureCollection<Polygon | MultiPolygon>([
      { type: "Feature", properties: {}, geometry: outer as Polygon | MultiPolygon },
      { type: "Feature", properties: {}, geometry: inner as Polygon | MultiPolygon },
    ]));
    return result?.geometry ?? outer;
  } catch {
    return outer;
  }
}

function geometryFromParts(parts: number[][][][]): Geometry | null {
  if (parts.length === 0) return null;
  return parts.length === 1 ? { type: "Polygon", coordinates: parts[0] } : { type: "MultiPolygon", coordinates: parts };
}

/**
 * 5m raster의 경계를 marching squares로 따고 Chaikin smoothing을 적용한다.
 * 도달 간선의 마지막 부분은 T7 isochroneGrid가 reachableIntervals로 잘라
 * seed한 값이므로, 셀 계단 대신 보간된 벡터 경계로 표시된다.
 */
function walkBandPolygons(field: WalkField, center: LngLat, radiusM: number): { polygons: PolygonCandidate[]; cumulativeAreaM2: number[] } {
  const grid = isochroneGrid(field, center, WALK_MINUTES, { cellM: ISOCHRONE_CELL_M, bufferM: ISOCHRONE_BUFFER_M });
  const cumulative = WALK_MINUTES.map((minutes) => contourGeometry(grid, minutes));
  const clippedCumulative = cumulative.map((geometry) => {
    if (!geometry) return { geometry: null, areaM2: 0 };
    const clipped = areaInCircle(center, radiusM, geometry);
    return clipped ? { geometry: geometryFromParts(clipped.parts), areaM2: clipped.areaM2 } : { geometry: null, areaM2: 0 };
  });
  const bands = [clippedCumulative[0].geometry, subtract(clippedCumulative[1].geometry, clippedCumulative[0].geometry), subtract(clippedCumulative[2].geometry, clippedCumulative[1].geometry)];
  const cumulativeAreaM2 = clippedCumulative.map((item) => item.areaM2);
  const polygons: PolygonCandidate[] = [];
  let id = 1;
  for (let index = 0; index < bands.length; index++) {
    const geometry = bands[index];
    if (!geometry) continue;
    for (const rings of polygonParts(geometry)) {
      const candidate = polygonCandidate(id++, WALK_LAYERS[index], rings, Math.max(0, polygonArea(rings)), null, {
        name: null,
        sublabel: null,
        labelPriority: 0,
      });
      if (candidate) polygons.push(candidate);
    }
  }
  return { polygons, cumulativeAreaM2 };
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const areaKm2 = (areaM2: number) => round3(areaM2 / 1_000_000);
const areaDisplay = (areaM2: number) => `${(areaM2 / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km²`;

export function d28(ctx: EngineContext): TileResult {
  const sources = walkSources(ctx);
  if (sources.length === 0) return notProvided(ctx, "D28", "OSM 보행망 자료를 확인하지 못했습니다.");

  const field = walkField(ctx);
  if (!field) return notProvided(ctx, "D28", "OSM 보행망이 없거나 대지 중심을 보행망에 스냅할 수 없습니다.");

  const bands = walkBandPolygons(field, ctx.input.center, ctx.input.radiusM);
  const [centerX, centerY] = toUtmk(ctx.input.center);
  const lines = walkLineCandidates(field, centerX, centerY, ctx.input.radiusM);
  const cumulativeAreasM2 = bands.cumulativeAreaM2;
  const circleM2 = Math.PI * ctx.input.radiusM ** 2;
  const bandAreasM2 = [
    cumulativeAreasM2[0] ?? 0,
    Math.max(0, (cumulativeAreasM2[1] ?? 0) - (cumulativeAreasM2[0] ?? 0)),
    Math.max(0, (cumulativeAreasM2[2] ?? 0) - (cumulativeAreasM2[1] ?? 0)),
  ];
  const shareMetrics = WALK_SHARE_ITEMS.map((item, index) => est(
    item.id,
    `구성비: ${item.label}`,
    round1(((bandAreasM2[index] ?? 0) / circleM2) * 100),
    "%",
    "d28-share-band@1:해당 보행시간 구간의 반경 교차면적÷π·r²",
    Math.round(bandAreasM2[index] ?? 0),
    Math.round(circleM2),
  ));
  const reachRatio10 = round1((cumulativeAreasM2[1] / circleM2) * 100);
  const coverage = ctx.coverage("reference", ["osm_roads"]);
  const status: TileResult["status"] = coverage.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete")
    ? "partial"
    : "complete";
  const sentence = `보행망 도보 10분(800 m) 도달 면적 ${areaDisplay(cumulativeAreasM2[1])}(직선 반경 ${fmt(ctx.input.radiusM)} m 원의 ${reachRatio10}%) → OSM 보행망·80 m/분 기준이며 횡단보도 대기·경사 미반영 → 현장 동선으로 확인할 것`;
  const limitations: TileDraft["limitations"] = [
    { kind: "unknown", note: "OSM 보행망의 완전성은 측정하지 않았습니다." },
    { kind: "estimated", note: "보행 시간은 80 m/분 내부 제안 기준이며 횡단보도 대기시간을 반영하지 않았습니다." },
    { kind: "unknown", note: "도보 5·10·15분 면 구성비는 서로 겹치지 않는 차분 구간의 면적 기준입니다. 접근 불가 면적과 보행망 선은 구성비 합에서 제외합니다." },
    { kind: "unknown", note: "지형 경사는 반영하지 않았습니다." },
    ...coverage,
  ];

  return makeTile(ctx, {
    code: "D28",
    type: "diagram",
    status,
    metrics: [
      est("area_5min_km2", "도보 5분 도달 면적", areaKm2(cumulativeAreasM2[0]), "km²", "d28-area@2:5분 누적 도달 면적(보행망·5m marching squares+smoothing)", cumulativeAreasM2[0], 1_000_000),
      est("area_10min_km2", "도보 10분 도달 면적", areaKm2(cumulativeAreasM2[1]), "km²", "d28-area@2:10분 누적 도달 면적(보행망·5m marching squares+smoothing)", cumulativeAreasM2[1], 1_000_000),
      est("area_15min_km2", "도보 15분 도달 면적", areaKm2(cumulativeAreasM2[2]), "km²", "d28-area@2:15분 누적 도달 면적(보행망·5m marching squares+smoothing)", cumulativeAreasM2[2], 1_000_000),
      est("reach_ratio_10min_pct", "10분 도달 면적 / 직선 반경 원 면적", reachRatio10, "%", "d28-reach-ratio@1:10분 누적 도달 면적÷π·반경²", cumulativeAreasM2[1], circleM2),
      obs("network_nodes", "보행망 정점 수", field.nodes, "개", "d28-network-nodes@1:0.1m 정점 병합·보행 제외 도로 제거 후 그래프 정점 수"),
      ...shareMetrics,
    ],
    judgment: {
      ruleId: "D28-walk-isochrone@1",
      basisMetricIds: ["area_10min_km2", "reach_ratio_10min_pct"],
      sentence,
      level: null,
      criteria: null,
    },
    sources,
    layers: [...WALK_LAYERS, "walk_net"],
    polygons: bands.polygons,
    lines,
    limitations,
  });
}
