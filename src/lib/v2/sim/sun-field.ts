/**
 * 반경 전체 일조장(미터 좌표계).
 *
 * The engine intentionally works on a byte mask rather than polygons after
 * the input obstacles have been projected.  A shadow is the swept union of a
 * footprint, its translated footprint, and one quadrilateral per edge.  The
 * pieces are scanline-filled directly into the same mask, so no Turf union is
 * on the hot path and concave footprints retain their shape.
 */
import type { XY } from "./shadow";
import type { HorizonMap } from "./horizon";
import { kst, kstForTrueSolar, sunPosition, sunriseSunsetKstMin, trueSolarMin } from "./sun";
import { availableParallelism } from "node:os";
import {
  isMainThread,
  MessageChannel,
  receiveMessageOnPort,
  Worker,
  type MessagePort,
  workerData,
} from "node:worker_threads";

const RAD = Math.PI / 180;
const EPSILON = 1e-10;

export interface Obstacle {
  ring: XY[];
  heightM: number;
  baseZ: number | null;
  kind: "building" | "canopy";
}

export interface SunGrid {
  x0: number;
  y0: number;
  cellM: number;
  cols: number;
  rows: number;
  receiver: Uint8Array;
  groundZ: Float32Array | null;
}

export interface SunFieldInput {
  grid: SunGrid;
  obstacles: readonly Obstacle[];
  latDeg: number;
  lonDeg: number;
  date: { year: number; month: number; day: number };
  stepMin?: number;
  horizon?: HorizonSampler;
  /** Structured-cloneable DEM horizon for date workers; callback remains for legacy callers. */
  horizonMap?: HorizonMap;
  hourlyFrom?: number;
  continuousTst?: [number, number];
  totalTst?: [number, number];
}

export interface SunFieldResult {
  sunMin: Uint16Array;
  longestRunTst0915: Uint16Array;
  totalTst0816: Uint16Array;
  sunriseKstMin: number;
  sunsetKstMin: number;
  dayLengthMin: number;
  tstOffsetMin: number;
  hourly: Array<{ kstHour: number; altDeg: number; azDeg: number; shade: Uint8Array }>;
  stats: { receivers: number; meanHours: number; shareLt1h: number; shareCont2h: number; shareTotal4h: number };
  obstacles: { buildings: number; canopy: number; excludedNoHeight: number };
}

