/** S02·S04가 공유하는 반경 일조 격자, 장애물, 지형 지평선 계산. */
import type BetterSqlite3 from "better-sqlite3";
import type { Geometry, Position } from "geojson";
import { toLngLat, toUtmk } from "../../crs";
import { computeSunField, fillRing, type Obstacle, type SunFieldResult, type SunGrid } from "../../sim/sun-field";
import { terrainHorizon, type HorizonMap } from "../../sim/horizon";
import type { EngineContext, SourceRef } from "../context";
import { demReader } from "./terrain-shared";

export const SUN_INFLUENCE_M = 400;

export type SunDateKey = "spring" | "summer" | "autumn" | "winter" | "analysis";
export const SEASON_SUN_DATES = {
  spring: [3, 20],
  summer: [6, 21],
  autumn: [9, 23],
  winter: [12, 22],
} as const;
export const SEASON_LABEL = {
  spring: "춘분",
  summer: "하지",
  autumn: "추분",
  winter: "동지",
  analysis: "분석일",
} as const;

const BUILDING_SOURCES = ["building", "gis_bldg"] as const;
const FEATURE_COLUMNS = ["feature_id", "stable_id", "kind", "release_id", "geom_json", "name", "pnu", "legal_code", "properties_json"] as const;

interface BuildingFactRow {
  feature_id: number;
  height_m: unknown;
}

function columns(db: BetterSqlite3.Database, table: string): Set<string> {
  try {
    return new Set((db.prepare("PRAGMA table_info(" + table + ")").all() as Array<{ name: string }>).map((column) => column.name));
  } catch {
    return new Set();
  }
}

function buildingReady(ctx: EngineContext): boolean {
  const db = ctx.db("buildings");
  if (!db || ctx.sources("buildings", BUILDING_SOURCES).length === 0) return false;
  const featureColumns = columns(db, "feature");
  const factColumns = columns(db, "building_fact");
  return FEATURE_COLUMNS.every((column) => featureColumns.has(column)) && factColumns.has("feature_id") && factColumns.has("height_m");
}

export function sunBuildingSources(ctx: EngineContext): SourceRef[] {
  return ctx.sources("buildings", BUILDING_SOURCES);
}

function factByFeature(db: BetterSqlite3.Database, featureIds: number[]): Map<number, BuildingFactRow> {
  if (featureIds.length === 0) return new Map();
  const rows = db
    .prepare("SELECT feature_id, height_m FROM building_fact WHERE feature_id IN (" + featureIds.map(() => "?").join(",") + ")")
    .all(...featureIds) as BuildingFactRow[];
  return new Map(rows.map((row) => [row.feature_id, row]));
}

function ringPositions(positions: readonly Position[] | undefined): XY[] {
  if (!positions) return [];
  const ring = positions
    .filter((position): position is Position & [number, number] => position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1]))
    .map((position) => [position[0], position[1]] as XY);
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  return ring.length >= 3 ? ring : [];
}

type XY = [number, number];

function outerRings(geometry: Geometry): XY[][] {
  if (geometry.type === "Polygon") {
    const ring = ringPositions(geometry.coordinates[0]);
    return ring.length >= 3 ? [ring] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((polygon) => ringPositions(polygon[0])).filter((ring) => ring.length >= 3);
  }
  return [];
}

function heightOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

function buildingObstacles(ctx: EngineContext): Obstacle[] | null {
  if (!buildingReady(ctx)) return null;
  const db = ctx.db("buildings");
  if (!db) return null;
  const radius = ctx.input.radiusM + SUN_INFLUENCE_M;
  const hits = ctx.hits("buildings", ["building"], radius);
  const facts = factByFeature(db, hits.map((hit) => hit.featureId));
  const obstacles: Obstacle[] = [];
  for (const hit of hits) {
    const heightM = heightOf(facts.get(hit.featureId)?.height_m);
    for (const ring of outerRings(hit.geometry)) obstacles.push({ ring, heightM, baseZ: null, kind: "building" });
  }
  return obstacles;
}

function canopyObstacles(canopy: number[][][][] | null): Obstacle[] {
  if (!canopy) return [];
  const obstacles: Obstacle[] = [];
  for (const polygon of canopy) {
    const ring = ringPositions(polygon[0] as Position[]);
    if (ring.length >= 3) obstacles.push({ ring, heightM: 8, baseZ: null, kind: "canopy" });
  }
  return obstacles;
}

/** 건물은 반경 + 400m 전체를 사용한다. 수관은 호출자가 넘길 때만 추가한다. */
export function sunObstaclesFor(ctx: EngineContext, canopy: number[][][][] | null): Obstacle[] {
  const key = canopy ? "sun:obstacles:canopy" : "sun:obstacles:buildings";
  return ctx.memo(key, () => [...(buildingObstacles(ctx) ?? []), ...canopyObstacles(canopy)]);
}

export function sunCellM(radiusM: number): 2 | 4 | 6 {
  if (!Number.isFinite(radiusM) || radiusM <= 0) throw new RangeError("radiusM must be positive");
  if (radiusM <= 1000) return 2;
  if (radiusM <= 2000) return 4;
  return 6;
}

