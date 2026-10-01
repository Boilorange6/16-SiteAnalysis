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

const CS2 = 1 / 3;
const RAD = Math.PI / 180;
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

export interface WindField {
  nx: number;
  ny: number;
  u: Float32Array;
  v: Float32Array;
  cellM?: number;
  originX?: number;
  originY?: number;
}

export interface WindDirection {
  /** 기상 방위각: 바람이 불어오는 방향, 북쪽=0·시계방향. */
  fromDeg?: number;
  inflowFromDeg?: number;
  directionDeg?: number;
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
  return { n: input.nx * input.ny, steps, u0, nu, cs, averageFrom };
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

  const f = Array.from({ length: 9 }, () => new Float32Array(n));
  const post = Array.from({ length: 9 }, () => new Float32Array(n));
  const next = Array.from({ length: 9 }, () => new Float32Array(n));
  const sumU = new Float64Array(n);
  const sumV = new Float64Array(n);
  const prevUx = new Float32Array(n);
  const prevUy = new Float32Array(n);
  const inflow = new Float64Array(9);
  equilibrium(1, u0, 0, inflow);

  // 초기장은 정지하지 않고 유입 평형으로 시작해 과도 구간을 줄인다.
  for (let k = 0; k < 9; k++) f[k].fill(inflow[k]);

  let residual = 0;
  let current = f;
  const currentPost = post;
  let currentNext = next;

