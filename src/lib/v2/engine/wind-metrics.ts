/** S03 바람 결과의 공통 계산·격자·검증 도우미.
 *
 * 서버가 보관하는 값은 모두 유입풍으로 정규화한 상대 성분이다. 이 파일은
 * 브라우저 WebGPU 업로드와 D2Q9 대체 계산이 같은 래스터 계약·지표를 쓰도록
 * 입력 경계와 표시 경계를 한 곳에 둔다.
 */
import { inflateRawSync } from "node:zlib";
import type { Geometry } from "geojson";
import { toLngLat, toUtmk } from "../crs";
import type { RasterRef, TileResult } from "../tile-result";
import { encodeRaster, type RasterData } from "../raster-store";
import type { EngineContext, SourceRef } from "./context";
import { computeWind2D, rotateFromWindFrame } from "../sim/lbm2d";
import { pointInRings, ringBBox, type XY } from "../sim/shadow";
import { demReader } from "./tiles/terrain-shared";
import { buildingRetirementLimitations, buildingRows, buildingsReady, BUILDING_SOURCES, type BuildingRow } from "./tiles/buildings-shared";
import { prevailingBySeason, type PrevailingDirection } from "./tiles/d22";
import { est, missing, obs } from "./tiles/common";

export const WIND_SEASONS = ["annual", "spring", "summer", "autumn", "winter"] as const;
export type WindSeason = (typeof WIND_SEASONS)[number];
const WIND_SEASON_LABEL: Record<WindSeason, string> = { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };
export const PEDESTRIAN_LAYER_Z = 6;
export const WIND_CELL_M = 4;
export const WIND_BUFFER_M = 200;
export const WIND_BREAKS = [0.5, 0.8, 1.2, 1.5] as const;
export const WIND_RAW_SCALE = 0.001;
export const FALLBACK_STEPS = 3_000;

export interface WindInflow extends PrevailingDirection {
  source: "season" | "annual";
}

export interface WindCase {
  ref: Omit<RasterRef, "bytes" | "sha256">;
  obstacleValues: Uint16Array;
  centerX: number;
  centerY: number;
  radiusM: number;
  bufferM: number;
  cellM: number;
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  inflow: Record<WindSeason, WindInflow | null>;
  station: { id: string; name: string; distanceM: number } | null;
  maxObstacleM: number;
  terrain: "included" | `excluded:${string}`;
  sources: SourceRef[];
  limitations: TileResult["limitations"];
}

export interface WindMetricInput {
  season: WindSeason;
  ref: Pick<RasterRef, "x0" | "y0" | "cellM" | "cols" | "rows">;
  values: Int16Array;
  obstacleValues: Uint16Array;
  centerX: number;
  centerY: number;
  radiusM: number;
  inflowFromDeg: number | null;
  steps: number;
  mlups: number | null;
}

export interface WindMetricResult {
  metrics: TileResult["metrics"];
  validCells: number;
  median: number | null;
  p90: number | null;
}

export interface EncodedWindLayer {
  ref: RasterRef;
  blob: Buffer;
  values: Int16Array;
}

interface ObstacleCandidate {
  polygons: XY[][][];
  bbox: ReturnType<typeof ringBBox>;
  heightM: number;
}

const finitePositive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

function basis(fromDeg: number): { flowX: number; flowY: number; leftX: number; leftY: number } {
  const radians = (fromDeg * Math.PI) / 180;
  const flowX = -Math.sin(radians);
  const flowY = -Math.cos(radians);
  return { flowX, flowY, leftX: -flowY, leftY: flowX };
}

function geometryPolygons(geometry: Geometry): XY[][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates as unknown as XY[][]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as unknown as XY[][][];
  return [];
}

function candidateFor(row: BuildingRow): ObstacleCandidate | null {
  if (!finitePositive(row.heightM)) return null;
  const polygons = geometryPolygons(row.hit.geometry)
    .map((rings) => rings.filter((ring) => ring.length >= 3) as XY[][])
    .filter((rings) => rings.length > 0);
  if (polygons.length === 0) return null;
  const all = polygons.flatMap((rings) => rings[0] ?? []);
  if (all.length < 3) return null;
  return { polygons, bbox: ringBBox(all), heightM: row.heightM };
}

