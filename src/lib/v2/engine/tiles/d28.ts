/** D28 도보권 — OSM 보행망에서 5·10·15분 도달 면을 만든다. */
import type { XY } from "../../crs";
import type { TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { est, fmt, lineCandidate, makeTile, obs, polygonCandidate, type LineCandidate, type PolygonCandidate, type TileDraft } from "./common";
import { notProvided } from "./not-provided";
import {
  isochroneGrid,
  WALK_SPEED_M_PER_MIN,
  walkField,
  walkSources,
  type WalkField,
} from "./walk-shared";
import type { LocalGrid } from "./raster-grid";

const WALK_MINUTES = [5, 10, 15] as const;
const WALK_LAYERS = ["walk_5", "walk_10", "walk_15"] as const;
const ISOCHRONE_CELL_M = 5;
const ISOCHRONE_BUFFER_M = 30;

/** 15분 격자는 1,200m까지 필요하지만 도판은 분석 반경 안만 그린다. */
function gridForPresentation(grid: ReturnType<typeof isochroneGrid>, radiusM: number): ReturnType<typeof isochroneGrid> {
  const minCol = Math.max(0, Math.floor((grid.cx - radiusM - grid.x0) / grid.cellM) - 1);
  const maxCol = Math.min(grid.cols - 1, Math.ceil((grid.cx + radiusM - grid.x0) / grid.cellM) + 1);
  const minRow = Math.max(0, Math.floor((grid.cy - radiusM - grid.y0) / grid.cellM) - 1);
  const maxRow = Math.min(grid.rows - 1, Math.ceil((grid.cy + radiusM - grid.y0) / grid.cellM) + 1);
  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const values = new Float64Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const sourceStart = (minRow + row) * grid.cols + minCol;
    values.set(grid.values.subarray(sourceStart, sourceStart + cols), row * cols);
  }
  return {
    ...grid,
    x0: grid.x0 + minCol * grid.cellM,
    y0: grid.y0 + minRow * grid.cellM,
    cols,
    rows,
    values,
  };
}

type GridPoint = [number, number];
type GridEdge = { start: GridPoint; end: GridPoint; a: XY; b: XY };
type BandGeometry = { rings: number[][][]; areaM2: number };

function gridKey(point: GridPoint): string {
  return `${point[0]},${point[1]}`;
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
    const intersects = (y > point[1]) !== (py > point[1]) && point[0] < ((px - x) * (point[1] - y)) / (py - y) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function ringArea(ring: readonly number[][]): number {
  return Math.abs(signedArea(ring));
}

function circleRadius(radiusM: number): number {
  const sides = 96;
  return radiusM * Math.sqrt((2 * Math.PI) / (sides * Math.sin((2 * Math.PI) / sides)));
}

function clipConvex(subject: number[][], clip: readonly number[][]): number[][] {
  let output = subject;
  for (let index = 1; index < clip.length && output.length >= 3; index++) {
    const a = clip[index - 1];
    const b = clip[index];
    const input = output;
    output = [];
    const inside = (point: readonly number[]) => (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]) >= -1e-7;
    const intersection = (from: readonly number[], to: readonly number[]): number[] => {
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) <= 1e-12) return [from[0], from[1]];
      const t = ((a[0] - from[0]) * ey - (a[1] - from[1]) * ex) / denominator;
      return [from[0] + dx * t, from[1] + dy * t];
    };
    let from = input.at(-1)!;
    for (const to of input) {
      const fromInside = inside(from);
      const toInside = inside(to);
      if (toInside) {
        if (!fromInside) output.push(intersection(from, to));
        output.push(to);
      } else if (fromInside) {
        output.push(intersection(from, to));
      }
      from = to;
    }
  }
  return output;
}

