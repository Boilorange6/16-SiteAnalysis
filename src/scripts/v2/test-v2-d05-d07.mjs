import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d05 } = await import("../../lib/v2/engine/tiles/d05.ts");
const { d06 } = await import("../../lib/v2/engine/tiles/d06.ts");
const { d07 } = await import("../../lib/v2/engine/tiles/d07.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

function metric(tile, id) {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode} metric ${id}`);
  return found;
}

function layerCounts(tile) {
  return new Map(tile.presentation.polygons.map((polygon) => [polygon.layer, (tile.presentation.polygons.filter((item) => item.layer === polygon.layer).length)]));
}

function makeContext(dataDir, analysisId) {
  return new EngineContext(dataDir, M.readManifest(dataDir), analysisId, {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: "4136011800101000000",
  });
}

const dataDir = mkdtempSync(join(tmpdir(), "v2-d05-d07-data-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const ctx = makeContext(dataDir, "d05-d07");

try {
  const d05Tile = d05(ctx);
  const d06Tile = d06(ctx);
  const d07Tile = d07(ctx);

  assert.equal(d05Tile.status, "partial");
  assert.equal(metric(d05Tile, "fill_floors_pct").value, 66.7);
  assert.equal(metric(d05Tile, "fill_height_m_pct").value, 50);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((i) => metric(d05Tile, `share_floors_${i}`).numerator),
    [2, 0, 1, 0, 1, 0],
  );
  assert.deepEqual([metric(d05Tile, "share_floors_assumed_1f").numerator, metric(d05Tile, "share_floors_assumed_1f").status], [2, "estimated"]);
  assert.equal(metric(d05Tile, "share_floors_1").denominator, 6);
  assert.equal(metric(d05Tile, "share_floors_1").value, 33.3);
  assert.equal(metric(d05Tile, "share_floors_6").value, 0);
  assert.equal(d05Tile.presentation.polygons.length, 6);
  assert.equal(d05Tile.presentation.polygonsTotal, 6);
  assert.deepEqual([...layerCounts(d05Tile).entries()].sort(), [
    ["floors_1_4", 2],
    ["floors_9_14", 1],
    ["floors_26p", 1],
    ["floors_assumed_1f_est", 2],
  ].sort());
  assert.equal(toTileView(d05Tile).chart.length, 7);
  assert.equal(toTileView(d05Tile).chart.some((item) => item.label.includes("미터")), false);

  assert.equal(metric(d06Tile, "tall_buildings").value, 1);
  assert.equal(metric(d06Tile, "tall_buildings").status, "observed");
  assert.equal(metric(d06Tile, "tall_buildings_est").value, 1);
  assert.equal(metric(d06Tile, "tall_buildings_est").status, "estimated");
  assert.equal(metric(d06Tile, "fill_height_m_pct").value, 50);
  assert.equal(metric(d06Tile, "share_tall_pct").numerator, 2);
  assert.equal(metric(d06Tile, "share_not_tall_pct").numerator, 2);
  assert.equal(metric(d06Tile, "share_unknown_pct").numerator, 0);
  assert.equal(metric(d06Tile, "tall_buildings_assumed").value, 2);
  assert.equal(metric(d06Tile, "share_assumed_one_floor_pct").numerator, 2);
  assert.equal(metric(d06Tile, "back_tall_area_m2").value, 625);
  assert.equal(d06Tile.presentation.polygons.length, 6);
  assert.ok(d06Tile.presentation.polygons.some((polygon) => polygon.layer === "tall_ge35_est"));
  assert.ok(d06Tile.presentation.polygons.some((polygon) => polygon.layer === "tall_assumed_1f_est"));
  assert.ok(d06Tile.limitations.some((limitation) => limitation.note.includes("높이·층수 자료가 없는 건물 2동(33.3%)은 1층(3 m)으로 가정")));
  assert.ok(d06Tile.limitations.some((limitation) => limitation.kind === "estimated" && limitation.note.includes("층수×3m")));
  assert.ok(!d06Tile.judgment.sentence.includes("고층건축물"));

  assert.equal(metric(d07Tile, "low_buildings").value, 2);
  assert.equal(metric(d07Tile, "low_buildings_est").value, 0);
  assert.equal(metric(d07Tile, "fill_height_m_pct").value, 50);
  assert.equal(metric(d07Tile, "share_low_pct").numerator, 2);
  assert.equal(metric(d07Tile, "share_not_low_pct").numerator, 2);
  assert.equal(metric(d07Tile, "share_unknown_pct").numerator, 0);
  assert.equal(metric(d07Tile, "low_buildings_assumed").value, 2);
  assert.equal(metric(d07Tile, "share_assumed_one_floor_pct").numerator, 2);
  assert.equal(metric(d07Tile, "back_low_area_m2").value, 244);
  assert.equal(d07Tile.presentation.polygons.length, 6);
  assert.ok(d07Tile.presentation.polygons.some((polygon) => polygon.layer === "low_le12_est") === false);
  assert.ok(d07Tile.presentation.polygons.some((polygon) => polygon.layer === "low_assumed_1f_est"));

  for (const view of [d05Tile, d06Tile, d07Tile].map(toTileView)) {
    assert.ok(!/도보|\d\s*분|종합/.test(JSON.stringify(view)));
  }
} finally {
  ctx.close();
}

const absentDir = mkdtempSync(join(tmpdir(), "v2-d05-d07-absent-"));
await buildEngineFixture(absentDir, "v1", { buildings: false });
const absentCtx = makeContext(absentDir, "d05-d07-absent");
try {
  assert.equal(d05(absentCtx).status, "not_provided");
  assert.equal(d06(absentCtx).status, "not_provided");
  assert.equal(d07(absentCtx).status, "not_provided");
} finally {
  absentCtx.close();
}

console.log("✓ v2 D05/D06/D07 engine tiles");
