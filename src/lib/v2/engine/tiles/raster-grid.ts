/** 로컬 미터 격자를 만들고 등치면·등고선을 지도 후보로 변환한다. */
import { difference, featureCollection, intersect, isobands, isolines, point, polygon } from "@turf/turf";
import type { Feature, FeatureCollection, MultiPolygon, Point, Polygon } from "geojson";
import { toLngLat, toUtmk, type LngLat } from "../../crs";
import { areaInCircle, polygonArea } from "./geo";
import { polygonCandidate, type PolygonCandidate } from "./common";
import { maxOf, minOf } from "../../extent";

export interface LocalGrid {
  /** 중심점의 EPSG:5179 x 좌표 */
  cx: number;
  /** 중심점의 EPSG:5179 y 좌표 */
  cy: number;
  cellM: number;
  cols: number;
  rows: number;
  /** EPSG:5179 격자 원점 x 좌표 */
  x0: number;
  /** EPSG:5179 격자 원점 y 좌표 */
  y0: number;
  /** row-major, row 0 = 남쪽(y0), NaN = 결측 */
  values: Float64Array;
}

/** Task 2의 common.ts 선 후보와 구조적으로 같은 로컬 타입이다. */
export type LineCandidate = {
  id: number;
  lengthM: number;
  l: { layer: string; points: [number, number][]; label?: string | null };
};

const NODATA_OFFSET = 2_000_000;
const NODATA_LOW_OFFSET = 3_000_000;
const EPSILON = 1e-9;

function assertGrid(g: LocalGrid): void {
  if (!Number.isFinite(g.cx) || !Number.isFinite(g.cy) || !Number.isFinite(g.cellM) || g.cellM <= 0) {
    throw new RangeError("invalid local grid geometry");
  }
  if (!Number.isInteger(g.cols) || !Number.isInteger(g.rows) || g.cols < 2 || g.rows < 2 || g.values.length !== g.cols * g.rows) {
    throw new RangeError("invalid local grid shape");
  }
}

function assertCenterAndRadius(center: LngLat, radiusM: number): void {
  if (center.length !== 2 || !center.every(Number.isFinite)) throw new RangeError("invalid grid center");
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid grid radius");
}

function gridPoint(g: LocalGrid, col: number, row: number): [number, number] {
  return [g.x0 + col * g.cellM, g.y0 + row * g.cellM];
}

function insideRadius(g: LocalGrid, col: number, row: number, radiusM: number): boolean {
  const [x, y] = gridPoint(g, col, row);
  return Math.hypot(x - g.cx, y - g.cy) <= radiusM + EPSILON;
}

function finiteValues(g: LocalGrid, radiusM: number | null = null): number[] {
  const values: number[] = [];
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      if (radiusM !== null && !insideRadius(g, col, row, radiusM)) continue;
      const value = g.values[row * g.cols + col];
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values;
}

/** 반경 사각형(±(radiusM+cellM))을 cellM 간격으로 표본화한다. */
export function localGrid(
  center: LngLat,
  radiusM: number,
  cellM: number,
  valueAt: (x: number, y: number, lng: number, lat: number) => number | null,
): LocalGrid {
  assertCenterAndRadius(center, radiusM);
  if (!Number.isFinite(cellM) || cellM <= 0) throw new RangeError("invalid grid cell size");
  if (typeof valueAt !== "function") throw new TypeError("valueAt must be a function");

  const [cx, cy] = toUtmk(center);
  const span = radiusM + cellM;
  const cols = Math.floor((2 * span) / cellM) + 1;
  const rows = cols;
  const x0 = cx - span;
  const y0 = cy - span;
  const values = new Float64Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * cellM;
      const y = y0 + row * cellM;
      const [lng, lat] = toLngLat([x, y]);
      const value = valueAt(x, y, lng, lat);
      values[row * cols + col] = typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
    }
  }
  return { cx, cy, cellM, cols, rows, x0, y0, values };
}