export interface HorizonSampler {
  (x: number, y: number, azDeg: number): number;
  /** Optional fast path for a fixed receiver grid. */
  valuesForGrid?: (grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">, azDeg: number) => Float32Array;
}

export interface SunFieldBatchOptions {
  /** Maximum number of date workers. Defaults to the available CPU count minus the caller. */
  parallelism?: number;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PreparedObstacle {
  ring: XY[];
  bbox: BBox;
  center: XY;
  heightM: number;
  baseZ: number | null;
  kind: Obstacle["kind"];
  hasHeight: boolean;
  convex: boolean;
}

interface SolarInterval {
  startTst: number;
  endTst: number;
  durationMin: number;
}

interface ShadowComponents {
  dxPerHeight: number;
  dyPerHeight: number;
}

interface ScanEdge {
  firstRow: number;
  lastRow: number;
  minY: number;
  maxY: number;
  xAtFirst: number;
  dxPerRow: number;
}

/** 30 m 지평선 격자를 수신 격자(2 m)로 이중선형 보간한다. 최근접 복제는 30 m 계단 블록을 만든다. */
export function horizonValuesForGrid(horizon: HorizonMap, grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">, azimuthDeg: number): Float32Array {
  const normalized = Math.round((((azimuthDeg % 360) + 360) % 360) * 1000) / 1000;
  const direction = (normalized / 360) * horizon.azimuths;
  const az0 = Math.floor(direction) % horizon.azimuths;
  const az1 = (az0 + 1) % horizon.azimuths;
  const ta = direction - Math.floor(direction);
  const azimuthValue = (row: number, col: number) => {
    const source = (row * horizon.cols + col) * horizon.azimuths;
    return horizon.angleDeg[source + az0] * (1 - ta) + horizon.angleDeg[source + az1] * ta;
  };
  const expanded = new Float32Array(grid.cols * grid.rows);
  const colIndex = new Int32Array(grid.cols);
  const colFrac = new Float64Array(grid.cols);
  for (let col = 0; col < grid.cols; col++) {
    const f = Math.max(0, Math.min(horizon.cols - 1, (grid.x0 + (col + 0.5) * grid.cellM - horizon.x0) / horizon.cellM - 0.5));
    const c0 = Math.min(horizon.cols - 2 < 0 ? 0 : horizon.cols - 2, Math.floor(f));
    colIndex[col] = c0;
    colFrac[col] = horizon.cols > 1 ? f - c0 : 0;
  }
  for (let row = 0; row < grid.rows; row++) {
    const fy = Math.max(0, Math.min(horizon.rows - 1, (grid.y0 + (row + 0.5) * grid.cellM - horizon.y0) / horizon.cellM - 0.5));
    const r0 = Math.min(horizon.rows - 2 < 0 ? 0 : horizon.rows - 2, Math.floor(fy));
    const r1 = Math.min(horizon.rows - 1, r0 + 1);
    const ty = horizon.rows > 1 ? fy - r0 : 0;
    const target = row * grid.cols;
    for (let col = 0; col < grid.cols; col++) {
      const c0 = colIndex[col];
      const c1 = Math.min(horizon.cols - 1, c0 + 1);
      const tx = colFrac[col];
      const bottom = azimuthValue(r0, c0) * (1 - tx) + azimuthValue(r0, c1) * tx;
      const top = azimuthValue(r1, c0) * (1 - tx) + azimuthValue(r1, c1) * tx;
      expanded[target + col] = bottom * (1 - ty) + top * ty;
    }
  }
  return expanded;
}

const indexOf = (row: number, col: number, cols: number) => row * cols + col;

function openRing(ring: readonly XY[]): XY[] {
  if (ring.length < 3) return [];
  const result = ring.map(([x, y]) => [x, y] as XY);
  const first = result[0];
  const last = result[result.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) result.pop();
  return result.length >= 3 ? result : [];
}

function ringBBox(ring: readonly XY[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function ringCenter(ring: readonly XY[]): XY {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

function shifted(ring: readonly XY[], v: XY): XY[] {
  return ring.map(([x, y]) => [x + v[0], y + v[1]] as XY);
}

function cross(a: XY, b: XY, c: XY): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function isConvexRing(ring: readonly XY[]): boolean {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const value = cross(ring[i], ring[(i + 1) % ring.length], ring[(i + 2) % ring.length]);
    if (Math.abs(value) <= EPSILON) continue;
    const current = value > 0 ? 1 : -1;
    if (sign && sign !== current) return false;
    sign = current;
  }
  return sign !== 0;
}

function convexHull(points: readonly XY[]): XY[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: XY[] = [];
  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) unique.push(point);
  }
  if (unique.length <= 2) return unique;
  const lower: XY[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= EPSILON) lower.pop();
    lower.push(point);
  }
  const upper: XY[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= EPSILON) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Return the footprint and the quadrilaterals swept by every edge.
 * The returned rings are open; callers that need GeoJSON close them once.
 */
export function shadowPieces(ring: readonly XY[], v: XY): XY[][] {
  const source = openRing(ring);
  if (!source.length) return [];
  if (Math.abs(v[0]) < EPSILON && Math.abs(v[1]) < EPSILON) return [source];
  const moved = shifted(source, v);
  const pieces: XY[][] = [source, moved];
  for (let i = 0; i < source.length; i++) {
    const a = source[i];
    const b = source[(i + 1) % source.length];
    pieces.push([a, b, moved[(i + 1) % source.length], moved[i]]);
  }
  return pieces;
}

function rowRange(grid: Pick<SunGrid, "y0" | "cellM" | "rows">, bbox: BBox): [number, number] {
  const first = Math.max(0, Math.ceil((bbox.minY - grid.y0) / grid.cellM - 0.5 - EPSILON));
  const last = Math.min(grid.rows - 1, Math.floor((bbox.maxY - grid.y0) / grid.cellM - 0.5 + EPSILON));
  return [first, last];
}

function rasterizeOpenRing(mask: Uint8Array, grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">, source: readonly XY[], crossings: number[]): void {
  if (!source.length) return;
  const bbox = ringBBox(source);
  const [firstRow, lastRow] = rowRange(grid, bbox);
  if (firstRow > lastRow) return;

  for (let row = firstRow; row <= lastRow; row++) {
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    crossings.length = 0;
    let previous = source[source.length - 1];
    for (const current of source) {
      const [x1, y1] = previous;
      const [x2, y2] = current;
      // Half-open edge rule prevents a vertex from being counted twice.
      if ((y1 > y) !== (y2 > y)) crossings.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      previous = current;
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = crossings[i];
      const right = crossings[i + 1];
      const firstCol = Math.max(0, Math.ceil((left - grid.x0) / grid.cellM - 0.5 - EPSILON));
      const lastCol = Math.min(grid.cols - 1, Math.floor((right - grid.x0) / grid.cellM - 0.5 + EPSILON));
      if (firstCol > lastCol) continue;
      const offset = row * grid.cols;
      for (let col = firstCol; col <= lastCol; col++) mask[offset + col] = 1;
    }
  }
}

function addInterval(diff: Int32Array, stride: number, row: number, grid: Pick<SunGrid, "x0" | "cellM" | "cols">, left: number, right: number): void {
  const firstCol = Math.max(0, Math.ceil((left - grid.x0) / grid.cellM - 0.5 - EPSILON));
  const lastCol = Math.min(grid.cols - 1, Math.floor((right - grid.x0) / grid.cellM - 0.5 + EPSILON));
  if (firstCol > lastCol) return;
  const offset = row * stride;
  diff[offset + firstCol]++;
  diff[offset + lastCol + 1]--;
}

function scanEdges(
  grid: Pick<SunGrid, "y0" | "cellM" | "rows">,
  source: readonly XY[],
): ScanEdge[] {
  const edges: ScanEdge[] = [];
  for (let i = 0; i < source.length; i++) {
    const a = source[i];
    const b = source[(i + 1) % source.length];
    const dy = b[1] - a[1];
    if (Math.abs(dy) <= EPSILON) continue;
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    const firstRow = Math.max(0, Math.ceil((minY - grid.y0) / grid.cellM - 0.5 - EPSILON));
    const lastRow = Math.min(grid.rows - 1, Math.floor((maxY - grid.y0) / grid.cellM - 0.5 + EPSILON));
    if (firstRow > lastRow) continue;
    const y = grid.y0 + (firstRow + 0.5) * grid.cellM;
    edges.push({
      firstRow,
      lastRow,
      minY,
      maxY,
      xAtFirst: a[0] + ((y - a[1]) * (b[0] - a[0])) / dy,
      dxPerRow: ((b[0] - a[0]) / dy) * grid.cellM,
    });
  }
  edges.sort((a, b) => a.firstRow - b.firstRow || a.lastRow - b.lastRow);
  return edges;
}

function insertSorted(values: number[], count: number, value: number): number {
  let at = count;
  while (at > 0 && values[at - 1] > value) {
    values[at] = values[at - 1];
    at--;
  }
  values[at] = value;
  return count + 1;
}

function rasterizeOpenRingToDiff(
  diff: Int32Array,
  stride: number,
  grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">,
  source: readonly XY[],
  crossings: number[],
): void {
  if (source.length < 3) return;
  const edges = scanEdges(grid, source);
  if (edges.length < 2) return;
  const firstRow = edges[0].firstRow;
  const lastRow = edges.reduce((max, edge) => Math.max(max, edge.lastRow), -1);
  const active: ScanEdge[] = [];
  let nextEdge = 0;
  for (let row = firstRow; row <= lastRow; row++) {
    while (nextEdge < edges.length && edges[nextEdge].firstRow <= row) active.push(edges[nextEdge++]);
    for (let i = active.length - 1; i >= 0; i--) if (active[i].lastRow < row) active.splice(i, 1);
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    let crossingCount = 0;
    for (const edge of active) {
      // Preserve the original half-open edge rule exactly: the lower endpoint
      // participates and the upper endpoint does not.
      if (y >= edge.minY && y < edge.maxY) crossingCount = insertSorted(crossings, crossingCount, edge.xAtFirst + (row - edge.firstRow) * edge.dxPerRow);
    }
    for (let i = 0; i + 1 < crossingCount; i += 2) addInterval(diff, stride, row, grid, crossings[i], crossings[i + 1]);
  }
}

function rasterizeConvexToDiff(
  diff: Int32Array,
  stride: number,
  grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">,
  source: readonly XY[],
): void {
  if (source.length < 3) return;
  const firstRows = new Int32Array(source.length);
  const lastRows = new Int32Array(source.length);
  const xAtFirst = new Float64Array(source.length);
  const dxPerRow = new Float64Array(source.length);
  let edgeCount = 0;
  let minRow = grid.rows;
  let maxRow = -1;
  for (let i = 0; i < source.length; i++) {
    const a = source[i];
    const b = source[(i + 1) % source.length];
    const dy = b[1] - a[1];
    if (Math.abs(dy) <= EPSILON) continue;
    const edgeMinY = Math.min(a[1], b[1]);
    const edgeMaxY = Math.max(a[1], b[1]);
    const firstRow = Math.max(0, Math.ceil((edgeMinY - grid.y0) / grid.cellM - 0.5 - EPSILON));
    const lastRow = Math.min(grid.rows - 1, Math.floor((edgeMaxY - grid.y0) / grid.cellM - 0.5 + EPSILON));
    if (firstRow > lastRow) continue;
    const y = grid.y0 + (firstRow + 0.5) * grid.cellM;
    firstRows[edgeCount] = firstRow;
    lastRows[edgeCount] = lastRow;
    xAtFirst[edgeCount] = a[0] + ((y - a[1]) * (b[0] - a[0])) / dy;
    dxPerRow[edgeCount] = ((b[0] - a[0]) / dy) * grid.cellM;
    edgeCount++;
    if (firstRow < minRow) minRow = firstRow;
    if (lastRow > maxRow) maxRow = lastRow;
  }
  if (edgeCount < 2 || minRow > maxRow) return;
  for (let row = minRow; row <= maxRow; row++) {
    let left = Infinity;
    let right = -Infinity;
    for (let edge = 0; edge < edgeCount; edge++) {
      if (row < firstRows[edge] || row > lastRows[edge]) continue;
      const x = xAtFirst[edge] + (row - firstRows[edge]) * dxPerRow[edge];
      if (x < left) left = x;
      if (x > right) right = x;
    }
    if (left !== Infinity && right !== -Infinity) addInterval(diff, stride, row, grid, left, right);
  }
}

/** Fill cell centers inside one polygon using the even-odd scanline rule. */
export function fillRing(mask: Uint8Array, grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">, ring: readonly XY[]): void {
  rasterizeOpenRing(mask, grid, openRing(ring), []);
}

function overlaps(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function gridBBox(grid: SunGrid): BBox {
  return { minX: grid.x0, minY: grid.y0, maxX: grid.x0 + grid.cols * grid.cellM, maxY: grid.y0 + grid.rows * grid.cellM };
}

function sweptBBox(ring: readonly XY[], v: XY): BBox {
  const b = ringBBox(ring);
  return { minX: b.minX + Math.min(0, v[0]), minY: b.minY + Math.min(0, v[1]), maxX: b.maxX + Math.max(0, v[0]), maxY: b.maxY + Math.max(0, v[1]) };
}

function sampleGround(grid: SunGrid, x: number, y: number): number {
  if (!grid.groundZ) return 0;
  const fx = (x - grid.x0) / grid.cellM - 0.5;
  const fy = (y - grid.y0) / grid.cellM - 0.5;
  const x0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(fy)));
  const x1 = Math.min(grid.cols - 1, x0 + 1);
  const y1 = Math.min(grid.rows - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const z00 = grid.groundZ[indexOf(y0, x0, grid.cols)];
  const z10 = grid.groundZ[indexOf(y0, x1, grid.cols)];
  const z01 = grid.groundZ[indexOf(y1, x0, grid.cols)];
  const z11 = grid.groundZ[indexOf(y1, x1, grid.cols)];
  const values = [z00, z10, z01, z11].filter(Number.isFinite);
  if (!values.length) return 0;
  const a = Number.isFinite(z00) && Number.isFinite(z10) ? z00 * (1 - tx) + z10 * tx : Number.isFinite(z00) ? z00 : z10;
  const b = Number.isFinite(z01) && Number.isFinite(z11) ? z01 * (1 - tx) + z11 * tx : Number.isFinite(z01) ? z01 : z11;
  return Number.isFinite(a) && Number.isFinite(b) ? a * (1 - ty) + b * ty : values[0];
}

function shadowComponents(sun: { altitudeDeg: number; azimuthDeg: number }): ShadowComponents | null {
  if (sun.altitudeDeg <= 0.01) return null;
  const lengthPerHeight = 1 / Math.tan(sun.altitudeDeg * RAD);
  const az = sun.azimuthDeg * RAD;
  return { dxPerHeight: -Math.sin(az) * lengthPerHeight, dyPerHeight: -Math.cos(az) * lengthPerHeight };
}

function effectiveShadowVector(grid: SunGrid, obstacle: PreparedObstacle, components: ShadowComponents): XY | null {
  if (!obstacle.hasHeight || obstacle.heightM <= 0) return null;
  const baseZ = Number.isFinite(obstacle.baseZ) ? obstacle.baseZ as number : sampleGround(grid, obstacle.center[0], obstacle.center[1]);
  const first: XY = [components.dxPerHeight * obstacle.heightM, components.dyPerHeight * obstacle.heightM];
  const endpointZ = sampleGround(grid, obstacle.center[0] + first[0], obstacle.center[1] + first[1]);
  const effectiveHeight = obstacle.heightM + baseZ - endpointZ;
  if (effectiveHeight <= 0) return null;
  // One fixed-point correction is deliberate: it follows the plan's terrain
  // contract while keeping the per-obstacle hot path bounded and deterministic.
  return [components.dxPerHeight * effectiveHeight, components.dyPerHeight * effectiveHeight];
}

function setRoofReceivers(grid: SunGrid, obstacles: readonly PreparedObstacle[]): void {
  const roof = new Uint8Array(grid.cols * grid.rows);
  for (const obstacle of obstacles) {
    if (obstacle.kind !== "building" || !overlaps(obstacle.bbox, gridBBox(grid))) continue;
    fillRing(roof, grid, obstacle.ring);
  }
  for (let i = 0; i < roof.length; i++) if (roof[i] && grid.receiver[i] === 1) grid.receiver[i] = 2;
}

function receiverIndices(grid: SunGrid): Uint32Array {
  let count = 0;
  for (const value of grid.receiver) if (value === 1) count++;
  const indices = new Uint32Array(count);
  let at = 0;
  for (let index = 0; index < grid.receiver.length; index++) if (grid.receiver[index] === 1) indices[at++] = index;
  return indices;
}

function setBit(bits: Uint8Array, at: number): void {
  bits[at >> 3] |= 1 << (at & 7);
}

function intervalOverlap(start: number, end: number, windowStart: number, windowEnd: number): number {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
}

function solarInterval(lonDeg: number, date: SunFieldInput["date"], startKst: number, endKst: number): SolarInterval {
  let startTst = trueSolarMin(lonDeg, kst(date.year, date.month, date.day, 0, startKst));
  let endTst = trueSolarMin(lonDeg, kst(date.year, date.month, date.day, 0, endKst));
  if (endTst <= startTst) endTst += 1440;
  // Dawn-to-dusk never crosses midnight in the target latitude, but retaining
  // the unwrapped interval makes window intersection deterministic at edges.
  if (startTst < 0) startTst += 1440;
  return { startTst, endTst, durationMin: endKst - startKst };
}

function normalizedWindow(window: [number, number]): [number, number] {
  const a = Math.max(0, Math.min(1440, window[0]));
  const b = Math.max(a, Math.min(1440, window[1]));
  return [a, b];
}

function makeShadeMask(
  grid: SunGrid,
  obstacles: readonly PreparedObstacle[],
  sun: { altitudeDeg: number; azimuthDeg: number },
  horizon: HorizonSampler | undefined,
  horizonValues: Float32Array | null,
  diff: Int32Array,
): Uint8Array {
  const shade = new Uint8Array(grid.cols * grid.rows);
  const components = shadowComponents(sun);
  if (!components) return shade;
  const bounds = gridBBox(grid);
  const stride = grid.cols + 1;
  diff.fill(0);
  const crossings: number[] = [];
  for (const obstacle of obstacles) {
    if (!obstacle.hasHeight) continue;
    const vector = effectiveShadowVector(grid, obstacle, components);
    if (!vector || !overlaps(sweptBBox(obstacle.ring, vector), bounds)) continue;
    const moved = shifted(obstacle.ring, vector);
    if (obstacle.convex) rasterizeConvexToDiff(diff, stride, grid, convexHull(obstacle.ring.concat(moved)));
    else for (const piece of shadowPieces(obstacle.ring, vector)) rasterizeOpenRingToDiff(diff, stride, grid, piece, crossings);
  }
  for (let row = 0; row < grid.rows; row++) {
    const offset = row * stride;
    let covered = 0;
    const target = row * grid.cols;
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    for (let col = 0; col < grid.cols; col++) {
      covered += diff[offset + col];
      const i = target + col;
      if (grid.receiver[i] === 0) continue;
      let terrainShade = false;
      if (grid.receiver[i] === 1 && horizonValues) {
        const horizonDeg = horizonValues[i];
        terrainShade = Number.isFinite(horizonDeg) && horizonDeg > sun.altitudeDeg;
      } else if (horizon && grid.receiver[i] === 1) {
        const x = grid.x0 + (col + 0.5) * grid.cellM;
        const horizonDeg = horizon(x, y, sun.azimuthDeg);
        terrainShade = Number.isFinite(horizonDeg) && horizonDeg > sun.altitudeDeg;
      }
      if (covered > 0 || terrainShade) shade[i] = 1;
    }
  }
  return shade;
}

function asUint16(values: Float64Array): Uint16Array {
  const result = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) result[i] = Math.max(0, Math.min(65535, Math.round(values[i])));
  return result;
}

// ponytail: receiver cells are horizontal planes; slope-normal irradiance is
// intentionally outside this engine and belongs in a later terrain model.
/** Compute one seasonal analysis-day sun field without reducing the radius or obstacle set. */
export function computeSunField(input: SunFieldInput): SunFieldResult {
  if (input.grid.cols < 1 || input.grid.rows < 1 || input.grid.cellM <= 0 || input.grid.receiver.length !== input.grid.cols * input.grid.rows) throw new Error("invalid sun grid");
  // Keep the pure-function contract: roof classification is derived locally
  // and never mutates the caller's receiver mask.
  const grid: SunGrid = { ...input.grid, receiver: new Uint8Array(input.grid.receiver) };
  const stepMin = input.stepMin ?? 10;
  if (!(stepMin > 0 && Number.isFinite(stepMin))) throw new Error("stepMin must be positive");
  const continuous = normalizedWindow(input.continuousTst ?? [540, 900]);
  const total = normalizedWindow(input.totalTst ?? [480, 960]);
  const { year, month, day } = input.date;
  const solar = sunriseSunsetKstMin(input.latDeg, input.lonDeg, year, month, day);
  const dayLengthMin = Math.max(0, solar.sunset - solar.sunrise);
  const tstOffsetMin = kstForTstOffset(input.lonDeg, input.date);
  const prepared = input.obstacles.map((obstacle) => {
    const ring = openRing(obstacle.ring);
    return {
      ring,
      bbox: ringBBox(ring),
      center: ring.length ? ringCenter(ring) : [0, 0],
      heightM: obstacle.heightM,
      baseZ: obstacle.baseZ,
      kind: obstacle.kind,
      hasHeight: Number.isFinite(obstacle.heightM),
      convex: isConvexRing(ring),
    } satisfies PreparedObstacle;
  }).filter((obstacle) => obstacle.ring.length >= 3);
  setRoofReceivers(grid, prepared);

  const size = grid.cols * grid.rows;
  const receiverCells = receiverIndices(grid);
  const sunMinFloat = new Float64Array(size);
  const longestFloat = new Float64Array(size);
  const totalFloat = new Float64Array(size);
  const running = new Float64Array(size);
  const shadowDiff = new Int32Array((grid.cols + 1) * grid.rows);
  const sunrise = solar.sunrise;
  const sunset = solar.sunset;

  for (let startKst = sunrise; startKst < sunset - EPSILON; startKst += stepMin) {
    const endKst = Math.min(sunset, startKst + stepMin);
    const midKst = (startKst + endKst) / 2;
    const sun = sunPosition(input.latDeg, input.lonDeg, kst(year, month, day, 0, midKst));
    const interval = solarInterval(input.lonDeg, input.date, startKst, endKst);
    const horizonValues = input.horizon?.valuesForGrid?.(grid, sun.azimuthDeg) ?? (input.horizonMap ? horizonValuesForGrid(input.horizonMap, grid, sun.azimuthDeg) : null);
    const shade = makeShadeMask(grid, prepared, sun, input.horizon, horizonValues, shadowDiff);
    const continuousMin = intervalOverlap(interval.startTst, interval.endTst, continuous[0], continuous[1]);
    const totalMin = intervalOverlap(interval.startTst, interval.endTst, total[0], total[1]);
    for (const i of receiverCells) {
      if (shade[i]) {
        if (continuousMin > 0) running[i] = 0;
        continue;
      }
      sunMinFloat[i] += interval.durationMin;
      if (continuousMin > 0) {
        running[i] += continuousMin;
        if (running[i] > longestFloat[i]) longestFloat[i] = running[i];
      }
      if (totalMin > 0) totalFloat[i] += totalMin;
    }
  }

  const hourly: SunFieldResult["hourly"] = [];
  const firstHour = Math.max(0, Math.floor(input.hourlyFrom ?? 5));
  for (let hour = firstHour; hour <= 23; hour++) {
    const sun = sunPosition(input.latDeg, input.lonDeg, kst(year, month, day, hour));
    if (sun.altitudeDeg < 5) continue;
    const horizonValues = input.horizon?.valuesForGrid?.(grid, sun.azimuthDeg) ?? (input.horizonMap ? horizonValuesForGrid(input.horizonMap, grid, sun.azimuthDeg) : null);
    const shade = makeShadeMask(grid, prepared, sun, input.horizon, horizonValues, shadowDiff);
    const bits = new Uint8Array(Math.ceil(size / 8));
    for (let i = 0; i < size; i++) if (shade[i]) setBit(bits, i);
    hourly.push({ kstHour: hour, altDeg: sun.altitudeDeg, azDeg: sun.azimuthDeg, shade: bits });
  }

  const sunMin = asUint16(sunMinFloat);
  const longestRunTst0915 = asUint16(longestFloat);
  const totalTst0816 = asUint16(totalFloat);
  let receivers = 0;
  let sumHours = 0;
  let lt1h = 0;
  let cont2h = 0;
  let total4h = 0;
  for (const i of receiverCells) {
    receivers++;
    sumHours += sunMin[i] / 60;
    if (sunMin[i] < 60) lt1h++;
    if (longestRunTst0915[i] >= 120) cont2h++;
    if (totalTst0816[i] >= 240) total4h++;
  }

  const buildings = prepared.filter((obstacle) => obstacle.kind === "building");
  const canopy = prepared.filter((obstacle) => obstacle.kind === "canopy");
  return {
    sunMin,
    longestRunTst0915,
    totalTst0816,
    sunriseKstMin: sunrise,
    sunsetKstMin: sunset,
    dayLengthMin,
    tstOffsetMin,
    hourly,
    stats: {
      receivers,
      meanHours: receivers ? sumHours / receivers : 0,
      shareLt1h: receivers ? lt1h / receivers : 0,
      shareCont2h: receivers ? cont2h / receivers : 0,
      shareTotal4h: receivers ? total4h / receivers : 0,
    },
    obstacles: {
      buildings: buildings.length,
      canopy: canopy.length,
      excludedNoHeight: buildings.filter((obstacle) => !obstacle.hasHeight).length,
    },
  };
}

/**
 * Compute independent dates concurrently in Node. The one-date function remains
 * the source of truth; workers only change scheduling and transfer the exact
 * typed-array result back. Callback horizons stay on the sync path, while a
 * HorizonMap is structured-cloneable and can travel with each date worker.
 */
export function computeSunFields(inputs: readonly SunFieldInput[], options: SunFieldBatchOptions = {}): SunFieldResult[] {
  if (inputs.length < 2 || options.parallelism === 1 || inputs.some((input) => input.horizon !== undefined)) return inputs.map(computeSunField);
  const available = Math.max(1, availableParallelism() - 1);
  const requested = options.parallelism ?? available;
  if (!Number.isInteger(requested) || requested < 1) throw new RangeError("parallelism must be a positive integer");
  const workerCount = Math.min(inputs.length, requested, available);
  if (workerCount < 2) return inputs.map(computeSunField);

  const results: SunFieldResult[] = new Array(inputs.length);
  for (let start = 0; start < inputs.length; start += workerCount) {
    const jobs = inputs.slice(start, start + workerCount).map((input, offset) => startWorker(input, start + offset));
    try {
      for (const job of jobs) {
        const waitStatus = Atomics.wait(job.done, 0, 0, 300_000);
        if (waitStatus === "timed-out") throw new Error(`sun-field worker timed out at date ${job.index}`);
        const packet = receiveMessageOnPort(job.port)?.message as SunFieldWorkerMessage | undefined;
        if (!packet?.ok) throw new Error(packet?.error ?? `sun-field worker failed at date ${job.index}`);
        results[job.index] = packet.result;
      }
    } finally {
      for (const job of jobs) {
        job.port.close();
        void job.worker.terminate();
      }
    }
  }
  return results;
}

interface SunFieldWorkerMessage {
  ok: boolean;
  result: SunFieldResult;
  error?: string;
}

interface SunFieldWorkerJob {
  index: number;
  done: Int32Array;
  port: MessagePort;
  worker: Worker;
}

function workerExecArgv(): string[] {
  const args = [...process.execArgv];
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--eval" || arg === "-e" || arg === "--print" || arg === "-p" || arg === "--input-type") {
      index++;
      continue;
    }
    if (arg.startsWith("--eval=") || arg.startsWith("--print=") || arg.startsWith("--input-type=")) continue;
    filtered.push(arg);
  }
  return filtered;
}

