/**
 * Line integral convolution for a browser wind raster.
 *
 * The noise field is generated once from a small integer PRNG so a map redraw
 * is stable.  Streamlines use a midpoint (RK2) step in both directions; a
 * non-finite vector is treated as an obstacle and ends that half-trace.
 */

type VectorField = { u: Float32Array; v: Float32Array; cols: number; rows: number };

function assertDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hashNoise(index: number, seed: number): number {
  let value = (Math.imul(index + 1, 0x9e3779b1) ^ seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  value ^= value >>> 16;
  return value / 0xffffffff;
}

function bilinear(values: Float32Array, width: number, height: number, x: number, y: number): number {
  const boundedX = Math.max(0, Math.min(width - 1, x));
  const boundedY = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(boundedX);
  const y0 = Math.floor(boundedY);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = boundedX - x0;
  const ty = boundedY - y0;
  const a = values[y0 * width + x0] ?? 0;
  const b = values[y0 * width + x1] ?? 0;
  const c = values[y1 * width + x0] ?? 0;
  const d = values[y1 * width + x1] ?? 0;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function velocityAt(field: VectorField, x: number, y: number, outW: number, outH: number): [number, number] | null {
  const fieldX = ((x - 0.5) * field.cols) / outW;
  const fieldY = ((y - 0.5) * field.rows) / outH;
  const boundedX = Math.max(0, Math.min(field.cols - 1, fieldX));
  const boundedY = Math.max(0, Math.min(field.rows - 1, fieldY));
  const x0 = Math.floor(boundedX);
  const y0 = Math.floor(boundedY);
  const x1 = Math.min(field.cols - 1, x0 + 1);
  const y1 = Math.min(field.rows - 1, y0 + 1);
  const tx = boundedX - x0;
  const ty = boundedY - y0;
  const index00 = y0 * field.cols + x0;
  const index10 = y0 * field.cols + x1;
  const index01 = y1 * field.cols + x0;
  const index11 = y1 * field.cols + x1;
  const u00 = field.u[index00] ?? Number.NaN;
  const u10 = field.u[index10] ?? Number.NaN;
  const u01 = field.u[index01] ?? Number.NaN;
  const u11 = field.u[index11] ?? Number.NaN;
  const v00 = field.v[index00] ?? Number.NaN;
  const v10 = field.v[index10] ?? Number.NaN;
  const v01 = field.v[index01] ?? Number.NaN;
  const v11 = field.v[index11] ?? Number.NaN;
  if (![u00, u10, u01, u11, v00, v10, v01, v11].every(Number.isFinite)) return null;
  const u = (u00 * (1 - tx) + u10 * tx) * (1 - ty) + (u01 * (1 - tx) + u11 * tx) * ty;
  const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return [u, v];
}

function normalizedDirection(vector: [number, number], direction: number, outW: number, outH: number): [number, number] | null {
  const x = vector[0] * (outW / Math.max(1, outW));
  const y = vector[1] * (outH / Math.max(1, outH));
  const length = Math.hypot(x, y);
  if (!(length > 1e-6)) return null;
  return [(x / length) * direction, (y / length) * direction];
}

/**
 * Paint deterministic white noise along the vector field in both directions.
 * The returned values are normalized to [0, 1] and can be used as a texture
 * multiplier over the U/Uin colour ramp.
 */
export function lic(
  u: Float32Array,
  v: Float32Array,
  cols: number,
  rows: number,
  outW: number,
  outH: number,
  opts: { lengthPx?: number; seed?: number } = {},
): Float32Array {
  assertDimension(cols, "cols");
  assertDimension(rows, "rows");
  assertDimension(outW, "outW");
  assertDimension(outH, "outH");
  if (u.length !== cols * rows || v.length !== cols * rows) throw new RangeError("LIC field length must equal cols * rows");
  const lengthPx = Math.max(1, Math.round(opts.lengthPx ?? 20));
  const seed = (Math.trunc(opts.seed ?? 0x31415926) >>> 0);
  const noise = new Float32Array(outW * outH);
  for (let index = 0; index < noise.length; index += 1) noise[index] = hashNoise(index, seed) * 2 - 1;
  const field: VectorField = { u, v, cols, rows };
  const output = new Float32Array(outW * outH);

  for (let y = 0; y < outH; y += 1) {
    for (let x = 0; x < outW; x += 1) {
      let sum = bilinear(noise, outW, outH, x, y);
      let samples = 1;
      for (const direction of [-1, 1]) {
        let cursorX = x + 0.5;
        let cursorY = y + 0.5;
        for (let step = 0; step < lengthPx; step += 1) {
          const vector = velocityAt(field, cursorX, cursorY, outW, outH);
          if (!vector) break;
          const first = normalizedDirection(vector, direction, outW, outH);
          if (!first) break;
          const midpointX = cursorX + first[0] * 0.5;
          const midpointY = cursorY + first[1] * 0.5;
          const midpoint = velocityAt(field, midpointX, midpointY, outW, outH);
          if (!midpoint) break;
          const second = normalizedDirection(midpoint, direction, outW, outH);
          if (!second) break;
          cursorX += second[0];
          cursorY += second[1];
          if (cursorX < 0 || cursorX >= outW || cursorY < 0 || cursorY >= outH) break;
          sum += bilinear(noise, outW, outH, cursorX - 0.5, cursorY - 0.5);
          samples += 1;
        }
      }
      output[y * outW + x] = Math.fround(clamp01(sum / samples * 0.5 + 0.5));
    }
  }
  return output;
}