/** 셀 중심이 원 안인 셀 수와 그중 유효(NaN 아님) 수. */
export function gridStats(g: LocalGrid, radiusM: number): { cells: number; valid: number } {
  assertGrid(g);
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid grid radius");
  let cells = 0;
  let valid = 0;
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      if (!insideRadius(g, col, row, radiusM)) continue;
      cells++;
      if (Number.isFinite(g.values[row * g.cols + col])) valid++;
    }
  }
  return { cells, valid };
}

/** 유효값만의 선형 보간 백분위(0~1). 유효값이 없으면 NaN이다. */
export function gridQuantiles(g: LocalGrid, radiusM: number, qs: number[]): number[] {
  assertGrid(g);
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError("invalid grid radius");
  if (qs.some((q) => !Number.isFinite(q) || q < 0 || q > 1)) throw new RangeError("quantile must be between 0 and 1");
  const values = finiteValues(g, radiusM).sort((a, b) => a - b);
  if (values.length === 0) return qs.map(() => Number.NaN);
  return qs.map((q) => {
    const position = (values.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return values[lower];
    return values[lower] + (values[upper] - values[lower]) * (position - lower);
  });
}

function validateBands(breaks: number[], layers: string[]): void {
  if (breaks.length === 0 || breaks.some((value) => !Number.isFinite(value))) throw new RangeError("breaks must be finite and non-empty");
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i] <= breaks[i - 1]) throw new RangeError("breaks must be strictly ascending");
  }
  if (layers.length !== breaks.length + 1 || layers.some((layer) => typeof layer !== "string" || layer.length === 0)) {
    throw new RangeError("layers must contain one label for each band");
  }
}

function turfGrid(g: LocalGrid, missingValue: number): FeatureCollection<Point> {
  const points: Feature<Point>[] = [];
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const value = g.values[row * g.cols + col];
      points.push(point(gridPoint(g, col, row), { elevation: Number.isFinite(value) ? value : missingValue }));
    }
  }
  return featureCollection(points);
}

/** 등고선 보간용으로만 결측 격자를 인접 유효값 평균으로 채운다. 원본 값은 바꾸지 않는다. */
function fillMissingValues(g: LocalGrid): Float64Array {
  let values = Float64Array.from(g.values);
  for (let pass = 0; pass < g.rows + g.cols; pass += 1) {
    const next = values.slice();
    let filled = 0;
    for (let row = 0; row < g.rows; row += 1) {
      for (let col = 0; col < g.cols; col += 1) {
        const index = row * g.cols + col;
        if (Number.isFinite(values[index])) continue;
        let sum = 0;
        let count = 0;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const neighborCol = col + dc;
          const neighborRow = row + dr;
          if (neighborCol < 0 || neighborCol >= g.cols || neighborRow < 0 || neighborRow >= g.rows) continue;
          const neighbor = values[neighborRow * g.cols + neighborCol];
          if (!Number.isFinite(neighbor)) continue;
          sum += neighbor;
          count += 1;
        }
        if (count > 0) {
          next[index] = sum / count;
          filled += 1;
        }
      }
    }
    values = next;
    if (filled === 0) break;
  }
  return values;
}

type BandGeometry = { type: "Polygon"; coordinates: number[][][] };

function appendBandGeometry(
  center: LngLat,
  radiusM: number,
  geometry: BandGeometry,
  layer: string,
  id: number,
  areaM2: { value: number },
  polygons: PolygonCandidate[],
  collectedParts: number[][][][],
): number {
  const clipped = areaInCircle(center, radiusM, geometry);
  if (!clipped || clipped.areaM2 <= 0) return id;
  areaM2.value += clipped.areaM2;
  collectedParts.push(...clipped.parts);
  for (const rings of clipped.parts) {
    const partAreaM2 = polygonArea(rings);
    if (partAreaM2 <= 0) continue;
    const candidate = polygonCandidate(id++, layer, rings, partAreaM2);
    if (candidate) polygons.push(candidate);
  }
  return id;
}

function bandIndex(value: number, breaks: number[]): number {
  for (let index = 0; index < breaks.length; index++) {
    if (value < breaks[index]) return index;
  }
  return breaks.length;
}

