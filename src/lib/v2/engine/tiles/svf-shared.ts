/** D29/S04가 공유하는 지형·건물 DSM과 하늘열림(SVF) 계산. */
import { toLngLat, toUtmk } from "../../crs";
import { terrainHorizon, type HorizonMap } from "../../sim/horizon";
import type { EngineContext } from "../context";
import { buildingRows, type BuildingRow } from "./buildings-shared";
import { polygonParts } from "./geo";
import { demReader } from "./terrain-shared";
import type { LocalGrid } from "./raster-grid";
import { localGrid } from "./raster-grid";

export const SVF_CELL_M = 2;
export const SVF_DIRS = 32;
export const SVF_MAX_DIST_M = 300;
export const SVF_EYE_M = 1.1;
export const SVF_HORIZON_CELL_M = 30;
export const SVF_HORIZON_AZIMUTHS = 72;
export const SVF_HORIZON_SEARCH_M = 5000;
export const CANOPY_ASSUMED_HEIGHT_M = 8;

export interface SvfShared {
  /** skyViewFactor와 같은 외곽 모서리·셀 간격의 DSM 격자. 값은 지면/건물/수관 상단 표고다. */
  grid: LocalGrid;
  /** row-major SVF. 반경 밖·건물 지붕·결측 지면은 NaN이다. */
  svf: Float32Array;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Obstacle {
  rings: number[][][];
  bounds: Bounds;
  heightM: number | null;
}

interface RasterState {
  grid: LocalGrid;
  ground: Float32Array;
  dsm: Float32Array;
  receiver: Uint8Array;
  buildingMask: Uint8Array;
}

const RAD = Math.PI / 180;

function boundsForRings(rings: number[][][]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
    ? { minX, minY, maxX, maxY }
    : null;
}

function pointOnSegment(x: number, y: number, a: number[], b: number[]): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return Math.hypot(x - a[0], y - a[1]) <= 1e-7;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2));
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)) <= 1e-7;
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (pointOnSegment(x, y, a, b)) return true;
    const crosses = (a[1] > y) !== (b[1] > y);
    if (crosses && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** EPSG:5179 폴리곤(바깥 고리·구멍 포함) 안의 점을 판정한다. */
export function pointInRings(x: number, y: number, rings: number[][][]): boolean {
  if (!rings[0] || !pointInRing(x, y, rings[0])) return false;
  return rings.slice(1).every((ring) => !pointInRing(x, y, ring));
}

/** MultiPolygon의 어느 파트 안에 점이 있는지 판정한다. */
export function pointInParts(x: number, y: number, parts: number[][][][]): boolean {
  return parts.some((rings) => pointInRings(x, y, rings));
}

function obstacleRows(rows: BuildingRow[]): Obstacle[] {
  return rows.flatMap((row) => polygonParts(row.hit.geometry).flatMap((parts) => {
    const bounds = boundsForRings(parts);
    return bounds ? [{ rings: parts, bounds, heightM: row.heightM }] : [];
  }));
}

function coarseSample(grid: LocalGrid, x: number, y: number): number | null {
  const px = (x - grid.x0) / grid.cellM;
  const py = (y - grid.y0) / grid.cellM;
  if (px < 0 || py < 0 || px > grid.cols - 1 || py > grid.rows - 1) return null;
  const col0 = Math.floor(px);
  const row0 = Math.floor(py);
  const col1 = Math.min(grid.cols - 1, col0 + 1);
  const row1 = Math.min(grid.rows - 1, row0 + 1);
  const tx = px - col0;
  const ty = py - row0;
  const values = [
    grid.values[row0 * grid.cols + col0],
    grid.values[row0 * grid.cols + col1],
    grid.values[row1 * grid.cols + col0],
    grid.values[row1 * grid.cols + col1],
  ];
  if (!values.every(Number.isFinite)) return null;
  return values[0] * (1 - tx) * (1 - ty) + values[1] * tx * (1 - ty) + values[2] * (1 - tx) * ty + values[3] * tx * ty;
}

function domainGrid(ctx: EngineContext, reader: NonNullable<ReturnType<typeof demReader>>): { grid: LocalGrid; ground: Float32Array; dsm: Float32Array; receiver: Uint8Array } {
  const [cx, cy] = toUtmk(ctx.input.center);
  // The reported raster covers the selected analysis circle. Terrain beyond
  // this extent is supplied by the separate 30m horizon map; keeping the
  // DSM at the requested 2m extent is important for the 4s worker budget.
  const span = ctx.input.radiusM + SVF_CELL_M;
  const cols = Math.floor((2 * span) / SVF_CELL_M) + 1;
  const rows = cols;
  const x0 = cx - span;
  const y0 = cy - span;
  const count = cols * rows;
  // DEM is about 30m data. Sample it once on a coarse local grid and
  // interpolate to the 2m DSM instead of doing four SQLite row lookups per
  // 2m cell. The 2m resolution is retained for buildings and the SVF raster.
  const coarse = localGrid(
    ctx.input.center,
    ctx.input.radiusM + SVF_MAX_DIST_M + SVF_CELL_M,
    SVF_HORIZON_CELL_M,
    (x, y, lng, lat) => reader.elevation(lng, lat),
  );
  const ground = new Float32Array(count);
  ground.fill(Number.NaN);
  const dsm = new Float32Array(count);
  dsm.fill(Number.NaN);
  const receiver = new Uint8Array(count);
  const values = new Float64Array(count);
  values.fill(Number.NaN);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = x0 + (col + 0.5) * SVF_CELL_M;
      const y = y0 + (row + 0.5) * SVF_CELL_M;
      const elevation = coarseSample(coarse, x, y);
      if (elevation === null || !Number.isFinite(elevation)) continue;
      const index = row * cols + col;
      ground[index] = elevation;
      dsm[index] = elevation;
      values[index] = elevation;
      if (Math.hypot(x - cx, y - cy) <= ctx.input.radiusM + SVF_CELL_M / 2) receiver[index] = 1;
    }
  }

  return {
    grid: { cx, cy, cellM: SVF_CELL_M, cols, rows, x0, y0, values },
    ground,
    dsm,
    receiver,
  };
}

