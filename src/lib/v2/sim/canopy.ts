/** Color-index canopy detection over an aerial WMTS mosaic. */
import { toUtmk, type LngLat } from "../crs";
import type { LocalGrid } from "../engine/tiles/raster-grid";
import type { Mosaic } from "../engine/imagery";

const EXG_HIST_MIN = -1;
const EXG_HIST_MAX = 2;
const HISTOGRAM_BINS = 256;
const DEFAULT_V_MIN = 0.06;
const DEFAULT_V_MAX = 0.85;
const DEFAULT_MIN_AREA_M2 = 4;
const DEFAULT_CLOSE_M = 1;
const DEFAULT_OPEN_M = 0.5;

export interface CanopyOptions {
  exgMin?: number;
  vMin?: number;
  vMax?: number;
  minAreaM2?: number;
  closeM?: number;
  openM?: number;
}

function assertMosaic(m: Mosaic): void {
  if (!Number.isInteger(m.z) || m.z < 0 || m.z > 30) throw new RangeError("invalid mosaic zoom");
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1) throw new RangeError("invalid mosaic shape");
  if (m.rgb.length !== m.width * m.height * 3) throw new RangeError("invalid mosaic RGB length");
  if (!Number.isFinite(m.mPerPx) || m.mPerPx <= 0) throw new RangeError("invalid mosaic resolution");
  if (m.valid && m.valid.length !== m.width * m.height) throw new RangeError("invalid mosaic validity length");
}

function isValidPixel(m: Mosaic, index: number): boolean {
  return !m.valid || m.valid[index] === 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function exgOf(rgb: Uint8Array, pixel: number): number {
  const offset = pixel * 3;
  const red = rgb[offset] / 255;
  const green = rgb[offset + 1] / 255;
  const blue = rgb[offset + 2] / 255;
  const total = red + green + blue;
  if (total <= 0) return -1;
  const r = red / total;
  const g = green / total;
  const b = blue / total;
  return 2 * g - r - b;
}

function validOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < 0) throw new RangeError(`invalid ${name}`);
  return resolved;
}

function otsuThreshold(histogram: Uint32Array, count: number): number {
  if (count === 0) return 0.2;
  let total = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin++) total += bin * histogram[bin];
  let backgroundCount = 0;
  let backgroundSum = 0;
  let bestBin = 0;
  let bestVariance = -1;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
    backgroundCount += histogram[bin];
    if (backgroundCount === 0) continue;
    const foregroundCount = count - backgroundCount;
    if (foregroundCount === 0) break;
    backgroundSum += bin * histogram[bin];
    const meanBackground = backgroundSum / backgroundCount;
    const meanForeground = (total - backgroundSum) / foregroundCount;
    const difference = meanBackground - meanForeground;
    const variance = backgroundCount * foregroundCount * difference * difference;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestBin = bin;
    }
  }
  const binWidth = (EXG_HIST_MAX - EXG_HIST_MIN) / HISTOGRAM_BINS;
  return EXG_HIST_MIN + (bestBin + 1) * binWidth;
}

type MorphologyMode = "dilate" | "erode";

/** Binary rectangular morphology in O(width*height), using separable windows. */
function windowPass(input: Uint8Array, width: number, height: number, radius: number, mode: MorphologyMode): Uint8Array {
  if (radius <= 0) return input.slice();
  const horizontal = new Uint16Array(input.length);
  const diameter = radius * 2 + 1;
  const kernelArea = diameter * diameter;
  for (let row = 0; row < height; row++) {
    const rowStart = row * width;
    let sum = 0;
    for (let column = 0; column <= radius && column < width; column++) sum += input[rowStart + column];
    for (let column = 0; column < width; column++) {
      horizontal[rowStart + column] = sum;
      const add = column + radius + 1;
      const remove = column - radius;
      if (add < width) sum += input[rowStart + add];
      if (remove >= 0) sum -= input[rowStart + remove];
    }
  }
  const output = new Uint8Array(input.length);
  for (let column = 0; column < width; column++) {
    let sum = 0;
    for (let row = 0; row <= radius && row < height; row++) sum += horizontal[row * width + column];
    for (let row = 0; row < height; row++) {
      const index = row * width + column;
      output[index] = mode === "erode" ? (sum === kernelArea ? 1 : 0) : (sum > 0 ? 1 : 0);
      const add = row + radius + 1;
      const remove = row - radius;
      if (add < height) sum += horizontal[add * width + column];
      if (remove >= 0) sum -= horizontal[remove * width + column];
    }
  }
  return output;
}

function openMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return windowPass(windowPass(mask, width, height, radius, "erode"), width, height, radius, "dilate");
}

function closeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return windowPass(windowPass(mask, width, height, radius, "dilate"), width, height, radius, "erode");
}

function removeSmallComponents(mask: Uint8Array, width: number, height: number, minimumPixels: number): void {
  if (minimumPixels <= 1) return;
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    mask[start] = 2;
    while (head < tail) {
      const index = queue[head++];
      const row = Math.floor(index / width);
      const column = index - row * width;
      if (column > 0 && mask[index - 1] === 1) {
        mask[index - 1] = 2;
        queue[tail++] = index - 1;
      }
      if (column + 1 < width && mask[index + 1] === 1) {
        mask[index + 1] = 2;
        queue[tail++] = index + 1;
      }
      if (row > 0 && mask[index - width] === 1) {
        mask[index - width] = 2;
        queue[tail++] = index - width;
      }
      if (row + 1 < height && mask[index + width] === 1) {
        mask[index + width] = 2;
        queue[tail++] = index + width;
      }
    }
    const kept = tail >= minimumPixels;
    if (!kept) for (let index = 0; index < tail; index++) mask[queue[index]] = 0;
  }
  for (let index = 0; index < mask.length; index++) if (mask[index] === 2) mask[index] = 1;
}

/** Detects vegetation-like pixels, then removes specks and closes small holes. */
export function detectCanopy(m: Mosaic, opts: CanopyOptions = {}): { mask: Uint8Array; threshold: number; coveragePct: number } {
  assertMosaic(m);
  const vMin = validOption(opts.vMin, DEFAULT_V_MIN, "vMin");
  const vMax = validOption(opts.vMax, DEFAULT_V_MAX, "vMax");
  if (vMax < vMin || vMax > 1) throw new RangeError("invalid vMax");
  const minAreaM2 = validOption(opts.minAreaM2, DEFAULT_MIN_AREA_M2, "minAreaM2");
  const closeM = validOption(opts.closeM, DEFAULT_CLOSE_M, "closeM");
  const openM = validOption(opts.openM, DEFAULT_OPEN_M, "openM");
  const histogram = new Uint32Array(HISTOGRAM_BINS);
  // Keep a compact ExG code so the thresholding pass does not decode every RGB
  // pixel a second time. Zero is reserved for pixels excluded by V/water tests.
  const exgCodes = new Uint16Array(m.width * m.height);
  let eligible = 0;
  for (let pixel = 0; pixel < m.width * m.height; pixel++) {
    if (!isValidPixel(m, pixel)) continue;
    const offset = pixel * 3;
    const red = m.rgb[offset];
    const green = m.rgb[offset + 1];
    const blue = m.rgb[offset + 2];
    const value = Math.max(red, green, blue) / 255;
    const blueWater = blue > green && blue > red;
    const exg = exgOf(m.rgb, pixel);
    if (value < vMin || value > vMax || blueWater) continue;
    const bin = clamp(Math.floor(((exg - EXG_HIST_MIN) / (EXG_HIST_MAX - EXG_HIST_MIN)) * HISTOGRAM_BINS), 0, HISTOGRAM_BINS - 1);
    histogram[bin] += 1;
    exgCodes[pixel] = Math.max(1, Math.min(30_000, Math.round((exg + 1) * 10_000)));
    eligible += 1;
  }
  const automaticThreshold = clamp(otsuThreshold(histogram, eligible), 0.04, 0.2);
  const threshold = clamp(opts.exgMin ?? automaticThreshold, 0.04, 0.2);
  const thresholdCode = Math.round((threshold + 1) * 10_000);
  const mask = new Uint8Array(m.width * m.height);
  let validPixelsForMask = 0;
  let candidatePixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!isValidPixel(m, pixel)) continue;
    validPixelsForMask += 1;
    if (exgCodes[pixel] >= thresholdCode) {
      mask[pixel] = 1;
      candidatePixels += 1;
    }
  }
  const openRadius = Math.ceil(openM / m.mPerPx - 1e-9);
  const closeRadius = Math.ceil(closeM / m.mPerPx - 1e-9);
  const allPixelsValid = !m.valid || validPixelsForMask === mask.length;
  // A completely eligible, complete image has no specks or holes to repair;
  // avoid spending the budget on morphology that could only touch the frame.
  if (!(allPixelsValid && candidatePixels === mask.length)) {
    const morphed = closeMask(openMask(mask, m.width, m.height, openRadius), m.width, m.height, closeRadius);
    mask.set(morphed);
    removeSmallComponents(mask, m.width, m.height, Math.max(1, Math.ceil(minAreaM2 / (m.mPerPx * m.mPerPx))));
  }
  let validPixels = 0;
  let canopyPixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!isValidPixel(m, pixel)) continue;
    validPixels += 1;
    canopyPixels += mask[pixel];
  }
  return { mask, threshold, coveragePct: validPixels === 0 ? 0 : (canopyPixels / validPixels) * 100 };
}

