/** D10 수관 래스터·벡터를 S04가 재사용하는 공통 계산. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
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
  /** 검출 결과(격자·벡터)를 분석 간에 재사용하는 디렉터리. 명시적으로 지정할 때만 사용한다. 'off'면 끈다. */
  resultCacheDir?: string;
}

type Edge = { start: string; end: string; direction: number };
type LatticePoint = { col: number; row: number };
type Loop = { points: LatticePoint[]; signedArea: number };

const MAX_VECTOR_POLYGONS = 3000;
const MAX_VECTOR_VERTICES = 200;
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

// shortcut: 허가된 영상 원천이 없어 주입된 모자이크만 쓴다. 대체 원천(토지피복지도·정사영상 등)을 정하면 여기에 연결.
function loadMosaic(options: CanopyForOptions): Mosaic | null {
  return options.mosaic ?? null;
}

const CANOPY_RESULT_VERSION = "canopy-result-1";

/** 같은 영상 픽셀·중심·반경이면 검출·격자·벡터 결과가 같으므로, 영상 내용 해시를 키로 디스크에 보관한다. */
function resultCachePath(ctx: EngineContext, mosaic: Mosaic, options: CanopyForOptions): string | null {
  const dir = options.resultCacheDir ?? process.env.V2_CANOPY_RESULT_DIR;
  if (!dir || dir === "off") return null;
  const hash = createHash("sha1");
  hash.update(JSON.stringify([CANOPY_RESULT_VERSION, ctx.input.center, ctx.input.radiusM, mosaic.z, mosaic.x0Px, mosaic.y0Px, mosaic.width, mosaic.height, mosaic.mPerPx, mosaic.missingTiles, mosaic.totalTiles]));
  hash.update(mosaic.rgb);
  if (mosaic.valid) hash.update(mosaic.valid);
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
    const mosaic = loadMosaic(options);
    if (!mosaic || mosaic.totalTiles <= 0 || mosaic.missingTiles >= mosaic.totalTiles) return null;
    const cacheFile = resultCachePath(ctx, mosaic, options);
    const cached = cacheFile ? readResultCache(cacheFile) : null;
    if (cached) return cached;
    const detected = detectCanopy(mosaic);
    const grid = canopyToGrid(mosaic, detected.mask, ctx.input.center, ctx.input.radiusM, 1);
    const stats = canopyCellStats(grid, ctx.input.radiusM);
    const result: CanopyResult = {
      grid,
      polygons: vectorPolygons(ctx, grid),
      threshold: detected.threshold,
      coveragePct: stats.valid === 0 ? 0 : (stats.canopy / stats.valid) * 100,
      missingTiles: mosaic.missingTiles,
      totalTiles: mosaic.totalTiles,
    };
    if (cacheFile) writeResultCache(cacheFile, result);
    return result;
  });
}