function circlePolygon(cx: number, cy: number, radiusM: number): number[][] {
  const radius = circleRadius(radiusM);
  const sides = 96;
  return Array.from({ length: sides + 1 }, (_, index) => {
    const angle = (2 * Math.PI * (index % sides)) / sides;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

function fullBandLoops(grid: LocalGrid, fullClass: Int8Array, classIndex: number): number[][][] {
  const edges: GridEdge[] = [];
  const outgoing = new Map<string, number[]>();
  const addEdge = (start: GridPoint, end: GridPoint, a: XY, b: XY) => {
    const edgeIndex = edges.length;
    edges.push({ start, end, a, b });
    const list = outgoing.get(gridKey(start)) ?? [];
    list.push(edgeIndex);
    outgoing.set(gridKey(start), list);
  };
  const pointAt = (col: number, row: number): XY => [grid.x0 + col * grid.cellM - grid.cellM / 2, grid.y0 + row * grid.cellM - grid.cellM / 2];
  const indexAt = (col: number, row: number) => row * grid.cols + col;
  const same = (col: number, row: number) => col >= 0 && col < grid.cols && row >= 0 && row < grid.rows && fullClass[indexAt(col, row)] === classIndex;

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (fullClass[indexAt(col, row)] !== classIndex) continue;
      const x0 = col;
      const y0 = row;
      const x1 = col + 1;
      const y1 = row + 1;
      const bottomLeft = pointAt(col, row);
      const bottomRight = pointAt(col + 1, row);
      const topRight = pointAt(col + 1, row + 1);
      const topLeft = pointAt(col, row + 1);
      if (!same(col, row - 1)) addEdge([x0, y0], [x1, y0], bottomLeft, bottomRight);
      if (!same(col + 1, row)) addEdge([x1, y0], [x1, y1], bottomRight, topRight);
      if (!same(col, row + 1)) addEdge([x1, y1], [x0, y1], topRight, topLeft);
      if (!same(col - 1, row)) addEdge([x0, y1], [x0, y0], topLeft, bottomLeft);
    }
  }

  const used = new Uint8Array(edges.length);
  const loops: number[][][] = [];
  for (let startIndex = 0; startIndex < edges.length; startIndex++) {
    if (used[startIndex]) continue;
    const startEdge = edges[startIndex];
    const startKey = gridKey(startEdge.start);
    const ring: number[][] = [[...startEdge.a]];
    let edgeIndex = startIndex;
    let closed = false;
    for (let guard = 0; guard <= edges.length; guard++) {
      if (used[edgeIndex]) break;
      const edge = edges[edgeIndex];
      used[edgeIndex] = 1;
      ring.push([...edge.b]);
      if (gridKey(edge.end) === startKey) {
        closed = true;
        break;
      }
      const candidates = (outgoing.get(gridKey(edge.end)) ?? []).filter((candidate) => !used[candidate]);
      if (candidates.length === 0) break;
      const dx = edge.b[0] - edge.a[0];
      const dy = edge.b[1] - edge.a[1];
      const next = candidates
        .map((candidate) => {
          const nextEdge = edges[candidate];
          const nx = nextEdge.b[0] - nextEdge.a[0];
          const ny = nextEdge.b[1] - nextEdge.a[1];
          const turn = (Math.atan2(dx * ny - dy * nx, dx * nx + dy * ny) + 2 * Math.PI) % (2 * Math.PI);
          return { candidate, turn };
        })
        .sort((a, b) => a.turn - b.turn || a.candidate - b.candidate)[0];
      edgeIndex = next.candidate;
    }
    if (closed && ring.length >= 4 && ringArea(ring) > 1e-6) loops.push(ring);
  }
  return loops;
}

function bandGeometry(grid: LocalGrid, radiusM: number): { bands: BandGeometry[][]; areaM2: number[] } {
  const [cx, cy] = [grid.cx, grid.cy];
  const radiusSquared = radiusM * radiusM;
  const half = grid.cellM / 2;
  const circle = circlePolygon(cx, cy, radiusM);
  const fullClass = new Int8Array(grid.cols * grid.rows);
  fullClass.fill(-1);
  const boundary: Array<{ classIndex: number; ring: number[][]; areaM2: number }> = [];
  const areaM2 = [0, 0, 0];
  const classOf = (value: number): number => value < 5.5 ? 0 : value < 10.5 ? 1 : 2;
  const indexAt = (col: number, row: number) => row * grid.cols + col;

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const value = grid.values[indexAt(col, row)];
      if (!Number.isFinite(value)) continue;
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      const nearestX = Math.max(x - half, Math.min(cx, x + half));
      const nearestY = Math.max(y - half, Math.min(cy, y + half));
      if ((nearestX - cx) ** 2 + (nearestY - cy) ** 2 > radiusSquared + 1e-6) continue;
      const classIndex = classOf(value);
      const corners = [[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half]];
      const entirelyInside = corners.every(([cornerX, cornerY]) => (cornerX - cx) ** 2 + (cornerY - cy) ** 2 <= radiusSquared + 1e-6);
      if (entirelyInside) {
        fullClass[indexAt(col, row)] = classIndex;
        areaM2[classIndex] += grid.cellM * grid.cellM;
        continue;
      }
      const clipped = clipConvex([...corners, corners[0]], circle);
      if (clipped.length < 3) continue;
      const clippedRing = [...clipped, clipped[0]];
      const clippedArea = ringArea(clippedRing);
      if (clippedArea <= 1e-6) continue;
      boundary.push({ classIndex, ring: clippedRing, areaM2: clippedArea });
      areaM2[classIndex] += clippedArea;
    }
  }

  const bands: BandGeometry[][] = [[], [], []];
  for (let classIndex = 0; classIndex < 3; classIndex++) {
    const loops = fullBandLoops(grid, fullClass, classIndex);
    const outers = loops.filter((ring) => signedArea(ring) > 0);
    const holes = loops.filter((ring) => signedArea(ring) < 0);
    for (const outer of outers) {
      const inner = holes.filter((hole) => pointInRing(hole[0], outer));
      const area = Math.max(0, ringArea(outer) - inner.reduce((sum, hole) => sum + ringArea(hole), 0));
      if (area > 1e-6) bands[classIndex].push({ rings: [outer, ...inner], areaM2: area });
    }
    for (const ring of loops) {
      if (signedArea(ring) >= 0 || outers.some((outer) => pointInRing(ring[0], outer))) continue;
      bands[classIndex].push({ rings: [ring], areaM2: ringArea(ring) });
    }
    for (const item of boundary) {
      if (item.classIndex === classIndex) bands[classIndex].push({ rings: [item.ring], areaM2: item.areaM2 });
    }
  }

  return { bands, areaM2 };
}

