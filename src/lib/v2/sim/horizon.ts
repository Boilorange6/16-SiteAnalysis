/**
 * 지형 지평선과 하늘열림(SVF)을 계산하는 순수 기하 엔진.
 *
 * 좌표는 기존 v2 로컬 미터 격자와 같은 EPSG:5179 계열의 x(동쪽),
 * y(북쪽) 축을 사용한다. 방위각은 나침반 기준(0°=북, 시계방향)이다.
 * `HorizonMap.x0/y0`는 격자 외곽의 남서 모서리이고, 표본점은 셀 중심이다.
 */

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const EPSILON = 1e-9;

export interface HorizonMap {
  x0: number;
  y0: number;
  cellM: number;
  cols: number;
  rows: number;
  azimuths: number;
  /** row-major, ((row * cols + col) * azimuths + k), elevation angle in degrees. */
  angleDeg: Float32Array;
}

export interface HorizonBBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface HorizonOptions {
  cellM?: number;
  azimuths?: number;
  searchM?: number;
}

export interface SkyViewGrid {
  x0: number;
  y0: number;
  cellM: number;
  cols: number;
  rows: number;
}

export interface SkyViewOptions {
  dirs?: number;
  maxDistM?: number;
  horizon?: HorizonMap;
  eyeM?: number;
}

type RaySample = {
  distance: number;
  colOffset: number;
  rowOffset: number;
};

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function assertGrid(grid: SkyViewGrid): void {
  assertFinite(grid.x0, "grid.x0");
  assertFinite(grid.y0, "grid.y0");
  assertPositive(grid.cellM, "grid.cellM");
  if (!Number.isInteger(grid.cols) || grid.cols < 1) throw new RangeError("grid.cols must be a positive integer");
  if (!Number.isInteger(grid.rows) || grid.rows < 1) throw new RangeError("grid.rows must be a positive integer");
}

function assertHorizonMap(horizon: HorizonMap): void {
  assertFinite(horizon.x0, "horizon.x0");
  assertFinite(horizon.y0, "horizon.y0");
  assertPositive(horizon.cellM, "horizon.cellM");
  if (!Number.isInteger(horizon.cols) || horizon.cols < 1) throw new RangeError("horizon.cols must be a positive integer");
  if (!Number.isInteger(horizon.rows) || horizon.rows < 1) throw new RangeError("horizon.rows must be a positive integer");
  if (!Number.isInteger(horizon.azimuths) || horizon.azimuths < 1) throw new RangeError("horizon.azimuths must be a positive integer");
  if (horizon.angleDeg.length !== horizon.cols * horizon.rows * horizon.azimuths) throw new RangeError("horizon.angleDeg has an invalid length");
}

function rayDistances(cellM: number, maxDistM: number): number[] {
  // 가까운 장애물은 한 셀 간격으로 놓치지 않고, 먼 지형은 지수적으로 건너뛴다.
  // 24m까지 촘촘히 보는 것은 작은 건물·우물 벽을 보존하면서 800m 장면의
  // 셀×방위×표본 수를 제한하기 위한 품질/성능 절충이다.
  const nearEnd = Math.min(maxDistM, Math.max(cellM * 8, 24));
  const distances: number[] = [];
  if (maxDistM < cellM) return [maxDistM];
  for (let distance = cellM; distance <= nearEnd + EPSILON; distance += cellM) distances.push(Math.min(distance, maxDistM));
  if (nearEnd >= maxDistM - EPSILON) return distances;

  let distance = nearEnd * 2;
  while (distance < maxDistM - EPSILON) {
    distances.push(distance);
    distance *= 2;
  }
  distances.push(maxDistM);
  return distances;
}

function validateBBox(bbox: HorizonBBox): void {
  assertFinite(bbox.minX, "bbox.minX");
  assertFinite(bbox.minY, "bbox.minY");
  assertFinite(bbox.maxX, "bbox.maxX");
  assertFinite(bbox.maxY, "bbox.maxY");
  if (bbox.maxX < bbox.minX || bbox.maxY < bbox.minY) throw new RangeError("bbox maximum must not be smaller than minimum");
}

