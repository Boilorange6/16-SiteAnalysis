import {
  D3Q19_OPPOSITE,
  D3Q19_VELOCITIES,
  D3Q19_WEIGHTS,
  type Lbm3dCase,
} from "./plan";

export interface Lbm3dLayer {
  zM: number;
  u: Float32Array;
  v: Float32Array;
}

export interface Lbm3dField {
  cellM: number;
  nx: number;
  ny: number;
  layers: Lbm3dLayer[];
  steps: number;
  elapsedMs: number;
  adapter: string;
  precision: "f16" | "f32";
  mlups: number;
  residual: number;
}

export interface CpuRunOptions {
  onProgress?: (p: { step: number; steps: number; mlups: number; elapsedMs: number }) => void;
  signal?: AbortSignal;
}

const Q = D3Q19_VELOCITIES.length;
const AVERAGE_EVERY = 64;
const MIN_TAU = 0.51;
const MAX_TAU = 3;
const GROUND_PROFILE_WALL_FACTOR = 0.9;

function cellIndex(x: number, y: number, z: number, nx: number, ny: number): number {
  return x + nx * (y + ny * z);
}

function assertCase(c: Lbm3dCase): void {
  const dimensions: Array<[string, number]> = [["nx", c.nx], ["ny", c.ny], ["nz", c.nz], ["steps", c.steps]];
  for (const [name, value] of dimensions) {
    if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  if (!Number.isFinite(c.cellM) || c.cellM <= 0) throw new RangeError("cellM must be positive");
  if (!Number.isFinite(c.uLattice) || c.uLattice <= 0 || c.uLattice >= 0.3) throw new RangeError("uLattice must be in (0, 0.3)");
  if (!Number.isFinite(c.profileAlpha) || c.profileAlpha < 0) throw new RangeError("profileAlpha must be non-negative");
  if (!Number.isFinite(c.zRefM) || c.zRefM <= 0) throw new RangeError("zRefM must be positive");
  if (!Number.isFinite(c.cs) || c.cs < 0) throw new RangeError("cs must be non-negative");
  if (!Number.isFinite(c.tau0) || c.tau0 <= 0.5) throw new RangeError("tau0 must be greater than 0.5");
  if (c.solid.length !== c.nx * c.ny * c.nz) throw new RangeError("solid length must equal nx * ny * nz");
  if (c.averageFrom < 0 || !Number.isFinite(c.averageFrom)) throw new RangeError("averageFrom must be non-negative");
}

export function inflowProfile(c: Pick<Lbm3dCase, "cellM" | "uLattice" | "profileAlpha" | "zRefM">, z: number): number {
  const zM = (z + 0.5) * c.cellM;
  const normalizedHeight = Math.max(0.05, zM / c.zRefM);
  return c.uLattice * normalizedHeight ** c.profileAlpha;
}

export function equilibriumDistribution(q: number, rho: number, ux: number, uy: number, uz: number): number {
  const [cx, cy, cz] = D3Q19_VELOCITIES[q];
  const cu = cx * ux + cy * uy + cz * uz;
  const speedSq = ux * ux + uy * uy + uz * uz;
  return D3Q19_WEIGHTS[q] * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * speedSq);
}

function f32(value: number): number {
  return Math.fround(Number.isFinite(value) ? value : 0);
}

function makeState(c: Lbm3dCase): Float32Array {
  const cells = c.nx * c.ny * c.nz;
  const state = new Float32Array(Q * cells);
  for (let z = 0; z < c.nz; z++) {
    const ux = inflowProfile(c, z);
    for (let y = 0; y < c.ny; y++) {
      for (let x = 0; x < c.nx; x++) {
        const i = cellIndex(x, y, z, c.nx, c.ny);
        const rho = c.solid[i] ? 1 : 1;
        const localUx = c.solid[i] ? 0 : ux;
        for (let q = 0; q < Q; q++) state[q * cells + i] = f32(equilibriumDistribution(q, rho, localUx, 0, 0));
      }
    }
  }
  return state;
}

function abortIfRequested(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const error = new Error("D3Q19 CPU reference run aborted");
  error.name = "AbortError";
  throw error;
}

