/**
 * D3Q19 격자 계획과 지형/건물 높이의 voxel 변환.
 *
 * 격자의 x축은 바람이 불어가는 방향이고, y축은 횡방향, z축은 위쪽이다.
 * solid는 x + nx * (y + ny * z) 순서이며 z=0은 항상 지면으로 채운다.
 */

export const D3Q19_VELOCITIES = [
  [0, 0, 0],
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0],
  [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1],
  [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1],
] as const satisfies readonly (readonly [number, number, number])[];

export const D3Q19_WEIGHTS = [
  1 / 3,
  1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18, 1 / 18,
  1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36,
  1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36, 1 / 36,
] as const;

export const D3Q19_OPPOSITE = [
  0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17,
] as const;

export interface Lbm3dCase {
  nx: number;
  ny: number;
  nz: number;
  cellM: number;
  solid: Uint8Array;
  uLattice: number;
  profileAlpha: number;
  zRefM: number;
  cs: number;
  tau0: number;
  steps: number;
  averageFrom: number;
  layersZm: number[];
}
export interface Lbm3dPlanLimits {
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
}

export interface Lbm3dGridPlan {
  cellM: number;
  nx: number;
  ny: number;
  nz: number;
  bytes: number;
  reason: string | null;
}

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  cellM: number;
}

