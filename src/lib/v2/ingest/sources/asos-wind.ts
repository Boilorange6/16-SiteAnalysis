/** 기상청 ASOS 시간자료를 16방위·5풍속 구간 빈도로 적재한다. */
import type BetterSqlite3 from "better-sqlite3";
import { parseCsv } from "../../a0/measure";
import { SourceStats } from "../build";

type Db = BetterSqlite3.Database;

export const ASOS_SOURCE_ID = "asos";
export const SPEED_BREAKS = [0.5, 2, 4, 6, 8] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DIR16_CODE_DEGREES = [360, 20, 50, 70, 90, 110, 140, 160, 180, 200, 230, 250, 270, 290, 320, 340] as const;

export type Season = "spring" | "summer" | "autumn" | "winter";
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const satisfies readonly Season[];

export function seasonOfMonth(month: number): Season {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError(`잘못된 월: ${month}`);
  if (month === 12 || month <= 2) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

export interface AsosHourly {
  stnId: string;
  tm: string;
  ws: number | null;
  wd: number | null;
  ta?: number | null;
  hm?: number | null;
  icsr?: number | null;
  dc10Tca?: number | null;
}

export interface AsosStation {
  stnId: string;
  name: string;
  lng: number;
  lat: number;
  elevationM: number | null;
  start: string;
  end: string | null;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function numberOf(value: unknown): number | null {
  const text = clean(value).replaceAll(",", "");
  if (text === "" || text === "-" || text.toLowerCase() === "null" || text.toLowerCase() === "nan") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function dateOf(value: unknown): string | null {
  const text = clean(value);
  const match = /^(\d{4})[./-]?(\d{2})[./-]?(\d{2})/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** KMA의 정온 코드 0은 풍향이 아니라 풍속으로 정온 여부를 판정한다. */
export function dir16Of(wdDeg: number | null): number | null {
  if (wdDeg === null || !Number.isFinite(wdDeg) || wdDeg === 0) return null;
  const normalized = ((wdDeg % 360) + 360) % 360;
  if (normalized === 0) return 0;
  let best = 0;
  let distance = Infinity;
  for (let i = 0; i < DIR16_CODE_DEGREES.length; i++) {
    const degree = DIR16_CODE_DEGREES[i] === 360 ? 0 : DIR16_CODE_DEGREES[i];
    const d = Math.min(Math.abs(normalized - degree), 360 - Math.abs(normalized - degree));
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best;
}

/** 풍속 < 0.5 m/s는 정온(-1), 결측은 null, 나머지는 [0.5,2)…[8,∞)다. */
export function speedBinOf(ws: number | null): number | null {
  if (ws === null || !Number.isFinite(ws)) return null;
  if (ws < SPEED_BREAKS[0]) return -1;
  for (let i = 1; i < SPEED_BREAKS.length; i++) if (ws < SPEED_BREAKS[i]) return i - 1;
  return SPEED_BREAKS.length - 1;
}

function headerIndex(headers: string[], names: readonly string[], required = true): number {
  const index = headers.findIndex((header) => names.includes(clean(header)));
  if (index < 0 && required) throw new Error(`ASOS 지점 메타 헤더 없음: ${names.join("/")}`);
  return index;
}

/** 기상자료개방포털 META_관측지점정보.csv의 EUC-KR 디코딩 후 텍스트를 읽는다. */
export function readStationCsv(text: string): AsosStation[] {
  const rows = parseCsv(text).filter((row) => row.some((cell) => clean(cell) !== ""));
  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => clean(header));
  const id = headerIndex(headers, ["지점", "지점번호", "stnId"]);
  const name = headerIndex(headers, ["지점명", "지점 이름", "stnNm"]);
  const lat = headerIndex(headers, ["위도", "lat"]);
  const lng = headerIndex(headers, ["경도", "lng", "lon"]);
  const elevation = headerIndex(headers, ["노장해발고도(m)", "노장해발고도", "해발고도(m)", "elevation"], false);
  const start = headerIndex(headers, ["시작일", "관측시작일", "start"], false);
  const end = headerIndex(headers, ["종료일", "관측종료일", "end"], false);
  if (start < 0) throw new Error("ASOS 지점 메타에 시작일 헤더가 없습니다");

  const stations: AsosStation[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const stnId = clean(row[id]);
    const stationName = clean(row[name]) || stnId;
    const latitude = numberOf(row[lat]);
    const longitude = numberOf(row[lng]);
    const started = dateOf(row[start]);
    if (!stnId || latitude === null || longitude === null || started === null || seen.has(stnId)) continue;
    seen.add(stnId);
    stations.push({
      stnId,
      name: stationName,
      lng: longitude,
      lat: latitude,
      elevationM: elevation >= 0 ? numberOf(row[elevation]) : null,
      start: started,
      end: end >= 0 ? dateOf(row[end]) : null,
    });
  }
  return stations;
}

function dayStart(value: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`잘못된 ASOS 날짜: ${value}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`잘못된 ASOS 날짜: ${value}`);
  return date.getTime();
}

function dateText(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface HourStamp {
  ms: number;
  year: number;
  month: number;
  day: number;
  hour: number;
}

function hourOf(value: string): HourStamp | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match || match[5] !== "00") return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const date = new Date(Date.UTC(year, month - 1, day, hour));
  if (date.toISOString().slice(0, 16) !== value.trim().replace(" ", "T")) return null;
  return { ms: date.getTime(), year, month, day, hour };
}

interface Histogram {
  bins: Map<number, number>;
  count: number;
}

interface SeasonHourAggregate {
  season: Season;
  hour: number;
  n: number;
  ta: Histogram;
  hm: Histogram;
  ws: Histogram;
  ghi: Histogram;
  cloud: Histogram;
}

interface SeasonRoseAggregate {
  dirs: number[][];
  calmHours: number;
}

function histogram(): Histogram {
  return { bins: new Map(), count: 0 };
}

function addHistogram(target: Histogram, value: number | null, step: number): void {
  if (value === null || !Number.isFinite(value)) return;
  const bin = Math.round(value / step);
  target.bins.set(bin, (target.bins.get(bin) ?? 0) + 1);
  target.count++;
}

function medianHistogram(target: Histogram, step: number): number | null {
  if (target.count === 0) return null;
  const ranks = target.count % 2 === 0 ? [target.count / 2 - 1, target.count / 2] : [(target.count - 1) / 2, (target.count - 1) / 2];
  const sorted = [...target.bins.entries()].sort(([a], [b]) => a - b);
  const atRank = (rank: number): number => {
    let seen = 0;
    for (const [bin, count] of sorted) {
      if (rank < seen + count) return bin * step;
      seen += count;
    }
    return sorted.at(-1)![0] * step;
  };
  return (atRank(ranks[0]) + atRank(ranks[1])) / 2;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** KST 표기의 관측시각에서 시간 중앙(hh-0.5)의 태양고도를 근사한다. */
function solarAltitudeAt(localHourMs: number, latDeg: number, lonDeg: number): number {
  const midpoint = new Date(localHourMs - 30 * 60 * 1000);
  const year = midpoint.getUTCFullYear();
  const month = midpoint.getUTCMonth();
  const day = midpoint.getUTCDate();
  const dayOfYear = Math.floor((Date.UTC(year, month, day) - Date.UTC(year, 0, 0)) / DAY_MS);
  const localMinutes = midpoint.getUTCHours() * 60 + midpoint.getUTCMinutes() + midpoint.getUTCSeconds() / 60;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (localMinutes / 60 - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = localMinutes + equationOfTime + 4 * lonDeg - 60 * 9;
  const hourAngle = ((trueSolarMinutes / 4 - 180) * Math.PI) / 180;
  const latitude = (latDeg * Math.PI) / 180;
  const altitude = Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
  return (altitude * 180) / Math.PI;
}

function ghiOf(icsr: number | null | undefined, time: HourStamp, station: AsosStation): number | null {
  if (solarAltitudeAt(time.ms, station.lat, station.lng) <= 0) return 0;
  const value = finiteOrNull(icsr);
  return value === null || value < 0 ? null : (value * 1_000_000) / 3_600;
}

function seasonHourOf(aggregate: StationAggregate, season: Season, hour: number): SeasonHourAggregate {
  const key = `${season}:${hour}`;
  const existing = aggregate.seasonHours.get(key);
  if (existing) return existing;
  const created: SeasonHourAggregate = { season, hour, n: 0, ta: histogram(), hm: histogram(), ws: histogram(), ghi: histogram(), cloud: histogram() };
  aggregate.seasonHours.set(key, created);
  return created;
}

interface StationAggregate {
  station: AsosStation;
  startMs: number;
  endMs: number;
  totalHours: number;
  calmHours: number;
  missingHours: number;
  dirs: number[][];
  seenHours: Uint8Array;
  seasonRoses: Map<Season, SeasonRoseAggregate>;
  seasonHours: Map<string, SeasonHourAggregate>;
}

function aggregateFor(station: AsosStation, periodStart: number, periodEnd: number): StationAggregate {
  const stationStart = dayStart(station.start);
  const stationEnd = station.end === null ? periodEnd : dayStart(station.end) + DAY_MS;
  const startMs = Math.max(periodStart, stationStart);
  const endMs = Math.min(periodEnd, stationEnd);
  const totalHours = Math.max(0, Math.round((endMs - startMs) / HOUR_MS));
  return {
    station,
    startMs,
    endMs,
    totalHours,
    calmHours: 0,
    missingHours: 0,
    dirs: Array.from({ length: 16 }, () => Array(5).fill(0)),
    seenHours: new Uint8Array(Math.ceil(totalHours / 8)),
    seasonRoses: new Map(),
    seasonHours: new Map(),
  };
}

export async function buildAsosWind(
  db: Db,
  stations: AsosStation[],
  hourly: AsyncIterable<AsosHourly>,
  releaseId: string,
  period: { start: string; end: string },
): Promise<SourceStats> {
  const periodStart = dayStart(period.start);
  const periodEnd = dayStart(period.end) + DAY_MS;
  if (periodEnd <= periodStart) throw new Error(`잘못된 ASOS 기간 ${period.start}..${period.end}`);

  const aggregates = new Map<string, StationAggregate>();
  for (const station of stations) {
    const aggregate = aggregateFor(station, periodStart, periodEnd);
    if (aggregate.totalHours > 0) aggregates.set(station.stnId, aggregate);
  }
  const stats = new SourceStats(ASOS_SOURCE_ID, releaseId, []);
  stats.expectedRegions = [...aggregates.keys()];

  for await (const row of hourly) {
    stats.read();
    const aggregate = aggregates.get(clean(row.stnId));
    const time = typeof row.tm === "string" ? hourOf(row.tm) : null;
    if (!aggregate || !time) {
      stats.reject();
      continue;
    }
    if (time.ms < aggregate.startMs || time.ms >= aggregate.endMs) continue;
    const hourIndex = Math.floor((time.ms - aggregate.startMs) / HOUR_MS);
    const byteIndex = Math.floor(hourIndex / 8);
    const bit = 1 << (hourIndex % 8);
    if ((aggregate.seenHours[byteIndex] & bit) !== 0) {
      stats.reject();
      continue;
    }
    aggregate.seenHours[byteIndex] |= bit;
    stats.accept({ stnId: aggregate.station.stnId, ws: row.ws, wd: row.wd }, aggregate.station.stnId, "hour");

    const season = seasonOfMonth(time.month);
    const seasonRose = aggregate.seasonRoses.get(season) ?? { dirs: Array.from({ length: 16 }, () => Array(5).fill(0)), calmHours: 0 };
    aggregate.seasonRoses.set(season, seasonRose);
    const seasonHour = seasonHourOf(aggregate, season, time.hour);
    seasonHour.n++;
    addHistogram(seasonHour.ta, finiteOrNull(row.ta), 0.1);
    addHistogram(seasonHour.hm, finiteOrNull(row.hm), 1);
    addHistogram(seasonHour.ws, finiteOrNull(row.ws), 0.1);
    addHistogram(seasonHour.ghi, ghiOf(row.icsr, time, aggregate.station), 5);
    addHistogram(seasonHour.cloud, finiteOrNull(row.dc10Tca), 1);

    const speedBin = speedBinOf(row.ws);
    if (speedBin === null) {
      aggregate.missingHours++;
    } else if (speedBin < 0) {
      aggregate.calmHours++;
      seasonRose.calmHours++;
    } else {
      const dir16 = dir16Of(row.wd);
      if (dir16 === null) aggregate.missingHours++;
      else {
        aggregate.dirs[dir16][speedBin]++;
        seasonRose.dirs[dir16][speedBin]++;
      }
    }
  }

  const insertStation = db.prepare(`INSERT INTO weather_station
    (station_id, name, lng, lat, elevation_m, period_start, period_end, total_hours, calm_hours, missing_hours, release_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertWind = db.prepare("INSERT INTO wind_rose (station_id, dir16, speed_bin, hours) VALUES (?, ?, ?, ?)");
  const insertSeasonWind = db.prepare("INSERT INTO wind_rose_season (station_id, season, dir16, speed_bin, hours, calm_hours) VALUES (?, ?, ?, ?, ?, ?)");
  const insertSeasonHour = db.prepare(`INSERT INTO weather_season_hour
    (station_id, season, hour, n, ta_med, hm_med, ws_med, ghi_med_wm2, cloud_med)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const stationIds = stations.map((station) => station.stnId);
  db.transaction(() => {
    if (stationIds.length > 0) {
      const marks = stationIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM wind_rose WHERE station_id IN (${marks})`).run(...stationIds);
      db.prepare(`DELETE FROM wind_rose_season WHERE station_id IN (${marks})`).run(...stationIds);
      db.prepare(`DELETE FROM weather_season_hour WHERE station_id IN (${marks})`).run(...stationIds);
      db.prepare(`DELETE FROM weather_station WHERE station_id IN (${marks})`).run(...stationIds);
    }
    for (const aggregate of aggregates.values()) {
      const missingByGap = Math.max(0, aggregate.totalHours - aggregate.calmHours - aggregate.dirs.flat().reduce((sum, hours) => sum + hours, 0));
      const missingHours = Math.max(aggregate.missingHours, missingByGap);
      insertStation.run(
        aggregate.station.stnId,
        aggregate.station.name,
        aggregate.station.lng,
        aggregate.station.lat,
        aggregate.station.elevationM,
        dateText(aggregate.startMs),
        dateText(Math.max(aggregate.startMs, aggregate.endMs - DAY_MS)),
        aggregate.totalHours,
        aggregate.calmHours,
        missingHours,
        releaseId,
      );
      for (let dir16 = 0; dir16 < 16; dir16++) {
        for (let speedBin = 0; speedBin < 5; speedBin++) insertWind.run(aggregate.station.stnId, dir16, speedBin, aggregate.dirs[dir16][speedBin]);
      }
      for (const season of SEASONS) {
        const rose = aggregate.seasonRoses.get(season);
        if (!rose) continue;
        for (let dir16 = 0; dir16 < 16; dir16++) {
          for (let speedBin = 0; speedBin < 5; speedBin++) insertSeasonWind.run(aggregate.station.stnId, season, dir16, speedBin, rose.dirs[dir16][speedBin], rose.calmHours);
        }
      }
      for (const item of aggregate.seasonHours.values()) {
        insertSeasonHour.run(
          aggregate.station.stnId,
          item.season,
          item.hour,
          item.n,
          medianHistogram(item.ta, 0.1),
          medianHistogram(item.hm, 1),
          medianHistogram(item.ws, 0.1),
          medianHistogram(item.ghi, 5),
          medianHistogram(item.cloud, 1),
        );
      }
    }
  })();
  return stats;
}