function circleRing(center: LngLat, radiusM: number): [number, number][] {
  const [cx, cy] = toUtmk(center);
  const segmentCount = 96;
  const correctedRadius = radiusM * Math.sqrt((2 * Math.PI) / (segmentCount * Math.sin((2 * Math.PI) / segmentCount)));
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = (2 * Math.PI * (index % segmentCount)) / segmentCount;
    return [cx + correctedRadius * Math.cos(angle), cy + correctedRadius * Math.sin(angle)];
  });
}

/** 등치면이 누락한 격자 외곽 영역을 원과 격자 셀 외곽의 교집합에서 복구한다. */
function uncoveredCircleParts(center: LngLat, radiusM: number, g: LocalGrid, bandParts: number[][][][]): number[][][][] {
  const halfCell = g.cellM / 2;
  const xMin = g.x0 - halfCell;
  const yMin = g.y0 - halfCell;
  const xMax = g.x0 + (g.cols - 1) * g.cellM + halfCell;
  const yMax = g.y0 + (g.rows - 1) * g.cellM + halfCell;
  const gridRing: [number, number][] = [[xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax], [xMin, yMin]];
  let remaining: Feature<Polygon | MultiPolygon> | null;
  try {
    remaining = intersect(featureCollection<Polygon | MultiPolygon>([
      polygon([circleRing(center, radiusM)]),
      polygon([gridRing]),
    ]));
  } catch {
    return [];
  }
  for (const rings of bandParts) {
    if (!remaining) break;
    try {
      remaining = difference(featureCollection<Polygon | MultiPolygon>([remaining, polygon(rings)]));
    } catch {
      return [];
    }
  }
  if (!remaining) return [];
  return remaining.geometry.type === "Polygon" ? [remaining.geometry.coordinates] : remaining.geometry.coordinates;
}

function appendPolygonParts(layer: string, id: number, parts: number[][][][], polygons: PolygonCandidate[]): number {
  for (const rings of parts) {
    const partAreaM2 = polygonArea(rings);
    if (partAreaM2 <= 0) continue;
    const candidate = polygonCandidate(id++, layer, rings, partAreaM2);
    if (candidate) polygons.push(candidate);
  }
  return id;
}

/**
 * 등치면 밴드를 만든다. 격자값은 투영 미터 좌표에서 계산하고, 반환 후보만 WGS84로 바꾼다.
 * nodata 면적은 areaM2의 마지막 원소에 둔다.
 */