function insideCircle(x: number, y: number, cx: number, cy: number, radiusM: number): boolean {
  return Math.hypot(x - cx, y - cy) <= radiusM;
}

function coarseGround(
  dem: { elevation: (lng: number, lat: number) => number | null },
  cx: number,
  cy: number,
  radiusM: number,
  cellM: number,
  cols: number,
  rows: number,
  x0: number,
  y0: number,
): Float32Array {
  // GLO-30 has no information at 2m spacing. Sample it at its native scale,
  // then bilinearly expand once to the receiver grid. This keeps the terrain
  // contract while avoiding one SQLite lookup for every 2m cell.
  const sampleM = 30;
  const sampleCols = Math.ceil((radiusM * 2) / sampleM) + 1;
  const sampleRows = sampleCols;
  const sample = new Float32Array(sampleCols * sampleRows);
  sample.fill(Number.NaN);
  for (let row = 0; row < sampleRows; row++) {
    const y = cy - radiusM + row * sampleM;
    for (let col = 0; col < sampleCols; col++) {
      const x = cx - radiusM + col * sampleM;
      const [lng, lat] = toLngLat([x, y]);
      const value = dem.elevation(lng, lat);
      if (value !== null) sample[row * sampleCols + col] = value;
    }
  }
  const out = new Float32Array(cols * rows);
  out.fill(Number.NaN);
  const sampleAt = (row: number, col: number): number => sample[row * sampleCols + col];
  for (let row = 0; row < rows; row++) {
    const y = y0 + (row + 0.5) * cellM;
    const fy = Math.max(0, Math.min(sampleRows - 1, (y - (cy - radiusM)) / sampleM));
    const row0 = Math.floor(fy);
    const row1 = Math.min(sampleRows - 1, row0 + 1);
    const ty = fy - row0;
    for (let col = 0; col < cols; col++) {
      const x = x0 + (col + 0.5) * cellM;
      const fx = Math.max(0, Math.min(sampleCols - 1, (x - (cx - radiusM)) / sampleM));
      const col0 = Math.floor(fx);
      const col1 = Math.min(sampleCols - 1, col0 + 1);
      const tx = fx - col0;
      const z00 = sampleAt(row0, col0);
      const z10 = sampleAt(row0, col1);
      const z01 = sampleAt(row1, col0);
      const z11 = sampleAt(row1, col1);
      const values = [z00, z10, z01, z11].filter(Number.isFinite);
      if (values.length === 0) continue;
      const a = Number.isFinite(z00) && Number.isFinite(z10) ? z00 * (1 - tx) + z10 * tx : Number.isFinite(z00) ? z00 : z10;
      const b = Number.isFinite(z01) && Number.isFinite(z11) ? z01 * (1 - tx) + z11 * tx : Number.isFinite(z01) ? z01 : z11;
      out[row * cols + col] = Number.isFinite(a) && Number.isFinite(b) ? a * (1 - ty) + b * ty : values[0];
    }
  }
  return out;
}

function makeHorizonLookup(horizon: HorizonMap): (x: number, y: number, azimuthDeg: number) => number {
  const byAzimuth = new Map<number, Float32Array>();
  let lastAzimuth = Number.NaN;
  let lastValues: Float32Array | null = null;
  const valuesFor = (azimuthDeg: number): Float32Array => {
    const normalized = Math.round((((azimuthDeg % 360) + 360) % 360) * 1000) / 1000;
    const cached = byAzimuth.get(normalized);
    if (cached) return cached;
    const direction = (normalized / 360) * horizon.azimuths;
    const az0 = Math.floor(direction) % horizon.azimuths;
    const az1 = (az0 + 1) % horizon.azimuths;
    const ta = direction - Math.floor(direction);
    const values = new Float32Array(horizon.cols * horizon.rows);
    for (let row = 0; row < horizon.rows; row++) {
      for (let col = 0; col < horizon.cols; col++) {
        const index = (row * horizon.cols + col) * horizon.azimuths;
        values[row * horizon.cols + col] = horizon.angleDeg[index + az0] * (1 - ta) + horizon.angleDeg[index + az1] * ta;
      }
    }
    byAzimuth.set(normalized, values);
    return values;
  };
  return (x, y, azimuthDeg) => {
    if (azimuthDeg !== lastAzimuth || lastValues === null) {
      lastAzimuth = azimuthDeg;
      lastValues = valuesFor(azimuthDeg);
    }
    const values = lastValues;
    // The DEM horizon itself is a 30m observation grid. Nearest-cell lookup
    // avoids repeating four spatial interpolations for every 2m receiver;
    // the terrain height was already bilinearly expanded in groundZ.
    const col = Math.max(0, Math.min(horizon.cols - 1, Math.round((x - horizon.x0) / horizon.cellM - 0.5)));
    const row = Math.max(0, Math.min(horizon.rows - 1, Math.round((y - horizon.y0) / horizon.cellM - 0.5)));
    return values[row * horizon.cols + col];
  };
}

function horizonLookupFor(ctx: EngineContext, horizon: HorizonMap): (x: number, y: number, azimuthDeg: number) => number {
  return ctx.memo("sun:horizon:lookup", () => makeHorizonLookup(horizon));
}

