/** D29/S04가 공유하는 지형·건물 DSM과 하늘열림(SVF) 계산. */
import { toLngLat, toUtmk } from "../../crs";
import { SVF_DIRS, SVF_EYE_M, SVF_MAX_DIST_M, skyViewFactorParallel } from "../../sim/svf-kernel";
import { terrainHorizon, type HorizonMap } from "../../sim/horizon";
import type { EngineContext } from "../context";
import { buildingRows, type BuildingRow } from "./buildings-shared";
import { polygonParts } from "./geo";
import { demReader } from "./terrain-shared";
import type { LocalGrid } from "./raster-grid";
import { localGrid } from "./raster-grid";

export { SVF_DIRS, SVF_EYE_M, SVF_MAX_DIST_M };
export const SVF_CELL_M = 2;
export const SVF_HORIZON_CELL_M = 30;
export const SVF_HORIZON_AZIMUTHS = 72;
export const SVF_HORIZON_SEARCH_M = 5000;
export const CANOPY_ASSUMED_HEIGHT_M = 8;

export interface SvfShared {
  /** skyViewFactor와 같은 외곽 모서리·셀 간격의 DSM 격자. 값은 지면/건물/수관 상단 표고다. */
  grid: LocalGrid;
  /** row-major SVF. 반경 밖·건물 지붕·결측 지면은 NaN이다. */
  svf: Float32Array;
  /** GLO-30이 게시되지 않은 경우 false이고, 지형은 평탄면으로 계산된다. */
  terrainAvailable: boolean;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface Obstacle {
  rings: number[][][];
  bounds: Bounds;
  heightM: number | null;
}

interface RasterState {
  grid: LocalGrid;
  ground: Float32Array;
  dsm: Float32Array;
  receiver: Uint8Array;
  buildingMask: Uint8Array;
  obstacleMask: Uint8Array;
}


function boundsForRings(rings: number[][][]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const point of ring) {
      if (point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      minX = Math.min(minX, point[0]);
      minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]);
      maxY = Math.max(maxY, point[1]);
    }
  }
  return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
    ? { minX, minY, maxX, maxY }
    : null;
}

function onSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): boolean {
  // Bounding-box reject (1e-7 m tolerance) keeps the exact distance test below for the rare near-edge cell.
  if (x < Math.min(ax, bx) - 1e-7 || x > Math.max(ax, bx) + 1e-7 || y < Math.min(ay, by) - 1e-7 || y > Math.max(ay, by) + 1e-7) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return Math.hypot(x - ax, y - ay) <= 1e-7;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= 1e-7;
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (onSegment(x, y, a[0], a[1], b[0], b[1])) return true;
    const crosses = (a[1] > y) !== (b[1] > y);
    if (crosses && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Flat [ax, ay, bx, by, ...] of the ring edges that can touch the scanline y (same edges pointInRing would act on). */
function edgesAtY(ring: number[][], y: number): number[] | null {
  if (ring.length < 3) return null;
  const edges: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (y < Math.min(a[1], b[1]) - 1e-7 || y > Math.max(a[1], b[1]) + 1e-7) continue;
    edges.push(a[0], a[1], b[0], b[1]);
  }
  return edges;
}

/** pointInRing restricted to the scanline's edges; identical result because the skipped edges neither cross nor touch. */
function pointInEdges(x: number, y: number, edges: number[] | null): boolean {
  if (edges === null) return false;
  let inside = false;
  for (let k = 0; k < edges.length; k += 4) {
    const ax = edges[k];
    const ay = edges[k + 1];
    const bx = edges[k + 2];
    const by = edges[k + 3];
    if (onSegment(x, y, ax, ay, bx, by)) return true;
    const crosses = (ay > y) !== (by > y);
    if (crosses && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** EPSG:5179 폴리곤(바깥 고리·구멍 포함) 안의 점을 판정한다. */
export function pointInRings(x: number, y: number, rings: number[][][]): boolean {
  if (!rings[0] || !pointInRing(x, y, rings[0])) return false;
  return rings.slice(1).every((ring) => !pointInRing(x, y, ring));
}

/** MultiPolygon의 어느 파트 안에 점이 있는지 판정한다. */
export function pointInParts(x: number, y: number, parts: number[][][][]): boolean {
  return parts.some((rings) => pointInRings(x, y, rings));
}

function obstacleRows(rows: BuildingRow[]): Obstacle[] {
  return rows.flatMap((row) => polygonParts(row.hit.geometry).flatMap((parts) => {
    const bounds = boundsForRings(parts);
    return bounds ? [{ rings: parts, bounds, heightM: row.heightM }] : [];
  }));
}

function coarseSample(grid: LocalGrid, x: number, y: number): number | null {
  const px = (x - grid.x0) / grid.cellM;
  const py = (y - grid.y0) / grid.cellM;
  if (px < 0 || py < 0 || px > grid.cols - 1 || py > grid.rows - 1) return null;
  const col0 = Math.floor(px);
  const row0 = Math.floor(py);
  const col1 = Math.min(grid.cols - 1, col0 + 1);
  const row1 = Math.min(grid.rows - 1, row0 + 1);
  const tx = px - col0;
  const ty = py - row0;
  const values = [
    grid.values[row0 * grid.cols + col0],
    grid.values[row0 * grid.cols + col1],
    grid.values[row1 * grid.cols + col0],
    grid.values[row1 * grid.cols + col1],
  ];
  if (!values.every(Number.isFinite)) return null;
  return values[0] * (1 - tx) * (1 - ty) + values[1] * tx * (1 - ty) + values[2] * (1 - tx) * ty + values[3] * tx * ty;
}

function domainGrid(ctx: EngineContext, reader: ReturnType<typeof demReader>): { grid: LocalGrid; ground: Float32Array; dsm: Float32Array; receiver: Uint8Array } {
  const [cx, cy] = toUtmk(ctx.input.center);
  // The reported raster covers the selected analysis circle. Terrain beyond
  // this extent is supplied by the separate 30m horizon map; keeping the
  // DSM at the requested 2m extent is important for the 4s worker budget.
  const span = ctx.input.radiusM + SVF_CELL_M;
  const cols = Math.floor((2 * span) / SVF_CELL_M) + 1;
  const rows = cols;
  const x0 = cx - span;
  const y0 = cy - span;
  const count = cols * rows;
  // DEM is about 30m data. Sample it once on a coarse local grid and
  // interpolate to the 2m DSM instead of doing four SQLite row lookups per
  // 2m cell. The 2m resolution is retained for buildings and the SVF raster.
  const coarse = reader === null ? null : localGrid(
    ctx.input.center,
    ctx.input.radiusM + SVF_MAX_DIST_M + SVF_CELL_M,
    SVF_HORIZON_CELL_M,
    (x, y, lng, lat) => reader.elevation(lng, lat),
  );
  const ground = new Float32Array(count);
  ground.fill(Number.NaN);
  const dsm = new Float32Array(count);
  dsm.fill(Number.NaN);
  const receiver = new Uint8Array(count);
  const values = new Float64Array(count);
  values.fill(Number.NaN);

  if (coarse === null) {
    // Keep the no-DEM path branch-free in the hot SVF loop below: flat ground
    // is a deliberate fallback, not a missing receiver surface.
    ground.fill(0);
    dsm.fill(0);
    values.fill(0);
    for (let row = 0; row < rows; row += 1) {
      const y = y0 + (row + 0.5) * SVF_CELL_M;
      for (let col = 0; col < cols; col += 1) {
        const x = x0 + (col + 0.5) * SVF_CELL_M;
        if (Math.hypot(x - cx, y - cy) <= ctx.input.radiusM + SVF_CELL_M / 2) receiver[row * cols + col] = 1;
      }
    }
  } else {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = x0 + (col + 0.5) * SVF_CELL_M;
        const y = y0 + (row + 0.5) * SVF_CELL_M;
        const elevation = coarseSample(coarse, x, y);
        if (elevation === null || !Number.isFinite(elevation)) continue;
        const index = row * cols + col;
        ground[index] = elevation;
        dsm[index] = elevation;
        values[index] = elevation;
        if (Math.hypot(x - cx, y - cy) <= ctx.input.radiusM + SVF_CELL_M / 2) receiver[index] = 1;
      }
    }
  }

  return {
    grid: { cx, cy, cellM: SVF_CELL_M, cols, rows, x0, y0, values },
    ground,
    dsm,
    receiver,
  };
}

function cellRange(grid: LocalGrid, bounds: Bounds): { col0: number; col1: number; row0: number; row1: number } | null {
  const col0 = Math.max(0, Math.floor((bounds.minX - grid.x0) / grid.cellM - 0.5) - 1);
  const col1 = Math.min(grid.cols - 1, Math.ceil((bounds.maxX - grid.x0) / grid.cellM - 0.5) + 1);
  const row0 = Math.max(0, Math.floor((bounds.minY - grid.y0) / grid.cellM - 0.5) - 1);
  const row1 = Math.min(grid.rows - 1, Math.ceil((bounds.maxY - grid.y0) / grid.cellM - 0.5) + 1);
  return col0 <= col1 && row0 <= row1 ? { col0, col1, row0, row1 } : null;
}

function forEachCoveredCell(grid: LocalGrid, obstacle: Obstacle, visit: (index: number) => void): void {
  const range = cellRange(grid, obstacle.bounds);
  if (!range) return;
  for (let row = range.row0; row <= range.row1; row += 1) {
    const y = grid.y0 + (row + 0.5) * grid.cellM;
    const scan = obstacle.rings.map((ring) => edgesAtY(ring, y));
    if (scan[0] === undefined || scan[0] === null || scan[0].length === 0) continue;
    for (let col = range.col0; col <= range.col1; col += 1) {
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      if (!pointInEdges(x, y, scan[0])) continue;
      let inHole = false;
      for (let hole = 1; hole < scan.length && !inHole; hole += 1) inHole = pointInEdges(x, y, scan[hole]);
      if (!inHole) visit(row * grid.cols + col);
    }
  }
}

function applyBuildings(state: RasterState, rows: BuildingRow[]): number {
  const obstacles = obstacleRows(rows);
  let unknownCells = 0;
  for (const obstacle of obstacles) {
    forEachCoveredCell(state.grid, obstacle, (index) => {
      state.buildingMask[index] = 1;
      state.receiver[index] = 0;
      if (obstacle.heightM === null) {
        unknownCells += 1;
        return;
      }
      state.obstacleMask[index] = 1;
      if (obstacle.heightM > state.dsm[index] - state.ground[index]) {
        // dsm initially equals the ground. Keep the highest roof when an
        // overlapping source polygon is encountered.
        state.dsm[index] = state.ground[index] + obstacle.heightM;
      }
    });
  }
  return unknownCells;
}

function applyCanopy(state: RasterState, canopy: number[][][][] | null): void {
  if (!canopy || canopy.length === 0) return;
  for (const parts of canopy) {
    const bounds = boundsForRings(parts);
    if (!bounds) continue;
    const obstacle: Obstacle = { rings: parts, bounds, heightM: CANOPY_ASSUMED_HEIGHT_M };
    forEachCoveredCell(state.grid, obstacle, (index) => {
      if (state.buildingMask[index] !== 0 || !Number.isFinite(state.ground[index])) return;
      const ground = state.ground[index];
      state.obstacleMask[index] = 1;
      state.dsm[index] = Math.max(state.dsm[index], ground + CANOPY_ASSUMED_HEIGHT_M);
    });
  }
}

function terrainFor(ctx: EngineContext, reader: ReturnType<typeof demReader>): HorizonMap {
  const [cx, cy] = toUtmk(ctx.input.center);
  if (reader === null) {
    return terrainHorizon(
      () => 0,
      {
        minX: cx - ctx.input.radiusM,
        minY: cy - ctx.input.radiusM,
        maxX: cx + ctx.input.radiusM,
        maxY: cy + ctx.input.radiusM,
      },
      { cellM: SVF_HORIZON_CELL_M, azimuths: SVF_HORIZON_AZIMUTHS, searchM: SVF_HORIZON_SEARCH_M },
    );
  }
  // The DEM is a 30m product. A 30m local cache keeps the horizon scan from
  // issuing millions of repeated SQLite interpolation queries at every ray
  // sample while preserving the DEM's native spatial detail.
  const terrainGrid = localGrid(
    ctx.input.center,
    SVF_HORIZON_SEARCH_M + SVF_HORIZON_CELL_M,
    SVF_HORIZON_CELL_M,
    (x, y, lng, lat) => reader.elevation(lng, lat),
  );
  return terrainHorizon(
    (x, y) => coarseSample(terrainGrid, x, y),
    {
      minX: cx - ctx.input.radiusM,
      minY: cy - ctx.input.radiusM,
      maxX: cx + ctx.input.radiusM,
      maxY: cy + ctx.input.radiusM,
    },
    { cellM: SVF_HORIZON_CELL_M, azimuths: SVF_HORIZON_AZIMUTHS, searchM: SVF_HORIZON_SEARCH_M },
  );
}

/** 한 분석 안에서 bare/canopy DSM을 각각 한 번만 계산한다. */
export function svfFor(ctx: EngineContext, canopy: number[][][][] | null): SvfShared | null {
  const memoKey = `svf:${canopy === null ? "bare" : "canopy"}`;
  return ctx.memo(memoKey, () => {
    const rows = buildingRows(ctx, Math.min(5000, ctx.input.radiusM + SVF_MAX_DIST_M + SVF_CELL_M));
    const reader = demReader(ctx);
    if (rows === null) return null;

    const base = domainGrid(ctx, reader);
    const state: RasterState = {
      ...base,
      buildingMask: new Uint8Array(base.dsm.length),
      obstacleMask: new Uint8Array(base.dsm.length),
    };
    applyBuildings(state, rows);
    applyCanopy(state, canopy);
    state.grid.values = Float64Array.from(state.dsm);
    const horizon = terrainFor(ctx, reader);
    const svf = skyViewFactorParallel(state.dsm, state.grid, state.receiver, state.obstacleMask, horizon);
    return { grid: state.grid, svf, terrainAvailable: reader !== null };
  });
}

