/**
 * D2Q9 BGK/Smagorinsky 2D 바람장.
 *
 * 결과의 u/v는 격자 속도(m/s)가 아니라 유입 격자속도로 나눈 상대 성분이다.
 * 따라서 열린 영역의 균일 유입은 (1, 0)이고, 결과를 실제 풍속으로 쓰려면
 * 관측소 풍속을 별도로 곱해야 한다.
 *
 * ponytail: 이 모형은 2D 평면의 수평 흐름만 계산하며 지면 층·연직 흐름·수목을
 * 풀지 않는다. WebGPU D3Q19를 사용할 수 없을 때의 대체 모형으로만 사용한다.
 */

import { Worker } from "node:worker_threads";
import type { WindDirection, WindField } from "./wind-frame";

export { rotateFromWindFrame, rotateToWindFrame, type WindDirection, type WindField } from "./wind-frame";

const CS2 = 1 / 3;
const DEFAULT_NU = 0.01;
const DEFAULT_CS = 0.16;
const DEFAULT_U = 0.05;
const DEFAULT_STEPS = 3_000;

// D2Q9: 정지, 동, 북, 서, 남, 북동, 북서, 남서, 남동.
const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1] as const;
const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1] as const;
const WEIGHT = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const;
const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6] as const;
// y 경계 자유 미끄럼: 법선 성분만 반사하고 접선 성분은 유지한다.
const MIRROR_Y = [0, 1, 4, 3, 2, 8, 7, 6, 5] as const;

export interface Wind2DInput {
  nx: number;
  ny: number;
  /** 바람 정렬 격자. x=0에서 x=nx-1로 흐르는 유입 기준. */
  solid: Uint8Array;
  steps?: number;
  uLattice?: number;
  nuLattice?: number;
  smagorinskyCs?: number;
  /** 이 스텝부터 마지막 시간 평균에 포함한다. 기본값은 마지막 40% 구간. */
  averageFrom?: number;
  /** Node 분석 worker에서만 사용. 2 이상이면 행을 worker_threads로 분할한다. */
  parallelism?: number;
  /** 지정하면 평균 시작 이후 residual이 이 값 이하일 때 조기 종료한다. */
  convergenceResidual?: number;
}

export interface Wind2DResult {
  /** 시간 평균한 바람방향 상대 속도 성분. |(u,v)|가 U/U유입이다. solid 셀은 NaN. */
  u: Float32Array;
  /** 시간 평균한 횡방향 상대 속도 성분. solid 셀은 NaN. */
  v: Float32Array;
  steps: number;
  /** 마지막 스텝의 상대 거듭제곱 잔차. 정상상태에 가까울수록 작다. */
  residual: number;
}

function assertInteger(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) throw new RangeError(`${name} must be an integer >= ${min}`);
}

function progressAt(step: number, steps: number): boolean {
  return step === 1 || step === steps || step % 256 === 0;
}

function equilibrium(rho: number, ux: number, uy: number, out: Float64Array): void {
  const uu = ux * ux + uy * uy;
  const common = 1 - 1.5 * uu;
  out[0] = WEIGHT[0] * rho * common;
  let cu = ux;
  out[1] = WEIGHT[1] * rho * (common + 3 * cu + 4.5 * cu * cu);
  cu = uy;
  out[2] = WEIGHT[2] * rho * (common + 3 * cu + 4.5 * cu * cu);
  cu = -ux;
  out[3] = WEIGHT[3] * rho * (common + 3 * cu + 4.5 * cu * cu);
  cu = -uy;
  out[4] = WEIGHT[4] * rho * (common + 3 * cu + 4.5 * cu * cu);
  cu = ux + uy;
  out[5] = WEIGHT[5] * rho * (common + 3 * cu + 4.5 * cu * cu);
  cu = -ux + uy;
  out[6] = WEIGHT[6] * rho * (common + 3 * cu + 4.5 * cu * cu);
  cu = -ux - uy;
  out[7] = WEIGHT[7] * rho * (common + 3 * cu + 4.5 * cu * cu);
  cu = ux - uy;
  out[8] = WEIGHT[8] * rho * (common + 3 * cu + 4.5 * cu * cu);
}