/**
 * DEM 표본 함수에서 셀별 방위 지평선을 만든다.
 * 표본 거리는 가까운 구간을 촘촘히, 먼 구간을 지수적으로 늘린다.
 * 결측 DEM은 하늘을 막지 않으며, 관측자 표고가 결측이면 그 셀의 각도는 0°다.
 */
export function terrainHorizon(
  z: (x: number, y: number) => number | null,
  bbox: HorizonBBox,
  opts: HorizonOptions = {},
): HorizonMap {
  if (typeof z !== "function") throw new TypeError("z must be a function");
  validateBBox(bbox);
  const cellM = opts.cellM ?? 30;
  const azimuths = opts.azimuths ?? 72;
  const searchM = opts.searchM ?? 5000;
  assertPositive(cellM, "cellM");
  assertPositive(searchM, "searchM");
  if (!Number.isInteger(azimuths) || azimuths < 1) throw new RangeError("azimuths must be a positive integer");

  const cols = Math.max(1, Math.ceil((bbox.maxX - bbox.minX) / cellM));
  const rows = Math.max(1, Math.ceil((bbox.maxY - bbox.minY) / cellM));
  const angleDeg = new Float32Array(cols * rows * azimuths);
  const distances = rayDistances(cellM, searchM);
  const directions = Array.from({ length: azimuths }, (_, k) => {
    const azDeg = (360 * k) / azimuths;
    const az = azDeg * RAD;
    return { sin: Math.sin(az), cos: Math.cos(az) };
  });

  for (let row = 0; row < rows; row += 1) {
    const y = bbox.minY + (row + 0.5) * cellM;
    for (let col = 0; col < cols; col += 1) {
      const x = bbox.minX + (col + 0.5) * cellM;
      const observer = z(x, y);
      if (observer === null || !Number.isFinite(observer)) continue;
      const base = (row * cols + col) * azimuths;
      for (let k = 0; k < azimuths; k += 1) {
        const direction = directions[k];
        let highest = 0;
        for (const distance of distances) {
          const sample = z(x + direction.sin * distance, y + direction.cos * distance);
          if (sample === null || !Number.isFinite(sample)) continue;
          const angle = Math.atan2(sample - observer, distance) * DEG;
          if (angle > highest) highest = angle;
        }
        angleDeg[base + k] = highest;
      }
    }
  }

  return { x0: bbox.minX, y0: bbox.minY, cellM, cols, rows, azimuths, angleDeg };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedAzimuth(azDeg: number): number {
  const normalized = azDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function spatialPosition(value: number, origin: number, cellM: number, size: number): number {
  // origin은 외곽 모서리이고 첫 표본은 origin + cellM/2이다.
  return clamp((value - origin) / cellM - 0.5, 0, size - 1);
}

/** 지평선의 공간 쌍선형·방위 선형 보간값(단위 °). */
export function horizonAt(h: HorizonMap, x: number, y: number, azDeg: number): number {
  assertHorizonMap(h);
  assertFinite(x, "x");
  assertFinite(y, "y");
  assertFinite(azDeg, "azDeg");

  const px = spatialPosition(x, h.x0, h.cellM, h.cols);
  const py = spatialPosition(y, h.y0, h.cellM, h.rows);
  const col0 = Math.floor(px);
  const row0 = Math.floor(py);
  const col1 = Math.min(h.cols - 1, col0 + 1);
  const row1 = Math.min(h.rows - 1, row0 + 1);
  const tx = px - col0;
  const ty = py - row0;

  const direction = (normalizedAzimuth(azDeg) / 360) * h.azimuths;
  const az0 = Math.floor(direction) % h.azimuths;
  const az1 = (az0 + 1) % h.azimuths;
  const ta = direction - Math.floor(direction);
  const value = (row: number, col: number, azimuth: number): number => h.angleDeg[(row * h.cols + col) * h.azimuths + azimuth];
  const interpolateAzimuth = (row: number, col: number): number => value(row, col, az0) * (1 - ta) + value(row, col, az1) * ta;
  const south = interpolateAzimuth(row0, col0) * (1 - tx) + interpolateAzimuth(row0, col1) * tx;
  const north = interpolateAzimuth(row1, col0) * (1 - tx) + interpolateAzimuth(row1, col1) * tx;
  return south * (1 - ty) + north * ty;
}

function validateSkyViewInputs(dsm: Float32Array, grid: SkyViewGrid, receiver: Uint8Array, opts: Required<Pick<SkyViewOptions, "dirs" | "maxDistM" | "eyeM">>): void {
  assertGrid(grid);
  if (dsm.length !== grid.cols * grid.rows) throw new RangeError("dsm has an invalid length");
  if (receiver.length !== dsm.length) throw new RangeError("receiver has an invalid length");
  if (!Number.isInteger(opts.dirs) || opts.dirs < 1) throw new RangeError("dirs must be a positive integer");
  assertPositive(opts.maxDistM, "maxDistM");
  assertFinite(opts.eyeM, "eyeM");
  if (opts.eyeM < 0) throw new RangeError("eyeM must not be negative");
}

function raySamples(cellM: number, maxDistM: number, dirs: number): RaySample[][] {
  const distances = rayDistances(cellM, maxDistM);
  return Array.from({ length: dirs }, (_, directionIndex) => {
    const az = (360 * directionIndex * RAD) / dirs;
    const sin = Math.sin(az);
    const cos = Math.cos(az);
    return distances.map((distance) => ({
      distance,
      colOffset: Math.round((sin * distance) / cellM),
      rowOffset: Math.round((cos * distance) / cellM),
    }));
  });
}

/**
 * DSM의 셀 중심에서 방위별 최대 고도각을 표본화해 SVF를 계산한다.
 * 비수광(receiver=0) 또는 결측 관측 셀은 NaN으로 남긴다.
 *
 * 지평선 지도가 주어지면 DSM 장애물과 지형 지평선 중 높은 쪽을 사용한다.
 * 연속 지형을 셀 법선으로 보정하지 않는 수평 수광면 근사다.
 */
export function skyViewFactor(
  dsm: Float32Array,
  grid: SkyViewGrid,
  receiver: Uint8Array,
  opts: SkyViewOptions = {},
): Float32Array {
  const resolved = {
    dirs: opts.dirs ?? 32,
    maxDistM: opts.maxDistM ?? 300,
    eyeM: opts.eyeM ?? 1.1,
  };
  validateSkyViewInputs(dsm, grid, receiver, resolved);
  if (opts.horizon) assertHorizonMap(opts.horizon);

  const result = new Float32Array(dsm.length);
  result.fill(Number.NaN);
  const rays = raySamples(grid.cellM, resolved.maxDistM, resolved.dirs);
  const directions = Array.from({ length: resolved.dirs }, (_, index) => (360 * index) / resolved.dirs);
  const cols = grid.cols;
  const rows = grid.rows;
  const horizon = opts.horizon;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      if (receiver[index] === 0 || !Number.isFinite(dsm[index])) continue;
      const observer = dsm[index] + resolved.eyeM;
      let blockedSquareSinSum = 0;
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      const y = grid.y0 + (row + 0.5) * grid.cellM;

      for (let directionIndex = 0; directionIndex < resolved.dirs; directionIndex += 1) {
        let highestSlope = 0;
        for (const sample of rays[directionIndex]) {
          const sampleCol = col + sample.colOffset;
          const sampleRow = row + sample.rowOffset;
          if (sampleCol < 0 || sampleCol >= cols || sampleRow < 0 || sampleRow >= rows) break;
          const elevation = dsm[sampleRow * cols + sampleCol];
          if (!Number.isFinite(elevation)) continue;
          const slope = (elevation - observer) / sample.distance;
          if (slope > highestSlope) highestSlope = slope;
        }
        let highestAngle = Math.atan(highestSlope);
        if (horizon) {
          const terrainAngle = horizonAt(horizon, x, y, directions[directionIndex]);
          if (terrainAngle > highestAngle * DEG) highestAngle = terrainAngle * RAD;
        }
        const sine = Math.sin(highestAngle);
        blockedSquareSinSum += sine * sine;
      }
      result[index] = Math.max(0, Math.min(1, 1 - blockedSquareSinSum / resolved.dirs));
    }
  }
  return result;
}