function contains(candidate: ObstacleCandidate, x: number, y: number): boolean {
  if (x < candidate.bbox.minX || x > candidate.bbox.maxX || y < candidate.bbox.minY || y > candidate.bbox.maxY) return false;
  return candidate.polygons.some((rings) => pointInRings(x, y, rings));
}

function samplesForCell(x: number, y: number, cellM: number): Array<[number, number]> {
  const quarter = cellM * 0.25;
  return [
    [x, y],
    [x - quarter, y - quarter],
    [x + quarter, y - quarter],
    [x + quarter, y + quarter],
    [x - quarter, y + quarter],
  ];
}

function valueAt(reader: ReturnType<typeof demReader>, x: number, y: number): number | null {
  if (!reader) return null;
  const [lng, lat] = toLngLat([x, y]);
  return reader.elevation(lng, lat);
}

function terrainSummary(
  reader: ReturnType<typeof demReader>,
  centerX: number,
  centerY: number,
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  cellM: number,
  maxBuildingM: number,
  direction: number,
): { mode: WindCase["terrain"]; minInflow: number | null; min: number | null; max: number | null } {
  if (!reader) return { mode: "excluded:DEM 미적재", minInflow: null, min: null, max: null };
  const step = Math.max(1, Math.round(30 / cellM));
  let min = Infinity;
  let max = -Infinity;
  let minInflow = Infinity;
  const frame = basis(direction);
  const extent = (cols * cellM) / 2;
  for (let row = 0; row < rows; row += step) {
    for (let col = 0; col < cols; col += step) {
      const x = x0 + (col + 0.5) * cellM;
      const y = y0 + (row + 0.5) * cellM;
      const elevation = valueAt(reader, x, y);
      if (elevation === null) continue;
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
      const dx = x - centerX;
      const dy = y - centerY;
      const windX = frame.flowX * dx + frame.flowY * dy;
      if (windX <= -extent + cellM * 1.5) minInflow = Math.min(minInflow, elevation);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(minInflow)) {
    return { mode: "excluded:DEM 유효 표본 부족", minInflow: null, min: null, max: null };
  }
  const relief = max - min;
  if (!(maxBuildingM > 0)) return { mode: "excluded:건물 높이 자료 없음", minInflow, min, max };
  if (relief > maxBuildingM * 0.5) return { mode: `excluded:지형 기복 ${Math.round(relief * 10) / 10}m가 장애물 높이의 50% 초과`, minInflow, min, max };
  return { mode: "included", minInflow, min, max };
}

function rasterizeObstacles(
  candidates: ObstacleCandidate[],
  reader: ReturnType<typeof demReader>,
  terrain: WindCase["terrain"],
  minInflow: number | null,
  x0: number,
  y0: number,
  cols: number,
  rows: number,
  cellM: number,
): { values: Uint16Array; maxObstacleM: number } {
  const values = new Uint16Array(cols * rows);
  let maxObstacleM = 0;
  for (const candidate of candidates) {
    const minCol = Math.max(0, Math.floor((candidate.bbox.minX - x0) / cellM) - 1);
    const maxCol = Math.min(cols - 1, Math.ceil((candidate.bbox.maxX - x0) / cellM) + 1);
    const minRow = Math.max(0, Math.floor((candidate.bbox.minY - y0) / cellM) - 1);
    const maxRow = Math.min(rows - 1, Math.ceil((candidate.bbox.maxY - y0) / cellM) + 1);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const x = x0 + (col + 0.5) * cellM;
        const y = y0 + (row + 0.5) * cellM;
        if (!samplesForCell(x, y, cellM).some(([sx, sy]) => contains(candidate, sx, sy))) continue;
        let height = candidate.heightM;
        if (terrain === "included" && minInflow !== null) {
          const ground = valueAt(reader, x, y);
          if (ground !== null) height += Math.max(0, ground - minInflow);
        }
        const index = row * cols + col;
        values[index] = Math.max(values[index]!, Math.min(65535, Math.max(1, Math.round(height * 10))));
        maxObstacleM = Math.max(maxObstacleM, height);
      }
    }
  }
  return { values, maxObstacleM };
}

