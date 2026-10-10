/**
 * 하늘열림(SVF) 광선 커널과 그 worker 병렬 실행. 무거운 엔진 모듈을 import하지 않아 worker 기동이 가볍다.
 */
import { availableParallelism } from "node:os";
import { isMainThread, Worker, workerData } from "node:worker_threads";
import type { LocalGrid } from "../engine/tiles/raster-grid";
import type { HorizonMap } from "./horizon";
import { workerExecArgv } from "./sun-field";

export const SVF_DIRS = 32;
export const SVF_MAX_DIST_M = 300;
export const SVF_EYE_M = 1.1;
const RAD = Math.PI / 180;

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

function obstacleIntegral(mask: Uint8Array, cols: number, rows: number): Uint32Array {
  const stride = cols + 1;
  const sums = new Uint32Array((rows + 1) * stride);
  for (let row = 0; row < rows; row += 1) {
    let rowSum = 0;
    const source = row * cols;
    const current = (row + 1) * stride;
    const previous = row * stride;
    for (let col = 0; col < cols; col += 1) {
      rowSum += mask[source + col];
      sums[current + col + 1] = sums[previous + col + 1] + rowSum;
    }
  }
  return sums;
}

function hasObstacleNear(integral: Uint32Array, cols: number, rows: number, col: number, row: number, radiusCells: number): boolean {
  const stride = cols + 1;
  const col0 = Math.max(0, col - radiusCells);
  const col1 = Math.min(cols - 1, col + radiusCells);
  const row0 = Math.max(0, row - radiusCells);
  const row1 = Math.min(rows - 1, row + radiusCells);
  const total = integral[(row1 + 1) * stride + col1 + 1]
    - integral[row0 * stride + col1 + 1]
    - integral[(row1 + 1) * stride + col0]
    + integral[row0 * stride + col0];
  return total !== 0;
}

/** T11 skyViewFactor의 결정적 계산을 유지하되 horizonAt의 반복 검증을 제거한 worker용 경로. */
interface Stripe {
  index: number;
  count: number;
}
/** Parallel workers take interleaved blocks of rows so the circle's cheap top/bottom rows balance out. */
const STRIPE_ROWS = 8;
const skipRow = (stripe: Stripe | undefined, row: number): boolean => stripe !== undefined && Math.floor(row / STRIPE_ROWS) % stripe.count !== stripe.index;

function skyViewFactorNoTerrain(dsm: Float32Array, grid: LocalGrid, receiver: Uint8Array, obstacleMask: Uint8Array, out?: Float32Array, stripe?: Stripe): Float32Array {
  const result = out ?? new Float32Array(dsm.length);
  if (!out) result.fill(Number.NaN);
  const rays = raySamples(grid.cellM, SVF_MAX_DIST_M, SVF_DIRS);
  const integral = obstacleIntegral(obstacleMask, grid.cols, grid.rows);
  const radiusCells = Math.ceil(SVF_MAX_DIST_M / grid.cellM);
  const interiorStart = radiusCells;
  const interiorEndCol = grid.cols - radiusCells;
  const interiorEndRow = grid.rows - radiusCells;
  for (let row = 0; row < grid.rows; row += 1) {
    if (skipRow(stripe, row)) continue;
    for (let col = 0; col < grid.cols; col += 1) {
      const index = row * grid.cols + col;
      if (receiver[index] === 0 || !Number.isFinite(dsm[index])) continue;
      if (!hasObstacleNear(integral, grid.cols, grid.rows, col, row, radiusCells)) {
        result[index] = 1;
        continue;
      }
      const observer = dsm[index] + SVF_EYE_M;
      let blockedSquareSinSum = 0;
      const interior = col >= interiorStart && col < interiorEndCol && row >= interiorStart && row < interiorEndRow;
      for (let directionIndex = 0; directionIndex < SVF_DIRS; directionIndex += 1) {
        let highestSlope = 0;
        const ray = rays[directionIndex];
        if (interior) {
          for (let sampleIndex = 0; sampleIndex < ray.distances.length; sampleIndex += 1) {
            const elevation = dsm[index + ray.rowOffsets[sampleIndex] * grid.cols + ray.colOffsets[sampleIndex]];
            if (!Number.isFinite(elevation)) continue;
            const slope = (elevation - observer) * ray.inverseDistances[sampleIndex];
            if (slope > highestSlope) highestSlope = slope;
          }
        } else {
          for (let sampleIndex = 0; sampleIndex < ray.distances.length; sampleIndex += 1) {
            const sampleCol = col + ray.colOffsets[sampleIndex];
            const sampleRow = row + ray.rowOffsets[sampleIndex];
            if (sampleCol < 0 || sampleCol >= grid.cols || sampleRow < 0 || sampleRow >= grid.rows) break;
            const elevation = dsm[index + ray.rowOffsets[sampleIndex] * grid.cols + ray.colOffsets[sampleIndex]];
            if (!Number.isFinite(elevation)) continue;
            const slope = (elevation - observer) * ray.inverseDistances[sampleIndex];
            if (slope > highestSlope) highestSlope = slope;
          }
        }
        blockedSquareSinSum += (highestSlope * highestSlope) / (1 + highestSlope * highestSlope);
      }
      result[index] = Math.max(0, Math.min(1, 1 - blockedSquareSinSum / SVF_DIRS));
    }
  }
  return result;
}

