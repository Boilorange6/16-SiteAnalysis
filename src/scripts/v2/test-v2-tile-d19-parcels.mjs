import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const d19Engine = TILES.find(([code]) => code === "D19")[1];
const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { d20 } = await import("../../lib/v2/tile/d19/d20.ts");

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
const JIMOK_LAYER_IDS = ["jimok:site", "jimok:road", "jimok:field", "jimok:forest", "jimok:water", "jimok:other"];

// 1) parcels 픽스처: 반경 경계에 걸친 필지도 개수에는 포함하고 면적은 원과 교차한 부분만 계산한다.
const dataDir = mkdtempSync(join(tmpdir(), "v2-d19-d20-"));
await buildEngineFixture(dataDir, "v1", { parcels: true });
const manifest = M.readManifest(dataDir);
const ctx = ctxFor(dataDir, manifest);
const d19 = d19Engine(ctx);

assert.equal(metric(d19, "parcels").value, 8);
assert.equal(metric(d19, "site_parcel_found").value, 1);
assert.equal(metric(d19, "share_jimok_1").value, 62.5);
assert.equal(metric(d19, "share_jimok_1").numerator, 5);
assert.equal(metric(d19, "share_jimok_1").denominator, 8);
assert.match(d19.judgment.sentence, /상위 지목 대지 5개\(62\.5%\)/);
assert.equal(metric(d19, "share_jimok_1").label, "지목: 대지");
assert.deepEqual(d19.metrics.filter((m) => m.id.startsWith("share_jimok_")).map((m) => m.label), [
  "지목: 대지",
  "지목: 도로",
  "지목: 전답",
  "지목: 임야",
  "지목: 하천·구거",
  "지목: 기타",
]);
assert.equal(d19.metrics.filter((m) => m.id.startsWith("share_jimok_")).length, 6);
assert.equal(d19.metrics.filter((m) => m.id.startsWith("share_count_")).length, 0);
assert.deepEqual(d19.presentation.layers.filter((layer) => layer.startsWith("jimok:")), JIMOK_LAYER_IDS);
assert.ok(d19.presentation.polygons.some((p) => p.layer === "jimok:road"), "single-character 도 is a road group");
assert.ok(d19.presentation.polygons.some((p) => p.layer === "jimok:water"), "single-character 천 is a water group");
assert.ok(d19.presentation.polygons.some((p) => p.layer === "parcel_site"));
assert.ok(d19.presentation.polygons.some((p) => p.label === "100"));
assert.ok(metric(d19, "fill_geometry_pct").value > 0);
assert.equal(metric(d19, "share_area_1").denominator, Math.round(Math.PI * 800 ** 2));

assert.equal(d19.metrics.filter((m) => m.id === "parcels").length, 1);
assert.equal(metric(d19, "parcels").value, 8);
assert.equal(metric(d19, "fill_area_pct").value, 100);
assert.deepEqual(
  LOT_LAYER_IDS.map((_, i) => metric(d19, `share_size_count_${i + 1}`).numerator),
  [0, 1, 1, 1, 3, 2],
);
assert.deepEqual(
  LOT_LAYER_IDS.map((_, i) => metric(d19, `share_size_count_${i + 1}`).value),
  [0, 12.5, 12.5, 12.5, 37.5, 25],
);
assert.equal(metric(d19, "median_parcel_m2").value, 3800);
assert.equal(metric(d19, "share_size_area_5").denominator, Math.round(Math.PI * 800 ** 2));
assert.ok(metric(d19, "share_size_area_5").numerator > 53000);
assert.ok(metric(d19, "share_size_area_5").numerator < 55000);
assert.ok(d19.presentation.polygons.some((p) => p.layer === "lot_ge3000"));
assert.ok(d19.presentation.polygons.some((p) => p.layer === "lot_road_water"));
const d19View = toTileView(d19);
assert.equal(d19View.defaultLayer, "all");
const baseView = viewWithLayer(d19View, "all");
assert.ok(baseView.map);
assert.ok(!baseView.map.polygons?.some((p) => p.layer.startsWith("lot_")), "parcel_size is excluded from the base view");
const sizeView = viewWithLayer(d19View, "parcel_size");
assert.ok(sizeView.map?.polygons?.some((p) => p.layer.startsWith("lot_")), "explicit parcel_size view remains available");
assert.ok(!sizeView.map?.polygons?.some((p) => p.layer.startsWith("jimok:")));
const d20Tile = d20(ctx);
assert.equal(d20Tile.metrics.some((m) => m.id === "parcels"), false, "absorbed D20 must not duplicate D19 parcels metric");
assert.ok(!d20Tile.presentation.layers.includes("parcel"), "absorbed D20 must not re-add the base parcel layer");
assert.ok(!d20Tile.presentation.polygons.some((p) => p.layer === "parcel"), "absorbed D20 must not re-add base parcel polygons");
noForbidden(d19);
ctx.close();

// 1b) 엔진 로컬 지목 그룹은 여섯 그룹 밖의 지목을 기타로 보낸다.
const groupCtx = ctxFor(dataDir, manifest);
const originalParcelHits = groupCtx.hits("parcels", ["parcel"]);
const otherHit = {
  ...originalParcelHits[0],
  featureId: 9999,
  stableId: "parcel:other-jimok",
  pnu: null,
  name: "999 기타",
  properties: { ...originalParcelHits[0].properties, jimok: "공", jibun: "999" },
};
groupCtx.hits = (file, kinds, radiusM) => file === "parcels" ? [...originalParcelHits, otherHit] : EngineContext.prototype.hits.call(groupCtx, file, kinds, radiusM);
const groupedD19 = d19Engine(groupCtx);
assert.ok(groupedD19.presentation.polygons.some((p) => p.layer === "jimok:other"));
groupCtx.close();

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
absentCtx.close();

console.log("✓ v2 D19/D20 engine tiles");