const DISTRIBUTION_COUNT = D3Q19_VELOCITIES.length;
const STATE_BUFFERS = 2;
const DEFAULT_CELL_M = 4;
const MIN_CELL_M = 5;
const MIN_BUFFER_M = 100;
const MAX_DEFAULT_BUFFER_M = 200;
const BYTES_PER_MB = 1024 ** 2;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function positiveInt(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function gridBytes(nx: number, ny: number, nz: number, bytesPerValue: number): number {
  return nx * ny * nz * DISTRIBUTION_COUNT * STATE_BUFFERS * bytesPerValue;
}

/**
 * WebGPU D3Q19에 필요한 분포 버퍼 크기를 계산한다.
 *
 * 제한을 넘을 때는 계획서의 순서대로 buffer 200→100 m, 높이 상한, cellM
 * 5 m를 적용한다. 어떤 단계에서 줄였는지는 reason에 남겨 조용한 품질
 * 저하가 일어나지 않게 한다. bytes는 19방향 x 2 ping-pong 상태 버퍼만
 * 포함한다(solid/평균/유니폼은 수 MB 이하의 부가 버퍼다).
 */
export function planGrid(p: {
  radiusM: number;
  bufferM: number;
  maxObstacleM: number;
  limits: Lbm3dPlanLimits;
  f16: boolean;
}): Lbm3dGridPlan {
  if (!Number.isFinite(p.radiusM) || p.radiusM <= 0) throw new RangeError("radiusM must be positive");
  if (!Number.isFinite(p.bufferM) || p.bufferM < 0) throw new RangeError("bufferM must be non-negative");
  if (!Number.isFinite(p.maxObstacleM) || p.maxObstacleM < 0) throw new RangeError("maxObstacleM must be non-negative");
  if (!Number.isFinite(p.limits.maxBufferSize) || p.limits.maxBufferSize <= 0) throw new RangeError("maxBufferSize must be positive");
  if (!Number.isFinite(p.limits.maxStorageBufferBindingSize) || p.limits.maxStorageBufferBindingSize <= 0) {
    throw new RangeError("maxStorageBufferBindingSize must be positive");
  }

  const bytesPerValue = p.f16 ? 2 : 4;
  const requestedHeightM = clamp(2.5 * p.maxObstacleM, 60, 160);
  const reasons: string[] = [];
  let cellM = DEFAULT_CELL_M;
  let bufferM = Math.min(p.bufferM, MAX_DEFAULT_BUFFER_M);
  let heightM = requestedHeightM;

  const calculate = () => {
    const nx = Math.max(1, Math.ceil((2 * (p.radiusM + bufferM)) / cellM));
    const ny = nx;
    const nz = Math.max(1, Math.ceil(heightM / cellM));
    const bytes = gridBytes(nx, ny, nz, bytesPerValue);
    // Directional SoA groups keep an individual binding to one direction. The
    // host may split these directions further, so this is intentionally not
    // the whole-state byte count.
    const oneDirectionBytes = nx * ny * nz * bytesPerValue;
    return { nx, ny, nz, bytes, oneDirectionBytes };
  };

  let result = calculate();
  const exceeds = () => result.bytes > p.limits.maxBufferSize || result.oneDirectionBytes > p.limits.maxStorageBufferBindingSize;

  if (exceeds() && bufferM > MIN_BUFFER_M) {
    const before = bufferM;
    bufferM = MIN_BUFFER_M;
    reasons.push(`buffer ${before}m→${bufferM}m`);
    result = calculate();
  }

  if (exceeds()) {
    const maxNzByBuffer = Math.floor(p.limits.maxBufferSize / (result.nx * result.ny * DISTRIBUTION_COUNT * STATE_BUFFERS * bytesPerValue));
    const maxNzByBinding = Math.floor(p.limits.maxStorageBufferBindingSize / (result.nx * result.ny * bytesPerValue));
    const allowedNz = Math.max(1, Math.min(result.nz, maxNzByBuffer || 1, maxNzByBinding || result.nz));
    if (allowedNz < result.nz) {
      const oldNz = result.nz;
      heightM = Math.max(cellM, allowedNz * cellM);
      reasons.push(`height cap ${oldNz}→${allowedNz} cells`);
      result = calculate();
    }
  }

  if (exceeds() && cellM < MIN_CELL_M) {
    const oldCellM = cellM;
    cellM = MIN_CELL_M;
    heightM = requestedHeightM;
    reasons.push(`cellM ${oldCellM}m→${cellM}m`);
    result = calculate();
  }

  // A very small adapter limit can still be impossible after the prescribed
  // reductions. Keep the requested plan visible and report the remaining
  // limitation rather than silently making a fourth quality trade-off.
  if (exceeds()) {
    reasons.push(`remaining limit: ${result.bytes} bytes exceeds adapter budget`);
  }

  return {
    cellM,
    nx: result.nx,
    ny: result.ny,
    nz: result.nz,
    bytes: result.bytes,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
  };
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function sourceIndexForWindFrame(x: number, y: number, nx: number, ny: number, fromDeg: number): [number, number] {
  // Source height grids are east (x) by north (y). Rotate their coordinates
  // into a frame whose +x points downwind. Nearest-cell sampling is exact for
  // the cardinal rotations used by the engine and deterministic otherwise.
  const sourceCx = (nx - 1) / 2;
  const sourceCy = (ny - 1) / 2;
  const targetX = x - sourceCx;
  const targetY = y - sourceCy;
  const from = (normalizeDegrees(fromDeg) * Math.PI) / 180;
  const flowX = -Math.sin(from);
  const flowY = -Math.cos(from);
  const crossX = Math.cos(from);
  const crossY = -Math.sin(from);
  const east = flowX * targetX + crossX * targetY + sourceCx;
  const north = flowY * targetX + crossY * targetY + sourceCy;
  return [Math.round(east), Math.round(north)];
}

/**
 * 북쪽 정렬된 높이(10 cm 단위)를 바람 정렬 3D solid mask로 바꾼다.
 * 높이 그리드는 nx*ny이며, height=0인 셀도 z=0 지면은 solid다.
 */
export function voxelize(heightDm: Uint16Array, grid: VoxelGrid, inflowFromDeg: number, plan: Pick<Lbm3dGridPlan, "cellM" | "nx" | "ny" | "nz">): Uint8Array {
  positiveInt(grid.nx, "grid.nx");
  positiveInt(grid.ny, "grid.ny");
  positiveInt(grid.nz, "grid.nz");
  if (!Number.isFinite(grid.cellM) || grid.cellM <= 0) throw new RangeError("grid.cellM must be positive");
  if (heightDm.length !== grid.nx * grid.ny) throw new RangeError("heightDm length must equal grid.nx * grid.ny");
  if (plan.nx !== grid.nx || plan.ny !== grid.ny || plan.nz !== grid.nz) throw new RangeError("grid and plan dimensions must match");
  if (!Number.isFinite(inflowFromDeg)) throw new RangeError("inflowFromDeg must be finite");

  const solid = new Uint8Array(grid.nx * grid.ny * grid.nz);
  for (let z = 0; z < grid.nz; z++) {
    const zCenterM = (z + 0.5) * plan.cellM;
    for (let y = 0; y < grid.ny; y++) {
      for (let x = 0; x < grid.nx; x++) {
        const i = x + grid.nx * (y + grid.ny * z);
        if (z === 0) {
          solid[i] = 1;
          continue;
        }
        const [sx, sy] = sourceIndexForWindFrame(x, y, grid.nx, grid.ny, inflowFromDeg);
        if (sx < 0 || sx >= grid.nx || sy < 0 || sy >= grid.ny) continue;
        const heightM = heightDm[sx + grid.nx * sy] / 10;
        if (zCenterM <= heightM) solid[i] = 1;
      }
    }
  }
  return solid;
}