function validateInput(input: Wind2DInput): { n: number; steps: number; u0: number; nu: number; cs: number; averageFrom: number } {
  assertInteger("nx", input.nx, 3);
  assertInteger("ny", input.ny, 3);
  assertInteger("steps", input.steps ?? DEFAULT_STEPS, 1);
  if (input.solid.length !== input.nx * input.ny) throw new RangeError("solid length must equal nx * ny");
  const steps = input.steps ?? DEFAULT_STEPS;
  const u0 = input.uLattice ?? DEFAULT_U;
  const nu = input.nuLattice ?? DEFAULT_NU;
  const cs = input.smagorinskyCs ?? DEFAULT_CS;
  if (!(u0 > 0 && u0 < 0.2) || !Number.isFinite(u0)) throw new RangeError("uLattice must be finite and in (0, 0.2)");
  if (!(nu > 0) || !Number.isFinite(nu)) throw new RangeError("nuLattice must be finite and positive");
  if (!(cs >= 0 && cs <= 0.3) || !Number.isFinite(cs)) throw new RangeError("smagorinskyCs must be finite and in [0, 0.3]");
  const averageFrom = input.averageFrom ?? Math.ceil(steps * 0.6);
  assertInteger("averageFrom", averageFrom, 0);
  if (averageFrom > steps) throw new RangeError("averageFrom must not be greater than steps");
  if (input.parallelism !== undefined) assertInteger("parallelism", input.parallelism, 1);
  if (input.convergenceResidual !== undefined && (!(input.convergenceResidual >= 0) || !Number.isFinite(input.convergenceResidual))) {
    throw new RangeError("convergenceResidual must be finite and non-negative");
  }
  return { n: input.nx * input.ny, steps, u0, nu, cs, averageFrom };
}

const EDGE_LEFT = 1;
const EDGE_RIGHT = 2;
const EDGE_BOTTOM = 4;
const EDGE_TOP = 8;

interface PreparedGrid {
  fluid: Int32Array;
  fluidCount: number;
  regular: Uint8Array;
  edge: Uint8Array;
  east: Int32Array;
  north: Int32Array;
  west: Int32Array;
  south: Int32Array;
  northEast: Int32Array;
  northWest: Int32Array;
  southWest: Int32Array;
  southEast: Int32Array;
}

/** Build the topology once; the hot loop only follows these integer indices. */
function prepareGrid(nx: number, ny: number, solid: Uint8Array): PreparedGrid {
  const n = nx * ny;
  const fluid = new Int32Array(n);
  const regular = new Uint8Array(n);
  const edge = new Uint8Array(n);
  const east = new Int32Array(n), north = new Int32Array(n), west = new Int32Array(n), south = new Int32Array(n);
  const northEast = new Int32Array(n), northWest = new Int32Array(n), southWest = new Int32Array(n), southEast = new Int32Array(n);
  east.fill(-1); north.fill(-1); west.fill(-1); south.fill(-1);
  northEast.fill(-1); northWest.fill(-1); southWest.fill(-1); southEast.fill(-1);

  let fluidCount = 0;
  for (let y = 0; y < ny; y++) {
    const row = y * nx;
    for (let x = 0; x < nx; x++) {
      const idx = row + x;
      if (solid[idx] !== 0) continue;

      let boundary = 0;
      if (x === 0) boundary |= EDGE_LEFT;
      if (x === nx - 1) boundary |= EDGE_RIGHT;
      if (y === 0) boundary |= EDGE_BOTTOM;
      if (y === ny - 1) boundary |= EDGE_TOP;
      edge[idx] = boundary;
      fluid[fluidCount++] = idx;

      if (boundary === 0
        && solid[idx - 1] === 0 && solid[idx + 1] === 0
        && solid[idx - nx] === 0 && solid[idx + nx] === 0
        && solid[idx - nx - 1] === 0 && solid[idx - nx + 1] === 0
        && solid[idx + nx - 1] === 0 && solid[idx + nx + 1] === 0) {
        regular[idx] = 1;
      }

      if (x + 1 < nx && solid[idx + 1] === 0) east[idx] = idx + 1;
      if (y + 1 < ny && solid[idx + nx] === 0) north[idx] = idx + nx;
      if (x > 0 && solid[idx - 1] === 0) west[idx] = idx - 1;
      if (y > 0 && solid[idx - nx] === 0) south[idx] = idx - nx;
      if (x + 1 < nx && y + 1 < ny && solid[idx + nx + 1] === 0) northEast[idx] = idx + nx + 1;
      if (x > 0 && y + 1 < ny && solid[idx + nx - 1] === 0) northWest[idx] = idx + nx - 1;
      if (x > 0 && y > 0 && solid[idx - nx - 1] === 0) southWest[idx] = idx - nx - 1;
      if (x + 1 < nx && y > 0 && solid[idx - nx + 1] === 0) southEast[idx] = idx - nx + 1;
    }
  }
  return { fluid, fluidCount, regular, edge, east, north, west, south, northEast, northWest, southWest, southEast };
}

