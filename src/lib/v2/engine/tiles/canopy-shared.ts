/** D10 수관 래스터·벡터를 S04가 재사용하는 공통 계산. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { LngLat } from "../../crs";
import type { Mosaic } from "../imagery";
import type { EngineContext } from "../context";
import { areaInCircle, polygonArea, simplifyRing } from "./geo";
import { canopyToGrid, detectCanopy } from "../../sim/canopy";
import type { LocalGrid } from "./raster-grid";

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
}

export interface CanopyForOptions {
  /** 테스트·재현용으로 이미 디코드한 모자이크를 주입한다. 작업자는 기본 경로를 사용한다. */
  mosaic?: Mosaic;
  cacheRoot?: string;
}

type Edge = { start: string; end: string; direction: number };
type LatticePoint = { col: number; row: number };
type Loop = { points: LatticePoint[]; signedArea: number };

const MAX_VECTOR_POLYGONS = 3000;
const MAX_VECTOR_VERTICES = 200;
const DEFAULT_AERIAL_CACHE_ROOT = "D:/V-coding/16-SiteAnalysis/.cache/v2/raw/aerial";

/** Next bundles this module under .next, while sharp is supplied by the main checkout. */
function sharpEntry(): string | null {
  let root = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(root, "node_modules", "sharp", "lib", "index.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(root);
    if (parent === root) break;
    root = parent;
  }
  return null;
}

function key(point: LatticePoint): string {
  return `${point.col},${point.row}`;
}

function pointOf(value: string): LatticePoint {
  const [col, row] = value.split(",").map(Number);
  return { col, row };
}

function directionOf(a: LatticePoint, b: LatticePoint): number {
  if (b.col > a.col) return 0;
  if (b.row > a.row) return 1;
  if (b.col < a.col) return 2;
  return 3;
}

function signedArea(points: readonly LatticePoint[]): number {
  let area = 0;
  for (let i = 1; i < points.length; i++) area += points[i - 1].col * points[i].row - points[i].col * points[i - 1].row;
  return area / 2;
}

function addEdge(edges: Map<string, Edge[]>, start: LatticePoint, end: LatticePoint): void {
  const from = key(start);
  const list = edges.get(from) ?? [];
  list.push({ start: from, end: key(end), direction: directionOf(start, end) });
  edges.set(from, list);
}

function isCanopyCell(grid: LocalGrid, col: number, row: number, radiusM: number): boolean {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  const x = grid.x0 + col * grid.cellM;
  const y = grid.y0 + row * grid.cellM;
  if (Math.hypot(x - grid.cx, y - grid.cy) > radiusM + grid.cellM * 0.75) return false;
  return grid.values[row * grid.cols + col] >= 0.5;
}

/** 1m binary grid의 경계만 걷는다. 셀별 Turf 폴리곤을 만들지 않아 800m도 선형 시간이다. */
function boundaryLoops(grid: LocalGrid, radiusM: number): Loop[] {
  const edges = new Map<string, Edge[]>();
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!isCanopyCell(grid, col, row, radiusM)) continue;
      if (!isCanopyCell(grid, col, row - 1, radiusM)) addEdge(edges, { col, row }, { col: col + 1, row });
      if (!isCanopyCell(grid, col + 1, row, radiusM)) addEdge(edges, { col: col + 1, row }, { col: col + 1, row: row + 1 });
      if (!isCanopyCell(grid, col, row + 1, radiusM)) addEdge(edges, { col: col + 1, row: row + 1 }, { col, row: row + 1 });
      if (!isCanopyCell(grid, col - 1, row, radiusM)) addEdge(edges, { col, row: row + 1 }, { col, row });
    }
  }

  const loops: Loop[] = [];
  const compareEdges = (a: Edge, b: Edge) => a.direction - b.direction || a.end.localeCompare(b.end);
  for (const list of edges.values()) list.sort(compareEdges);
  const used = new Set<string>();
  const edgeId = (edge: Edge) => `${edge.start}>${edge.end}`;
  const nextEdge = (current: Edge): Edge | null => {
    const candidates = (edges.get(current.end) ?? []).filter((edge) => !used.has(edgeId(edge)));
    if (candidates.length === 0) return null;
    // The boundary keeps the filled side on its left: left turn, straight,
    // right turn, then the rare reverse at a diagonal contact.
    const wanted = [
      (current.direction + 3) % 4,
      current.direction,
      (current.direction + 1) % 4,
      (current.direction + 2) % 4,
    ];
    candidates.sort((a, b) => wanted.indexOf(a.direction) - wanted.indexOf(b.direction) || compareEdges(a, b));
    return candidates[0];
  };

  const starts = [...edges.values()].flat().sort((a, b) => a.start.localeCompare(b.start) || compareEdges(a, b));
  for (const first of starts) {
    if (used.has(edgeId(first))) continue;
    const points = [pointOf(first.start)];
    let edge: Edge | null = first;
    const firstStart = first.start;
    while (edge && !used.has(edgeId(edge))) {
      used.add(edgeId(edge));
      points.push(pointOf(edge.end));
      if (edge.end === firstStart) break;
      edge = nextEdge(edge);
    }
    if (points.length >= 4 && points.at(-1)?.col === points[0].col && points.at(-1)?.row === points[0].row) {
      loops.push({ points, signedArea: signedArea(points) });
    }
  }
  return loops;
}

