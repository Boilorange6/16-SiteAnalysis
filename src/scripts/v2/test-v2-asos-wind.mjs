/** ASOS 풍향·풍속 집계 적재기와 지점 메타 파서 테스트. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { ASOS_SOURCE_ID, SPEED_BREAKS, buildAsosWind, dir16Of, readStationCsv, seasonOfMonth, speedBinOf } = await import("../../lib/v2/ingest/sources/asos-wind.ts");

assert.equal(ASOS_SOURCE_ID, "asos");
assert.deepEqual([...SPEED_BREAKS], [0.5, 2, 4, 6, 8]);
assert.equal(dir16Of(360), 0);
assert.equal(dir16Of(0), null);
assert.equal(dir16Of(320), 14);
assert.equal(speedBinOf(0.4), -1);
assert.equal(speedBinOf(0.5), 0);
assert.equal(speedBinOf(8), 4);
assert.equal(speedBinOf(null), null);

const fixtureDir = join(process.cwd(), "src", "scripts", "v2", "fixtures");
const stations = readStationCsv(readFileSync(join(fixtureDir, "asos-station-sample.csv"), "utf8"));
assert.equal(stations.length, 2);
assert.deepEqual(stations[0], { stnId: "near", name: "근거리 관측소", lng: 127.1843, lat: 37.6245, elevationM: 30, start: "2010-01-01", end: null });
const stationsForBuild = [...stations, { stnId: "closed", name: "폐쇄 관측소", lng: 127, lat: 37, elevationM: null, start: "2010-01-01", end: "2024-12-31" }];

const sourceRows = readFileSync(join(fixtureDir, "asos-sample.jsonl"), "utf8")
  .trim()
  .split(/\r?\n/u)
  .map((line) => JSON.parse(line));
assert.ok(sourceRows.length >= 48);
const sourceRowsWithDuplicate = [...sourceRows, sourceRows[0]];

async function* hourly() {
  for (const row of sourceRowsWithDuplicate) yield row;
}

const db = new Database(":memory:");
initDataFileSchema(db, "weather");
const releaseId = insertRelease(db, {
  sourceId: "asos",
  provider: "test",
  sourceUrl: "https://example.invalid",
  sourceAsOf: "2025-12-31",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "fixture",
  licenseCode: "TEST",
});
const stats = await buildAsosWind(db, stationsForBuild, hourly(), releaseId, { start: "2025-01-01", end: "2025-12-31" });
assert.equal(stats.received, sourceRows.length + 1);
assert.equal(stats.accepted, sourceRows.length);
assert.equal(stats.rejected, 1);
assert.deepEqual(stats.byRegion, { near: sourceRows.filter((row) => row.stnId === "near").length, far: sourceRows.filter((row) => row.stnId === "far").length });
assert.equal(db.prepare("SELECT 1 FROM weather_station WHERE station_id = 'closed'").get(), undefined);
assert.deepEqual([...stats.expectedRegions].sort(), ["far", "near"]);

const near = db.prepare("SELECT * FROM weather_station WHERE station_id = 'near'").get();
assert.equal(near.total_hours, 8760);
assert.equal(near.calm_hours, 1);
assert.equal(near.missing_hours, 8733);
const far = db.prepare("SELECT * FROM weather_station WHERE station_id = 'far'").get();
assert.equal(far.calm_hours, 2);
assert.equal(far.missing_hours, 8732);
assert.equal(db.prepare("SELECT hours FROM wind_rose WHERE station_id = 'near' AND dir16 = 14 AND speed_bin = 2").pluck().get(), 10);
const annualNear = db.prepare("SELECT SUM(hours) FROM wind_rose WHERE station_id = 'near'").pluck().get();
const seasonalNear = db.prepare("SELECT SUM(hours) FROM wind_rose_season WHERE station_id = 'near'").pluck().get();
assert.equal(seasonalNear, annualNear);
assert.equal(db.prepare("SELECT COUNT(*) FROM wind_rose WHERE station_id = 'near'").pluck().get(), 80);
assert.equal(seasonOfMonth(2), "winter");
assert.equal(seasonOfMonth(3), "spring");
assert.equal(seasonOfMonth(11), "autumn");
assert.equal(seasonOfMonth(12), "winter");
assert.ok(db.prepare("SELECT hours FROM wind_rose_season WHERE station_id = 'near' AND season = 'winter' AND dir16 = 14 AND speed_bin = 2").pluck().get() > 0);
const winter14 = db.prepare("SELECT * FROM weather_season_hour WHERE station_id = 'near' AND season = 'winter' AND hour = 14").get();
assert.equal(winter14.n, 3);
assert.equal(winter14.ta_med, 2.1);
assert.equal(winter14.hm_med, 50);
assert.equal(winter14.ws_med, 2.1);
assert.equal(winter14.ghi_med_wm2, 300);
assert.equal(winter14.cloud_med, 3);
const winter02 = db.prepare("SELECT * FROM weather_season_hour WHERE station_id = 'near' AND season = 'winter' AND hour = 2").get();
assert.equal(winter02.ghi_med_wm2, 0, "야간 결측 일사는 계산된 0으로 기록");
const calmBySeason = db.prepare("SELECT season, calm_hours FROM wind_rose_season WHERE station_id = 'near' GROUP BY season ORDER BY season").all();
assert.ok(calmBySeason.some((row) => row.calm_hours === 1));
db.close();

// 예전 raw 행(ta/hm/icsr/dc10Tca 없음)도 바람장미는 적재하고 대표 기상은 항목별 null이어야 한다.
{
  const oldDb = new Database(":memory:");
  initDataFileSchema(oldDb, "weather");
  const oldRelease = insertRelease(oldDb, {
    sourceId: "asos",
    provider: "test",
    sourceUrl: "https://example.invalid",
    sourceAsOf: "2025-12-31",
    fetchedAt: "2026-10-01T00:00:00Z",
    checksum: "legacy",
    licenseCode: "TEST",
  });
  async function* oldHourly() {
    yield { stnId: "old", tm: "2025-01-01 14:00", ws: 1, wd: 320 };
  }
  await buildAsosWind(oldDb, [{ stnId: "old", name: "old", lng: 127.1, lat: 37.5, elevationM: null, start: "2025-01-01", end: null }], oldHourly(), oldRelease, { start: "2025-01-01", end: "2025-01-01" });
  assert.equal(oldDb.prepare("SELECT SUM(hours) FROM wind_rose WHERE station_id = 'old'").pluck().get(), 1);
  assert.deepEqual(oldDb.prepare("SELECT ta_med, hm_med, ghi_med_wm2, cloud_med FROM weather_season_hour WHERE station_id = 'old'").get(), { ta_med: null, hm_med: null, ghi_med_wm2: null, cloud_med: null });
  oldDb.close();
}

// 엔진 fixture의 계절 행, 정온 모드, 옛 파일 모양을 고정한다.
for (const [label, weather] of [["true", true], ["calm", "calm"]]) {
  const dir = mkdtempSync(join(tmpdir(), `v2-asos-${label}-`));
  await buildEngineFixture(dir, "fx", { weather });
  const fixtureDb = new Database(join(dir, "versions", "fx", "weather.sqlite"));
  assert.equal(fixtureDb.prepare("SELECT COUNT(*) FROM weather_season_hour").pluck().get(), 192);
  assert.equal(fixtureDb.prepare("SELECT ghi_med_wm2, cloud_med FROM weather_season_hour WHERE station_id = 'near' AND season = 'summer' AND hour = 14").get().ghi_med_wm2, 750);
  assert.equal(fixtureDb.prepare("SELECT ta_med, hm_med, ghi_med_wm2, cloud_med FROM weather_season_hour WHERE station_id = 'near' AND season = 'winter' AND hour = 14").get().ta_med, 3);
  if (weather === "calm") assert.equal(fixtureDb.prepare("SELECT MIN(ws_med) AS min_ws, MAX(ws_med) AS max_ws FROM weather_season_hour").get().min_ws, 0.3);
  fixtureDb.close();
  rmSync(dir, { recursive: true, force: true });
}
{
  const dir = mkdtempSync(join(tmpdir(), "v2-asos-legacy-"));
  await buildEngineFixture(dir, "fx", { weather: "legacy" });
  const legacyDb = new Database(join(dir, "versions", "fx", "weather.sqlite"));
  assert.equal(legacyDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'weather_season_hour'").get(), undefined);
  assert.equal(legacyDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wind_rose_season'").get(), undefined);
  legacyDb.close();
  rmSync(dir, { recursive: true, force: true });
}

const loaderSource = readFileSync(join(process.cwd(), "src", "lib", "v2", "ingest", "sources", "asos-wind.ts"), "utf8");
assert.match(loaderSource, /\bseenHours:\s*Uint8Array/);
assert.match(loaderSource, /new Uint8Array\(Math\.ceil\(totalHours \/ 8\)\)/);
assert.doesNotMatch(loaderSource, /\bseen:\s*Set<string>/);

console.log("✓ v2 ASOS wind");