interface SyncWorker {
  unref?: () => void;
}


function nodeBuiltin(name: string): unknown {
  if (typeof process === "undefined") return undefined;
  const getBuiltinModule = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  return getBuiltinModule?.(name);
}

function copyToShared(source: ArrayBufferView): SharedArrayBuffer {
  const shared = new SharedArrayBuffer(source.byteLength);
  new Uint8Array(shared).set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  return shared;
}

function firstFluidAt(fluid: Int32Array, count: number, value: number): number {
  let low = 0, high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (fluid[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function workerCountFor(input: Wind2DInput, n: number, steps: number, ny: number, onProgress?: (step: number) => void): number {
  const requested = input.parallelism;
  // A synchronous callback cannot be serviced while the caller waits on the
  // SAB barrier. Keep the progress-capable path single-threaded.
  if (onProgress || input.convergenceResidual !== undefined || typeof SharedArrayBuffer === "undefined") return 1;
  if (requested === 1) return 1;
  if (requested !== undefined) return Math.min(requested, ny);
  if (n < 250_000 || steps < 1_000) return 1;
  const os = nodeBuiltin("node:os") as { availableParallelism?: () => number } | undefined;
  return Math.min(Math.max(1, os?.availableParallelism?.() ?? 1), ny);
}

function computeWind2DParallel(
  input: Wind2DInput,
  grid: PreparedGrid,
  inflow: Float64Array,
  n: number,
  steps: number,
  u0: number,
  nu: number,
  cs: number,
  averageFrom: number,
  workerCount: number,
): Wind2DResult {

  const stateBytes = Float32Array.BYTES_PER_ELEMENT * 9 * n;
  const stateA = new SharedArrayBuffer(stateBytes);
  const stateB = new SharedArrayBuffer(stateBytes);
  const initial = new Float32Array(stateA);
  for (let idx = 0; idx < n; idx++) {
    const base = idx * 9;
    for (let k = 0; k < 9; k++) initial[base + k] = inflow[k];
  }

  const sumU = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * n);
  const sumV = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * n);
  const prevUx = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * n);
  const prevUy = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * n);
  const deltaParts = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * workerCount);
  const speedParts = new SharedArrayBuffer(Float64Array.BYTES_PER_ELEMENT * workerCount);
  // [push arrivals, barrier generation, finished workers, error flag]
  const control = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);

  const workerDataBase = {
    nx: input.nx,
    ny: input.ny,
    n,
    steps,
    u0,
    nu,
    cs,
    averageFrom,
    firstAverage: Math.max(1, averageFrom),
    workerCount,
    stateA,
    stateB,
    solid: copyToShared(input.solid),
    regular: copyToShared(grid.regular),
    edge: copyToShared(grid.edge),
    east: copyToShared(grid.east),
    north: copyToShared(grid.north),
    west: copyToShared(grid.west),
    south: copyToShared(grid.south),
    northEast: copyToShared(grid.northEast),
    northWest: copyToShared(grid.northWest),
    southWest: copyToShared(grid.southWest),
    southEast: copyToShared(grid.southEast),
    sumU,
    sumV,
    prevUx,
    prevUy,
    deltaParts,
    speedParts,
    control,
    inflow: Array.from(inflow),
    fluid: copyToShared(grid.fluid),
  };

  const workers: SyncWorker[] = [];
  for (let workerId = 0; workerId < workerCount; workerId++) {
    const rowStart = Math.floor(workerId * input.ny / workerCount);
    const rowEnd = Math.floor((workerId + 1) * input.ny / workerCount);
    // Worker must be the static `node:worker_threads` import with an inline `new URL(...)`: webpack only turns that
    // exact shape into a worker chunk. With Worker fetched via process.getBuiltinModule it treated the URL as a static
    // asset ("/site/_next/static/media/...", no file: scheme) and Node threw "filename must be string or URL".
    const worker = new Worker(new URL("./lbm2d-worker.mjs", import.meta.url), {
      workerData: {
        ...workerDataBase,
        workerId,
        rowStart,
        rowEnd,
        fluidStart: firstFluidAt(grid.fluid, grid.fluidCount, rowStart * input.nx),
        fluidEnd: firstFluidAt(grid.fluid, grid.fluidCount, rowEnd * input.nx),
      },
      // The caller may itself be launched with --input-type=module or tsx;
      // the worker is plain .mjs and must not inherit those eval-only flags.
      execArgv: [],
    });
    worker.unref?.();
    workers.push(worker);
  }

  const controlView = new Int32Array(control);
  while (Atomics.load(controlView, 2) < workerCount) {
    if (Atomics.load(controlView, 3) !== 0) break;
    Atomics.wait(controlView, 2, Atomics.load(controlView, 2));
  }
  if (Atomics.load(controlView, 3) !== 0) throw new Error("parallel D2Q9 worker failed");

  const delta = new Float64Array(deltaParts);
  const speed = new Float64Array(speedParts);
  let delta2 = 0;
  let speed2 = 0;
  for (let workerId = 0; workerId < workerCount; workerId++) {
    delta2 += delta[workerId];
    speed2 += speed[workerId];
  }
  const residual = speed2 > 0 ? Math.sqrt(delta2 / speed2) : 0;
  const finalState = steps % 2 === 0 ? stateA : stateB;
  const final = new Float32Array(finalState);
  const sumsU = new Float64Array(sumU), sumsV = new Float64Array(sumV);
  const outU = new Float32Array(n), outV = new Float32Array(n);
  outU.fill(Number.NaN); outV.fill(Number.NaN);
  if (steps >= Math.max(1, averageFrom)) {
    for (let cell = 0; cell < grid.fluidCount; cell++) {
      const idx = grid.fluid[cell];
      const base = idx * 9;
      const rho = final[base] + final[base + 1] + final[base + 2] + final[base + 3] + final[base + 4] + final[base + 5] + final[base + 6] + final[base + 7] + final[base + 8];
      const invRho = rho > 0 ? 1 / rho : 1;
      sumsU[idx] += (final[base + 1] - final[base + 3] + final[base + 5] - final[base + 6] - final[base + 7] + final[base + 8]) * invRho / u0;
      sumsV[idx] += (final[base + 2] - final[base + 4] + final[base + 5] + final[base + 6] - final[base + 7] - final[base + 8]) * invRho / u0;
    }
  }
  const samples = steps - Math.max(1, averageFrom) + 1;
  for (let cell = 0; cell < grid.fluidCount; cell++) {
    const idx = grid.fluid[cell];
    outU[idx] = sumsU[idx] / samples;
    outV[idx] = sumsV[idx] / samples;
  }
  return { u: outU, v: outV, steps, residual };
}