export function bandPolygons(
  center: LngLat,
  radiusM: number,
  g: LocalGrid,
  breaks: number[],
  layers: string[],
  nodataLayer: string | null,
): { polygons: PolygonCandidate[]; areaM2: number[] } {
  assertCenterAndRadius(center, radiusM);
  assertGrid(g);
  validateBands(breaks, layers);
  if (nodataLayer !== null && (typeof nodataLayer !== "string" || nodataLayer.length === 0)) throw new RangeError("invalid nodata layer");

  const allFinite = finiteValues(g);
  const baseMin = Math.min(0, ...breaks, ...allFinite);
  const baseMax = Math.max(0, ...breaks, ...allFinite);
  const missingValue = baseMin - NODATA_OFFSET;
  const boundaries = [baseMin - NODATA_LOW_OFFSET, baseMin - 1, ...breaks, baseMax + 1];
  const contours = isobands(turfGrid(g, missingValue), boundaries, { zProperty: "elevation" });
  const polygons: PolygonCandidate[] = [];
  const bandCount = layers.length + (nodataLayer === null ? 0 : 1);
  const observedAreas = Array.from({ length: bandCount }, () => 0);
  const observedParts = Array.from({ length: bandCount }, () => [] as number[][][][]);
  let id = 1;

  contours.features.forEach((feature, turfIndex) => {
    const bandIndex = turfIndex - 1;
    if (bandIndex < 0) {
      if (nodataLayer === null) return;
      for (const coordinates of feature.geometry.coordinates) {
        const holder = { value: 0 };
        id = appendBandGeometry(center, radiusM, { type: "Polygon", coordinates }, nodataLayer, id, holder, polygons, observedParts[layers.length]);
        observedAreas[layers.length] += holder.value;
      }
      return;
    }
    if (bandIndex >= layers.length) return;
    for (const coordinates of feature.geometry.coordinates) {
      const holder = { value: 0 };
      id = appendBandGeometry(center, radiusM, { type: "Polygon", coordinates }, layers[bandIndex], id, holder, polygons, observedParts[bandIndex]);
      observedAreas[bandIndex] += holder.value;
    }
  });

  // Isobands can lose the band that reaches the grid boundary. Calculate the
  // reported shares from clipped sample cells, which tile the circle without
  // depending on a contour being closed, then restore the missing outer
  // geometry as the circle minus all emitted bands.
  const cellAreas = Array.from({ length: bandCount }, () => 0);
  const halfCell = g.cellM / 2;
  const cellParts = Array.from({ length: bandCount }, () => [] as number[][][][]);
  let hasNoData = false;
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const [x, y] = gridPoint(g, col, row);
      const cell: BandGeometry = {
        type: "Polygon",
        coordinates: [[[x - halfCell, y - halfCell], [x + halfCell, y - halfCell], [x + halfCell, y + halfCell], [x - halfCell, y + halfCell], [x - halfCell, y - halfCell]]],
      };
      const clipped = areaInCircle(center, radiusM, cell);
      if (!clipped || clipped.areaM2 <= 0) continue;
      const value = g.values[row * g.cols + col];
      if (!Number.isFinite(value)) hasNoData = true;
      const index = Number.isFinite(value)
        ? bandIndex(value, breaks)
        : (nodataLayer === null ? -1 : layers.length);
      if (index < 0 || index >= bandCount) continue;
      cellAreas[index] += clipped.areaM2;
      cellParts[index].push(...clipped.parts);
    }
  }

  const deficits = cellAreas.map((area, index) => area - observedAreas[index]);
  const targetIndex = deficits.reduce((best, deficit, index) => deficit > deficits[best] ? index : best, 0);
  if (deficits[targetIndex] > 1e-6 && (nodataLayer !== null || !hasNoData)) {
    const targetLayer = targetIndex === layers.length ? nodataLayer! : layers[targetIndex];
    for (let index = polygons.length - 1; index >= 0; index--) {
      if (polygons[index].p.layer === targetLayer) polygons.splice(index, 1);
    }
    const emittedParts = observedParts.flatMap((parts, index) => index === targetIndex ? [] : parts);
    const uncovered = uncoveredCircleParts(center, radiusM, g, emittedParts);
    id = appendPolygonParts(targetLayer, id, uncovered.length > 0 ? uncovered : cellParts[targetIndex], polygons);
  }

  return { polygons, areaM2: cellAreas };
}

function clippedSegment(
  a: [number, number],
  b: [number, number],
  cx: number,
  cy: number,
  radiusM: number,
): { a: [number, number]; b: [number, number]; t0: number; t1: number } | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const qa = dx * dx + dy * dy;
  if (qa <= EPSILON) return Math.hypot(a[0] - cx, a[1] - cy) <= radiusM + EPSILON ? { a, b, t0: 0, t1: 1 } : null;
  const fx = a[0] - cx;
  const fy = a[1] - cy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - radiusM * radiusM;
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return qc <= 0 ? { a, b, t0: 0, t1: 1 } : null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const t0 = Math.max(0, Math.min(1, (-qb - root) / (2 * qa)));
  const t1 = Math.max(0, Math.min(1, (-qb + root) / (2 * qa)));
  if (t1 - t0 <= EPSILON) return null;
  return {
    a: [a[0] + dx * t0, a[1] + dy * t0],
    b: [a[0] + dx * t1, a[1] + dy * t1],
    t0,
    t1,
  };
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-7;
}

function clippedPaths(path: number[][], cx: number, cy: number, radiusM: number): [number, number][][] {
  const paths: [number, number][][] = [];
  let current: [number, number][] | null = null;
  for (let i = 1; i < path.length; i++) {
    const segment = clippedSegment(path[i - 1] as [number, number], path[i] as [number, number], cx, cy, radiusM);
    if (!segment) {
      if (current && current.length >= 2) paths.push(current);
      current = null;
      continue;
    }
    if (!current || !samePoint(current[current.length - 1], segment.a)) {
      if (current && current.length >= 2) paths.push(current);
      current = [segment.a, segment.b];
    } else if (!samePoint(current[current.length - 1], segment.b)) {
      current.push(segment.b);
    }
    if (segment.t1 < 1 - EPSILON) {
      if (current.length >= 2) paths.push(current);
      current = null;
    }
  }
  if (current && current.length >= 2) paths.push(current);
  return paths;
}

