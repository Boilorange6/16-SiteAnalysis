import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d19: d19Engine } = await import("../../lib/v2/engine/tiles/d19.ts");
const { d20: d20Engine } = await import("../../lib/v2/engine/tiles/d20.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => {
  const found = tile.metrics.find((m) => m.id === id);
  assert.ok(found, `${tile.tileCode}.${id}`);
  return found;
};
const ctxFor = (dataDir, manifest, pnu = PNU_DASAN_100) => new EngineContext(
  dataDir,
  manifest,
  "an-1",
  { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM: 800, analysisDate: "2026-09-30", pnu },
);
const noForbidden = (tile) => assert.ok(!/도보|\d\s*분|종합/.test(JSON.stringify(toTileView(tile))), `${tile.tileCode} view has forbidden wording`);
const LOT_LAYER_IDS = ["lot_lt100", "lot_100_300", "lot_300_1000", "lot_1000_3000", "lot_ge3000", "lot_road_water"];

// 1) parcels 픽스처: 반경 경계에 걸친 필지도 개수에는 포함하고 면적은 원과 교차한 부분만 계산한다.
const dataDir = mkdtempSync(join(tmpdir(), "v2-d19-d20-"));
await buildEngineFixture(dataDir, "v1", { parcels: true });
const manifest = M.readManifest(dataDir);
const ctx = ctxFor(dataDir, manifest);
const d19 = d19Engine(ctx);
const d20 = d20Engine(ctx);

assert.equal(metric(d19, "parcels").value, 8);
assert.equal(metric(d19, "site_parcel_found").value, 1);
assert.equal(metric(d19, "share_jimok_1").value, 62.5);
assert.equal(metric(d19, "share_jimok_1").numerator, 5);
assert.equal(metric(d19, "share_jimok_1").denominator, 8);
assert.ok(d19.presentation.polygons.some((p) => p.layer === "parcel_site"));
assert.ok(d19.presentation.polygons.some((p) => p.label === "100"));
assert.ok(metric(d19, "fill_geometry_pct").value > 0);
assert.equal(metric(d19, "share_area_1").denominator, Math.round(Math.PI * 800 ** 2));

assert.equal(metric(d20, "parcels").value, 8);
assert.equal(metric(d20, "fill_area_pct").value, 100);
assert.deepEqual(
  LOT_LAYER_IDS.map((_, i) => metric(d20, `share_count_${i + 1}`).numerator),
  [0, 1, 1, 1, 3, 2],
);
assert.deepEqual(
  LOT_LAYER_IDS.map((_, i) => metric(d20, `share_count_${i + 1}`).value),
  [0, 12.5, 12.5, 12.5, 37.5, 25],
);
assert.equal(metric(d20, "median_parcel_m2").value, 3800);
assert.equal(metric(d20, "share_area_5").denominator, Math.round(Math.PI * 800 ** 2));
assert.ok(metric(d20, "share_area_5").numerator > 53000);
assert.ok(metric(d20, "share_area_5").numerator < 55000);
assert.ok(d20.presentation.polygons.some((p) => p.layer === "lot_ge3000"));
assert.ok(d20.presentation.polygons.some((p) => p.layer === "lot_road_water"));
noForbidden(d19);
noForbidden(d20);
ctx.close();

// 2) 좌표만 입력하면 대상 PNU는 해당 없음이지, 미확인 0이 아니다.
const centerCtx = ctxFor(dataDir, manifest, null);
const centerD19 = d19Engine(centerCtx);
assert.equal(metric(centerD19, "site_parcel_found").status, "not_applicable");
assert.equal(metric(centerD19, "site_parcel_found").value, null);
centerCtx.close();

// 3) parcels 파일이 게시되지 않은 버전은 두 타일 모두 예외 없이 not_provided다.
const absentDir = mkdtempSync(join(tmpdir(), "v2-d19-d20-absent-"));
await buildEngineFixture(absentDir, "v1");
const absentManifest = M.readManifest(absentDir);
const absentCtx = ctxFor(absentDir, absentManifest);
assert.equal(d19Engine(absentCtx).status, "not_provided");
assert.equal(d20Engine(absentCtx).status, "not_provided");
absentCtx.close();

console.log("✓ v2 D19/D20 engine tiles");
