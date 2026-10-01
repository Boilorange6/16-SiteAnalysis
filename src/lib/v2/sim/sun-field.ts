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
import { kst, kstForTrueSolar, sunPosition, sunriseSunsetKstMin, trueSolarMin } from "./sun";

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
  horizon?: (x: number, y: number, azDeg: number) => number;
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

function rasterizeOpenRingToDiff(
  diff: Int32Array,
  stride: number,
  grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">,
  source: readonly XY[],
  crossings: number[],
): void {
  if (source.length < 3) return;
  const [firstRow, lastRow] = rowRange(grid, ringBBox(source));
  if (firstRow > lastRow) return;
  for (let row = firstRow; row <= lastRow; row++) {
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    crossings.length = 0;
    let previous = source[source.length - 1];
    for (const current of source) {
      const [x1, y1] = previous;
      const [x2, y2] = current;
      if ((y1 > y) !== (y2 > y)) crossings.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      previous = current;
    }
    if (crossings.length < 2) continue;
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) addInterval(diff, stride, row, grid, crossings[i], crossings[i + 1]);
  }
}

function rasterizeConvexToDiff(
  diff: Int32Array,
  stride: number,
  grid: Pick<SunGrid, "x0" | "y0" | "cellM" | "cols" | "rows">,
  source: readonly XY[],
): void {
  if (source.length < 3) return;
  const edges: Array<{ firstRow: number; lastRow: number; xAtFirst: number; dxPerRow: number }> = [];
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
    edges.push({ firstRow, lastRow, xAtFirst: a[0] + ((y - a[1]) * (b[0] - a[0])) / dy, dxPerRow: ((b[0] - a[0]) / dy) * grid.cellM });
    if (firstRow < minRow) minRow = firstRow;
    if (lastRow > maxRow) maxRow = lastRow;
  }
  if (minRow > maxRow) return;
  for (let row = minRow; row <= maxRow; row++) {
    let left = Infinity;
    let right = -Infinity;
    for (const edge of edges) {
      if (row < edge.firstRow || row > edge.lastRow) continue;
      const x = edge.xAtFirst + (row - edge.firstRow) * edge.dxPerRow;
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
  horizon: SunFieldInput["horizon"],
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
    for (let col = 0; col < grid.cols; col++) {
      covered += diff[offset + col];
      if (covered > 0 && grid.receiver[target + col] !== 0) shade[target + col] = 1;
    }
  }
  if (horizon) {
    for (let row = 0; row < grid.rows; row++) {
      const y = grid.y0 + (row + 0.5) * grid.cellM;
      const offset = row * grid.cols;
      for (let col = 0; col < grid.cols; col++) {
        const i = offset + col;
        if (grid.receiver[i] !== 1) continue;
        const x = grid.x0 + (col + 0.5) * grid.cellM;
        const horizonDeg = horizon(x, y, sun.azimuthDeg);
        if (Number.isFinite(horizonDeg) && horizonDeg > sun.altitudeDeg) shade[i] = 1;
      }
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
    const shade = makeShadeMask(grid, prepared, sun, input.horizon, shadowDiff);
    const continuousMin = intervalOverlap(interval.startTst, interval.endTst, continuous[0], continuous[1]);
    const totalMin = intervalOverlap(interval.startTst, interval.endTst, total[0], total[1]);
    for (let i = 0; i < size; i++) {
      if (grid.receiver[i] !== 1) continue;
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
    const shade = makeShadeMask(grid, prepared, sun, input.horizon, shadowDiff);
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
  for (let i = 0; i < size; i++) {
    if (grid.receiver[i] !== 1) continue;
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

function kstForTstOffset(lonDeg: number, date: SunFieldInput["date"]): number {
  return kstForTrueSolar(lonDeg, date.year, date.month, date.day, 12 * 60) - 12 * 60;
}
