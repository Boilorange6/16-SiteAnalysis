/** S02 반경 전체 일조장·계절 날짜·정시 그림자 래스터 계약. */
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s02 } = await import("../../lib/v2/engine/tiles/s02.ts");
const { sunFieldFor, sunGridFor, sunObstaclesFor } = await import("../../lib/v2/engine/tiles/sun-shared.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-s02-raster-"));
await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true, terrain: true });
const manifest = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, manifest, "s02-raster", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: PNU_DASAN_100,
});

try {
  const computeStarted = performance.now();
  const grid = sunGridFor(ctx);
  assert.ok(grid, "sun grid");
  assert.equal(grid.cellM, 2, "800m analysis uses the quality 2m grid");
  assert.equal(grid.receiver.length, grid.cols * grid.rows);
  assert.ok(grid.receiver.includes(2), "building footprints are roof receiver cells");

  const obstacles = sunObstaclesFor(ctx, null);
  assert.equal(obstacles.length, 6, "all buildings in radius + 400m are used");
  assert.ok(obstacles.some((obstacle) => !Number.isFinite(obstacle.heightM)), "unknown height is retained as excluded obstacle");

  const winter = sunFieldFor(ctx, "winter");
  assert.ok(winter);
  assert.strictEqual(winter, sunFieldFor(ctx, "winter"), "seasonal field is memoized");
  assert.ok(winter.hourly.length >= 8 && winter.hourly.length <= 10);

  const tile = s02(ctx);
  const computeElapsedMs = Math.round(performance.now() - computeStarted);
  assert.equal(tile.status, "partial", "unknown-height building is reported as partial");
  assert.equal(tile.conditions.simulation.model, "sun-raster@1");
  assert.equal(tile.conditions.simulation.stepMin, 10);
  assert.equal(tile.conditions.simulation.cellM, 2);
  assert.equal(tile.conditions.simulation.influenceM, 400);
  assert.equal(tile.conditions.simulation.terrain, "glo30-horizon");
  assert.deepEqual(tile.conditions.simulation.tstWindows, { continuous: "09-15", total: "08-16" });
  assert.equal(tile.conditions.simulation.hourlyMinAltDeg, 5);
  assert.equal(Object.keys(tile.conditions.simulation.dates).length, 5);
  assert.equal(tile.conditions.simulation.dates.winter.date, "2026-12-22");
  const hourLegend = tile.presentation.legend.filter((item) => item.label.startsWith("일조시간 · "));
  assert.equal(hourLegend.length, 13, "sun-hour legend has 0..12+ hourly bins");
  assert.deepEqual(hourLegend[0], { label: "일조시간 · 0시간", min: 0, max: 1 });
  assert.deepEqual(hourLegend.at(-1), { label: "일조시간 · 12시간 이상", min: 12, max: null });
  assert.ok(tile.presentation.rasters?.some((ref) => ref.name === "sun_hours_winter"));
  assert.ok(tile.presentation.rasters?.some((ref) => ref.name === "shade_winter_flow"));
  assert.ok(tile.presentation.polygons?.some((polygon) => polygon.layer === "sun_face"));

  const rasters = ctx.takeRasters("S02");
  const rasterBytes = rasters.reduce((sum, item) => sum + item.blob.length, 0);
  // 병렬 부하에서 한 번의 지연으로 흔들리지 않도록 새 컨텍스트 2회를 더 재서 3회 중앙값으로 판정한다.
  const samples = [computeElapsedMs];
  for (let run = 0; run < 2; run += 1) {
    const extra = new EngineContext(dataDir, manifest, `s02-raster-perf-${run}`, {
      address: "경기도 남양주시 다산동 100", center: CENTER, radiusM: 800, analysisDate: "2026-09-30", pnu: PNU_DASAN_100,
    });
    try {
      const started = performance.now();
      s02(extra);
      samples.push(Math.round(performance.now() - started));
    } finally {
      extra.close();
    }
  }
  const medianComputeMs = [...samples].sort((a, b) => a - b)[1];
  assert.ok(medianComputeMs <= 15_000, `five-date S02 budget median: ${medianComputeMs}ms (${samples.join("/")})`);
  assert.ok(rasterBytes <= 6 * 1024 * 1024, `five-date S02 raster budget: ${rasterBytes} bytes`);
  const names = rasters.map(({ ref }) => ref.name);
  const keys = ["spring", "summer", "autumn", "winter", "analysis"];
  const expectedBase = keys.flatMap((key) => ["sun_hours_" + key, "shade_" + key + "_flow"]);
  assert.deepEqual(names.filter((name) => expectedBase.includes(name)).sort(), expectedBase.sort());
  assert.equal(names.filter((name) => name.startsWith("shade_") && /_h\d{2}$/.test(name)).length, keys.reduce((sum, key) => sum + sunFieldFor(ctx, key).hourly.length, 0));

  const sunRef = tile.presentation.rasters.find((ref) => ref.name === "sun_hours_winter");
  const sunBlob = rasters.find(({ ref }) => ref.name === "sun_hours_winter").blob;
  const sunRaw = inflateRawSync(sunBlob);
  assert.equal(sunRaw.length, sunRef.cols * sunRef.rows);
  const roof = grid.receiver.findIndex((value) => value === 2);
  assert.ok(roof >= 0);
  assert.equal(sunRaw[roof], 254, "roof cells are nodata 254");
  assert.ok(sunRaw.includes(255), "outside-radius cells are nodata 255");

  assert.ok(tile.metrics.some((metric) => metric.id === "mean_sun_h_winter"));
  assert.ok(tile.metrics.every((metric) => metric.value === null || (metric.unit === "%" ? metric.value >= 0 && metric.value <= 100 : true)));
  assert.ok(tile.limitations.some((limitation) => limitation.note.includes("높이 미상")));
  assert.ok(tile.limitations.some((limitation) => limitation.note.includes("400 m")));
  assert.ok(tile.judgment.sentence.includes("진태양시 09~15"));
  const summerMean = tile.metrics.find((metric) => metric.id === "mean_sun_h_summer").value;
  assert.ok(tile.judgment.sentence.startsWith(`하지 반경 안 지면의 평균 일조 ${summerMean}시간, 동지 `), "문장은 헤드라인과 같은 하지로 시작");
  assert.ok(!tile.judgment.sentence.includes("법적 일조권 충족"));
  assert.ok(Buffer.byteLength(JSON.stringify(tile), "utf8") < 200_000, "raster bytes stay outside result JSON");
  console.log(`✓ v2 S02 full-radius seasonal raster contract (${computeElapsedMs}ms, ${rasterBytes} compressed bytes)`);
} finally {
  ctx.close();
}