function cellRange(grid: LocalGrid, bounds: Bounds): { col0: number; col1: number; row0: number; row1: number } | null {
  const col0 = Math.max(0, Math.floor((bounds.minX - grid.x0) / grid.cellM - 0.5) - 1);
  const col1 = Math.min(grid.cols - 1, Math.ceil((bounds.maxX - grid.x0) / grid.cellM - 0.5) + 1);
  const row0 = Math.max(0, Math.floor((bounds.minY - grid.y0) / grid.cellM - 0.5) - 1);
  const row1 = Math.min(grid.rows - 1, Math.ceil((bounds.maxY - grid.y0) / grid.cellM - 0.5) + 1);
  return col0 <= col1 && row0 <= row1 ? { col0, col1, row0, row1 } : null;
}

function forEachCoveredCell(grid: LocalGrid, obstacle: Obstacle, visit: (index: number) => void): void {
  const range = cellRange(grid, obstacle.bounds);
  if (!range) return;
  for (let row = range.row0; row <= range.row1; row += 1) {
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    for (let col = range.col0; col <= range.col1; col += 1) {
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      if (pointInRings(x, y, obstacle.rings)) visit(row * grid.cols + col);
    }
  }
}

function rayDistances(cellM: number, maxDistM: number): number[] {
  const nearEnd = Math.min(maxDistM, Math.max(cellM * 8, 24));
  const distances: number[] = [];
  if (maxDistM < cellM) return [maxDistM];
  for (let distance = cellM; distance <= nearEnd + 1e-9; distance += cellM) distances.push(Math.min(distance, maxDistM));
  if (nearEnd >= maxDistM - 1e-9) return distances;
  let distance = nearEnd * 2;
  while (distance < maxDistM - 1e-9) {
    distances.push(distance);
    distance *= 2;
  }
  distances.push(maxDistM);
  return distances;
}

interface RaySamples {
  distances: Float64Array;
  inverseDistances: Float64Array;
  colOffsets: Int32Array;
  rowOffsets: Int32Array;
}

