/** S02는 동지 일조 래스터를 기본으로 내보내고 계절별 래스터를 함께 보존한다. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s02 } = await import("../../lib/v2/tile/s02/engine.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

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
  const sunFace = (tile.presentation.polygons ?? []).find((polygon) => polygon.layer === "sun_face");
  assert.ok(sunFace, "S02 emits the site sun_face polygon");
  assert.equal(sunFace.name, null, "the site surface has no source feature name");
  assert.match(sunFace.sublabel, /^동지 일조 \d+(?:\.\d)?시간$/, "sun_face carries the formatted winter sunlight sublabel");
  assert.equal(sunFace.labelPriority, 2, "the site surface is a priority label");
  assert.ok(!tile.presentation.legend.some((item) => item.label === "수광면"), "legacy 수광면 legend is removed");
  const hourLegend = tile.presentation.legend.filter((item) => item.label.startsWith("동지 일조시간(시간) · "));
  assert.equal(hourLegend.length, 16, "S02 exposes one complete 0..15+ winter sun-hour legend");
  assert.deepEqual(hourLegend.at(-1), { label: "동지 일조시간(시간) · 15시간 이상", min: 15, max: null });
  const securedGround = tile.metrics.find((metric) => metric.id === "secured_ground_pct_winter");
  assert.ok(securedGround && securedGround.unit === "%" && Number.isFinite(securedGround.value), "S02 exposes secured ground percentage");
  const viewHourLegend = toTileView(tile).map.legend.filter((item) => item.label.startsWith("동지 일조시간(시간) · "));
  assert.equal(viewHourLegend.length, 16, "S02 card expands the sun-hour legend to 16 display bins");
  assert.deepEqual(viewHourLegend.at(-1), { label: "동지 일조시간(시간) · 15시간 이상", min: 15, max: null });
  assert.ok(tile.metrics.some((metric) => metric.id === "mean_sun_h_winter"));
  assert.ok(tile.metrics.some((metric) => metric.id === "share_cont2h_0915_pct_winter"));
  assert.ok(!tile.limitations.some((limitation) => limitation.note.includes("09:00–15:00") && limitation.note.includes("최대 6시간")));
  assert.ok(!tile.judgment.sentence.includes("최대 6시간"));
  assert.ok(!tile.judgment.sentence.includes("법적 일조권 충족"));
} finally {
  ctx.close();
}

console.log("✓ v2 S02 winter raster and seasonal output");
