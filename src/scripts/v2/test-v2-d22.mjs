/** D22 바람장미 엔진 테스트. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { DIR16_DEGREES, DIR16_NAMES, d22, prevailingBySeason } = await import("../../lib/v2/engine/tiles/d22.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-d22-"));
await buildEngineFixture(dataDir, "v1", { weather: true });
const weatherDb = new Database(join(dataDir, "versions", "v1", "weather.sqlite"));
const releaseId = weatherDb.prepare("SELECT release_id FROM source_release WHERE source_id = 'asos' LIMIT 1").pluck().get();
weatherDb.prepare(`INSERT INTO weather_station
  (station_id, name, lng, lat, elevation_m, period_start, period_end, total_hours, calm_hours, missing_hours, release_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
  "short",
  "short",
  ...at(100),
  15,
  "2016-01-01",
  "2025-12-31",
  10000,
  0,
  2000,
  releaseId,
);
weatherDb.close();
const manifest = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, manifest, "d22-test", {
  address: "테스트",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
});
const startedAt = performance.now();
const result = d22(ctx);
const elapsedMs = performance.now() - startedAt;
assert.ok(elapsedMs < 1500, `D22 engine exceeded 1500 ms budget: ${elapsedMs.toFixed(1)} ms`);
console.log(`D22 engine perf: ${elapsedMs.toFixed(1)} ms (budget 1500 ms)`);
parseTileResult(result);
const metric = (id) => result.metrics.find((item) => item.id === id);

assert.equal(result.tileCode, "D22");
assert.equal(result.tileType, "diagram");
assert.equal(result.status, "complete");
assert.equal(metric("station_distance_m").value, 3000);
assert.ok(result.limitations.some((limitation) => limitation.note.includes("8,760시간") && limitation.note.includes("1개")));
assert.equal(metric("station_elevation_m").value, 30);
assert.equal(metric("period_years").value, 10);
assert.equal(metric("fill_hours_pct").value, 95);
assert.equal(metric("calm_pct").value, 10);
assert.equal(metric("missing_pct").value, 5);
assert.equal(metric("prevailing_dir_deg").value, 315);
assert.match(metric("prevailing_dir_deg").label, /NW/);
assert.equal(metric("back_dir_14").value, Math.round((20000 / (87672 - 8767 - 4384)) * 1000) / 10);
assert.equal(result.presentation.layers.length, 0);
assert.equal(result.presentation.features, undefined);
assert.equal(result.presentation.polygons, undefined);
assert.equal(result.presentation.lines, undefined);
assert.equal(result.presentation.rose.station, "near");
assert.equal(result.presentation.rose.dirs.length, 16);
assert.ok(result.presentation.rose.dirs.every((bins) => bins.length === 5));
assert.equal(result.presentation.rose.dirs.flat().reduce((sum, hours) => sum + hours, 0), 87672 - 8767 - 4384);
assert.equal(result.presentation.rose.calmHours, 8767);
assert.equal(result.presentation.rose.missingHours, 4384);
assert.equal(result.presentation.rose.totalHours, 87672);
assert.ok(result.presentation.roses);
assert.deepEqual(Object.keys(result.presentation.roses).sort(), ["annual", "autumn", "spring", "summer", "winter"]);
assert.equal(result.presentation.roses.annual.dirs[14][1], result.presentation.rose.dirs[14][1]);
assert.equal(result.presentation.roses.summer.dirs[10][1], 20000);
assert.equal(result.presentation.roses.winter.dirs[14][1], 20000);
assert.equal(metric("prevailing_dir_deg_summer").value, 225);
assert.equal(metric("prevailing_dir_deg_winter").value, 315);
assert.equal(metric("calm_pct_summer").value, 0.5);
const prevailing = prevailingBySeason(ctx);
assert.equal(prevailing.station.id, "near");
assert.equal(prevailing.annual.name, "NW");
assert.deepEqual(prevailing.seasons.summer, { deg: 225, name: "SW", pct: 100 });
assert.deepEqual(prevailing.seasons.winter, { deg: 315, name: "NW", pct: 100 });
assert.match(result.judgment.sentence, /NW/);
assert.doesNotMatch(JSON.stringify(result), /좋음|법적 적합|개발 가능/);
assert.equal(DIR16_NAMES[14], "NW");
assert.equal(DIR16_DEGREES[14], 315);
ctx.close();

const legacyDir = mkdtempSync(join(tmpdir(), "v2-d22-legacy-"));
await buildEngineFixture(legacyDir, "v1", { weather: "legacy" });
const legacyCtx = new EngineContext(legacyDir, M.readManifest(legacyDir), "d22-legacy", {
  address: "테스트",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
});
const legacy = d22(legacyCtx);
parseTileResult(legacy);
assert.equal(legacy.status, "complete");
assert.equal(legacy.presentation.roses, undefined);
assert.equal(legacy.presentation.rose.dirs[14][1], 20000);
assert.equal(legacy.metrics.find((item) => item.id === "prevailing_dir_deg_summer"), undefined);
assert.ok(legacy.limitations.some((limitation) => limitation.note === "계절 장미 미적재"));
legacyCtx.close();

const noWeatherDir = mkdtempSync(join(tmpdir(), "v2-d22-empty-"));
await buildEngineFixture(noWeatherDir, "v1");
const noWeatherCtx = new EngineContext(noWeatherDir, M.readManifest(noWeatherDir), "d22-empty", {
  address: "테스트",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
});
const noWeather = d22(noWeatherCtx);
assert.equal(noWeather.status, "not_provided");
assert.equal(noWeather.limitations[0].note, "기상(ASOS) 미적재");
noWeatherCtx.close();

console.log("✓ v2 D22 wind rose");