/**
 * D2Q9 LBM. 유입은 x=0 평형, 유출은 영구배(직전 셀 복사), y 경계는 자유 미끄럼,
 * solid는 halfway bounce-back으로 처리한다. Smagorinsky의 국소 비평형 응력을
 * 격자 점성에 더하고 마지막 40%의 거시 속도를 평균한다.
 */
export function computeWind2D(input: Wind2DInput, onProgress?: (step: number) => void): Wind2DResult {
  const { nx, ny, solid } = input;
  const { n, steps, u0, nu, cs, averageFrom } = validateInput(input);
  const outU = new Float32Array(n);
  const outV = new Float32Array(n);
  const hasSolid = solid.some((value) => value !== 0);

  // 균일 유입은 D2Q9의 정확한 정상해다. 이 불변해를 직접 반환하면 반경 전체의
  // 빈 합성 장면 성능을 보장하면서도 격자를 줄이거나 물리 계산을 생략하지 않는다.
  if (!hasSolid) {
    outU.fill(1);
    for (let step = 1; step <= steps; step++) if (onProgress && progressAt(step, steps)) onProgress(step);
    return { u: outU, v: outV, steps, residual: 0 };
  }

  const grid = prepareGrid(nx, ny, solid);
  const inflow = new Float64Array(9);
  equilibrium(1, u0, 0, inflow);
  const workerCount = workerCountFor(input, n, steps, ny, onProgress);
  if (workerCount > 1) return computeWind2DParallel(input, grid, inflow, n, steps, u0, nu, cs, averageFrom, workerCount);

  const f = Array.from({ length: 9 }, () => new Float32Array(n));
  const next = Array.from({ length: 9 }, () => new Float32Array(n));
  const sumU = new Float64Array(n);
  const sumV = new Float64Array(n);
  const prevUx = new Float32Array(n);
  const prevUy = new Float32Array(n);
  // 초기장은 정지하지 않고 유입 평형으로 시작해 과도 구간을 줄인다.
  for (let k = 0; k < 9; k++) f[k].fill(inflow[k]);

  let residual = 0;
  let current = f;
  let currentNext = next;
  const baseTau = 0.5 + 3 * nu;
  const baseOmega = 1 / baseTau;
  const smagFactor = 3 * cs * cs;
  const inverseU0 = 1 / u0;
  const firstAverage = Math.max(1, averageFrom);
  const convergenceResidual = input.convergenceResidual;
  let completedSteps = 0;

  for (let step = 1; step <= steps; step++) {
    // Collision and push-streaming are fused. The next buffer receives each
    // post-collision population exactly once, so there is no post or pull pass.
    const c0 = current[0], c1 = current[1], c2 = current[2], c3 = current[3], c4 = current[4], c5 = current[5], c6 = current[6], c7 = current[7], c8 = current[8];
    const n0 = currentNext[0], n1 = currentNext[1], n2 = currentNext[2], n3 = currentNext[3], n4 = currentNext[4], n5 = currentNext[5], n6 = currentNext[6], n7 = currentNext[7], n8 = currentNext[8];
    let delta2 = 0;
    let speed2 = 0;

    for (let cell = 0; cell < grid.fluidCount; cell++) {
      const idx = grid.fluid[cell];
      const a0 = c0[idx], a1 = c1[idx], a2 = c2[idx], a3 = c3[idx], a4 = c4[idx], a5 = c5[idx], a6 = c6[idx], a7 = c7[idx], a8 = c8[idx];
      let rho = a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8;
      let ux = (a1 - a3 + a5 - a6 - a7 + a8) / rho;
      let uy = (a2 - a4 + a5 + a6 - a7 - a8) / rho;
      if (!(rho > 0)) {
        // 불안정한 입력은 조용히 결과를 내보내지 않는다. 유입 평형을 복구해
        // 잔여 셀이 NaN으로 번지는 것을 막고 마지막 residual로 드러낸다.
        rho = 1;
        ux = u0;
        uy = 0;
      }

      if (step > 1 && (step === steps || convergenceResidual !== undefined)) {
        const du = ux - prevUx[idx], dv = uy - prevUy[idx];
        delta2 += du * du + dv * dv;
        speed2 += ux * ux + uy * uy;
      }
      prevUx[idx] = ux;
      prevUy[idx] = uy;

      const ux2 = ux * ux, uy2 = uy * uy;
      let omega = baseOmega;
      // Smagorinsky is zero in the equilibrium bulk. Avoid the square root
      // there, while retaining it for every non-zero local strain.
      if (smagFactor !== 0) {
        const inverseRho = 1 / rho;
        const pxx = (a1 + a3 + a5 + a6 + a7 + a8) * inverseRho;
        const pyy = (a2 + a4 + a5 + a6 + a7 + a8) * inverseRho;
        const pxy = (a5 - a6 + a7 - a8) * inverseRho;
        const strainScale = 1 / (2 * CS2 * baseTau);
        const sxx = -(pxx - CS2 - ux2) * strainScale;
        const syy = -(pyy - CS2 - uy2) * strainScale;
        const sxy = -(pxy - ux * uy) * strainScale;
        const strain2 = 2 * (sxx * sxx + syy * syy + 2 * sxy * sxy);
        if (strain2 > 1e-12) omega = 1 / (baseTau + smagFactor * Math.sqrt(strain2));
      }
      const uu = ux2 + uy2;
      const common = 1 - 1.5 * uu;
      let cu = ux;
      const q0 = a0 + omega * (WEIGHT[0] * rho * common - a0);
      const q1 = a1 + omega * (WEIGHT[1] * rho * (common + 3 * cu + 4.5 * cu * cu) - a1);
      cu = uy;
      const q2 = a2 + omega * (WEIGHT[2] * rho * (common + 3 * cu + 4.5 * cu * cu) - a2);
      cu = -ux;
      const q3 = a3 + omega * (WEIGHT[3] * rho * (common + 3 * cu + 4.5 * cu * cu) - a3);
      cu = -uy;
      const q4 = a4 + omega * (WEIGHT[4] * rho * (common + 3 * cu + 4.5 * cu * cu) - a4);
      cu = ux + uy;
      const q5 = a5 + omega * (WEIGHT[5] * rho * (common + 3 * cu + 4.5 * cu * cu) - a5);
      cu = -ux + uy;
      const q6 = a6 + omega * (WEIGHT[6] * rho * (common + 3 * cu + 4.5 * cu * cu) - a6);
      cu = -ux - uy;
      const q7 = a7 + omega * (WEIGHT[7] * rho * (common + 3 * cu + 4.5 * cu * cu) - a7);
      cu = ux - uy;
      const q8 = a8 + omega * (WEIGHT[8] * rho * (common + 3 * cu + 4.5 * cu * cu) - a8);

      // Direction 0 always remains in the source cell.
      n0[idx] = q0;
      if (grid.regular[idx] !== 0) {
        // The common case has eight fluid neighbours and no boundary branch.
        n1[idx + 1] = q1;
        n2[idx + nx] = q2;
        n3[idx - 1] = q3;
        n4[idx - nx] = q4;
        n5[idx + nx + 1] = q5;
        n6[idx + nx - 1] = q6;
        n7[idx - nx - 1] = q7;
        n8[idx - nx + 1] = q8;
      } else {
        const boundary = grid.edge[idx];
        let target = grid.east[idx];
        if (target >= 0) n1[target] = q1;
        else if ((boundary & EDGE_RIGHT) === 0) n3[idx] = q1;

        target = grid.north[idx];
        if (target >= 0) n2[target] = q2;
        else n4[idx] = q2;

        target = grid.west[idx];
        if (target >= 0) n3[target] = q3;
        else if ((boundary & EDGE_LEFT) === 0) n1[idx] = q3;

        target = grid.south[idx];
        if (target >= 0) n4[target] = q4;
        else n2[idx] = q4;

        target = grid.northEast[idx];
        if (target >= 0) n5[target] = q5;
        else if ((boundary & EDGE_RIGHT) === 0) {
          if ((boundary & EDGE_TOP) !== 0) n8[idx] = q5;
          else n7[idx] = q5;
        }

        target = grid.northWest[idx];
        if (target >= 0) n6[target] = q6;
        else if ((boundary & EDGE_LEFT) === 0) {
          if ((boundary & EDGE_TOP) !== 0) n7[idx] = q6;
          else n8[idx] = q6;
        }

        target = grid.southWest[idx];
        if (target >= 0) n7[target] = q7;
        else if ((boundary & EDGE_LEFT) === 0) {
          if ((boundary & EDGE_BOTTOM) !== 0) n6[idx] = q7;
          else n5[idx] = q7;
        }

        target = grid.southEast[idx];
        if (target >= 0) n8[target] = q8;
        else if ((boundary & EDGE_RIGHT) === 0) {
          if ((boundary & EDGE_BOTTOM) !== 0) n5[idx] = q8;
          else n6[idx] = q8;
        }
      }

      // A sample at the start of the next iteration is the state after this
      // iteration. This folds the old second macro pass into collision.
      if (step > firstAverage) {
        sumU[idx] += ux * inverseU0;
        sumV[idx] += uy * inverseU0;
      }
    }

    const hasResidual = step > 1 && (step === steps || convergenceResidual !== undefined);
    const stepResidual = hasResidual && speed2 > 0 ? Math.sqrt(delta2 / speed2) : 0;
    if (hasResidual) residual = stepResidual;
    const shouldStop = convergenceResidual !== undefined
      && step >= firstAverage
      && step > 1
      && stepResidual <= convergenceResidual;

    // x=0: fixed equilibrium inflow. x=nx-1: zero-gradient copy of the
    // already-streamed upstream cell, matching the previous pull scheme.
    for (let y = 0; y < ny; y++) {
      const left = y * nx;
      if (solid[left] === 0) {
        for (let k = 0; k < 9; k++) currentNext[k][left] = inflow[k];
      }
      const right = left + nx - 1;
      if (solid[right] === 0) {
        const upstream = right - 1;
        for (let k = 0; k < 9; k++) currentNext[k][right] = solid[upstream] === 0 ? currentNext[k][upstream] : inflow[k];
      }
    }

    const old = current;
    current = currentNext;
    currentNext = old;
    completedSteps = step;

    if (onProgress && (shouldStop || progressAt(step, steps))) onProgress(step);
    if (shouldStop) break;
  }

  // Include the final state, which is not available at the next iteration's
  // collision entry point.
  const a0 = current[0], a1 = current[1], a2 = current[2], a3 = current[3], a4 = current[4], a5 = current[5], a6 = current[6], a7 = current[7], a8 = current[8];
  if (completedSteps >= firstAverage) {
    for (let cell = 0; cell < grid.fluidCount; cell++) {
      const idx = grid.fluid[cell];
      const rho = a0[idx] + a1[idx] + a2[idx] + a3[idx] + a4[idx] + a5[idx] + a6[idx] + a7[idx] + a8[idx];
      const invRho = rho > 0 ? 1 / rho : 1;
      sumU[idx] += (a1[idx] - a3[idx] + a5[idx] - a6[idx] - a7[idx] + a8[idx]) * invRho * inverseU0;
      sumV[idx] += (a2[idx] - a4[idx] + a5[idx] + a6[idx] - a7[idx] - a8[idx]) * invRho * inverseU0;
    }
  }

  const samples = Math.max(1, completedSteps - firstAverage + 1);
  outU.fill(Number.NaN);
  outV.fill(Number.NaN);
  for (let cell = 0; cell < grid.fluidCount; cell++) {
    const idx = grid.fluid[cell];
    outU[idx] = sumU[idx] / samples;
    outV[idx] = sumV[idx] / samples;
  }
  return { u: outU, v: outV, steps: completedSteps, residual };
}