function outputLayers(c: Lbm3dCase, u: Float32Array, v: Float32Array, fallbackU: Float32Array, fallbackV: Float32Array, sampleCount: number): Lbm3dLayer[] {
  const sourceU = sampleCount > 0 ? u : fallbackU;
  const sourceV = sampleCount > 0 ? v : fallbackV;
  const layers: Lbm3dLayer[] = [];
  for (const zM of c.layersZm) {
    const requested = Math.round(zM / c.cellM - 0.5);
    const z = Math.min(c.nz - 1, Math.max(0, requested));
    const layerU = new Float32Array(c.nx * c.ny);
    const layerV = new Float32Array(c.nx * c.ny);
    for (let y = 0; y < c.ny; y++) {
      for (let x = 0; x < c.nx; x++) {
        const xy = x + c.nx * y;
        const i = cellIndex(x, y, z, c.nx, c.ny);
        if (c.solid[i]) {
          layerU[xy] = Number.NaN;
          layerV[xy] = Number.NaN;
        } else {
          layerU[xy] = sourceU[i];
          layerV[xy] = sourceV[i];
        }
      }
    }
    layers.push({ zM, u: layerU, v: layerV });
  }
  return layers;
}

/**
 * WebGPU 커널과 같은 D3Q19 pull-streaming + BGK/Smagorinsky 참조 구현.
 * 의도적으로 작은 격자용이다. 실제 반경 800 m 계산은 runLbm3d()로
 * 브라우저 GPU에서 실행한다.
 */