function pointInRing(point: LatticePoint, ring: readonly LatticePoint[]): boolean {
  let inside = false;
  for (let i = 1, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const intersects = (a.row > point.row) !== (b.row > point.row)
      && point.col < ((b.col - a.col) * (point.row - a.row)) / (b.row - a.row) + a.col;
    if (intersects) inside = !inside;
  }
  return inside;
}

function vectorPolygons(ctx: EngineContext, grid: LocalGrid): number[][][][] {
  const loops = boundaryLoops(grid, ctx.input.radiusM);
  const outer = loops.filter((loop) => loop.signedArea > 0).sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea));
  const holes = loops.filter((loop) => loop.signedArea < 0);
  const grouped = outer.map((loop) => ({ outer: loop.points, holes: [] as LatticePoint[][] }));
  for (const hole of holes) {
    const target = grouped.find((candidate) => pointInRing(hole.points[0], candidate.outer));
    if (target) target.holes.push(hole.points);
  }

  const toMeters = (points: readonly LatticePoint[]): number[][] => points.map(({ col, row }) => [
    grid.x0 + (col - 0.5) * grid.cellM,
    grid.y0 + (row - 0.5) * grid.cellM,
  ]);
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

/**
 * The T3 worker calls tile engines synchronously. T15's sharp decoder is
 * asynchronous, so the worker-side bridge performs the WMTS fetch/decode in a
 * short-lived Node child and returns a binary payload. This keeps sharp off the
 * event loop without weakening the production cache or the 22s first-run cap.
 */
