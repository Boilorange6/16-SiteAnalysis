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

export interface AsosHourly {
  stnId: string;
  tm: string;
  ws: number | null;
  wd: number | null;
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

function hourOf(value: string): { ms: number; key: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!match || match[5] !== "00") return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4])));
  if (date.toISOString().slice(0, 16) !== value.trim().replace(" ", "T")) return null;
  return { ms: date.getTime(), key: `${match[1]}-${match[2]}-${match[3]} ${match[4]}:00` };
}

interface StationAggregate {
  station: AsosStation;
  startMs: number;
  endMs: number;
  totalHours: number;
  calmHours: number;
  missingHours: number;
  dirs: number[][];
  seen: Set<string>;
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
    seen: new Set<string>(),
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

  const aggregates = new Map(stations.map((station) => [station.stnId, aggregateFor(station, periodStart, periodEnd)]));
  const stats = new SourceStats(ASOS_SOURCE_ID, releaseId, []);
  stats.expectedRegions = stations.map((station) => station.stnId);

  for await (const row of hourly) {
    stats.read();
    const aggregate = aggregates.get(clean(row.stnId));
    const time = typeof row.tm === "string" ? hourOf(row.tm) : null;
    if (!aggregate || !time) {
      stats.reject();
      continue;
    }
    if (time.ms < aggregate.startMs || time.ms >= aggregate.endMs) continue;
    if (aggregate.seen.has(time.key)) {
      stats.reject();
      continue;
    }
    aggregate.seen.add(time.key);
    stats.accept({ stnId: aggregate.station.stnId, ws: row.ws, wd: row.wd }, aggregate.station.stnId, "hour");

    const speedBin = speedBinOf(row.ws);
    if (speedBin === null) {
      aggregate.missingHours++;
    } else if (speedBin < 0) {
      aggregate.calmHours++;
    } else {
      const dir16 = dir16Of(row.wd);
      if (dir16 === null) aggregate.missingHours++;
      else aggregate.dirs[dir16][speedBin]++;
    }
  }

  const insertStation = db.prepare(`INSERT INTO weather_station
    (station_id, name, lng, lat, elevation_m, period_start, period_end, total_hours, calm_hours, missing_hours, release_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertWind = db.prepare("INSERT INTO wind_rose (station_id, dir16, speed_bin, hours) VALUES (?, ?, ?, ?)");
  const stationIds = stations.map((station) => station.stnId);
  db.transaction(() => {
    if (stationIds.length > 0) {
      const marks = stationIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM wind_rose WHERE station_id IN (${marks})`).run(...stationIds);
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
    }
  })();
  return stats;
}
