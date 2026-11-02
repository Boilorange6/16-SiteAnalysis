/** S02는 동지 일조 래스터를 기본으로 내보내고 계절별 래스터를 함께 보존한다. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
  // 컷 장의 카드는 그 컷(계절)을 따른다(spec §4-2): 동지는 기본 카드, 다른 계절은 그 계절의 값, 그 계절 값이 없으면 카드 없음.
  {
    const { viewForCut } = await import("../../lib/v2/ui/cut-selection.ts");
    const base = toTileView(tile);
    assert.deepEqual(base.keyFigure.question, "동지 평균 일조");
    assert.deepEqual(viewForCut(base, { tile: "S02", mode: "single", date: "winter" }).keyFigure, base.keyFigure, "동지 컷은 기본 카드 그대로");
    const rowOf = (view, label) => view.rows.find((row) => row.label === label);
    const spring = viewForCut(base, { tile: "S02", mode: "single", date: "spring" }).keyFigure;
    assert.ok(spring, "춘분 컷도 카드가 있다");
    assert.equal(spring.question, "춘분 평균 일조");
    assert.equal(spring.answer.value, rowOf(base, "춘분 평균 일조시간").value, "큰 답은 춘분 평균 일조시간");
    assert.ok(spring.stats.some((stat) => stat.label === "춘분 연속 2시간 확보" && stat.value === rowOf(base, "춘분 진태양시 09~15 연속 2시간 확보").value), "보조는 그 계절의 연속 2시간 확보");
    assert.ok(!JSON.stringify(spring).includes("미확인"), "미확인을 카드에 쓰지 않는다");
    const noSummer = { ...base, rows: base.rows.filter((row) => row.label !== "하지 평균 일조시간") };
    assert.equal(viewForCut(noSummer, { tile: "S02", mode: "single", date: "summer" }).keyFigure, null, "그 계절 값이 없으면 카드를 내지 않는다(동지 카드를 대신 내지 않는다)");
  }
  assert.ok(!tile.limitations.some((limitation) => limitation.note.includes("09:00–15:00") && limitation.note.includes("최대 6시간")));
  assert.ok(!tile.judgment.sentence.includes("최대 6시간"));
  assert.ok(!tile.judgment.sentence.includes("법적 일조권 충족"));
} finally {
  ctx.close();
}

const terrainDir = mkdtempSync(join(tmpdir(), "v2-s02-terrain-provenance-"));
await buildEngineFixture(terrainDir, "v1", { buildings: true, parcels: true, terrain: true });
const terrainManifest = M.readManifest(terrainDir);
const terrainCtx = new EngineContext(terrainDir, terrainManifest, "s02-terrain-provenance", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 100,
  analysisDate: "2026-09-30",
  pnu: PNU_DASAN_100,
});
try {
  const terrainTile = s02(terrainCtx);
  assert.ok(terrainTile.provenance.sources.some((source) => source.sourceId === "terrain_tiles"), "지형 DEM 원천 provenance");
} finally {
  terrainCtx.close();
  rmSync(terrainDir, { recursive: true, force: true });
}

console.log("✓ v2 S02 winter raster and seasonal output");