function satelliteMosaicSync(center: LngLat, radiusM: number, cacheRoot: string): Mosaic | null {
  const sharpPath = sharpEntry();
  if (!sharpPath) return null;
  const worker = String.raw`
const fs = require("fs");
const path = require("path");
const sharp = require(process.argv[1]);
const input = JSON.parse(process.argv[2]);
const TILE = 256;
const MAX_LAT = 85.05112878;
const EARTH_RADIUS_M = 6378137;
function worldSize(z) { return TILE * 2 ** z; }
function globalPixel(center, z) {
  const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, center[1]));
  const size = worldSize(z);
  const sin = Math.sin(lat * Math.PI / 180);
  return [((center[0] + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
}
function mPerPixel(lat, z) { return Math.cos(lat * Math.PI / 180) * 2 * Math.PI * EARTH_RADIUS_M / worldSize(z); }
function wrapX(x, z) { const n = 2 ** z; return ((x % n) + n) % n; }
function cachePath(x, y, z) { return path.join(input.cacheRoot, "Satellite", String(z), String(y), String(x) + ".jpeg"); }
async function decode(bytes) {
  const decoded = await sharp(bytes, { failOn: "none" }).raw().toBuffer({ resolveWithObject: true });
  let data = decoded.data;
  let info = decoded.info;
  if (info.width !== TILE || info.height !== TILE) {
    const resized = await sharp(bytes, { failOn: "none" }).resize(TILE, TILE, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
    data = resized.data; info = resized.info;
  }
  const rgb = Buffer.alloc(TILE * TILE * 3);
  for (let i = 0; i < TILE * TILE; i++) {
    const from = i * info.channels;
    const to = i * 3;
    const value = data[from] || 0;
    rgb[to] = value;
    rgb[to + 1] = info.channels > 2 ? data[from + 1] || 0 : value;
    rgb[to + 2] = info.channels > 2 ? data[from + 2] || 0 : value;
  }
  return rgb;
}
async function fetchTile(x, y, z) {
  const wrapped = wrapX(x, z);
  const file = cachePath(wrapped, y, z);
  let bytes;
  try { bytes = fs.readFileSync(file); }
  catch {
    const key = process.env.VWORLD_API_KEY;
    if (!key || y < 0 || y >= 2 ** z) return null;
    try {
      const url = "https://api.vworld.kr/req/wmts/1.0.0/" + encodeURIComponent(key) + "/Satellite/" + z + "/" + y + "/" + wrapped + ".jpeg";
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok || !(response.headers.get("content-type") || "").startsWith("image/")) return null;
      bytes = Buffer.from(await response.arrayBuffer());
      try { const tmp = file + "." + process.pid + ".tmp"; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, file); } catch {}
    } catch { return null; }
  }
  try { return { x, y, rgb: await decode(bytes) }; } catch { return null; }
}
(async () => {
  const z = input.radiusM <= 1000 ? 18 : 17;
  const resolution = mPerPixel(input.center[1], z);
  const [cx, cy] = globalPixel(input.center, z);
  const half = input.radiusM / resolution;
  const x0 = Math.floor(cx - half); const y0 = Math.floor(cy - half);
  const x1 = Math.ceil(cx + half); const y1 = Math.ceil(cy + half);
  const width = Math.max(1, x1 - x0); const height = Math.max(1, y1 - y0);
  const firstX = Math.floor(x0 / TILE); const lastX = Math.floor((x1 - 1) / TILE);
  const firstY = Math.floor(y0 / TILE); const lastY = Math.floor((y1 - 1) / TILE);
  const coords = [];
  for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) coords.push({ x, y });
  const tiles = await Promise.all(coords.map((coordinate) => fetchTile(coordinate.x, coordinate.y, z)));
  const rgb = Buffer.alloc(width * height * 3); const valid = Buffer.alloc(width * height);
  let missing = 0;
  for (let i = 0; i < coords.length; i++) {
    const tile = tiles[i]; if (!tile) { missing++; continue; }
    const left = Math.max(x0, tile.x * TILE); const right = Math.min(x1, tile.x * TILE + TILE);
    const top = Math.max(y0, tile.y * TILE); const bottom = Math.min(y1, tile.y * TILE + TILE);
    if (tile.y < 0 || tile.y >= 2 ** z) { missing++; continue; }
    for (let gy = top; gy < bottom; gy++) for (let gx = left; gx < right; gx++) {
      const from = ((gy - tile.y * TILE) * TILE + gx - tile.x * TILE) * 3;
      const to = ((gy - y0) * width + gx - x0) * 3;
      rgb[to] = tile.rgb[from]; rgb[to + 1] = tile.rgb[from + 1]; rgb[to + 2] = tile.rgb[from + 2];
      valid[(gy - y0) * width + gx - x0] = 1;
    }
  }
  const header = Buffer.from(JSON.stringify({ z, x0Px: x0, y0Px: y0, width, height, mPerPx: resolution, missingTiles: missing, totalTiles: coords.length, rgbBytes: rgb.length }));
  const output = Buffer.alloc(4 + header.length + rgb.length + valid.length);
  output.writeUInt32LE(header.length, 0); header.copy(output, 4); rgb.copy(output, 4 + header.length); valid.copy(output, 4 + header.length + rgb.length);
  process.stdout.write(output);
})().catch((error) => { process.stderr.write(String(error)); process.exit(1); });
`;
  const result = spawnSync(process.execPath, ["-e", worker, sharpPath, JSON.stringify({ center, radiusM, cacheRoot })], {
    encoding: "buffer",
    maxBuffer: 128 * 1024 * 1024,
    timeout: 35_000,
    windowsHide: true,
  });
  if (result.status !== 0 || !result.stdout || result.stdout.length < 4) return null;
  try {
    const headerLength = result.stdout.readUInt32LE(0);
    const header = JSON.parse(result.stdout.subarray(4, 4 + headerLength).toString("utf8"));
    const start = 4 + headerLength;
    const rgbEnd = start + header.rgbBytes;
    if (rgbEnd + header.width * header.height !== result.stdout.length) return null;
    return {
      z: header.z,
      x0Px: header.x0Px,
      y0Px: header.y0Px,
      width: header.width,
      height: header.height,
      rgb: new Uint8Array(result.stdout.subarray(start, rgbEnd)),
      mPerPx: header.mPerPx,
      missingTiles: header.missingTiles,
      totalTiles: header.totalTiles,
      valid: new Uint8Array(result.stdout.subarray(rgbEnd)),
    };
  } catch {
    return null;
  }
}

function loadMosaic(ctx: EngineContext, options: CanopyForOptions): Mosaic | null {
  if (options.mosaic) return options.mosaic;
  return satelliteMosaicSync(ctx.input.center, ctx.input.radiusM, options.cacheRoot ?? process.env.V2_AERIAL_CACHE_DIR ?? DEFAULT_AERIAL_CACHE_ROOT);
}

/** 한 분석의 모든 무거운 수관 소비자가 같은 모자이크·벡터를 재사용한다. */
export function canopyFor(ctx: EngineContext, options: CanopyForOptions = {}): CanopyResult | null {
  return ctx.memo("canopy:polygons", () => {
    const mosaic = loadMosaic(ctx, options);
    if (!mosaic || mosaic.totalTiles <= 0 || mosaic.missingTiles >= mosaic.totalTiles) return null;
    const detected = detectCanopy(mosaic);
    const grid = canopyToGrid(mosaic, detected.mask, ctx.input.center, ctx.input.radiusM, 1);
    const stats = canopyCellStats(grid, ctx.input.radiusM);
    return {
      grid,
      polygons: vectorPolygons(ctx, grid),
      threshold: detected.threshold,
      coveragePct: stats.valid === 0 ? 0 : (stats.canopy / stats.valid) * 100,
      missingTiles: mosaic.missingTiles,
      totalTiles: mosaic.totalTiles,
    };
  });
}
