/** D10 수관 래스터·벡터를 S04가 재사용하는 공통 계산. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateSync, inflateSync } from "node:zlib";
import type { Mosaic } from "../imagery";
import type { EngineContext } from "../context";
import type { SourceRef } from "../context";
import { toUtmk } from "../../crs";
import { areaInCircle, polygonArea, simplifyRing } from "./geo";
import { canopyToGrid, detectCanopy } from "../../sim/canopy";
import type { LocalGrid } from "./raster-grid";
import { fillRing, type Obstacle } from "../../sim/sun-field";
import { sunObstaclesFor } from "./sun-shared";
import { buildingsReady } from "./buildings-shared";

/** 수관은 항공사진에서 높이를 관측하지 않으므로 Sitedia와 같은 고정 가정이다. */
export const CANOPY_ASSUMED_HEIGHT_M = 8;

export interface CanopyResult {
  grid: LocalGrid;
  /** EPSG:5179 미터 좌표의 [바깥 고리, 구멍...] 목록. */
  polygons: number[][][][];
  threshold: number;
  /** 영상 유효 셀 중 수관으로 검출된 셀의 비율. */
  coveragePct: number;
  missingTiles: number;
  totalTiles: number;
  buildingMaskApplied: boolean;
  year?: number;
}

export function canopySource(year?: number): SourceRef {
  return { sourceId: "ngii_air", releaseId: `ngii_air@${year ?? "unknown"}`, sourceAsOf: year ? String(year) : null, fetchedAt: "runtime" };
}

export interface CanopyForOptions {
  /** 테스트·재현용으로 이미 디코드한 모자이크를 주입한다. 작업자는 기본 경로를 사용한다. */
  mosaic?: Mosaic;
  /** 실데이터 QA에서 동일 요청의 영상을 관찰한다. */
  onMosaic?: (mosaic: Mosaic) => void;
  /** 검출 결과(격자·벡터)를 분석 간에 재사용하는 디렉터리. 명시적으로 지정할 때만 사용한다. 'off'면 끈다. */
  resultCacheDir?: string;
}

type LatticePoint = { col: number; row: number };
type Loop = { points: LatticePoint[]; signedArea: number };
type CompactLoop = { points: Int32Array; signedArea: number };

const MAX_VECTOR_POLYGONS = 3000;
const MAX_VECTOR_VERTICES = 200;
function isCanopyCell(grid: LocalGrid, col: number, row: number, radiusM: number): boolean {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  const x = grid.x0 + col * grid.cellM;
  const y = grid.y0 + row * grid.cellM;
  if (Math.hypot(x - grid.cx, y - grid.cy) > radiusM + grid.cellM * 0.75) return false;
  return grid.values[row * grid.cols + col] >= 0.5;
}

/** 1m binary grid의 경계만 걷는다. 셀별 Turf 폴리곤을 만들지 않아 800m도 선형 시간이다. */
function compactBoundaryLoops(grid: LocalGrid, radiusM: number): CompactLoop[] {
  // One byte per lattice vertex: four outgoing direction bits, cleared on use.
  const stride = grid.cols + 1;
  const edges = new Uint8Array(stride * (grid.rows + 1));
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!isCanopyCell(grid, col, row, radiusM)) continue;
      if (!isCanopyCell(grid, col, row - 1, radiusM)) edges[row * stride + col] |= 1;
      if (!isCanopyCell(grid, col + 1, row, radiusM)) edges[row * stride + col + 1] |= 2;
      if (!isCanopyCell(grid, col, row + 1, radiusM)) edges[(row + 1) * stride + col + 1] |= 4;
      if (!isCanopyCell(grid, col - 1, row, radiusM)) edges[(row + 1) * stride + col] |= 8;
    }
  }

  const loops: CompactLoop[] = [];
  // Match the former localeCompare("col,row") start order, including prefixes.
  const columns = Array.from({ length: grid.cols + 1 }, (_, i) => i).sort((a, b) => `${a},`.localeCompare(`${b},`));
  const rows = Array.from({ length: grid.rows + 1 }, (_, i) => i).sort((a, b) => String(a).localeCompare(String(b)));
  const dc = [1, 0, -1, 0], dr = [0, 1, 0, -1];
  for (const startCol of columns) for (const startRow of rows) {
    const start = startRow * stride + startCol;
    for (let initial = 0; initial < 4; initial++) {
      if (!(edges[start] & (1 << initial))) continue;
      const points: number[] = [startCol, startRow];
      let area = 0;
      let col = startCol, row = startRow, direction = initial;
      while (direction >= 0) {
        const index = row * stride + col;
        edges[index] &= ~(1 << direction);
        const nextCol = col + dc[direction], nextRow = row + dr[direction];
        area += col * nextRow - nextCol * row;
        col = nextCol; row = nextRow;
        points.push(col, row);
        if (col === startCol && row === startRow) break;
        const available = edges[row * stride + col];
        const left = (direction + 3) % 4, right = (direction + 1) % 4, reverse = (direction + 2) % 4;
        direction = available & (1 << left) ? left : available & (1 << direction) ? direction : available & (1 << right) ? right : available & (1 << reverse) ? reverse : -1;
      }
      if (points.length >= 8 && col === startCol && row === startRow) {
        loops.push({ points: Int32Array.from(points), signedArea: area / 2 });
      }
    }
  }
  return loops;
}

