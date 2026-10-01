/**
 * 기상청 ASOS 시간자료를 연도별 JSONL로 받는다.
 *   DATA_GO_KR_API_KEY=... npx tsx src/scripts/v2/weather-fetch.mjs --years 10
 * 서비스키는 .env.local에서만 읽고 URL·오류·요약에 출력하지 않는다.
 * 전국 자료 수집은 운영자가 실행한다. --station과 --date로 한 지점·하루 모양만 확인할 수 있다.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { decodeText } = await import("../../lib/v2/a0/measure.ts");
const { readStationCsv } = await import("../../lib/v2/ingest/sources/asos-wind.ts");

const ENDPOINT = "https://apis.data.go.kr/1360000/AsosHourlyInfoService/getWthrDataList";
const PAGE_ROWS = 999;
const TIMEOUT_MS = 30_000;
const MAIN = process.env.V2_MAIN_ROOT ?? "D:/V-coding/16-SiteAnalysis";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const rawDir = opt("raw", join(MAIN, ".cache/v2/raw"));
const stationFile = opt("stations", join(rawDir, "asos", "META_관측지점정보.csv"));
const envFile = existsSync(".env.local") ? ".env.local" : join(MAIN, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const serviceKey = process.env.DATA_GO_KR_API_KEY?.trim();
if (!serviceKey) {
  console.error("DATA_GO_KR_API_KEY가 .env.local에 없습니다.");
  process.exit(2);
}
if (!existsSync(stationFile)) {
  console.error(`ASOS 지점 메타 파일이 없습니다: ${stationFile}`);
  process.exit(2);
}

const years = Number(opt("years", "10"));
const endYear = Number(opt("end-year", "2025"));
if (!Number.isInteger(years) || years < 1 || years > 100 || !Number.isInteger(endYear) || endYear < 1900) {
  console.error("--years는 1 이상 정수, --end-year는 1900 이상이어야 합니다.");
  process.exit(2);
}
const dateOnly = opt("date", null);
if (dateOnly !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
  console.error("--date는 YYYY-MM-DD 형식이어야 합니다.");
  process.exit(2);
}
const stationFilter = opt("station", null);
const requestedStations = stationFilter ? new Set(String(stationFilter).split(",").map((value) => value.trim()).filter(Boolean)) : null;
const stations = readStationCsv(decodeText(readFileSync(stationFile)).text).filter((station) => !requestedStations || requestedStations.has(station.stnId));
if (stations.length === 0) {
  console.error("수집할 ASOS 지점이 없습니다.");
  process.exit(2);
}

const fromYear = dateOnly ? Number(dateOnly.slice(0, 4)) : endYear - years + 1;
const yearsToFetch = dateOnly ? [fromYear] : Array.from({ length: years }, (_, i) => fromYear + i);
const asosDir = join(rawDir, "asos");
const failures = [];
let calls = 0;
let done = 0;
let skipped = 0;
let rowsWritten = 0;

const textOf = (value) => (value === null || value === undefined ? "" : String(value).trim());
const numberOrNull = (value) => {
  const text = textOf(value);
  if (text === "" || text === "-" || text.toLowerCase() === "null" || text.toLowerCase() === "nan") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
};
const safeError = (error) => String(error?.message ?? error).split(serviceKey).join("[redacted]").split(encodeURIComponent(serviceKey)).join("[redacted]");
const dateForYear = (year, first) => `${year}${first ? "0101" : "1231"}`;

function itemsOf(payload) {
  const response = payload?.response;
  const header = response?.header ?? {};
  const code = textOf(header.resultCode);
  if (code && code !== "00" && code !== "000") throw new Error(`ASOS API 오류 ${code} ${textOf(header.resultMsg)}`.trim());
  const body = response?.body ?? {};
  const rawItems = body?.items?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems && typeof rawItems === "object" ? [rawItems] : [];
  const totalCount = Number(body.totalCount ?? items.length);
  return { items, totalCount: Number.isFinite(totalCount) ? totalCount : items.length };
}

async function fetchPage(station, year, startDate, endDate, pageNo) {
  const params = new URLSearchParams({
    serviceKey,
    pageNo: String(pageNo),
    numOfRows: String(PAGE_ROWS),
    dataType: "JSON",
    dataCd: "ASOS",
    dateCd: "HR",
    startDt: startDate,
    startHh: "00",
    endDt: endDate,
    endHh: "23",
    stnIds: station.stnId,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    calls++;
    const response = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return itemsOf(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

function normalizedRow(row, stationId) {
  const tm = textOf(row.tm);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(tm)) return null;
  return { stnId: textOf(row.stnId) || stationId, tm, ws: numberOrNull(row.ws), wd: numberOrNull(row.wd) };
}

for (const station of stations) {
  const stationDir = join(asosDir, station.stnId);
  mkdirSync(stationDir, { recursive: true });
  for (const year of yearsToFetch) {
    const output = join(stationDir, `${year}.jsonl`);
    if (existsSync(output) && !flag("refetch")) {
      skipped++;
      continue;
    }
    const startDate = dateOnly ?? dateForYear(year, true);
    const endDate = dateOnly ?? dateForYear(year, false);
    try {
      const items = [];
      let totalCount = 0;
      for (let pageNo = 1; ; pageNo++) {
        const page = await fetchPage(station, year, startDate.replaceAll("-", ""), endDate.replaceAll("-", ""), pageNo);
        totalCount = page.totalCount;
        items.push(...page.items);
        if (items.length >= totalCount || page.items.length === 0) break;
      }
      const rows = items.map((row) => normalizedRow(row, station.stnId)).filter(Boolean);
      if (rows.length !== items.length) throw new Error(`응답 행의 시간 필드가 올바르지 않습니다 (${rows.length}/${items.length})`);
      const tmp = `${output}.tmp-${process.pid}`;
      writeFileSync(tmp, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
      renameSync(tmp, output);
      done++;
      rowsWritten += rows.length;
      console.log(`done ${station.stnId}/${year}: ${rows.length} rows`);
    } catch (error) {
      failures.push({ cell: `${station.stnId}/${year}`, error: safeError(error) });
      console.error(`FAIL ${station.stnId}/${year}: ${safeError(error)}`);
    }
  }
}

console.log(JSON.stringify({ stations: stations.length, years: yearsToFetch, done, skipped, rows: rowsWritten, calls, failed: failures.length }));
for (const failure of failures.slice(0, 20)) console.log(`FAIL ${failure.cell}: ${failure.error}`);
process.exitCode = failures.length > 0 ? 1 : 0;