function hasPositiveTerrainIn(horizon: HorizonMap): boolean {
  for (const value of horizon.angleDeg) if (value > 1e-6) return true;
  return false;
}

function skyViewFactorFast(dsm: Float32Array, grid: LocalGrid, receiver: Uint8Array, obstacleMask: Uint8Array, horizon: HorizonMap, out?: Float32Array, stripe?: Stripe): Float32Array {
  if (!hasPositiveTerrainIn(horizon)) return skyViewFactorNoTerrain(dsm, grid, receiver, obstacleMask, out, stripe);
  const result = out ?? new Float32Array(dsm.length);
  if (!out) result.fill(Number.NaN);
  const rays = raySamples(grid.cellM, SVF_MAX_DIST_M, SVF_DIRS);
  const directions = Array.from({ length: SVF_DIRS }, (_, index) => (360 * index) / SVF_DIRS);
  const radiusCells = Math.ceil(SVF_MAX_DIST_M / grid.cellM);
  const interiorStart = radiusCells;
  const interiorEndCol = grid.cols - radiusCells;
  const interiorEndRow = grid.rows - radiusCells;
  for (let row = 0; row < grid.rows; row += 1) {
    if (skipRow(stripe, row)) continue;
    for (let col = 0; col < grid.cols; col += 1) {
      const index = row * grid.cols + col;
      if (receiver[index] === 0 || !Number.isFinite(dsm[index])) continue;
      const observer = dsm[index] + SVF_EYE_M;
      let blockedSquareSinSum = 0;
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      const y = grid.y0 + (row + 0.5) * grid.cellM;
      const interior = col >= interiorStart && col < interiorEndCol && row >= interiorStart && row < interiorEndRow;
      for (let directionIndex = 0; directionIndex < SVF_DIRS; directionIndex += 1) {
        let highestSlope = 0;
        const ray = rays[directionIndex];
        if (interior) {
          for (let sampleIndex = 0; sampleIndex < ray.distances.length; sampleIndex += 1) {
            const elevation = dsm[index + ray.rowOffsets[sampleIndex] * grid.cols + ray.colOffsets[sampleIndex]];
            if (!Number.isFinite(elevation)) continue;
            const slope = (elevation - observer) * ray.inverseDistances[sampleIndex];
            if (slope > highestSlope) highestSlope = slope;
          }
        } else {
          for (let sampleIndex = 0; sampleIndex < ray.distances.length; sampleIndex += 1) {
            const sampleCol = col + ray.colOffsets[sampleIndex];
            const sampleRow = row + ray.rowOffsets[sampleIndex];
            if (sampleCol < 0 || sampleCol >= grid.cols || sampleRow < 0 || sampleRow >= grid.rows) break;
            const elevation = dsm[index + ray.rowOffsets[sampleIndex] * grid.cols + ray.colOffsets[sampleIndex]];
            if (!Number.isFinite(elevation)) continue;
            const slope = (elevation - observer) * ray.inverseDistances[sampleIndex];
            if (slope > highestSlope) highestSlope = slope;
          }
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

interface SvfWorkerPayload {
  kind: "svf";
  dsm: Float32Array;
  receiver: Uint8Array;
  obstacleMask: Uint8Array;
  result: Float32Array;
  grid: Pick<LocalGrid, "cx" | "cy" | "cellM" | "cols" | "rows" | "x0" | "y0">;
  horizon: HorizonMap;
  stripe: Stripe;
  done: Int32Array;
}

function sharedCopy<T extends Float32Array | Uint8Array>(source: T): T {
  const target = new (source.constructor as new (buffer: SharedArrayBuffer) => T)(new SharedArrayBuffer(source.byteLength));
  target.set(source as never);
  return target;
}

/**
 * Same per-cell kernel as skyViewFactorFast, run by interleaved row stripes on worker threads writing into one
 * shared result. Cells are independent, so the output is bit-identical to the serial path; any worker failure
 * (or a single-core host) falls back to the serial kernel.
 */
export function skyViewFactorParallel(dsm: Float32Array, grid: LocalGrid, receiver: Uint8Array, obstacleMask: Uint8Array, horizon: HorizonMap): Float32Array {
  const workerCount = Math.min(8, availableParallelism() - 1);
  if (workerCount < 2 || process.env.V2_SVF_SERIAL === "1") return skyViewFactorFast(dsm, grid, receiver, obstacleMask, horizon);
  const workers: Worker[] = [];
  try {
    const result = new Float32Array(new SharedArrayBuffer(dsm.byteLength));
    result.fill(Number.NaN);
    const shared = { dsm: sharedCopy(dsm), receiver: sharedCopy(receiver), obstacleMask: sharedCopy(obstacleMask) };
    const done = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    const { cx, cy, cellM, cols, rows, x0, y0 } = grid;
    for (let index = 0; index < workerCount; index += 1) {
      const payload: SvfWorkerPayload = { kind: "svf", ...shared, result, grid: { cx, cy, cellM, cols, rows, x0, y0 }, horizon, stripe: { index, count: workerCount }, done };
      workers.push(new Worker(new URL("./svf-kernel.ts", import.meta.url), { workerData: payload, execArgv: workerExecArgv() }));
    }
    const deadline = Date.now() + 120_000;
    for (let finished = Atomics.load(done, 0); finished < workerCount; finished = Atomics.load(done, 0)) {
      if (Date.now() > deadline) throw new Error("svf worker timed out");
      if (finished < 0) throw new Error("svf worker failed");
      Atomics.wait(done, 0, finished, 1000);
    }
    return result;
  } catch {
    return skyViewFactorFast(dsm, grid, receiver, obstacleMask, horizon);
  } finally {
    for (const worker of workers) void worker.terminate();
  }
}

function runSvfWorker(): void {
  const payload = workerData as SvfWorkerPayload;
  try {
    const grid = { ...payload.grid, values: new Float64Array(0) } as LocalGrid;
    skyViewFactorFast(payload.dsm, grid, payload.receiver, payload.obstacleMask, payload.horizon, payload.result, payload.stripe);
    Atomics.add(payload.done, 0, 1);
  } catch {
    Atomics.store(payload.done, 0, -1000);
  }
  Atomics.notify(payload.done, 0);
}

if (!isMainThread && workerData && typeof workerData === "object" && (workerData as { kind?: string }).kind === "svf") runSvfWorker();
