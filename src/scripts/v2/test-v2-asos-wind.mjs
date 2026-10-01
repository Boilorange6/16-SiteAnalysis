/** ASOS 풍향·풍속 집계 적재기와 지점 메타 파서 테스트. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { ASOS_SOURCE_ID, SPEED_BREAKS, buildAsosWind, dir16Of, readStationCsv, speedBinOf } = await import("../../lib/v2/ingest/sources/asos-wind.ts");

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
assert.equal(sourceRows.length, 48);

async function* hourly() {
  for (const row of sourceRows) yield row;
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
const stats = await buildAsosWind(db, stationsForBuild, hourly(), releaseId, { start: "2025-01-01", end: "2025-01-03" });
assert.equal(stats.received, 48);
assert.equal(stats.accepted, 48);
assert.equal(stats.rejected, 0);
assert.deepEqual(stats.byRegion, { near: 24, far: 24 });
assert.equal(db.prepare("SELECT 1 FROM weather_station WHERE station_id = 'closed'").get(), undefined);
assert.deepEqual([...stats.expectedRegions].sort(), ["far", "near"]);

const near = db.prepare("SELECT * FROM weather_station WHERE station_id = 'near'").get();
assert.equal(near.total_hours, 72);
assert.equal(near.calm_hours, 1);
assert.equal(near.missing_hours, 49);
const far = db.prepare("SELECT * FROM weather_station WHERE station_id = 'far'").get();
assert.equal(far.calm_hours, 2);
assert.equal(far.missing_hours, 48);
assert.equal(db.prepare("SELECT hours FROM wind_rose WHERE station_id = 'near' AND dir16 = 14 AND speed_bin = 2").pluck().get(), 10);
assert.equal(db.prepare("SELECT SUM(hours) FROM wind_rose WHERE station_id = 'near'").pluck().get(), 22);
assert.equal(db.prepare("SELECT COUNT(*) FROM wind_rose WHERE station_id = 'near'").pluck().get(), 80);
db.close();

console.log("✓ v2 ASOS wind");