  for (let step = 1; step <= steps; step++) {
    // current*를 고정 배열 변수에 다시 연결한다. 배열 swap 뒤에도 inner loop가
    // 동적 2차원 접근을 하지 않도록 한다.
    const c0 = current[0], c1 = current[1], c2 = current[2], c3 = current[3], c4 = current[4], c5 = current[5], c6 = current[6], c7 = current[7], c8 = current[8];
    const q0 = currentPost[0], q1 = currentPost[1], q2 = currentPost[2], q3 = currentPost[3], q4 = currentPost[4], q5 = currentPost[5], q6 = currentPost[6], q7 = currentPost[7], q8 = currentPost[8];
    let delta2 = 0;
    let speed2 = 0;

    for (let idx = 0; idx < n; idx++) {
      if (solid[idx] !== 0) continue;
      const a0 = c0[idx], a1 = c1[idx], a2 = c2[idx], a3 = c3[idx], a4 = c4[idx], a5 = c5[idx], a6 = c6[idx], a7 = c7[idx], a8 = c8[idx];
      let rho = a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8;
      let ux = (a1 - a3 + a5 - a6 - a7 + a8) / rho;
      let uy = (a2 - a4 + a5 + a6 - a7 - a8) / rho;
      if (!(rho > 0) || !Number.isFinite(rho) || !Number.isFinite(ux) || !Number.isFinite(uy)) {
        // 불안정한 입력은 조용히 결과를 내보내지 않는다. 유입 평형을 복구해
        // 잔여 셀이 NaN으로 번지는 것을 막고 마지막 residual로 드러낸다.
        rho = 1;
        ux = u0;
        uy = 0;
      }

      if (step > 1) {
        const du = ux - prevUx[idx], dv = uy - prevUy[idx];
        delta2 += du * du + dv * dv;
        speed2 += ux * ux + uy * uy;
      }
      prevUx[idx] = ux;
      prevUy[idx] = uy;

      // 비평형 운동량 텐서로 국소 strain rate를 추정한다.
      const pxx = a1 + a3 + a5 + a6 + a7 + a8;
      const pyy = a2 + a4 + a5 + a6 + a7 + a8;
      const pxy = a5 - a6 + a7 - a8;
      const ux2 = ux * ux, uy2 = uy * uy;
      const sxx = -(pxx - rho * (CS2 + ux2)) / (2 * rho * CS2 * (0.5 + 3 * nu));
      const syy = -(pyy - rho * (CS2 + uy2)) / (2 * rho * CS2 * (0.5 + 3 * nu));
      const sxy = -(pxy - rho * ux * uy) / (2 * rho * CS2 * (0.5 + 3 * nu));
      const strain = Math.sqrt(Math.max(0, 2 * (sxx * sxx + syy * syy + 2 * sxy * sxy)));
      const tau = 0.5 + 3 * (nu + cs * cs * strain);
      const omega = 1 / tau;
      const uu = ux2 + uy2;
      const common = 1 - 1.5 * uu;
      let cu = ux;
      q0[idx] = a0 + omega * (WEIGHT[0] * rho * common - a0);
      q1[idx] = a1 + omega * (WEIGHT[1] * rho * (common + 3 * cu + 4.5 * cu * cu) - a1);
      cu = uy;
      q2[idx] = a2 + omega * (WEIGHT[2] * rho * (common + 3 * cu + 4.5 * cu * cu) - a2);
      cu = -ux;
      q3[idx] = a3 + omega * (WEIGHT[3] * rho * (common + 3 * cu + 4.5 * cu * cu) - a3);
      cu = -uy;
      q4[idx] = a4 + omega * (WEIGHT[4] * rho * (common + 3 * cu + 4.5 * cu * cu) - a4);
      cu = ux + uy;
      q5[idx] = a5 + omega * (WEIGHT[5] * rho * (common + 3 * cu + 4.5 * cu * cu) - a5);
      cu = -ux + uy;
      q6[idx] = a6 + omega * (WEIGHT[6] * rho * (common + 3 * cu + 4.5 * cu * cu) - a6);
      cu = -ux - uy;
      q7[idx] = a7 + omega * (WEIGHT[7] * rho * (common + 3 * cu + 4.5 * cu * cu) - a7);
      cu = ux - uy;
      q8[idx] = a8 + omega * (WEIGHT[8] * rho * (common + 3 * cu + 4.5 * cu * cu) - a8);
    }

    residual = step > 1 && speed2 > 0 ? Math.sqrt(delta2 / speed2) : 0;

    // Pull streaming. x 경계의 미정 population은 아래 inflow/outflow 보정으로
    // 덮고, y 경계는 MIRROR_Y로 접선 속도를 보존한다.
    const n0 = currentNext[0], n1 = currentNext[1], n2 = currentNext[2], n3 = currentNext[3], n4 = currentNext[4], n5 = currentNext[5], n6 = currentNext[6], n7 = currentNext[7], n8 = currentNext[8];
    const q = currentPost;
    for (let y = 0; y < ny; y++) {
      const row = y * nx;
      for (let x = 0; x < nx; x++) {
        const idx = row + x;
        if (solid[idx] !== 0) continue;
        for (let k = 0; k < 9; k++) {
          const sx = x - CX[k];
          const sy = y - CY[k];
          let value: number;
          if (sx < 0) {
            value = inflow[k];
          } else if (sx >= nx) {
            const upstream = idx - 1;
            value = upstream >= row && solid[upstream] === 0 ? q[k][upstream] : inflow[k];
          } else if (sy < 0 || sy >= ny) {
            value = q[MIRROR_Y[k]][idx];
          } else {
            const source = sy * nx + sx;
            value = solid[source] !== 0 ? q[OPP[k]][idx] : q[k][source];
          }
          switch (k) {
            case 0: n0[idx] = value; break;
            case 1: n1[idx] = value; break;
            case 2: n2[idx] = value; break;
            case 3: n3[idx] = value; break;
            case 4: n4[idx] = value; break;
            case 5: n5[idx] = value; break;
            case 6: n6[idx] = value; break;
            case 7: n7[idx] = value; break;
            case 8: n8[idx] = value; break;
          }
        }
      }
    }

    // x=0: 유입 평형을 강제한다. x=nx-1: 마지막 유체 셀의 population을 복사한다.
    for (let y = 0; y < ny; y++) {
      const left = y * nx;
      if (solid[left] === 0) for (let k = 0; k < 9; k++) currentNext[k][left] = inflow[k];
      const right = left + nx - 1;
      if (solid[right] === 0) {
        const upstream = right - 1;
        for (let k = 0; k < 9; k++) currentNext[k][right] = solid[upstream] === 0 ? currentNext[k][upstream] : inflow[k];
      }
    }

    const old = current;
    current = currentNext;
    currentNext = old;

    if (step >= averageFrom) {
      const a0 = current[0], a1 = current[1], a2 = current[2], a3 = current[3], a4 = current[4], a5 = current[5], a6 = current[6], a7 = current[7], a8 = current[8];
      for (let idx = 0; idx < n; idx++) {
        if (solid[idx] !== 0) continue;
        const rho = a0[idx] + a1[idx] + a2[idx] + a3[idx] + a4[idx] + a5[idx] + a6[idx] + a7[idx] + a8[idx];
        const invRho = rho > 0 && Number.isFinite(rho) ? 1 / rho : 1;
        sumU[idx] += (a1[idx] - a3[idx] + a5[idx] - a6[idx] - a7[idx] + a8[idx]) * invRho / u0;
        sumV[idx] += (a2[idx] - a4[idx] + a5[idx] + a6[idx] - a7[idx] - a8[idx]) * invRho / u0;
      }
    }
    if (onProgress && progressAt(step, steps)) onProgress(step);
  }

  const samples = Math.max(1, steps - Math.max(1, averageFrom) + 1);
  for (let idx = 0; idx < n; idx++) {
    if (solid[idx] !== 0) {
      outU[idx] = Number.NaN;
      outV[idx] = Number.NaN;
    } else {
      outU[idx] = sumU[idx] / samples;
      outV[idx] = sumV[idx] / samples;
    }
  }
  return { u: outU, v: outV, steps, residual };
}

