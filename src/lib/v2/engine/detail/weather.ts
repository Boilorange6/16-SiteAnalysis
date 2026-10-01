/** D22 바람장미 상세. 연·계절별로 같은 16방위 집계값을 CSV와 카드에 쓴다. */
import type { DetailCard, DetailColumn, DetailRow, DetailSpec, DetailContext } from "./registry";
import { sourceLineOf } from "../../ui/tile-view";
import { toUtmk } from "../../crs";

export const WIND_COLUMNS: DetailColumn[] = [
  { key: "direction", label: "방위", kind: "category" },
  { key: "frequency_pct", label: "빈도(%)", kind: "number" },
  { key: "main_speed", label: "주로 부는 풍속(m/s)", kind: "text" },
  { key: "over4_pct", label: "4m/s 이상(%)", kind: "number" },
  { key: "hours", label: "관측 시간", kind: "number", csvOnly: true },
  { key: "season", label: "계절", kind: "category", csvOnly: true },
];

const DIR16_NAMES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;
const SPEED_LABELS = ["0.5–2", "2–4", "4–6", "6–8", "8+"] as const;
const SEASONS = [
  { value: "annual", label: "연간" },
  { value: "spring", label: "봄" },
  { value: "summer", label: "여름" },
  { value: "autumn", label: "가을" },
  { value: "winter", label: "겨울" },
] as const;

const WEATHER_CONTROLS = [{ key: "season", label: "계절", options: SEASONS.map((item) => ({ ...item })), default: "annual" }];

interface Station {
  station_id: string;
  name: string;
  lng: number;
  lat: number;
  elevation_m: number | null;
  total_hours: number;
  missing_hours: number;
}

interface WindRow {
  dir16: number;
  speed_bin: number;
  hours: number;
}

function sourceText(ctx: DetailContext): string {
  return sourceLineOf(ctx.sources("weather", ["asos"]));
}

function stationOf(ctx: DetailContext): { station: Station; distanceM: number } | null {
  const db = ctx.db("weather");
  if (!db || ctx.sources("weather", ["asos"]).length === 0) return null;
  const stations = db.prepare("SELECT station_id, name, lng, lat, elevation_m, total_hours, missing_hours FROM weather_station ORDER BY station_id").all() as Station[];
  const [cx, cy] = toUtmk(ctx.input.center);
  let best: { station: Station; distanceM: number } | null = null;
  for (const station of stations) {
    if (!Number.isFinite(station.lng) || !Number.isFinite(station.lat)) continue;
    if (station.total_hours - station.missing_hours < 8760) continue;
    const [x, y] = toUtmk([station.lng, station.lat]);
    const distanceM = Math.hypot(x - cx, y - cy);
    if (!best || distanceM < best.distanceM || (distanceM === best.distanceM && station.station_id < best.station.station_id)) best = { station, distanceM };
  }
  return best;
}

function windRows(ctx: DetailContext): DetailRow[] {
  const nearest = stationOf(ctx);
  if (!nearest) return [];
  const db = ctx.db("weather");
  if (!db) return [];
  const season = ctx.detailControls?.season ?? "annual";
  let rows: WindRow[];
  try {
    if (season === "annual") rows = db.prepare("SELECT dir16, speed_bin, hours FROM wind_rose WHERE station_id = ? ORDER BY dir16, speed_bin").all(nearest.station.station_id) as WindRow[];
    else rows = db.prepare("SELECT dir16, speed_bin, hours FROM wind_rose_season WHERE station_id = ? AND season = ? ORDER BY dir16, speed_bin").all(nearest.station.station_id, season) as WindRow[];
  } catch {
    return [];
  }
  const bins = Array.from({ length: 16 }, () => Array(5).fill(0));
  for (const row of rows) {
    if (Number.isInteger(row.dir16) && row.dir16 >= 0 && row.dir16 < 16 && Number.isInteger(row.speed_bin) && row.speed_bin >= 0 && row.speed_bin < 5) bins[row.dir16][row.speed_bin] += Math.max(0, Number(row.hours) || 0);
  }
  const totals = bins.map((values) => values.reduce((sum, value) => sum + value, 0));
  const directionalTotal = totals.reduce((sum, value) => sum + value, 0);
  return DIR16_NAMES.map((direction, dir16) => {
    const directionTotal = totals[dir16];
    const mainBin = bins[dir16].reduce((best, value, index) => value > bins[dir16][best] ? index : best, 0);
    const over4 = bins[dir16].slice(2).reduce((sum, value) => sum + value, 0);
    return {
      fid: `wind:${season}:${dir16}`,
      lng: nearest.station.lng,
      lat: nearest.station.lat,
      cells: {
        direction,
         frequency_pct: directionalTotal > 0 ? (directionTotal / directionalTotal) * 100 : null,
        main_speed: directionTotal > 0 ? `${SPEED_LABELS[mainBin]}m/s` : null,
         over4_pct: directionTotal > 0 ? (over4 / directionTotal) * 100 : null,
        hours: directionTotal,
        season,
      },
    };
  });
}

function cardFor(ctx: DetailContext, rows: readonly DetailRow[]): DetailCard {
  const nearest = stationOf(ctx);
  const season = ctx.detailControls?.season ?? "annual";
  const prevailing = [...rows].sort((a, b) => (Number(b.cells.frequency_pct) || 0) - (Number(a.cells.frequency_pct) || 0))[0];
  return {
    title: nearest?.station.name ?? "ASOS 관측소",
    subtitle: nearest ? `최근접 ${Math.round(nearest.distanceM)}m · ${SEASONS.find((item) => item.value === season)?.label ?? season}` : undefined,
    fields: [
      { label: "최빈 풍향", value: prevailing ? `${prevailing.cells.direction} (${prevailing.cells.frequency_pct}%)` : null },
      { label: "관측소 해발", value: nearest?.station.elevation_m == null ? null : `${nearest.station.elevation_m}m` },
      { label: "관측 기간", value: nearest ? `${nearest.station.total_hours.toLocaleString("ko-KR")}시간` : null },
    ],
    source: sourceText(ctx),
    ...(rows.length === 0 ? { missing: ["계절별 풍장미"] } : {}),
  };
}

const weatherSpec: DetailSpec = {
  columns: WIND_COLUMNS,
  controls: WEATHER_CONTROLS,
  summary(ctx) { const rows = windRows(ctx); return cardFor(ctx, rows); },
  rows: windRows,
  at(ctx, lng, lat) {
    const nearest = stationOf(ctx);
    if (!nearest) return null;
    const [x, y] = toUtmk([lng, lat]);
    const [sx, sy] = toUtmk([nearest.station.lng, nearest.station.lat]);
    if (Math.hypot(x - sx, y - sy) > 100000) return null;
    return { card: cardFor(ctx, windRows(ctx)), fid: `weather:${nearest.station.station_id}` };
  },
};

export const WEATHER_SPECS: Partial<Record<"D22", DetailSpec>> = { D22: weatherSpec };