/** Test-facing view preserves the original point and loop order. */
export function boundaryLoops(grid: LocalGrid, radiusM: number): Loop[] {
  return compactBoundaryLoops(grid, radiusM).map((loop) => {
    const points: LatticePoint[] = [];
    for (let i = 0; i < loop.points.length; i += 2) points.push({ col: loop.points[i], row: loop.points[i + 1] });
    return { points, signedArea: loop.signedArea };
  });
}

function pointInRing(col: number, row: number, ring: Int32Array): boolean {
  let inside = false;
  for (let i = 2, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1];
    const intersects = (ay > row) !== (by > row)
      && col < ((bx - ax) * (row - ay)) / (by - ay) + ax;
    if (intersects) inside = !inside;
  }
  return inside;
}

function vectorPolygons(ctx: EngineContext, grid: LocalGrid): number[][][][] {
  const loops = compactBoundaryLoops(grid, ctx.input.radiusM);
  const outer = loops.filter((loop) => loop.signedArea > 0).sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea));
  const holes = loops.filter((loop) => loop.signedArea < 0);
  const grouped = outer.map((loop) => ({ outer: loop.points, holes: [] as Int32Array[] }));
  for (const hole of holes) {
    const target = grouped.find((candidate) => pointInRing(hole.points[0], hole.points[1], candidate.outer));
    if (target) target.holes.push(hole.points);
  }

  const toMeters = (points: Int32Array): number[][] => {
    const result: number[][] = [];
    for (let i = 0; i < points.length; i += 2) result.push([
      grid.x0 + (points[i] - 0.5) * grid.cellM,
      grid.y0 + (points[i + 1] - 0.5) * grid.cellM,
    ]);
    return result;
  };
  const candidates: Array<{ rings: number[][][]; areaM2: number }> = [];
  for (const candidate of grouped) {
    const rings = [candidate.outer, ...candidate.holes].map((ring) => simplifyRing(toMeters(ring), MAX_VECTOR_VERTICES));
    if (rings[0].length < 4) continue;
    const geometry = { type: "Polygon" as const, coordinates: rings };
    const clipped = areaInCircle(ctx.input.center, ctx.input.radiusM, geometry);
    if (!clipped || clipped.areaM2 <= 0) continue;
    for (const part of clipped.parts) {
      const simplified = part.map((ring) => simplifyRing(ring, MAX_VECTOR_VERTICES));
      if (simplified[0]?.length >= 4) candidates.push({ rings: simplified, areaM2: polygonArea(simplified) });
    }
  }
  return candidates
    .filter((candidate) => candidate.areaM2 > 0)
    .sort((a, b) => b.areaM2 - a.areaM2)
    .slice(0, MAX_VECTOR_POLYGONS)
    .map((candidate) => candidate.rings);
}

/** Grid cell centres inside the study circle. */
export function canopyCellStats(grid: LocalGrid, radiusM: number): { valid: number; canopy: number } {
  let valid = 0;
  let canopy = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.x0 + col * grid.cellM;
      const y = grid.y0 + row * grid.cellM;
      if (Math.hypot(x - grid.cx, y - grid.cy) > radiusM + 1e-9) continue;
      const value = grid.values[row * grid.cols + col];
      if (!Number.isFinite(value)) continue;
      valid += 1;
      if (value >= 0.5) canopy += 1;
    }
  }
  return { valid, canopy };
}