function mergeSources(...groups: SourceRef[][]): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const source of group) {
      const key = `${source.sourceId}:${source.releaseId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(source);
    }
  }
  return out;
}

function inflowsFor(ctx: EngineContext): { inflow: Record<WindSeason, WindInflow | null>; station: WindCase["station"] } {
  const prevailing = prevailingBySeason(ctx);
  const inflow = Object.fromEntries(WIND_SEASONS.map((season) => {
    if (!prevailing) return [season, null];
    if (season === "annual") return [season, prevailing.annual ? { ...prevailing.annual, source: "season" as const } : null];
    const direction = prevailing.seasons[season] ?? prevailing.annual;
    return [season, direction ? { ...direction, source: prevailing.seasons[season] ? "season" as const : "annual" as const } : null];
  })) as Record<WindSeason, WindInflow | null>;
  return { inflow, station: prevailing?.station ?? null };
}

/** 분석 반경 전체(+200m 버퍼)의 건물 장애물과 계절 유입 방향을 만든다. */
export function buildWindCase(ctx: EngineContext): WindCase | null {
  if (!buildingsReady(ctx)) return null;
  const rows = buildingRows(ctx, Math.min(5000, ctx.input.radiusM + WIND_BUFFER_M));
  if (rows === null) return null;
  const weather = inflowsFor(ctx);
  if (!weather.station || !weather.inflow.annual) return null;

  const [centerX, centerY] = toUtmk(ctx.input.center);
  const extent = ctx.input.radiusM + WIND_BUFFER_M;
  const cellM = WIND_CELL_M;
  const cols = Math.max(3, Math.ceil((extent * 2) / cellM));
  const rowsCount = cols;
  const x0 = centerX - (cols * cellM) / 2;
  const y0 = centerY - (rowsCount * cellM) / 2;
  const candidates = rows.map(candidateFor).filter((candidate): candidate is ObstacleCandidate => candidate !== null);
  const unknownCount = rows.filter((row) => !finitePositive(row.heightM)).length;
  let maxBuildingM = 0;
  for (const candidate of candidates) maxBuildingM = Math.max(maxBuildingM, candidate.heightM);
  const annualDirection = weather.inflow.annual.deg;
  const reader = demReader(ctx);
  const terrain = terrainSummary(reader, centerX, centerY, x0, y0, cols, rowsCount, cellM, maxBuildingM, annualDirection);
  const raster = rasterizeObstacles(candidates, reader, terrain.mode, terrain.minInflow, x0, y0, cols, rowsCount, cellM);
  const values = raster.values;
  maxBuildingM = Math.max(maxBuildingM, raster.maxObstacleM);

  const limitations: TileResult["limitations"] = [
    { kind: "estimated", note: "조기설계 참고용 — 풍동·검증 CFD 아님 · 주풍향 1방향 입력 · 보행 안전·인허가 판단에 쓰지 않음" },
    { kind: "estimated", note: "상대풍속 U/U유입만 제공하며 실제 풍속 단위는 제공하지 않음" },
    { kind: "unknown", note: "지형·수목 미포함(지형은 기복이 작을 때만 장애물 높이에 반영)" },
    ...buildingRetirementLimitations(ctx, Math.min(5000, ctx.input.radiusM + WIND_BUFFER_M)),
  ];
  if (Object.values(weather.inflow).some((direction) => direction?.source === "annual")) {
    limitations.push({ kind: "not_provided", note: "계절 장미 미적재 — 계절 사례는 연간 최빈 풍향을 대체 입력으로 사용했습니다." });
  }
  if (weather.station) {
    limitations.push({ kind: "estimated", note: `최근접 ASOS ${weather.station.name} 관측소 거리 ${Math.round(weather.station.distanceM / 100) / 10}km를 유입 대표점으로 사용했습니다.` });
  }
  if (unknownCount > 0) limitations.push({ kind: "unknown", note: `높이 미상 건물 ${unknownCount}개는 장애물에서 제외했습니다.` });
  if (terrain.mode !== "included") limitations.push({ kind: "estimated", note: `지형은 장애물 높이에 반영하지 않았습니다(${terrain.mode.slice("excluded:".length)}).` });
  const sources = mergeSources(
    ctx.sources("buildings", [...BUILDING_SOURCES]),
    ctx.sources("weather", ["asos"]),
    ctx.sources("terrain", ["terrain_tiles", "dem"]),
  );
  return {
    ref: {
      name: "obstacle_height",
      kind: "scalar",
      crs: "EPSG:5179",
      x0,
      y0,
      cellM,
      cols,
      rows: rowsCount,
      dtype: "u16",
      bands: 1,
      scale: 0.1,
      offset: 0,
      nodata: 0,
      palette: "wind_ratio",
      label: "장애물 높이(건물·지형)",
    },
    obstacleValues: values,
    centerX,
    centerY,
    radiusM: ctx.input.radiusM,
    bufferM: WIND_BUFFER_M,
    cellM,
    cols,
    rows: rowsCount,
    x0,
    y0,
    inflow: weather.inflow,
    station: weather.station,
    maxObstacleM: maxBuildingM,
    terrain: terrain.mode,
    sources,
    limitations,
  };
}

export function windCaseSimulation(c: WindCase): Record<string, unknown> {
  return {
    model: "lbm-d3q19-les@1",
    seasons: [],
    case: {
      cellM: c.cellM,
      bufferM: c.bufferM,
      inflow: Object.fromEntries(WIND_SEASONS.map((season) => {
      const direction = c.inflow[season];
        return [season, direction ? { deg: direction.deg, name: direction.name, pct: direction.pct, source: direction.source } : null];
      })),
      station: c.station,
      maxObstacleM: Math.round(c.maxObstacleM * 10) / 10,
      terrain: c.terrain,
    },
  };
}

function clampRaw(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-5000, Math.min(5000, Math.round(value / WIND_RAW_SCALE)));
}

export function interleaveRelative(u: Float32Array, v: Float32Array, obstacleValues: Uint16Array): Int16Array {
  if (u.length !== v.length || u.length !== obstacleValues.length) throw new RangeError("wind field length mismatch");
  const out = new Int16Array(u.length * 2);
  for (let index = 0; index < u.length; index += 1) {
    if (obstacleValues[index] > 0) continue;
    out[index * 2] = clampRaw(u[index]);
    out[index * 2 + 1] = clampRaw(v[index]);
  }
  return out;
}

export function windRasterData(c: Pick<WindCase, "ref" | "cols" | "rows">, season: WindSeason, zM: number, values: Int16Array, label = "보행층 상대풍속"): RasterData {
  if (values.length !== c.cols * c.rows * 2) throw new RangeError("wind layer length mismatch");
  return {
    ref: {
      name: `wind_${season}_z${String(Math.round(zM)).padStart(2, "0")}`,
      kind: "vector2",
      crs: "EPSG:5179",
      x0: c.ref.x0,
      y0: c.ref.y0,
      cellM: c.ref.cellM,
      cols: c.cols,
      rows: c.rows,
      dtype: "i16",
      bands: 2,
      scale: WIND_RAW_SCALE,
      offset: 0,
      nodata: null,
      palette: "wind_ratio",
      label,
    },
    values,
  };
}

export function encodeWindLayer(data: RasterData): EncodedWindLayer {
  const encoded = encodeRaster(data);
  return { ...encoded, values: data.values as Int16Array };
}

export function decodeRasterValues(ref: RasterRef, blob: Buffer): Uint8Array | Uint16Array | Int16Array {
  const raw = inflateRawSync(blob);
  const bytesPerSample = ref.dtype === "u16" || ref.dtype === "i16" ? 2 : 1;
  const expected = ref.cols * ref.rows * ref.bands * bytesPerSample;
  if (raw.length !== expected) throw new Error(`RASTER_RAW_LENGTH_MISMATCH: ${ref.name}`);
  if (ref.dtype === "u8" || ref.dtype === "bits") return Uint8Array.from(raw);
  const values = new Int16Array(raw.length / 2);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  for (let i = 0; i < values.length; i += 1) values[i] = ref.dtype === "u16" ? view.getUint16(i * 2, true) : view.getInt16(i * 2, true);
  return ref.dtype === "u16" ? Uint16Array.from(values) : values;
}

/** 북쪽 정렬 obstacle_height를 바람 정렬 D2Q9 solid mask로 재표본한다. */
export function obstacleToWindFrame(c: Pick<WindCase, "ref" | "obstacleValues" | "centerX" | "centerY" | "cols" | "rows" | "cellM">, fromDeg: number): Uint8Array {
  const solid = new Uint8Array(c.cols * c.rows);
  const frame = basis(fromDeg);
  const extent = (c.cols * c.cellM) / 2;
  for (let row = 0; row < c.rows; row += 1) {
    for (let col = 0; col < c.cols; col += 1) {
      const windX = -extent + (col + 0.5) * c.cellM;
      const windY = -extent + (row + 0.5) * c.cellM;
      const globalX = c.centerX + frame.flowX * windX + frame.leftX * windY;
      const globalY = c.centerY + frame.flowY * windX + frame.leftY * windY;
      const sourceCol = Math.floor((globalX - c.ref.x0) / c.cellM);
      const sourceRow = Math.floor((globalY - c.ref.y0) / c.cellM);
      if (sourceCol < 0 || sourceCol >= c.cols || sourceRow < 0 || sourceRow >= c.rows) continue;
      if (c.obstacleValues[sourceRow * c.cols + sourceCol] > 0) solid[row * c.cols + col] = 1;
    }
  }
  return solid;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return rounded(low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low));
}

function percent(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

function shareMetric(season: WindSeason, index: number, value: number | null, numerator: number, denominator: number): TileResult["metrics"][number] {
  const labels = ["0.5 미만", "0.5~0.8", "0.8~1.2", "1.2~1.5", "1.5 이상"];
  const seasonLabel = WIND_SEASON_LABEL[season];
  return value === null
    ? missing(`share_wind_${index}_${season}`, `${seasonLabel} 보행층 상대풍속 ${labels[index]} 면적`, "%", `s03-share-${index}@1:유효 셀 중 ${labels[index]} 비율`)
    : est(`share_wind_${index}_${season}`, `${seasonLabel} 보행층 상대풍속 ${labels[index]} 면적`, value, "%", `s03-share-${index}@1:유효 셀 중 ${labels[index]} 비율`, numerator, denominator);
}

/** i16 vector2 한 층을 S03 표시 지표로 만든다. 단위는 의도적으로 m/s가 아니다. */
export function metricsForWindField(input: WindMetricInput): WindMetricResult {
  const count = input.ref.cols * input.ref.rows;
  if (input.values.length !== count * 2 || input.obstacleValues.length !== count) throw new RangeError("wind metrics shape mismatch");
  const speeds: number[] = [];
  const frame = input.ref;
  const bins = [0, 0, 0, 0, 0];
  let calm = 0;
  for (let row = 0; row < frame.rows; row += 1) {
    for (let col = 0; col < frame.cols; col += 1) {
      const x = frame.x0 + (col + 0.5) * frame.cellM;
      const y = frame.y0 + (row + 0.5) * frame.cellM;
      if (Math.hypot(x - input.centerX, y - input.centerY) > input.radiusM) continue;
      const index = row * frame.cols + col;
      if (input.obstacleValues[index] > 0) continue;
      const u = input.values[index * 2] * WIND_RAW_SCALE;
      const v = input.values[index * 2 + 1] * WIND_RAW_SCALE;
      const speed = Math.hypot(u, v);
      if (!Number.isFinite(speed) || speed > 5) continue;
      speeds.push(speed);
      if (speed < 0.2) calm += 1;
      let bin: number = WIND_BREAKS.length;
      for (let i = 0; i < WIND_BREAKS.length; i += 1) {
        if (speed < WIND_BREAKS[i]) {
          bin = i;
          break;
        }
      }
      bins[bin] += 1;
    }
  }
  const denominator = speeds.length;
  const median = quantile(speeds, 0.5);
  const p90 = quantile(speeds, 0.9);
  const seasonLabel = WIND_SEASON_LABEL[input.season];
  return {
    validCells: denominator,
    median,
    p90,
    metrics: [
      median === null ? missing(`urel_median_${input.season}`, `${seasonLabel} 보행층 상대풍속 중앙값`, "U/U유입", "s03-urel-median@1:유효 셀 중앙값") : est(`urel_median_${input.season}`, `${seasonLabel} 보행층 상대풍속 중앙값`, median, "U/U유입", "s03-urel-median@1:유효 셀 중앙값", null, denominator),
      p90 === null ? missing(`urel_p90_${input.season}`, `${seasonLabel} 보행층 상대풍속 P90`, "U/U유입", "s03-urel-p90@1:유효 셀 90백분위") : est(`urel_p90_${input.season}`, `${seasonLabel} 보행층 상대풍속 P90`, p90, "U/U유입", "s03-urel-p90@1:유효 셀 90백분위", null, denominator),
      ...bins.map((countInBin, index) => shareMetric(input.season, index, percent(countInBin, denominator), countInBin, denominator)),
      percent(calm, denominator) === null
        ? missing(`share_calm_lt02_${input.season}`, `${seasonLabel} 상대풍속 0.2 미만 면적`, "%", "s03-calm@1:유효 셀 중 상대풍속 0.2 미만")
        : est(`share_calm_lt02_${input.season}`, `${seasonLabel} 상대풍속 0.2 미만 면적`, percent(calm, denominator)!, "%", "s03-calm@1:유효 셀 중 상대풍속 0.2 미만", calm, denominator),
      input.inflowFromDeg === null
        ? missing(`inflow_from_deg_${input.season}`, `${seasonLabel} 유입 풍향`, "도", "s03-inflow@1:D22 최근접 ASOS 최빈 풍향")
        : obs(`inflow_from_deg_${input.season}`, `${seasonLabel} 유입 풍향`, input.inflowFromDeg, "도", "s03-inflow@1:D22 최근접 ASOS 최빈 풍향"),
      est("cell_m", "바람 격자 셀 크기", frame.cellM, "m", "s03-grid@1:바람장 래스터 셀 크기"),
      est("domain_buffer_m", "바람장 반경 버퍼", Math.round((Math.max(frame.cols, frame.rows) * frame.cellM) / 2 - input.radiusM), "m", "s03-grid@1:분석 반경 외 계산 버퍼"),
      est("steps", "반복 스텝", input.steps, "step", "s03-steps@1:LBM 반복 횟수"),
      input.mlups === null ? missing("gpu_mlups", "GPU 처리량", "MLUPS", "s03-gpu@1:브라우저 보고 GPU 처리량") : obs("gpu_mlups", "GPU 처리량", input.mlups, "MLUPS", "s03-gpu@1:브라우저 보고 GPU 처리량"),
    ],
  };
}

export function fallbackField(c: WindCase, fromDeg: number, steps = FALLBACK_STEPS): { values: Int16Array; steps: number } {
  const solid = obstacleToWindFrame(c, fromDeg);
  const field = computeWind2D({ nx: c.cols, ny: c.rows, solid, steps, parallelism: Math.min(8, c.rows) });
  const north = rotateFromWindFrame({ nx: c.cols, ny: c.rows, u: field.u, v: field.v, cellM: c.cellM, originX: c.x0, originY: c.y0 }, fromDeg);
  return { values: interleaveRelative(north.u, north.v, c.obstacleValues), steps: field.steps };
}

export function encodedWindLayer(c: WindCase, season: WindSeason, zM: number, values: Int16Array, label: string): EncodedWindLayer {
  return encodeWindLayer(windRasterData(c, season, zM, values, label));
}