function raySamples(cellM: number, maxDistM: number, dirs: number): RaySamples[] {
  const distances = rayDistances(cellM, maxDistM);
  return Array.from({ length: dirs }, (_, directionIndex) => {
    const az = (360 * directionIndex * RAD) / dirs;
    const sin = Math.sin(az);
    const cos = Math.cos(az);
    const colOffsets = Int32Array.from(distances, (distance) => Math.round((sin * distance) / cellM));
    const rowOffsets = Int32Array.from(distances, (distance) => Math.round((cos * distance) / cellM));
    const distanceValues = Float64Array.from(distances);
    return { distances: distanceValues, inverseDistances: Float64Array.from(distanceValues, (distance) => 1 / distance), colOffsets, rowOffsets };
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** horizonAt와 같은 보간이지만, 이미 검증된 내부 HorizonMap의 반복 검사를 생략한다. */
function horizonAtFast(horizon: HorizonMap, x: number, y: number, azDeg: number): number {
  const px = clamp((x - horizon.x0) / horizon.cellM - 0.5, 0, horizon.cols - 1);
  const py = clamp((y - horizon.y0) / horizon.cellM - 0.5, 0, horizon.rows - 1);
  const col0 = Math.floor(px);
  const row0 = Math.floor(py);
  const col1 = Math.min(horizon.cols - 1, col0 + 1);
  const row1 = Math.min(horizon.rows - 1, row0 + 1);
  const tx = px - col0;
  const ty = py - row0;
  const direction = (((azDeg % 360) + 360) % 360) / 360 * horizon.azimuths;
  const az0 = Math.floor(direction) % horizon.azimuths;
  const az1 = (az0 + 1) % horizon.azimuths;
  const ta = direction - Math.floor(direction);
  const southWest0 = horizon.angleDeg[(row0 * horizon.cols + col0) * horizon.azimuths + az0];
  const southWest1 = horizon.angleDeg[(row0 * horizon.cols + col0) * horizon.azimuths + az1];
  const southEast0 = horizon.angleDeg[(row0 * horizon.cols + col1) * horizon.azimuths + az0];
  const southEast1 = horizon.angleDeg[(row0 * horizon.cols + col1) * horizon.azimuths + az1];
  const northWest0 = horizon.angleDeg[(row1 * horizon.cols + col0) * horizon.azimuths + az0];
  const northWest1 = horizon.angleDeg[(row1 * horizon.cols + col0) * horizon.azimuths + az1];
  const northEast0 = horizon.angleDeg[(row1 * horizon.cols + col1) * horizon.azimuths + az0];
  const northEast1 = horizon.angleDeg[(row1 * horizon.cols + col1) * horizon.azimuths + az1];
  const southWest = southWest0 * (1 - ta) + southWest1 * ta;
  const southEast = southEast0 * (1 - ta) + southEast1 * ta;
  const northWest = northWest0 * (1 - ta) + northWest1 * ta;
  const northEast = northEast0 * (1 - ta) + northEast1 * ta;
  const south = southWest * (1 - tx) + southEast * tx;
  const north = northWest * (1 - tx) + northEast * tx;
  return south * (1 - ty) + north * ty;
}

/** T11 skyViewFactor의 결정적 계산을 유지하되 horizonAt의 반복 검증을 제거한 worker용 경로. */
function skyViewFactorNoTerrain(dsm: Float32Array, grid: LocalGrid, receiver: Uint8Array): Float32Array {
  const result = new Float32Array(dsm.length);
  result.fill(Number.NaN);
  const rays = raySamples(grid.cellM, SVF_MAX_DIST_M, SVF_DIRS);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const index = row * grid.cols + col;
      if (receiver[index] === 0 || !Number.isFinite(dsm[index])) continue;
      const observer = dsm[index] + SVF_EYE_M;
      let blockedSquareSinSum = 0;
      for (let directionIndex = 0; directionIndex < SVF_DIRS; directionIndex += 1) {
        let highestSlope = 0;
        const ray = rays[directionIndex];
        for (let sampleIndex = 0; sampleIndex < ray.distances.length; sampleIndex += 1) {
          const sampleCol = col + ray.colOffsets[sampleIndex];
          const sampleRow = row + ray.rowOffsets[sampleIndex];
          if (sampleCol < 0 || sampleCol >= grid.cols || sampleRow < 0 || sampleRow >= grid.rows) break;
          const elevation = dsm[index + ray.rowOffsets[sampleIndex] * grid.cols + ray.colOffsets[sampleIndex]];
          if (!Number.isFinite(elevation)) continue;
          const slope = (elevation - observer) * ray.inverseDistances[sampleIndex];
          if (slope > highestSlope) highestSlope = slope;
        }
        blockedSquareSinSum += (highestSlope * highestSlope) / (1 + highestSlope * highestSlope);
      }
      result[index] = Math.max(0, Math.min(1, 1 - blockedSquareSinSum / SVF_DIRS));
    }
  }
  return result;
}

function skyViewFactorFast(dsm: Float32Array, grid: LocalGrid, receiver: Uint8Array, horizon: HorizonMap): Float32Array {
  const result = new Float32Array(dsm.length);
  result.fill(Number.NaN);
  const rays = raySamples(grid.cellM, SVF_MAX_DIST_M, SVF_DIRS);
  const directions = Array.from({ length: SVF_DIRS }, (_, index) => (360 * index) / SVF_DIRS);
  let hasPositiveTerrain = false;
  for (const value of horizon.angleDeg) {
    if (value > 1e-6) {
      hasPositiveTerrain = true;
      break;
    }
  }
  if (!hasPositiveTerrain) return skyViewFactorNoTerrain(dsm, grid, receiver);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const index = row * grid.cols + col;
      if (receiver[index] === 0 || !Number.isFinite(dsm[index])) continue;
      const observer = dsm[index] + SVF_EYE_M;
      let blockedSquareSinSum = 0;
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      const y = grid.y0 + (row + 0.5) * grid.cellM;
      for (let directionIndex = 0; directionIndex < SVF_DIRS; directionIndex += 1) {
        let highestSlope = 0;
        const ray = rays[directionIndex];
        for (let sampleIndex = 0; sampleIndex < ray.distances.length; sampleIndex += 1) {
          const sampleCol = col + ray.colOffsets[sampleIndex];
          const sampleRow = row + ray.rowOffsets[sampleIndex];
          if (sampleCol < 0 || sampleCol >= grid.cols || sampleRow < 0 || sampleRow >= grid.rows) break;
          const elevation = dsm[index + ray.rowOffsets[sampleIndex] * grid.cols + ray.colOffsets[sampleIndex]];
          if (!Number.isFinite(elevation)) continue;
          const slope = (elevation - observer) * ray.inverseDistances[sampleIndex];
          if (slope > highestSlope) highestSlope = slope;
        }
        let sine = highestSlope / Math.sqrt(1 + highestSlope * highestSlope);
        const terrainAngle = horizonAtFast(horizon, x, y, directions[directionIndex]);
        const terrainSine = Math.sin(terrainAngle * RAD);
        if (terrainSine > sine) sine = terrainSine;
        blockedSquareSinSum += sine * sine;
      }
      result[index] = Math.max(0, Math.min(1, 1 - blockedSquareSinSum / SVF_DIRS));
    }
  }
  return result;
}