function resultTransferList(result: SunFieldResult): ArrayBuffer[] {
  return [
    result.sunMin.buffer,
    result.longestRunTst0915.buffer,
    result.totalTst0816.buffer,
    ...result.hourly.map((hour) => hour.shade.buffer),
  ] as ArrayBuffer[];
}

function startWorker(input: SunFieldInput, index: number): SunFieldWorkerJob {
  const { port1, port2 } = new MessageChannel();
  const done = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const worker = new Worker(new URL("./sun-field.ts", import.meta.url), {
    workerData: { kind: "sun-field", input, port: port2, done: done.buffer },
    transferList: [port2],
    execArgv: workerExecArgv(),
  });
  return { index, done, port: port1, worker };
}

function runSunFieldWorker(): void {
  const payload = workerData as { kind?: string; input?: SunFieldInput; port?: MessagePort; done?: SharedArrayBuffer };
  if (payload.kind !== "sun-field" || !payload.input || !payload.port || !payload.done) return;
  const done = new Int32Array(payload.done);
  try {
    const result = computeSunField(payload.input);
    payload.port.postMessage({ ok: true, result } satisfies SunFieldWorkerMessage, resultTransferList(result));
  } catch (error) {
    payload.port.postMessage({ ok: false, result: {} as SunFieldResult, error: error instanceof Error ? error.message : String(error) } satisfies SunFieldWorkerMessage);
  } finally {
    Atomics.store(done, 0, 1);
    Atomics.notify(done, 0);
    payload.port.close();
  }
}

function kstForTstOffset(lonDeg: number, date: SunFieldInput["date"]): number {
  return kstForTrueSolar(lonDeg, date.year, date.month, date.day, 12 * 60) - 12 * 60;
}

if (!isMainThread && workerData && typeof workerData === "object" && (workerData as { kind?: string }).kind === "sun-field") runSunFieldWorker();