function openPathLength(path: number[][]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return length;
}

function pointSegmentDistance(point: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/** 열린 등고선용 Douglas–Peucker. 닫는 점을 덧붙이지 않고 꼭짓점 상한만 적용한다. */
function simplifyOpenPath(path: [number, number][], maxVertices: number): [number, number][] {
  if (path.length <= maxVertices) return path;
  const keptAt = (tolerance: number): number[] => {
    const keep = new Uint8Array(path.length);
    keep[0] = 1;
    keep[path.length - 1] = 1;
    const stack: Array<[number, number]> = [[0, path.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop()!;
      let far = -1;
      let farDistance = tolerance;
      for (let i = start + 1; i < end; i++) {
        const distance = pointSegmentDistance(path[i], path[start], path[end]);
        if (distance > farDistance) {
          far = i;
          farDistance = distance;
        }
      }
      if (far >= 0) {
        keep[far] = 1;
        stack.push([start, far], [far, end]);
      }
    }
    return Array.from(keep.keys()).filter((index) => keep[index]);
  };

  let low = 0;
  let high = maxOf(path.map((point) => Math.hypot(point[0] - path[0][0], point[1] - path[0][1])));
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (keptAt(middle).length <= maxVertices) high = middle;
    else low = middle;
  }
  const indices = keptAt(high);
  if (indices.length <= maxVertices) return indices.map((index) => path[index]);
  return Array.from({ length: maxVertices }, (_, index) => path[Math.round((index * (path.length - 1)) / (maxVertices - 1))]);
}

function toLineCandidate(id: number, layer: string, path: [number, number][], label: string): LineCandidate {
  return {
    id,
    lengthM: openPathLength(path),
    l: {
      layer,
      points: simplifyOpenPath(path, 200).map(([x, y]) => {
        const [lng, lat] = toLngLat([x, y]);
        return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
      }),
      label,
    },
  };
}

/** 절대 표고 intervalM 간격의 등고선을 만들고 분석 원 안 구간만 반환한다. */
export function contourLines(center: LngLat, radiusM: number, g: LocalGrid, intervalM: number, layer: string): LineCandidate[] {
  assertCenterAndRadius(center, radiusM);
  assertGrid(g);
  if (!Number.isFinite(intervalM) || intervalM <= 0) throw new RangeError("invalid contour interval");
  if (typeof layer !== "string" || layer.length === 0) throw new RangeError("invalid contour layer");

  const values = finiteValues(g);
  if (values.length === 0) return [];
  const minBreak = Math.ceil(minOf(values) / intervalM - 1e-10) * intervalM;
  const maxBreak = Math.floor(maxOf(values) / intervalM + 1e-10) * intervalM;
  if (minBreak > maxBreak) return [];
  const breaks = Array.from({ length: Math.floor((maxBreak - minBreak) / intervalM + 0.5) + 1 }, (_, index) => minBreak + index * intervalM);
  const contourGrid = { ...g, values: fillMissingValues(g) };
  const grid = turfGrid(contourGrid, minOf(values) - NODATA_OFFSET);
  const output: LineCandidate[] = [];
  let id = 1;
  const lines = isolines(grid, breaks, { zProperty: "elevation" });
  lines.features.forEach((feature) => {
    const elevation = Number(feature.properties?.elevation);
    if (!Number.isFinite(elevation)) return;
    const labelValue = Math.abs(elevation) < 1e-9 ? 0 : Math.round(elevation * 100) / 100;
    for (const path of feature.geometry.coordinates) {
      for (const clipped of clippedPaths(path, g.cx, g.cy, radiusM)) {
        if (openPathLength(clipped) <= EPSILON) continue;
        output.push(toLineCandidate(id++, layer, clipped, `${labelValue}m`));
      }
    }
  });
  return output;
}
