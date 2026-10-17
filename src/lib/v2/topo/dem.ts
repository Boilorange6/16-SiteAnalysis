import { toUtmk } from "../crs";

export interface TopoDemGrid {
  x0: number;
  y0: number;
  cellM: number;
  cols: number;
  rows: number;
  values: Float32Array;
}

interface TopoPoint {
  x: number;
  y: number;
  z: number;
}

const IDW_RADIUS_M = 60;

function bucketKey(x: number, y: number): string {
  return `${x},${y}`;
}

function bucketIndex(value: number, bucketM: number): number {
  return Math.floor(value / bucketM);
}

function quadrant(dx: number, dy: number): number {
  if (dx >= 0 && dy >= 0) return 0; // NE
  if (dx < 0 && dy >= 0) return 1; // NW
  if (dx < 0 && dy < 0) return 2; // SW
  return 3; // SE
}

function interpolatedValue(
  buckets: ReadonlyMap<string, readonly TopoPoint[]>,
  x: number,
  y: number,
  bucketM: number,
): number {
  const bx = bucketIndex(x, bucketM);
  const by = bucketIndex(y, bucketM);
  const bucketRadius = Math.ceil(IDW_RADIUS_M / bucketM);
  const nearest: Array<{ point: TopoPoint; distanceSquared: number } | undefined> = [undefined, undefined, undefined, undefined];

  for (let ix = bx - bucketRadius; ix <= bx + bucketRadius; ix += 1) {
    for (let iy = by - bucketRadius; iy <= by + bucketRadius; iy += 1) {
      const candidates = buckets.get(bucketKey(ix, iy));
      if (!candidates) continue;
      for (const point of candidates) {
        const dx = point.x - x;
        const dy = point.y - y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > IDW_RADIUS_M * IDW_RADIUS_M) continue;
        const slot = quadrant(dx, dy);
        if (!nearest[slot] || distanceSquared < nearest[slot]!.distanceSquared) {
          nearest[slot] = { point, distanceSquared };
        }
      }
    }
  }

  const selected = nearest.filter((value): value is { point: TopoPoint; distanceSquared: number } => value !== undefined);
  if (selected.length < 2) return Number.NaN;
  const exact = selected.find((value) => value.distanceSquared === 0);
  if (exact) return exact.point.z;
  let weightedSum = 0;
  let weightSum = 0;
  for (const value of selected) {
    const weight = 1 / value.distanceSquared;
    weightedSum += value.point.z * weight;
    weightSum += weight;
  }
  return weightedSum / weightSum;
}

export function interpolateTopoDem(points: Float64Array, bounds: [number, number, number, number], cellM = 5): TopoDemGrid {
  const [minX, minY, maxX, maxY] = bounds;
  if (![minX, minY, maxX, maxY, cellM].every(Number.isFinite) || maxX <= minX || maxY <= minY || cellM <= 0) {
    throw new RangeError("invalid DEM bounds or cell size");
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellM));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellM));
  const values = new Float32Array(cols * rows);
  values.fill(Number.NaN);

  const validPoints: TopoPoint[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) validPoints.push({ x, y, z });
  }
  if (validPoints.length === 0) return { x0: minX, y0: minY, cellM, cols, rows, values };

  const bucketM = cellM * 4;
  const buckets = new Map<string, TopoPoint[]>();
  for (const point of validPoints) {
    const key = bucketKey(bucketIndex(point.x, bucketM), bucketIndex(point.y, bucketM));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }

  // ponytail: 사분면 IDW는 등고선 사이 계단이 남는다 — TIN(제약 Delaunay)으로 바꿀 때까지 '추정'으로 표기
  for (let row = 0; row < rows; row += 1) {
    const y = minY + (row + 0.5) * cellM;
    for (let col = 0; col < cols; col += 1) {
      const x = minX + (col + 0.5) * cellM;
      values[row * cols + col] = interpolatedValue(buckets, x, y, bucketM);
    }
  }
  return { x0: minX, y0: minY, cellM, cols, rows, values };
}

export class TopoDemReader {
  constructor(private readonly grid: TopoDemGrid) {}

  elevationUtmk(x: number, y: number): number | null {
    const { x0, y0, cellM, cols, rows, values } = this.grid;
    if (![x, y].every(Number.isFinite) || cols <= 0 || rows <= 0 || values.length < cols * rows) return null;
    const maxX = x0 + cols * cellM;
    const maxY = y0 + rows * cellM;
    if (x < x0 || x > maxX || y < y0 || y > maxY) return null;

    const gridX = (x - x0) / cellM - 0.5;
    const gridY = (y - y0) / cellM - 0.5;
    const xA = Math.max(0, Math.min(cols - 1, Math.floor(gridX)));
    const yA = Math.max(0, Math.min(rows - 1, Math.floor(gridY)));
    const xB = Math.max(0, Math.min(cols - 1, xA + 1));
    const yB = Math.max(0, Math.min(rows - 1, yA + 1));
    const tx = Math.max(0, Math.min(1, gridX - Math.floor(gridX)));
    const ty = Math.max(0, Math.min(1, gridY - Math.floor(gridY)));
    const v00 = values[yA * cols + xA];
    const v10 = values[yA * cols + xB];
    const v01 = values[yB * cols + xA];
    const v11 = values[yB * cols + xB];
    if (![v00, v10, v01, v11].every(Number.isFinite)) return null;
    const top = v00 + (v10 - v00) * tx;
    const bottom = v01 + (v11 - v01) * tx;
    return top + (bottom - top) * ty;
  }

  elevation(lng: number, lat: number): number | null {
    const [x, y] = toUtmk([lng, lat]);
    return this.elevationUtmk(x, y);
  }
}