let yearCache: { year: number; fetchedAt: number } | null = null;
function loadMosaic(ctx: EngineContext, options: CanopyForOptions): Mosaic | null {
  if (options.mosaic) return options.mosaic;
  if (!process.env.NGII_API_KEY) return null;
  const cacheRoot = process.env.V2_NGII_AIR_CACHE_DIR ?? join(dirname(process.env.V2_DATA_DIR ?? resolve(process.cwd(), ".cache/v2/data")), "raw", "ngii-air");
  const worker = resolve(process.cwd(), "src/lib/v2/engine/ngii-air-worker.cjs");
  const cachedYear = yearCache && Date.now() - yearCache.fetchedAt < 86400000 ? yearCache.year : null;
  const result = spawnSync(process.execPath, [worker, JSON.stringify({ center: toUtmk(ctx.input.center), radiusM: ctx.input.radiusM, cacheRoot, cachedYear })], {
    encoding: "buffer", maxBuffer: 512 * 1024 * 1024, timeout: 300000, windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout || result.stdout.length < 4) return null;
  try {
    const length = result.stdout.readUInt32LE(0);
    const header = JSON.parse(result.stdout.subarray(4, 4 + length).toString("utf8"));
    const start = 4 + length, end = start + header.rgbBytes;
    if (end + header.width * header.height !== result.stdout.length) return null;
    if (header.yearFetched) yearCache = { year: header.year, fetchedAt: Date.now() };
    return { ...header, rgb: result.stdout.subarray(start, end), valid: result.stdout.subarray(end) };
  } catch { return null; }
}

const CANOPY_RESULT_VERSION = "canopy-result-2-bldgmask";

/** 영상과 실제 건물 링이 같을 때만 검출·격자·벡터 결과를 재사용한다. */
function resultCachePath(ctx: EngineContext, mosaic: Mosaic, options: CanopyForOptions, buildings: readonly Obstacle[], buildingMaskApplied: boolean): string | null {
  const dir = options.resultCacheDir ?? process.env.V2_CANOPY_RESULT_DIR;
  if (!dir || dir === "off") return null;
  const hash = createHash("sha1");
  hash.update(JSON.stringify([CANOPY_RESULT_VERSION, ctx.input.center, ctx.input.radiusM, mosaic.z, mosaic.x0Px, mosaic.y0Px, mosaic.utmkOrigin, mosaic.year, mosaic.width, mosaic.height, mosaic.mPerPx, mosaic.missingTiles, mosaic.totalTiles]));
  hash.update(mosaic.rgb);
  if (mosaic.valid) hash.update(mosaic.valid);
  hash.update(JSON.stringify([buildingMaskApplied, buildings.map((building) => building.ring)]));
  return join(dir, `${hash.digest("hex")}.bin`);
}

function readResultCache(file: string): CanopyResult | null {
  try {
    const bytes = readFileSync(file);
    const headerLength = bytes.readUInt32LE(0);
    const header = JSON.parse(bytes.subarray(4, 4 + headerLength).toString("utf8")) as Omit<CanopyResult, "grid"> & { grid: Omit<LocalGrid, "values"> };
    const raw = inflateSync(bytes.subarray(4 + headerLength));
    const values = new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    if (values.length !== header.grid.cols * header.grid.rows) return null;
    return { ...header, grid: { ...header.grid, values } };
  } catch {
    return null;
  }
}

function writeResultCache(file: string, result: CanopyResult): void {
  try {
    const { values, ...grid } = result.grid;
    const header = Buffer.from(JSON.stringify({ ...result, grid }));
    const length = Buffer.alloc(4);
    length.writeUInt32LE(header.length, 0);
    const body = deflateSync(Buffer.from(values.buffer, values.byteOffset, values.byteLength), { level: 1 });
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, Buffer.concat([length, header, body]));
    renameSync(temporary, file);
  } catch {
    // The cache is an optimisation only.
  }
}

/** 한 분석의 모든 무거운 수관 소비자가 같은 모자이크·벡터를 재사용한다. */
export function canopyFor(ctx: EngineContext, options: CanopyForOptions = {}): CanopyResult | null {
  return ctx.memo("canopy:polygons", () => {
    const mosaic = loadMosaic(ctx, options);
    if (!mosaic || mosaic.totalTiles <= 0 || mosaic.missingTiles >= mosaic.totalTiles) return null;
    options.onMosaic?.(mosaic);
    const buildingMaskApplied = buildingsReady(ctx);
    const buildings = buildingMaskApplied ? sunObstaclesFor(ctx, null) : [];
    const cacheFile = resultCachePath(ctx, mosaic, options, buildings, buildingMaskApplied);
    const cached = cacheFile ? readResultCache(cacheFile) : null;
    if (cached) return cached;
    const detected = detectCanopy(mosaic);
    const grid = canopyToGrid(mosaic, detected.mask, ctx.input.center, ctx.input.radiusM, 1);
    const buildingMask = new Uint8Array(grid.values.length);
    const rasterGrid = { ...grid, x0: grid.x0 - grid.cellM / 2, y0: grid.y0 - grid.cellM / 2 };
    for (const building of buildings) fillRing(buildingMask, rasterGrid, building.ring);
    for (let i = 0; i < buildingMask.length; i++) {
      if (buildingMask[i] && Number.isFinite(grid.values[i])) grid.values[i] = 0;
    }
    const stats = canopyCellStats(grid, ctx.input.radiusM);
    const polygons = vectorPolygons(ctx, grid);
    const result: CanopyResult = {
      grid,
      polygons,
      threshold: detected.threshold,
      coveragePct: stats.valid === 0 ? 0 : (stats.canopy / stats.valid) * 100,
      missingTiles: mosaic.missingTiles,
      totalTiles: mosaic.totalTiles,
      buildingMaskApplied,
      ...(mosaic.year ? { year: mosaic.year } : {}),
    };
    if (cacheFile) writeResultCache(cacheFile, result);
    return result;
  });
}