function walkBandPolygons(grid: LocalGrid, radiusM: number): { polygons: PolygonCandidate[]; areaM2: number[] } {
  const geometry = bandGeometry(grid, radiusM);
  const polygons: PolygonCandidate[] = [];
  let id = 1;
  for (let classIndex = 0; classIndex < geometry.bands.length; classIndex++) {
    for (const band of geometry.bands[classIndex]) {
      const polygon = polygonCandidate(id++, WALK_LAYERS[classIndex], band.rings, band.areaM2);
      if (polygon) polygons.push(polygon);
    }
  }
  return { polygons, areaM2: geometry.areaM2 };
}

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
  const lines: LineCandidate[] = [];
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
      const candidate = lineCandidate(id++, "walk_net", [clipped[0], clipped[1]], segmentLengthM);
      if (candidate) lines.push(candidate);
    }
  }
  return lines;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const areaKm2 = (areaM2: number) => round3(areaM2 / 1_000_000);

export function d28(ctx: EngineContext): TileResult {
  const sources = walkSources(ctx);
  if (sources.length === 0) return notProvided(ctx, "D28", "OSM 보행망 자료가 적재되지 않았습니다.");

  const field = walkField(ctx);
  if (!field) return notProvided(ctx, "D28", "OSM 보행망이 없거나 대지 중심을 보행망에 스냅할 수 없습니다.");

  const grid = isochroneGrid(field, ctx.input.center, WALK_MINUTES, { cellM: ISOCHRONE_CELL_M, bufferM: ISOCHRONE_BUFFER_M });
  const bands = walkBandPolygons(gridForPresentation(grid, ctx.input.radiusM), ctx.input.radiusM);
  const bandAreasM2 = WALK_LAYERS.map((_, index) => bands.areaM2[index] ?? 0);
  const cumulativeAreasM2 = bandAreasM2.map((_, index) => bandAreasM2.slice(0, index + 1).reduce((sum, area) => sum + area, 0));
  const circleM2 = Math.PI * ctx.input.radiusM ** 2;
  const reachRatio10 = round1((cumulativeAreasM2[1] / circleM2) * 100);
  const coverage = ctx.coverage("reference", ["osm_roads"]);
  const status: TileResult["status"] = coverage.some((limitation) => limitation.kind === "partial" || limitation.kind === "incomplete")
    ? "partial"
    : "complete";
  const sentence = `보행망 도보 10분(800 m) 도달 면적 ${areaKm2(cumulativeAreasM2[1])}㎢(직선 반경 ${fmt(ctx.input.radiusM)} m 원의 ${reachRatio10}%) → OSM 보행망·80 m/분 기준이며 횡단보도 대기·경사 미반영 → 현장 동선으로 확인할 것`;
  const limitations: TileDraft["limitations"] = [
    { kind: "unknown", note: "OSM 보행망의 완전성은 측정하지 않았습니다." },
    { kind: "estimated", note: "보행 시간은 80 m/분 내부 제안 기준이며 횡단보도 대기시간을 반영하지 않았습니다." },
    { kind: "unknown", note: "지형 경사는 반영하지 않았습니다." },
    ...coverage,
  ];

  return makeTile(ctx, {
    code: "D28",
    type: "diagram",
    status,
    metrics: [
      est("area_5min_km2", "도보 5분 도달 면적", areaKm2(cumulativeAreasM2[0]), "km²", "d28-area@1:5분 누적 도달 면적(보행망·5m 격자)", cumulativeAreasM2[0], 1_000_000),
      est("area_10min_km2", "도보 10분 도달 면적", areaKm2(cumulativeAreasM2[1]), "km²", "d28-area@1:10분 누적 도달 면적(보행망·5m 격자)", cumulativeAreasM2[1], 1_000_000),
      est("area_15min_km2", "도보 15분 도달 면적", areaKm2(cumulativeAreasM2[2]), "km²", "d28-area@1:15분 누적 도달 면적(보행망·5m 격자)", cumulativeAreasM2[2], 1_000_000),
      est("reach_ratio_10min_pct", "10분 도달 면적 / 직선 반경 원 면적", reachRatio10, "%", "d28-reach-ratio@1:10분 누적 도달 면적÷π·반경²", cumulativeAreasM2[1], circleM2),
      obs("network_nodes", "보행망 정점 수", field.nodes, "개", "d28-network-nodes@1:0.1m 정점 병합·보행 제외 도로 제거 후 그래프 정점 수"),
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
    lines: walkLineCandidates(field, grid.cx, grid.cy, ctx.input.radiusM),
    limitations,
  });
}
