/** D22 바람장미 — 최근접 ASOS 관측소의 장기 풍향·풍속 빈도. */
import { toUtmk } from "../../crs";
import { parseTileResult, type TileResult } from "../../tile-result";
import type { EngineContext } from "../context";
import { fmt, makeTile, missing, obs, roundM, type TileDraft } from "./common";
import { notProvided } from "./not-provided";

export const DIR16_NAMES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
export const DIR16_DEGREES = DIR16_NAMES.map((_, index) => index * 22.5) as readonly number[];

interface StationRow {
  station_id: string;
  name: string;
  lng: number;
  lat: number;
  elevation_m: number | null;
  period_start: string;
  period_end: string;
  total_hours: number;
  calm_hours: number;
  missing_hours: number;
}

interface WindRow {
  dir16: number;
  speed_bin: number;
  hours: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const percentage = (part: number, whole: number) => (whole > 0 ? round1((part / whole) * 100) : null);

function periodYears(start: string, end: string): number | null {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return round1((to - from + 24 * 60 * 60 * 1000) / (365.25 * 24 * 60 * 60 * 1000));
}

function withRose(tile: TileResult, rose: NonNullable<TileResult["presentation"]["rose"]>): TileResult {
  return parseTileResult({ ...tile, presentation: { ...tile.presentation, rose } });
}

export function d22(ctx: EngineContext): TileResult {
  const db = ctx.db("weather");
  if (!db) return notProvided(ctx, "D22", "기상(ASOS) 미적재");

  const sources = ctx.sources("weather", ["asos"]);
  const stations = db.prepare(`SELECT station_id, name, lng, lat, elevation_m, period_start, period_end,
      total_hours, calm_hours, missing_hours FROM weather_station ORDER BY station_id`).all() as StationRow[];
  if (stations.length === 0 || sources.length === 0) return notProvided(ctx, "D22", "기상(ASOS) 관측소 자료가 없습니다");
  const eligibleStations = stations.filter((row) => row.total_hours - row.missing_hours >= 8_760);
  const excludedStationCount = stations.length - eligibleStations.length;
  if (eligibleStations.length === 0) return notProvided(ctx, "D22", `관측시간 8,760시간 이상인 ASOS 관측소가 없습니다(${excludedStationCount}개 제외)`);

  const [cx, cy] = toUtmk(ctx.input.center);
  let nearest: { row: StationRow; distanceM: number } | null = null;
  for (const row of eligibleStations) {
    if (![row.lng, row.lat].every(Number.isFinite)) continue;
    const [x, y] = toUtmk([row.lng, row.lat]);
    const distanceM = Math.hypot(x - cx, y - cy);
    if (nearest === null || distanceM < nearest.distanceM || (distanceM === nearest.distanceM && row.station_id < nearest.row.station_id)) nearest = { row, distanceM };
  }
  if (nearest === null) return notProvided(ctx, "D22", "기상(ASOS) 관측소 좌표가 없습니다");

  const row = nearest.row;
  const dirs = Array.from({ length: 16 }, () => Array(5).fill(0));
  const windRows = db.prepare("SELECT dir16, speed_bin, hours FROM wind_rose WHERE station_id = ?").all(row.station_id) as WindRow[];
  for (const item of windRows) {
    if (Number.isInteger(item.dir16) && item.dir16 >= 0 && item.dir16 < 16 && Number.isInteger(item.speed_bin) && item.speed_bin >= 0 && item.speed_bin < 5) {
      dirs[item.dir16][item.speed_bin] += Math.max(0, Math.trunc(item.hours));
    }
  }

  const totalHours = Math.max(0, Math.trunc(row.total_hours));
  const calmHours = Math.max(0, Math.trunc(row.calm_hours));
  const roseHours = dirs.flat().reduce((sum, hours) => sum + hours, 0);
  const missingHours = Math.max(0, Math.trunc(row.missing_hours), totalHours - calmHours - roseHours);
  const observedHours = Math.max(0, totalHours - missingHours);
  const dirTotals = dirs.map((speedBins) => speedBins.reduce((sum, hours) => sum + hours, 0));
  const directionalHours = dirTotals.reduce((sum, hours) => sum + hours, 0);
  const prevailingIndex = directionalHours > 0 ? dirTotals.reduce((best, hours, index) => hours > dirTotals[best] ? index : best, 0) : null;
  const prevailingHours = prevailingIndex === null ? 0 : dirTotals[prevailingIndex];
  const prevailingPct = percentage(prevailingHours, directionalHours);
  const period = periodYears(row.period_start, row.period_end);

  const metrics: TileDraft["metrics"] = [
    obs("station_distance_m", "최근접 ASOS 관측소 거리", roundM(nearest.distanceM), "m", "d22-station-distance@1:EPSG:5179 중심과 최근접 관측소의 직선거리", roundM(nearest.distanceM), null),
    row.elevation_m === null || !Number.isFinite(row.elevation_m)
      ? missing("station_elevation_m", "관측소 해발고도", "m", "d22-station-elevation@1:관측소 META 노장해발고도")
      : obs("station_elevation_m", "관측소 해발고도", row.elevation_m, "m", "d22-station-elevation@1:관측소 META 노장해발고도", row.elevation_m, null),
    period === null ? missing("period_years", "관측 기간", "년", "d22-period@1:관측소 period_start~period_end") : obs("period_years", "관측 기간", period, "년", "d22-period@1:관측소 period_start~period_end", null, null),
    percentage(observedHours, totalHours) === null
      ? missing("fill_hours_pct", "풍향·풍속 관측 시간 채움률", "%", "d22-fill-hours@1:(정온+풍향·풍속 관측 시간)÷총 기간 시간")
      : obs("fill_hours_pct", "풍향·풍속 관측 시간 채움률", percentage(observedHours, totalHours)!, "%", "d22-fill-hours@1:(정온+풍향·풍속 관측 시간)÷총 기간 시간", observedHours, totalHours),
    percentage(calmHours, totalHours) === null
      ? missing("calm_pct", "정온 비율", "%", "d22-calm@1:정온 시간÷총 기간 시간")
      : obs("calm_pct", "정온 비율", percentage(calmHours, totalHours)!, "%", "d22-calm@1:정온 시간÷총 기간 시간", calmHours, totalHours),
    percentage(missingHours, totalHours) === null
      ? missing("missing_pct", "결측 시간 비율", "%", "d22-missing@1:결측 시간÷총 기간 시간")
      : obs("missing_pct", "결측 시간 비율", percentage(missingHours, totalHours)!, "%", "d22-missing@1:결측 시간÷총 기간 시간", missingHours, totalHours),
    prevailingIndex === null
      ? missing("prevailing_dir_deg", "최빈 풍향 중심각(미상)", "도", "d22-prevailing@1:방위별 관측 시간 최댓값의 16방위 중심각")
      : obs("prevailing_dir_deg", `최빈 풍향 중심각(${DIR16_NAMES[prevailingIndex]})`, DIR16_DEGREES[prevailingIndex], "도", "d22-prevailing@1:방위별 관측 시간 최댓값의 16방위 중심각", prevailingHours, directionalHours),
    ...DIR16_NAMES.map((name, index) => {
      const value = percentage(dirTotals[index], directionalHours);
      return value === null
        ? missing(`back_dir_${index}`, `${name} 풍향 빈도`, "%", "d22-back-direction@1:방위별 시간÷(관측−정온) 시간")
        : obs(`back_dir_${index}`, `${name} 풍향 빈도`, value, "%", "d22-back-direction@1:방위별 시간÷(관측−정온) 시간", dirTotals[index], directionalHours);
    }),
  ];

  const prevailingText = prevailingIndex === null || prevailingPct === null ? "최빈 풍향을 산출할 유효 풍향 관측 없음" : `최빈 풍향 ${DIR16_NAMES[prevailingIndex]} ${prevailingPct}%`;
  const elevationText = row.elevation_m === null || !Number.isFinite(row.elevation_m) ? "해발고도 미상" : `해발 ${fmt(row.elevation_m)}m`;
  const sentence = `최근접 관측소 ${row.name}(거리 ${round1(nearest.distanceM / 1000)}km, ${elevationText}) 기준 ${prevailingText} → 관측소 지형과 대지 국지풍은 다를 수 있음 → 현장 풍환경·S03 탐색으로 확인할 것`;
  const tile = makeTile(ctx, {
    code: "D22",
    type: "diagram",
    status: "complete",
    metrics,
    judgment: { ruleId: "D22-wind-rose@1", basisMetricIds: ["station_distance_m", "prevailing_dir_deg"], sentence, level: null, criteria: null },
    sources,
    layers: [],
    limitations: [
      { kind: "unknown", note: "관측소 장기 빈도이며 대지 국지 흐름이 아님 · 지점·기간 표시" },
      ...(excludedStationCount > 0 ? [{ kind: "partial" as const, note: `관측시간 8,760시간 미만인 ASOS 관측소 ${excludedStationCount}개를 제외했습니다.` }] : []),
    ],
  });
  return withRose(tile, { station: row.name, dirs, calmHours, missingHours, totalHours });
}
