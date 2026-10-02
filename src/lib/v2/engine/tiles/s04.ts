/** S04 열쾌적 UTCI — 계절 대표기상·일조·SVF·S03 보행층 바람을 결합한다. */
import type BetterSqlite3 from "better-sqlite3";
import { toUtmk } from "../../crs";
import { SEASONS, type Season } from "../../ingest/sources/asos-wind";
import { parseTileResult, type RasterRef, type TileResult } from "../../tile-result";
import {
  AK,
  ALBEDO_GROUND,
  ALBEDO_WALL,
  EP,
  EPS_SURFACE,
  F_LATERAL,
  F_UPDOWN,
  GROUND_HEATING_C_PER_WM2,
  STEFAN_BOLTZMANN,
  tmrt,
} from "../../sim/radiation";
import { fillRing, shadowPieces } from "../../sim/sun-field";
import { kst, sunPosition } from "../../sim/sun";
import { UTCI_BREAKS, UTCI_WIND_RANGE, utci } from "../../sim/utci";
import type { RasterData } from "../../raster-store";
import type { EngineContext, SourceRef } from "../context";
import { CANOPY_ASSUMED_HEIGHT_M, canopyFor } from "./canopy-shared";
import { est, makeTile, missing, obs } from "./common";
import { BUILDING_SOURCES } from "./buildings-shared";
import { notProvided } from "./not-provided";
import { SEASON_SUN_DATES, sunDateValue, sunFieldFor, sunFieldsFor, sunGridFor, sunObstaclesFor } from "./sun-shared";
import { svfFor } from "./svf-shared";

/** UTCI representative hours are KST wall-clock hours. */
export const UTCI_HOURS = [10, 14, 18] as const;
export const UTCI_CELL_M = 2;

const UTCI_SEASONS = [...SEASONS] as readonly Season[];
const RASTER_SCALE = 0.25;
const RASTER_OFFSET = -40;
const RASTER_OUT_OF_RANGE = 253;
const RASTER_BUILDING = 254;
const RASTER_OUTSIDE = 255;
const WEATHER_TABLE_NOTE = "계절×시각 대표 기상 미적재 — weather 재빌드 필요";
const SEASON_KO: Record<Season, string> = { spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };

const UTCI_CATEGORIES = [
  { key: "extreme_cold", label: "극한 한랭", test: (value: number) => value < -40 },
  { key: "very_strong_cold", label: "매우 강한 한랭", test: (value: number) => value >= -40 && value < -27 },
  { key: "strong_cold", label: "강한 한랭", test: (value: number) => value >= -27 && value < -13 },
  { key: "moderate_cold", label: "중간 한랭", test: (value: number) => value >= -13 && value < UTCI_BREAKS[0] },
  { key: "no_thermal_stress", label: "열적 쾌적", test: (value: number) => value >= UTCI_BREAKS[0] && value < UTCI_BREAKS[1] },
  { key: "moderate_heat", label: "중간 열스트레스", test: (value: number) => value >= UTCI_BREAKS[1] && value < UTCI_BREAKS[2] },
  { key: "strong_heat", label: "강한 열스트레스", test: (value: number) => value >= UTCI_BREAKS[2] && value < UTCI_BREAKS[3] },
  { key: "very_strong_heat", label: "매우 강한 열스트레스", test: (value: number) => value >= UTCI_BREAKS[3] && value < UTCI_BREAKS[4] },
  { key: "extreme_heat", label: "극한 열스트레스", test: (value: number) => value >= UTCI_BREAKS[4] },
] as const;

type WeatherRow = {
  season: Season;
  hour: number;
  n: number;
  ta_med: number | null;
  hm_med: number | null;
  ws_med: number | null;
  ghi_med_wm2: number | null;
  cloud_med: number | null;
};

type WeatherState =
  | { kind: "not_provided"; note: string; sources: SourceRef[] }
  | { kind: "legacy"; note: string; sources: SourceRef[] }
  | { kind: "ready"; station: { id: string; name: string; distanceM: number }; rows: Map<string, WeatherRow>; sources: SourceRef[] };