function applyBuildings(state: RasterState, rows: BuildingRow[]): number {
  const obstacles = obstacleRows(rows);
  let unknownCells = 0;
  for (const obstacle of obstacles) {
    forEachCoveredCell(state.grid, obstacle, (index) => {
      state.buildingMask[index] = 1;
      state.receiver[index] = 0;
      if (obstacle.heightM === null) {
        unknownCells += 1;
        return;
      }
      if (obstacle.heightM > state.dsm[index] - state.ground[index]) {
        // dsm initially equals the ground. Keep the highest roof when an
        // overlapping source polygon is encountered.
        state.dsm[index] = state.ground[index] + obstacle.heightM;
      }
    });
  }
  return unknownCells;
}

function applyCanopy(state: RasterState, canopy: number[][][][] | null): void {
  if (!canopy || canopy.length === 0) return;
  for (const parts of canopy) {
    const bounds = boundsForRings(parts);
    if (!bounds) continue;
    const obstacle: Obstacle = { rings: parts, bounds, heightM: CANOPY_ASSUMED_HEIGHT_M };
    forEachCoveredCell(state.grid, obstacle, (index) => {
      if (state.buildingMask[index] !== 0 || !Number.isFinite(state.ground[index])) return;
      const ground = state.ground[index];
      state.dsm[index] = Math.max(state.dsm[index], ground + CANOPY_ASSUMED_HEIGHT_M);
    });
  }
}

function terrainFor(ctx: EngineContext, reader: NonNullable<ReturnType<typeof demReader>>): HorizonMap {
  const [cx, cy] = toUtmk(ctx.input.center);
  // The DEM is a 30m product. A 30m local cache keeps the horizon scan from
  // issuing millions of repeated SQLite interpolation queries at every ray
  // sample while preserving the DEM's native spatial detail.
  const terrainGrid = localGrid(
    ctx.input.center,
    SVF_HORIZON_SEARCH_M + SVF_HORIZON_CELL_M,
    SVF_HORIZON_CELL_M,
    (x, y, lng, lat) => reader.elevation(lng, lat),
  );
  return terrainHorizon(
    (x, y) => coarseSample(terrainGrid, x, y),
    {
      minX: cx - ctx.input.radiusM,
      minY: cy - ctx.input.radiusM,
      maxX: cx + ctx.input.radiusM,
      maxY: cy + ctx.input.radiusM,
    },
    { cellM: SVF_HORIZON_CELL_M, azimuths: SVF_HORIZON_AZIMUTHS, searchM: SVF_HORIZON_SEARCH_M },
  );
}

/** 한 분석 안에서 bare/canopy DSM을 각각 한 번만 계산한다. */
export function svfFor(ctx: EngineContext, canopy: number[][][][] | null): SvfShared | null {
  const memoKey = `svf:${canopy === null ? "bare" : "canopy"}`;
  return ctx.memo(memoKey, () => {
    const rows = buildingRows(ctx, Math.min(5000, ctx.input.radiusM + SVF_MAX_DIST_M + SVF_CELL_M));
    const reader = demReader(ctx);
    if (rows === null || !reader) return null;

    const base = domainGrid(ctx, reader);
    const state: RasterState = { ...base, buildingMask: new Uint8Array(base.dsm.length) };
    applyBuildings(state, rows);
    applyCanopy(state, canopy);
    state.grid.values = Float64Array.from(state.dsm);
    const horizon = terrainFor(ctx, reader);
    const svf = skyViewFactorFast(state.dsm, state.grid, state.receiver, horizon);
    return { grid: state.grid, svf };
  });
}