function readDirection(value: number | WindDirection): number {
  const direction = typeof value === "number" ? value : value.fromDeg ?? value.inflowFromDeg ?? value.directionDeg;
  if (direction === undefined || !Number.isFinite(direction)) throw new RangeError("wind direction must be finite");
  return ((direction % 360) + 360) % 360;
}

function parseTransformArgs(
  first: WindField | Float32Array,
  second: number | WindDirection | Float32Array,
  nx?: number,
  ny?: number,
  direction?: number | WindDirection,
): { field: WindField; fromDeg: number } {
  if (first instanceof Float32Array) {
    if (!(second instanceof Float32Array) || nx === undefined || ny === undefined || direction === undefined) throw new TypeError("array rotation requires u, v, nx, ny, direction");
    return { field: { u: first, v: second, nx, ny }, fromDeg: readDirection(direction) };
  }
  return { field: first, fromDeg: readDirection(second as number | WindDirection) };
}

function sampleBilinear(values: Float32Array, nx: number, ny: number, x: number, y: number): number {
  // A rotated raster keeps the same extent. Clamping makes a constant field an
  // exact invariant and avoids inventing zero-speed borders at the crop edge.
  const px = Math.min(nx - 1, Math.max(0, x));
  const py = Math.min(ny - 1, Math.max(0, y));
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(nx - 1, x0 + 1), y1 = Math.min(ny - 1, y0 + 1);
  const tx = px - x0, ty = py - y0;
  const a = values[y0 * nx + x0], b = values[y0 * nx + x1], c = values[y1 * nx + x0], d = values[y1 * nx + x1];
  if (![a, b, c, d].every(Number.isFinite)) return Number.NaN;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function validateField(field: WindField): void {
  assertInteger("field.nx", field.nx, 2);
  assertInteger("field.ny", field.ny, 2);
  if (field.u.length !== field.nx * field.ny || field.v.length !== field.nx * field.ny) throw new RangeError("wind field length must equal nx * ny");
}

function rotateField(field: WindField, fromDeg: number, toWind: boolean): WindField {
  validateField(field);
  const { nx, ny } = field;
  const u = new Float32Array(nx * ny), v = new Float32Array(nx * ny);
  const from = fromDeg * RAD;
  // Meteorological from-bearing -> mathematical flow vector (east, north).
  const flowX = -Math.sin(from), flowY = -Math.cos(from);
  const leftX = -flowY, leftY = flowX;
  const cx = (nx - 1) / 2, cy = (ny - 1) / 2;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const dx = x - cx, dy = y - cy;
    const at = y * nx + x;
    if (toWind) {
      const east = flowX * dx + leftX * dy + cx;
      const north = flowY * dx + leftY * dy + cy;
      const eastU = sampleBilinear(field.u, nx, ny, east, north);
      const northU = sampleBilinear(field.v, nx, ny, east, north);
      u[at] = eastU * flowX + northU * flowY;
      v[at] = eastU * leftX + northU * leftY;
    } else {
      const windX = flowX * dx + flowY * dy + cx;
      const windY = leftX * dx + leftY * dy + cy;
      const windU = sampleBilinear(field.u, nx, ny, windX, windY);
      const windV = sampleBilinear(field.v, nx, ny, windX, windY);
      u[at] = windU * flowX + windV * leftX;
      v[at] = windU * flowY + windV * leftY;
    }
  }
  return { nx, ny, u, v, cellM: field.cellM, originX: field.originX, originY: field.originY };
}

export function rotateToWindFrame(field: WindField, direction: number | WindDirection): WindField;
export function rotateToWindFrame(u: Float32Array, v: Float32Array, nx: number, ny: number, direction: number | WindDirection): WindField;
export function rotateToWindFrame(first: WindField | Float32Array, second: number | WindDirection | Float32Array, nx?: number, ny?: number, direction?: number | WindDirection): WindField {
  const parsed = parseTransformArgs(first, second, nx, ny, direction);
  return rotateField(parsed.field, parsed.fromDeg, true);
}

export function rotateFromWindFrame(field: WindField, direction: number | WindDirection): WindField;
export function rotateFromWindFrame(u: Float32Array, v: Float32Array, nx: number, ny: number, direction: number | WindDirection): WindField;
export function rotateFromWindFrame(first: WindField | Float32Array, second: number | WindDirection | Float32Array, nx?: number, ny?: number, direction?: number | WindDirection): WindField {
  const parsed = parseTransformArgs(first, second, nx, ny, direction);
  return rotateField(parsed.field, parsed.fromDeg, false);
}