export function runCpuReference(c: Lbm3dCase, options: CpuRunOptions = {}): Lbm3dField {
  assertCase(c);
  const cells = c.nx * c.ny * c.nz;
  if (cells > 2_000_000) throw new RangeError("CPU reference is limited to 2,000,000 cells");
  const started = globalThis.performance?.now() ?? Date.now();
  let input: Float32Array<ArrayBufferLike> = makeState(c);
  let output: Float32Array<ArrayBufferLike> = new Float32Array(input.length);
  const avgU = new Float32Array(cells);
  const avgV = new Float32Array(cells);
  const lastU = new Float32Array(cells);
  const lastV = new Float32Array(cells);
  const averageFrom = Math.min(Math.max(0, Math.floor(c.averageFrom)), Math.max(0, c.steps - 1));
  let averageSamples = 0;
  let residual = 0;

  for (let step = 0; step < c.steps; step++) {
    abortIfRequested(options.signal);
    residual = 0;
    for (let z = 0; z < c.nz; z++) {
      for (let y = 0; y < c.ny; y++) {
        for (let x = 0; x < c.nx; x++) {
          const i = cellIndex(x, y, z, c.nx, c.ny);
          if (c.solid[i]) {
            for (let q = 0; q < Q; q++) output[q * cells + i] = 0;
            lastU[i] = 0;
            lastV[i] = 0;
            continue;
          }

          const incoming = new Array<number>(Q);
          for (let q = 0; q < Q; q++) {
            const [cx, cy, cz] = D3Q19_VELOCITIES[q];
            const sx = x - cx;
            const sy = y - cy;
            const sz = z - cz;
            if (sx < 0 || sx >= c.nx || sy < 0 || sy >= c.ny || sz < 0 || sz >= c.nz) {
              if (sx < 0 && cx > 0) {
                incoming[q] = equilibriumDistribution(q, 1, inflowProfile(c, z), 0, 0);
              } else if (sx >= c.nx && cx < 0) {
                // Convective/zero-gradient outlet.
                incoming[q] = input[q * cells + i];
              } else {
                // Free-slip side/top and ground-adjacent halfway bounce-back.
                incoming[q] = input[D3Q19_OPPOSITE[q] * cells + i];
              }
            } else {
              const neighbor = cellIndex(sx, sy, sz, c.nx, c.ny);
              if (c.solid[neighbor]) {
                const bounced = input[D3Q19_OPPOSITE[q] * cells + i];
                // Halfway bounce-back with the atmospheric inlet profile as
                // a tangential wall correction at z=0. It prevents the first
                // fluid layer from losing the prescribed power-law inflow;
                // building faces remain stationary bounce-back walls.
                const ground = sz === 0;
                incoming[q] = ground ? bounced + GROUND_PROFILE_WALL_FACTOR * 6 * D3Q19_WEIGHTS[q] * inflowProfile(c, z) * cx : bounced;
              } else {
                incoming[q] = input[q * cells + neighbor];
              }
            }
          }

          let rho = 0;
          let ux = 0;
          let uy = 0;
          let uz = 0;
          for (let q = 0; q < Q; q++) {
            rho += incoming[q];
            ux += incoming[q] * D3Q19_VELOCITIES[q][0];
            uy += incoming[q] * D3Q19_VELOCITIES[q][1];
            uz += incoming[q] * D3Q19_VELOCITIES[q][2];
          }
          if (!(rho > 1e-8) || !Number.isFinite(rho)) {
            rho = 1;
            ux = inflowProfile(c, z);
            uy = 0;
            uz = 0;
          } else {
            ux /= rho;
            uy /= rho;
            uz /= rho;
          }
          const speedSq = ux * ux + uy * uy + uz * uz;
          if (speedSq > 0.09) {
            const scale = 0.3 / Math.sqrt(speedSq);
            ux *= scale;
            uy *= scale;
            uz *= scale;
          }
          const uIn = inflowProfile(c, z);
          const equilibrium = new Array<number>(Q);
          let nonEquilibriumNorm = 0;
          for (let q = 0; q < Q; q++) {
            equilibrium[q] = equilibriumDistribution(q, rho, ux, uy, uz);
            const delta = incoming[q] - equilibrium[q];
            nonEquilibriumNorm += (delta * delta) / Math.max(D3Q19_WEIGHTS[q], 1e-6);
          }
          const stress = Math.sqrt(Math.max(0, nonEquilibriumNorm));
          const tauEff = Math.min(MAX_TAU, Math.max(MIN_TAU, 0.5 * (c.tau0 + Math.sqrt(c.tau0 * c.tau0 + 18 * c.cs * c.cs * stress))));
          const sponge = x >= c.nx * 0.9 ? Math.min(1, (x - c.nx * 0.9) / Math.max(1, c.nx * 0.1)) : 0;
          const spongeUx = uIn;
          for (let q = 0; q < Q; q++) {
            let post = incoming[q] - (incoming[q] - equilibrium[q]) / tauEff;
            if (sponge > 0) post = post * (1 - sponge * 0.08) + equilibriumDistribution(q, rho, spongeUx, 0, 0) * sponge * 0.08;
            // A full equilibrium inlet keeps the small reference channel
            // deterministic and avoids a density drift from a partial
            // Zou-He reconstruction. The pull boundary above still handles
            // the first-cell incoming populations explicitly.
            if (x === 0) post = equilibriumDistribution(q, 1, uIn, 0, 0);
            const stored = f32(post);
            output[q * cells + i] = stored;
            residual = Math.max(residual, Math.abs(stored - f32(incoming[q])));
          }
          const normalizedU = f32(x === 0 ? 1 : ux / Math.max(uIn, 1e-6));
          const normalizedV = f32(x === 0 ? 0 : uy / Math.max(uIn, 1e-6));
          lastU[i] = normalizedU;
          lastV[i] = normalizedV;
          if (step >= averageFrom && step % AVERAGE_EVERY === 0) {
            avgU[i] = f32(avgU[i] + normalizedU);
            avgV[i] = f32(avgV[i] + normalizedV);
          }
        }
      }
    }
    if (step >= averageFrom && step % AVERAGE_EVERY === 0) averageSamples++;
    const elapsedMs = (globalThis.performance?.now() ?? Date.now()) - started;
    options.onProgress?.({
      step: step + 1,
      steps: c.steps,
      mlups: ((cells * (step + 1)) / Math.max(elapsedMs, 0.001)) / 1000,
      elapsedMs,
    });
    const next = input;
    input = output;
    output = next;
  }

  if (averageSamples > 0) {
    for (let i = 0; i < cells; i++) {
      avgU[i] = f32(avgU[i] / averageSamples);
      avgV[i] = f32(avgV[i] / averageSamples);
    }
  }
  const elapsedMs = (globalThis.performance?.now() ?? Date.now()) - started;
  return {
    cellM: c.cellM,
    nx: c.nx,
    ny: c.ny,
    layers: outputLayers(c, avgU, avgV, lastU, lastV, averageSamples),
    steps: c.steps,
    elapsedMs,
    adapter: "cpu-reference",
    precision: "f32",
    mlups: ((cells * c.steps) / Math.max(elapsedMs, 0.001)) / 1000,
    residual,
  };
}

export const runLbm3dCpu = runCpuReference;
export const cpuReference = runCpuReference;