function makeGrid(ctx: EngineContext, obstacles: readonly Obstacle[], cellM: number): SunGrid {
  const [cx, cy] = toUtmk(ctx.input.center);
  const cols = Math.max(1, Math.ceil((ctx.input.radiusM * 2) / cellM));
  const rows = cols;
  const x0 = cx - ctx.input.radiusM;
  const y0 = cy - ctx.input.radiusM;
  const receiver = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    const y = y0 + (row + 0.5) * cellM;
    for (let col = 0; col < cols; col++) {
      const x = x0 + (col + 0.5) * cellM;
      if (insideCircle(x, y, cx, cy, ctx.input.radiusM)) receiver[row * cols + col] = 1;
    }
  }

  const dem = demReader(ctx);
  let groundZ: Float32Array | null = null;
  if (dem) {
    groundZ = coarseGround(dem, cx, cy, ctx.input.radiusM, cellM, cols, rows, x0, y0);
  }

  const roof = new Uint8Array(cols * rows);
  for (const obstacle of obstacles) if (obstacle.kind === "building") fillRing(roof, { x0, y0, cellM, cols, rows }, obstacle.ring);
  for (let index = 0; index < receiver.length; index++) if (receiver[index] === 1 && roof[index]) receiver[index] = 2;
  return { x0, y0, cellM, cols, rows, receiver, groundZ };
}

/** 반경 원 격자와 건물 지붕(2)을 한 번만 만든다. */
export function sunGridFor(ctx: EngineContext): SunGrid | null {
  return ctx.memo("sun:grid", () => {
    const obstacles = sunObstaclesFor(ctx, null);
    if (obstacles.length === 0 && !buildingReady(ctx)) return null;
    return makeGrid(ctx, obstacles, sunCellM(ctx.input.radiusM));
  });
}

/** DEM이 게시된 경우에만 공통 30m·72방위 지평선 지도를 만든다. */
export function horizonFor(ctx: EngineContext): HorizonMap | null {
  return ctx.memo("sun:horizon", () => {
    const dem = demReader(ctx);
    if (!dem) return null;
    const [cx, cy] = toUtmk(ctx.input.center);
    const nativeM = 30;
    const sampled = new Map<string, number | null>();
    const elevationAtNative = (x: number, y: number): number | null => {
      const gx = Math.round(x / nativeM);
      const gy = Math.round(y / nativeM);
      const key = gx + ":" + gy;
      if (sampled.has(key)) return sampled.get(key) ?? null;
      const [lng, lat] = toLngLat([gx * nativeM, gy * nativeM]);
      const value = dem.elevation(lng, lat);
      sampled.set(key, value);
      return value;
    };
    return terrainHorizon(
      elevationAtNative,
      { minX: cx - ctx.input.radiusM, minY: cy - ctx.input.radiusM, maxX: cx + ctx.input.radiusM, maxY: cy + ctx.input.radiusM },
      { cellM: 30, azimuths: 72, searchM: 5000 },
    );
  });
}

function dateFor(ctx: EngineContext, dateKey: SunDateKey): { year: number; month: number; day: number } {
  if (dateKey === "analysis") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.input.analysisDate);
    if (!match) throw new RangeError("invalid analysis date: " + ctx.input.analysisDate);
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }
  const date = SEASON_SUN_DATES[dateKey];
  const year = Number(ctx.input.analysisDate.slice(0, 4));
  return { year, month: date[0], day: date[1] };
}

/** 날짜별 일조장은 한 분석 안에서 S02·S04가 공유한다. */
export function sunFieldFor(ctx: EngineContext, dateKey: SunDateKey): SunFieldResult | null {
  return ctx.memo("sun:field:" + dateKey, () => {
    const grid = sunGridFor(ctx);
    if (!grid) return null;
    const obstacles = sunObstaclesFor(ctx, null);
    const horizon = horizonFor(ctx);
    const date = dateFor(ctx, dateKey);
    return computeSunField({
      grid,
      obstacles,
      latDeg: ctx.input.center[1],
      lonDeg: ctx.input.center[0],
      date,
      stepMin: 10,
      hourlyFrom: 5,
      continuousTst: [540, 900],
      totalTst: [480, 960],
      horizon: horizon ? horizonLookupFor(ctx, horizon) : undefined,
    });
  });
}

export function sunDateValue(ctx: EngineContext, dateKey: SunDateKey): string {
  const date = dateFor(ctx, dateKey);
  return String(date.year).padStart(4, "0") + "-" + String(date.month).padStart(2, "0") + "-" + String(date.day).padStart(2, "0");
}

export function sunSources(ctx: EngineContext): SourceRef[] {
  return sunBuildingSources(ctx);
}

export function sunBuildingHitCount(ctx: EngineContext): number {
  if (!buildingReady(ctx)) return 0;
  return ctx.hits("buildings", ["building"], ctx.input.radiusM + SUN_INFLUENCE_M).length;
}

export function sunBuildingReady(ctx: EngineContext): boolean {
  return buildingReady(ctx);
}
