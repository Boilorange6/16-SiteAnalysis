/** D21 일조시간 — S02 셀 공유·구간 면·미계산 분모 계약. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d21 } = await import("../../lib/v2/engine/tiles/d21.ts");
const { s02 } = await import("../../lib/v2/engine/tiles/s02.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-d21-"));
await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true });
const manifest = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, manifest, "d21-test", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: PNU_DASAN_100,
});

const metric = (tile, id) => tile.metrics.find((item) => item.id === id);
try {
  const tile = d21(ctx);
  const s02Tile = s02(ctx);
  assert.equal(tile.tileCode, "D21");
  assert.ok(["complete", "partial"].includes(tile.status));
  assert.equal(metric(tile, "median_sun_hours").value, metric(s02Tile, "median_sun_hours").value);
  const shares = Array.from({ length: 6 }, (_, i) => metric(tile, `share_sun_${i + 1}`).value);
  assert.ok(shares.every((value) => typeof value === "number"));
  assert.ok(Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) <= 0.5, `share sum ${shares.reduce((sum, value) => sum + value, 0)}`);
  assert.ok(metric(tile, "share_sun_5").value >= 0, "최대 6시간 셀은 6~8시간 구간에 들어갈 수 있다");
  assert.equal(metric(tile, "share_sun_6").value, 0, "09~15 창에서 8시간 이상 구간은 비어 있어야 한다");
  assert.equal(metric(tile, "fill_calculated_pct").value, metric(s02Tile, "uncalculated_ratio").value === 0 ? 100 : 100 - metric(s02Tile, "uncalculated_ratio").value);
  assert.ok(tile.presentation.polygons?.some((polygon) => polygon.layer.startsWith("sun_")));
  assert.ok(tile.presentation.layers.includes("sun_uncalc"));
  assert.ok(tile.limitations.some((limitation) => limitation.note.includes("09:00–15:00")));
  assert.ok(!tile.judgment.sentence.includes("법적"));
} finally {
  ctx.close();
}

console.log("✓ v2 D21 sunlight hours");