interface WindLayer {
  ref: RasterRef;
  values: Uint8Array | Uint16Array | Int16Array;
}

interface SeasonHourResult {
  season: Season;
  hour: (typeof UTCI_HOURS)[number];
  raster: RasterRef;
  inRangeValues: number[];
  sunValues: number[];
  shadeValues: number[];
  input: WeatherRow;
  sunAltitude: number;
  shadeCells: number;
  treeShadeCells: number;
  consideredCells: number;
  outOfRangeCells: number;
  categoryCounts: number[];
}

function hasTable(db: BetterSqlite3.Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function tableColumns(db: BetterSqlite3.Database, table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function finite(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentage(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
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

function weatherState(ctx: EngineContext): WeatherState {
  const db = ctx.db("weather");
  const sources = ctx.sources("weather", ["asos"]);
  if (!db || sources.length === 0) return { kind: "not_provided", note: "기상(ASOS) 미적재", sources };
  if (!hasTable(db, "weather_season_hour")) return { kind: "legacy", note: WEATHER_TABLE_NOTE, sources };

  const required = new Set(["station_id", "season", "hour", "n", "ta_med", "hm_med", "ws_med", "ghi_med_wm2", "cloud_med"]);
  const columns = tableColumns(db, "weather_season_hour");
  if (![...required].every((column) => columns.has(column))) return { kind: "legacy", note: WEATHER_TABLE_NOTE, sources };

  const stationRows = db.prepare(`SELECT station_id, name, lng, lat, total_hours, missing_hours
    FROM weather_station ORDER BY station_id`).all() as Array<{
    station_id: string;
    name: string;
    lng: number;
    lat: number;
    total_hours: number;
    missing_hours: number;
  }>;
  const eligible = stationRows.filter((row) => Number.isFinite(row.total_hours) && Number.isFinite(row.missing_hours) && row.total_hours - row.missing_hours >= 8_760);
  if (eligible.length === 0) return { kind: "not_provided", note: "관측시간 8,760시간 이상인 ASOS 관측소가 없습니다", sources };

  const [cx, cy] = toUtmk(ctx.input.center);
  let nearest: (typeof eligible)[number] | null = null;
  let nearestDistance = Infinity;
  for (const row of eligible) {
    if (!Number.isFinite(row.lng) || !Number.isFinite(row.lat)) continue;
    const [x, y] = toUtmk([row.lng, row.lat]);
    const distanceM = Math.hypot(x - cx, y - cy);
    if (nearest === null || distanceM < nearestDistance || (distanceM === nearestDistance && row.station_id < nearest.station_id)) {
      nearest = row;
      nearestDistance = distanceM;
    }
  }
  if (!nearest) return { kind: "not_provided", note: "최근접 ASOS 관측소 좌표가 없습니다", sources };

  const rows = db.prepare(`SELECT season, hour, n, ta_med, hm_med, ws_med, ghi_med_wm2, cloud_med
    FROM weather_season_hour WHERE station_id = ?`).all(nearest.station_id) as WeatherRow[];
  const byKey = new Map<string, WeatherRow>();
  for (const row of rows) {
    if (!SEASONS.includes(row.season) || !Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
    byKey.set(`${row.season}:${row.hour}`, row);
  }
  return {
    kind: "ready",
    station: { id: nearest.station_id, name: nearest.name, distanceM: Math.round(nearestDistance) },
    rows: byKey,
    sources,
  };
}

function windLayerFor(ctx: EngineContext, season: Season): WindLayer | null {
  return ctx.memo(`s04:wind:${season}`, () => {
    const layer = ctx.rasterReader?.("S03", `wind_${season}_z06`) ?? null;
    if (!layer || layer.ref.bands !== 2 || layer.ref.cols < 1 || layer.ref.rows < 1) return null;
    if (layer.values.length < layer.ref.cols * layer.ref.rows * 2) return null;
    return layer;
  });
}

function windRatioAt(layer: WindLayer, x: number, y: number): number | null {
  const col = Math.floor((x - layer.ref.x0) / layer.ref.cellM);
  const row = Math.floor((y - layer.ref.y0) / layer.ref.cellM);
  if (col < 0 || row < 0 || col >= layer.ref.cols || row >= layer.ref.rows) return null;
  const base = (row * layer.ref.cols + col) * layer.ref.bands;
  const u = layer.values[base];
  const v = layer.values[base + 1];
  if (u === undefined || v === undefined || (layer.ref.nodata !== null && (u === layer.ref.nodata || v === layer.ref.nodata))) return null;
  const east = u * layer.ref.scale + layer.ref.offset;
  const north = v * layer.ref.scale + layer.ref.offset;
  const ratio = Math.hypot(east, north);
  return Number.isFinite(ratio) ? ratio : null;
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function dayOfYear(year: number, month: number, day: number): number {
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / (24 * 60 * 60 * 1000));
}

function dateParts(ctx: EngineContext, season: Season): { year: number; month: number; day: number } {
  const year = Number(ctx.input.analysisDate.slice(0, 4));
  const [month, day] = SEASON_SUN_DATES[season];
  return { year, month, day };
}

function shadowVectorFor(heightM: number, sun: { altitudeDeg: number; azimuthDeg: number }): [number, number] | null {
  if (!Number.isFinite(heightM) || heightM <= 0 || !Number.isFinite(sun.altitudeDeg) || sun.altitudeDeg <= 0) return null;
  const length = heightM / Math.tan((sun.altitudeDeg * Math.PI) / 180);
  if (!Number.isFinite(length)) return null;
  const azimuth = (sun.azimuthDeg * Math.PI) / 180;
  return [-Math.sin(azimuth) * length, -Math.cos(azimuth) * length];
}

function treeShadeFor(ctx: EngineContext, grid: { x0: number; y0: number; cellM: number; cols: number; rows: number }, obstacles: ReturnType<typeof sunObstaclesFor>, season: Season, hour: number): Uint8Array {
  return ctx.memo(`s04:tree-shade:${season}:${hour}`, () => {
    const mask = new Uint8Array(grid.cols * grid.rows);
    const { year, month, day } = dateParts(ctx, season);
    const sun = sunPosition(ctx.input.center[1], ctx.input.center[0], kst(year, month, day, hour));
    if (sun.altitudeDeg <= 0) return mask;
    for (const tree of obstacles.filter((obstacle) => obstacle.kind === "canopy")) {
      const vector = shadowVectorFor(tree.heightM, sun);
      if (!vector) continue;
      for (const piece of shadowPieces(tree.ring, vector)) fillRing(mask, grid, piece);
    }
    return mask;
  });
}

interface HourlyShadeGrid {
  shade: Uint8Array;
  x0: number;
  y0: number;
  cellM: number;
  cols: number;
  rows: number;
}

function hourlyShadeGrid(field: ReturnType<typeof sunFieldFor>, hour: number, grid: ReturnType<typeof sunGridFor>): HourlyShadeGrid | null {
  const hourly = field?.hourly.find((item) => item.kstHour === hour);
  if (!hourly || !grid) return null;
  return { shade: hourly.shade, x0: grid.x0, y0: grid.y0, cellM: grid.cellM, cols: grid.cols, rows: grid.rows };
}

function fieldShadeAt(field: HourlyShadeGrid | null, x: number, y: number): boolean {
  if (!field) return false;
  const col = Math.floor((x - field.x0) / field.cellM);
  const row = Math.floor((y - field.y0) / field.cellM);
  if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return false;
  const bitIndex = row * field.cols + col;
  return (field.shade[bitIndex >> 3] & (1 << (bitIndex & 7))) !== 0;
}

function categoryIndex(value: number): number {
  for (let index = 0; index < UTCI_CATEGORIES.length; index += 1) if (UTCI_CATEGORIES[index].test(value)) return index;
  return UTCI_CATEGORIES.length - 1;
}

function rawUtci(value: number): number {
  // 253–255 are reserved for out-of-range, building and outside. The public
  // u8/0.25/-40 contract is retained; exact unquantized values remain in metrics.
  return Math.max(0, Math.min(RASTER_OUT_OF_RANGE - 1, Math.round((value - RASTER_OFFSET) / RASTER_SCALE)));
}

function simulationFor(
  ctx: EngineContext,
  station: { id: string; name: string; distanceM: number } | null,
  seasons: Season[],
  windSource: string,
): Record<string, unknown> {
  const sunDates = Object.fromEntries(UTCI_SEASONS.map((season) => [season, sunDateValue(ctx, season)]));
  return {
    model: "utci-bröde2012+tmrt-6dir@1",
    hours: [...UTCI_HOURS],
    seasons,
    station,
    sunDates,
    treeHeightM: CANOPY_ASSUMED_HEIGHT_M,
    windSource,
    constants: { AK, EP, F_UPDOWN, F_LATERAL, ALBEDO_GROUND, ALBEDO_WALL, EPS_SURFACE, GROUND_HEATING_C_PER_WM2, STEFAN_BOLTZMANN },
  };
}

function windSourceFor(ctx: EngineContext): string {
  const layer = windLayerFor(ctx, "summer");
  return layer?.ref.label?.toLowerCase().includes("d2q9") ? "S03 lbm-d2q9@1" : "S03 lbm-d3q19-les@1 z6 × ASOS 10 m";
}

function metricForInput(row: WeatherRow, season: Season, hour: number): TileResult["metrics"] {
  const suffix = `_${season}_h${hour}`;
  const label = `대표 기상 ${hour}시간 중앙값 · ${SEASON_KO[season]}`;
  return [
    obs(`input_ta_c${suffix}`, `${label} 기온`, row.ta_med!, "°C", "s04-input@1:weather_season_hour.ta_med"),
    obs(`input_rh_pct${suffix}`, `${label} 습도`, row.hm_med!, "%", "s04-input@1:weather_season_hour.hm_med"),
    obs(`input_ws10_ms${suffix}`, `${label} 관측소 10m 풍속`, row.ws_med!, "m/s", "s04-input@1:weather_season_hour.ws_med"),
    obs(`input_ghi_wm2${suffix}`, `${label} 일사량`, row.ghi_med_wm2!, "W/m²", "s04-input@1:weather_season_hour.ghi_med_wm2"),
    obs(`input_cloud10${suffix}`, `${label} 운량`, row.cloud_med!, "10분위", "s04-input@1:weather_season_hour.cloud_med"),
  ];
}

function optionalMetric(
  id: string,
  label: string,
  value: number | null,
  unit: string,
  formulaVersion: string,
  numerator: number | null = null,
  denominator: number | null = null,
): TileResult["metrics"][number] {
  return value === null || !Number.isFinite(value)
    ? missing(id, label, unit, formulaVersion)
    : est(id, label, round1(value), unit, formulaVersion, numerator, denominator);
}

function categoryLegend(): Array<{ label: string; min: number | null; max: number | null }> {
  return [
    { label: "UTCI 극한 한랭 (< −40°C)", min: -40, max: -40 },
    { label: "UTCI 매우 강한 한랭 (−40~−27°C)", min: -40, max: -27 },
    { label: "UTCI 강한 한랭 (−27~−13°C)", min: -27, max: -13 },
    { label: "UTCI 중간 한랭 (−13~9°C)", min: -13, max: 9 },
    { label: "UTCI 열적 쾌적 (9~26°C)", min: 9, max: 26 },
    { label: "UTCI 중간 열스트레스 (26~32°C)", min: 26, max: 32 },
    { label: "UTCI 강한 열스트레스 (32~38°C)", min: 32, max: 38 },
    { label: "UTCI 매우 강한 열스트레스 (38~46°C)", min: 38, max: 46 },
    { label: "UTCI 극한 열스트레스 (≥46°C)", min: 46, max: null },
    { label: "계산 범위 밖(바람)", min: null, max: null },
    { label: "건물", min: null, max: null },
    { label: "반경 밖", min: null, max: null },
  ];
}

function caseMetrics(result: SeasonHourResult): TileResult["metrics"] {
  const suffix = `_${result.season}_h${result.hour}`;
  const denominator = result.consideredCells;
  const inRangeMedian = quantile(result.inRangeValues, 0.5);
  const p90 = quantile(result.inRangeValues, 0.9);
  const sunMedian = quantile(result.sunValues, 0.5);
  const shadeMedian = quantile(result.shadeValues, 0.5);
  const shares = result.categoryCounts.map((count, index) => est(
    `share_utci_${index < UTCI_CATEGORIES.length ? UTCI_CATEGORIES[index].key : "out_of_range"}_pct${suffix}`,
    `UTCI ${index < UTCI_CATEGORIES.length ? UTCI_CATEGORIES[index].label : "계산 범위 밖"} 면적 구성비 · ${SEASON_KO[result.season]} ${result.hour}시`,
    percentage(count, denominator),
    "%",
    "s04-share@1:UTCI 범주 셀 면적÷계산 대상 셀 면적",
    count,
    denominator,
  ));
  const outPct = percentage(result.outOfRangeCells, denominator);
  return [
    ...metricForInput(result.input, result.season, result.hour),
    obs(`sun_alt_deg${suffix}`, `태양고도 · ${SEASON_KO[result.season]} ${result.hour}시`, round1(result.sunAltitude), "도", "s04-sun@1:SEASON_SUN_DATES·KST 시각 태양고도"),
    optionalMetric(`utci_median${suffix}`, `UTCI 중앙값 · ${SEASON_KO[result.season]} ${result.hour}시`, inRangeMedian, "°C", "s04-utci@1:Bröde2012 + 6방향 tmrt", null, result.inRangeValues.length),
    optionalMetric(`utci_p90${suffix}`, `UTCI P90 · ${SEASON_KO[result.season]} ${result.hour}시`, p90, "°C", "s04-utci@1:Bröde2012 + 6방향 tmrt", null, result.inRangeValues.length),
    optionalMetric(`utci_sun_median${suffix}`, `양지 UTCI 중앙값 · ${SEASON_KO[result.season]} ${result.hour}시`, sunMedian, "°C", "s04-utci-sun@1:in-range sunlit cells", null, result.sunValues.length),
    optionalMetric(`utci_shade_median${suffix}`, `그늘 UTCI 중앙값 · ${SEASON_KO[result.season]} ${result.hour}시`, shadeMedian, "°C", "s04-utci-shade@1:in-range shaded cells", null, result.shadeValues.length),
    optionalMetric(`sun_shade_diff_c${suffix}`, `양지−그늘 UTCI 차이 · ${SEASON_KO[result.season]} ${result.hour}시`, sunMedian !== null && shadeMedian !== null ? sunMedian - shadeMedian : null, "°C", "s04-sun-shade@1:양지 중앙값−그늘 중앙값"),
    est(`shade_pct${suffix}`, `그늘 면적률 · ${SEASON_KO[result.season]} ${result.hour}시`, percentage(result.shadeCells, denominator), "%", "s04-shade-share@1:그늘 셀 면적÷계산 대상 셀 면적", result.shadeCells, denominator),
    est(`tree_shade_pct${suffix}`, `수관 그늘 면적률 · ${SEASON_KO[result.season]} ${result.hour}시`, percentage(result.treeShadeCells, denominator), "%", "s04-tree-shade@1:수관 그림자 셀 면적÷계산 대상 셀 면적", result.treeShadeCells, denominator),
    est(`share_out_of_range_pct_${result.season}_h${result.hour}`, `UTCI 바람 입력 범위 밖 면적률 · ${SEASON_KO[result.season]} ${result.hour}시`, outPct, "%", "s04-out-of-range@1:UTCI 풍속 0.5~17m/s 밖 셀 면적÷계산 대상 셀 면적", result.outOfRangeCells, denominator),
    ...shares,
  ];
}

function representativeAliases(metrics: TileResult["metrics"], result: SeasonHourResult): TileResult["metrics"] {
  if (result.season !== "summer" || result.hour !== 14) return metrics;
  const suffix = "_summer_h14";
  const aliases = [
    "input_ta_c", "input_rh_pct", "input_ws10_ms", "input_ghi_wm2", "input_cloud10", "sun_alt_deg",
    "utci_median", "utci_p90", "utci_sun_median", "utci_shade_median", "sun_shade_diff_c", "shade_pct", "tree_shade_pct",
  ].map((base) => {
    const original = metrics.find((item) => item.id === `${base}${suffix}`);
    return original ? { ...original, id: base } : null;
  }).filter((item): item is TileResult["metrics"][number] => item !== null);
  const out = metrics.find((item) => item.id === "share_out_of_range_pct_summer_h14");
  if (out) aliases.push({ ...out, id: "share_out_of_range_pct" });
  return [...metrics, ...aliases];
}

function fixedLimitations(): TileResult["limitations"] {
  return [
    { kind: "estimated", note: "기상 대표자료(계절·시각 10년 중앙값)와 단순화한 복사·바람 입력에 따른 UTCI 근사값입니다. 현장 측정·개인별 건강 위험 예측을 뜻하지 않습니다 — 숫자를 인용하지 말고 자리끼리 비교하세요." },
    { kind: "estimated", note: "수목 높이 8 m 가정(항공사진 수관)" },
    { kind: "estimated", note: "바람 = S03 보행층(6 m) 상대풍속 × 관측소 10 m 풍속(국지 10 m 등가 가정)" },
    { kind: "estimated", note: "지면·벽 온도는 경험식(양지 가열)" },
  ];
}

function calculateCase(
  ctx: EngineContext,
  shared: NonNullable<ReturnType<typeof svfFor>>,
  obstacles: ReturnType<typeof sunObstaclesFor>,
  buildingMask: Uint8Array,
  wind: WindLayer,
  input: WeatherRow,
  season: Season,
  hour: (typeof UTCI_HOURS)[number],
): SeasonHourResult {
  const grid = shared.grid;
  const field = sunFieldFor(ctx, season);
  const { year, month, day } = dateParts(ctx, season);
  const sun = sunPosition(ctx.input.center[1], ctx.input.center[0], kst(year, month, day, hour));
  const dayNumber = dayOfYear(year, month, day);
  const treeMask = treeShadeFor(ctx, grid, obstacles, season, hour);
  const hourlyShade = hourlyShadeGrid(field, hour, sunGridFor(ctx));
  const values = new Uint8Array(grid.cols * grid.rows);
  values.fill(RASTER_OUTSIDE);
  const inRangeValues: number[] = [];
  const sunValues: number[] = [];
  const shadeValues: number[] = [];
  const categoryCounts = Array.from({ length: UTCI_CATEGORIES.length + 1 }, () => 0);
  let shadeCells = 0;
  let treeShadeCells = 0;
  let consideredCells = 0;
  let outOfRangeCells = 0;
  const tmrtCache = new Map<number, number>();
  const utciCache = new Map<string, number>();
  const [cx, cy] = toUtmk(ctx.input.center);

  for (let rowIndex = 0; rowIndex < grid.rows; rowIndex += 1) {
    const y = grid.y0 + (rowIndex + 0.5) * grid.cellM;
    for (let col = 0; col < grid.cols; col += 1) {
      const index = rowIndex * grid.cols + col;
      const x = grid.x0 + (col + 0.5) * grid.cellM;
      if (Math.hypot(x - cx, y - cy) > ctx.input.radiusM) continue;
      if (buildingMask[index] === 1) {
        values[index] = RASTER_BUILDING;
        continue;
      }
      const svfValue = shared.svf[index];
      if (!Number.isFinite(svfValue)) continue;
      const ratio = windRatioAt(wind, x, y);
      if (ratio === null || !finite(input.ws_med) || !finite(input.ta_med) || !finite(input.hm_med) || !finite(input.ghi_med_wm2) || !finite(input.cloud_med)) continue;
      const va10Local = ratio * input.ws_med;
      const fieldShade = sun.altitudeDeg > 0 && fieldShadeAt(hourlyShade, x, y);
      const treeShade = sun.altitudeDeg > 0 && treeMask[index] === 1;
      const shade = sun.altitudeDeg <= 0 || fieldShade || treeShade;
      consideredCells += 1;
      if (shade) shadeCells += 1;
      if (treeShade && !fieldShade) treeShadeCells += 1;
      const inRange = va10Local >= UTCI_WIND_RANGE[0] && va10Local <= UTCI_WIND_RANGE[1];
      if (!inRange) {
        outOfRangeCells += 1;
        categoryCounts[UTCI_CATEGORIES.length] += 1;
        values[index] = RASTER_OUT_OF_RANGE;
        continue;
      }
      const sky = Math.max(0, Math.min(1, svfValue));
      const tmrtKey = Math.round(sky * 1000) * 2 + (shade ? 1 : 0);
      let radiant = tmrtCache.get(tmrtKey);
      if (radiant === undefined) {
        radiant = tmrt({
          taC: input.ta_med,
          rhPct: input.hm_med,
          ghiWm2: input.ghi_med_wm2,
          cloud10: input.cloud_med,
          sunAltDeg: sun.altitudeDeg,
          dayOfYear: dayNumber,
          svf: tmrtKey / 2000 - (shade ? 0.0005 : 0),
          sunlit: !shade,
          groundSunlit: !shade,
        });
        tmrtCache.set(tmrtKey, radiant);
      }
      const vaKey = Math.round(va10Local * 100);
      const radiantKey = Math.round(radiant * 10);
      const cacheKey = `${radiantKey}:${vaKey}`;
      let value = utciCache.get(cacheKey);
      if (value === undefined) {
        value = utci(input.ta_med, radiantKey / 10, vaKey / 100, input.hm_med).value;
        utciCache.set(cacheKey, value);
      }
      if (!Number.isFinite(value)) continue;
      inRangeValues.push(value);
      const category = categoryIndex(value);
      categoryCounts[category] += 1;
      values[index] = rawUtci(value);
      if (shade) shadeValues.push(value);
      else sunValues.push(value);
    }
  }

  const rasterData: RasterData = {
    ref: {
      name: `utci_${season}_h${hour}`,
      kind: "scalar",
      crs: "EPSG:5179",
      x0: grid.x0,
      y0: grid.y0,
      cellM: UTCI_CELL_M,
      cols: grid.cols,
      rows: grid.rows,
      dtype: "u8",
      bands: 1,
      scale: RASTER_SCALE,
      offset: RASTER_OFFSET,
      nodata: RASTER_OUTSIDE,
      palette: "utci",
      label: `UTCI — ${SEASON_KO[season]} ${hour}시 · 기온 · 습도 · 태양고도`,
    },
    values,
  };
  const raster = ctx.emitRaster("S04", rasterData);
  return { season, hour, raster, inRangeValues, sunValues, shadeValues, input, sunAltitude: sun.altitudeDeg, shadeCells, treeShadeCells, consideredCells, outOfRangeCells, categoryCounts };
}

export function s04(ctx: EngineContext): TileResult {
  const weather = weatherState(ctx);
  if (weather.kind === "not_provided") return notProvided(ctx, "S04", weather.note);
  if (weather.kind === "legacy") return notProvided(ctx, "S04", weather.note);

  const canopy = canopyFor(ctx);
  const shared = svfFor(ctx, canopy?.polygons ?? null);
  if (!shared) return notProvided(ctx, "S04", "건물 자료가 없어 UTCI 복사·그늘장을 계산하지 못했습니다.");

  const allObstacles = sunObstaclesFor(ctx, canopy?.polygons ?? null);
  const buildingMask = new Uint8Array(shared.grid.cols * shared.grid.rows);
  for (const obstacle of sunObstaclesFor(ctx, null)) fillRing(buildingMask, shared.grid, obstacle.ring);

  const sources = mergeSources(weather.sources, ctx.sources("buildings", BUILDING_SOURCES));
  const limitations = fixedLimitations();
  if (!canopy) limitations.push({ kind: "not_provided", note: "항공사진 수관 자료 미적재 — 수관 그림자를 반영하지 않았습니다." });

  const calculated: SeasonHourResult[] = [];
  const missingSeasons: Season[] = [];
  const readySeasons: Array<{ season: Season; wind: WindLayer; rows: WeatherRow[] }> = [];
  for (const season of UTCI_SEASONS) {
    const wind = windLayerFor(ctx, season);
    const rows = UTCI_HOURS.map((hour) => weather.rows.get(`${season}:${hour}`));
    const rowReady = rows.every((row): row is WeatherRow => row !== undefined && row.n > 0 && finite(row.ta_med) && finite(row.hm_med) && finite(row.ws_med) && finite(row.ghi_med_wm2) && finite(row.cloud_med));
    if (!wind || !rowReady) {
      missingSeasons.push(season);
      continue;
    }
    readySeasons.push({ season, wind, rows });
  }
  if (readySeasons.length === UTCI_SEASONS.length) sunFieldsFor(ctx);
  else for (const ready of readySeasons) sunFieldFor(ctx, ready.season);
  for (const ready of readySeasons) {
    for (let index = 0; index < UTCI_HOURS.length; index += 1) calculated.push(calculateCase(ctx, shared, allObstacles, buildingMask, ready.wind, ready.rows[index]!, ready.season, UTCI_HOURS[index]));
  }

  const metrics = calculated.reduce<TileResult["metrics"]>((all, result) => [...all, ...caseMetrics(result)], []);
  const representative = calculated.find((result) => result.season === "summer" && result.hour === 14);
  const withAliases = representative ? representativeAliases(metrics, representative) : metrics;
  const allOutOfRange = calculated.some((result) => result.consideredCells > 0 && result.outOfRangeCells === result.consideredCells);
  const status: TileResult["status"] = calculated.length === 0 ? "pending" : missingSeasons.length > 0 || allOutOfRange ? "partial" : "complete";
  if (missingSeasons.length > 0) limitations.push({ kind: "partial", note: `다음 계절은 S03 바람장 또는 계절×시각 대표 기상이 없어 계산 대기입니다: ${missingSeasons.join(", ")}` });
  if (allOutOfRange) limitations.push({ kind: "partial", note: `UTCI 풍속 범위(${UTCI_WIND_RANGE[0]}~${UTCI_WIND_RANGE[1]}m/s) 밖 셀이 있어 해당 셀은 통계에서 제외했습니다.` });

  const sentence = representative
    ? `여름 14시 UTCI 중앙값 ${metricValueFor(withAliases, "utci_median_summer_h14")}°C, 양지·그늘 차이 ${metricValueFor(withAliases, "sun_shade_diff_c_summer_h14")}°C → 계절·시각 자리끼리 비교하고 현장 조건을 확인하세요`
    : "계절·시각 대표 기상과 S03 바람장이 준비된 경우에만 UTCI를 계산합니다 → 계절·시각 자리끼리 비교하고 현장 조건을 확인하세요";
  const basis = representative ? ["utci_median_summer_h14", "shade_pct_summer_h14"] : [];
  const tile = makeTile(ctx, {
    code: "S04",
    type: "simulation",
    status,
    metrics: withAliases,
    judgment: { ruleId: "S04-utci@1", basisMetricIds: basis, sentence, level: null, criteria: null },
    sources,
    layers: ["utci"],
    limitations,
  });
  return parseTileResult({
    ...tile,
    conditions: {
      ...tile.conditions,
      simulation: simulationFor(ctx, weather.station, calculated.length > 0 ? [...new Set(calculated.map((result) => result.season))] : [], windSourceFor(ctx)),
    },
    presentation: {
      ...tile.presentation,
      rasters: calculated.map((result) => result.raster),
      legend: categoryLegend(),
    },
  });
}

function metricValueFor(metrics: TileResult["metrics"], id: string): string {
  const value = metrics.find((metric) => metric.id === id)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "자료 없음";
}