function globalPixel(center: LngLat, z: number): [number, number] {
  const [lng, rawLat] = center;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, rawLat));
  const size = 256 * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [
    ((lng + 180) / 360) * size,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  ];
}

/** Downsamples the pixel mask to a majority-vote EPSG:5179 local grid. */
export function canopyToGrid(m: Mosaic, mask: Uint8Array, center: LngLat, radiusM: number, cellM = 1): LocalGrid {
  assertMosaic(m);
  if (mask.length !== m.width * m.height) throw new RangeError("invalid canopy mask length");
  if (center.length !== 2 || !center.every(Number.isFinite)) throw new RangeError("invalid grid center");
  if (!Number.isFinite(radiusM) || radiusM < 0 || !Number.isFinite(cellM) || cellM <= 0) throw new RangeError("invalid grid dimensions");
  const [cx, cy] = toUtmk(center);
  const span = radiusM + cellM;
  const cols = Math.floor((2 * span) / cellM) + 1;
  const rows = cols;
  const x0 = cx - span;
  const y0 = cy - span;
  const values = new Float64Array(cols * rows);
  values.fill(Number.NaN);
  const [centerPxX, centerPxY] = globalPixel(center, m.z);
  const halfPixelSpan = cellM / (2 * m.mPerPx);
  for (let row = 0; row < rows; row++) {
    const y = y0 + row * cellM;
    const pixelY = centerPxY - (y - cy) / m.mPerPx;
    const minY = Math.max(0, Math.ceil(pixelY - halfPixelSpan - m.y0Px - 0.5));
    const maxY = Math.min(m.height - 1, Math.floor(pixelY + halfPixelSpan - m.y0Px - 0.5));
    for (let column = 0; column < cols; column++) {
      const x = x0 + column * cellM;
      const pixelX = centerPxX + (x - cx) / m.mPerPx;
      let minX = Math.max(0, Math.ceil(pixelX - halfPixelSpan - m.x0Px - 0.5));
      let maxX = Math.min(m.width - 1, Math.floor(pixelX + halfPixelSpan - m.x0Px - 0.5));
      let sampleMinY = minY;
      let sampleMaxY = maxY;
      if (minX > maxX || sampleMinY > sampleMaxY) {
        const nearestX = Math.max(0, Math.min(m.width - 1, Math.floor(pixelX - m.x0Px)));
        const nearestY = Math.max(0, Math.min(m.height - 1, Math.floor(pixelY - m.y0Px)));
        minX = maxX = nearestX;
        sampleMinY = sampleMaxY = nearestY;
      }
      let valid = 0;
      let canopy = 0;
      for (let sampleY = sampleMinY; sampleY <= sampleMaxY; sampleY++) {
        for (let sampleX = minX; sampleX <= maxX; sampleX++) {
          const index = sampleY * m.width + sampleX;
          if (m.valid && m.valid[index] !== 1) continue;
          valid += 1;
          canopy += mask[index];
        }
      }
      if (valid > 0) values[row * cols + column] = canopy * 2 >= valid ? 1 : 0;
    }
  }
  return { cx, cy, cellM, cols, rows, x0, y0, values };
}
