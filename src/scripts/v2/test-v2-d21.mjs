/** D21은 S02 동지 일조 래스터를 재사용하고 별도 폴리곤을 만들지 않는다. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s02 } = await import("../../lib/v2/engine/tiles/s02.ts");
const { d21 } = await import("../../lib/v2/engine/tiles/d21.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-d21-raster-"));
await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true });
const manifest = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, manifest, "d21-raster", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: PNU_DASAN_100,
});

try {
  const s02Tile = s02(ctx);
  const s02Ref = s02Tile.presentation.rasters.find((ref) => ref.name === "sun_hours_winter");
  const s02Items = ctx.takeRasters("S02");
  const s02Blob = s02Items.find(({ ref }) => ref.name === "sun_hours_winter");
  assert.ok(s02Ref && s02Blob);

  const tile = d21(ctx);
  const d21Ref = tile.presentation.rasters.find((ref) => ref.name === "sun_hours_winter");
  const d21Items = ctx.takeRasters("D21");
  const d21Blob = d21Items.find(({ ref }) => ref.name === "sun_hours_winter");
  assert.ok(d21Ref && d21Blob);
  assert.equal(d21Ref.sha256, s02Ref.sha256, "D21 points at the same winter raster bytes");
  assert.equal(d21Blob.ref.sha256, s02Blob.ref.sha256, "D21 re-emission is byte-identical");
  assert.equal(tile.presentation.polygons, undefined, "D21 no longer converts the raster to band polygons");
  assert.equal(tile.presentation.rasters.length, 1);
  assert.ok(tile.metrics.some((metric) => metric.id === "mean_sun_h_winter"));
  assert.ok(tile.metrics.some((metric) => metric.id === "share_cont2h_0915_pct_winter"));
  assert.ok(!tile.limitations.some((limitation) => limitation.note.includes("09:00–15:00") && limitation.note.includes("최대 6시간")));
  assert.ok(!tile.judgment.sentence.includes("최대 6시간"));
  assert.ok(!tile.judgment.sentence.includes("법적 일조권 충족"));
} finally {
  ctx.close();
}

console.log("✓ v2 D21 winter raster reuse");
