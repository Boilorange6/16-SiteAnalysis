/** S02는 동지 일조 래스터를 기본으로 내보내고 계절별 래스터를 함께 보존한다. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s02 } = await import("../../lib/v2/engine/tiles/s02.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-s02-raster-"));
await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true });
const manifest = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, manifest, "s02-raster", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: PNU_DASAN_100,
});

try {
  const tile = s02(ctx);
  const winterRef = tile.presentation.rasters.find((ref) => ref.name === "sun_hours_winter");
  const emitted = ctx.takeRasters("S02");
  const winterBlob = emitted.find(({ ref }) => ref.name === "sun_hours_winter");
  assert.equal(tile.tileCode, "S02");
  assert.equal(tile.tileType, "simulation");
  assert.ok(winterRef && winterBlob);
  assert.equal(winterRef.sha256, winterBlob.ref.sha256, "S02 winter raster reference and emitted bytes match");
  assert.ok(tile.presentation.rasters.length > 1, "S02 keeps seasonal and hourly raster choices");
  assert.ok((tile.presentation.polygons ?? []).some((polygon) => polygon.layer === "sun_face"));
  const hourLegend = tile.presentation.legend.filter((item) => item.label.startsWith("일조시간 · "));
  assert.equal(hourLegend.length, 13, "S02 keeps the complete 0..12+ sun-hour legend");
  assert.deepEqual(hourLegend.at(-1), { label: "일조시간 · 12시간 이상", min: 12, max: null });
  assert.ok(tile.metrics.some((metric) => metric.id === "mean_sun_h_winter"));
  assert.ok(tile.metrics.some((metric) => metric.id === "share_cont2h_0915_pct_winter"));
  assert.ok(!tile.limitations.some((limitation) => limitation.note.includes("09:00–15:00") && limitation.note.includes("최대 6시간")));
  assert.ok(!tile.judgment.sentence.includes("최대 6시간"));
  assert.ok(!tile.judgment.sentence.includes("법적 일조권 충족"));
} finally {
  ctx.close();
}

console.log("✓ v2 S02 winter raster and seasonal output");
