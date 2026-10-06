/**
 * 바람장 좌표 회전(유입 방향 프레임 ↔ 동·북 프레임). 순수 계산이라 브라우저와 서버가 함께 쓴다.
 * lbm2d.ts는 node:worker_threads를 import하므로 화면 코드는 이 파일만 가져와야 한다.
 */

const RAD = Math.PI / 180;

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
