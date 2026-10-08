import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { buildingRows } = await import("../../lib/v2/engine/tiles/buildings-shared.ts");
const { s01 } = await import("../../lib/v2/engine/tiles/s01.ts");
const { d05 } = await import("../../lib/v2/tile/d05/engine.ts");
const { d06 } = await import("../../lib/v2/tile/d05/d06.ts");
const { d07 } = await import("../../lib/v2/tile/d05/d07.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-height-engine-"));
await buildEngineFixture(dataDir, "v1", { buildings: true, ledgerEstimate: true });
const ctx = new EngineContext(dataDir, M.readManifest(dataDir), "height-engine", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
});
try {
  const rows = buildingRows(ctx);
  assert.ok(rows);
  const ledgerRow = rows.find((row) => row.hit.stableId === "building:b_ledger_est");
  assert.ok(ledgerRow);
  assert.deepEqual([ledgerRow.heightM, ledgerRow.heightMethod, ledgerRow.floorsAbove], [21, "floors_estimate", 7], "타일 엔진은 표제부 추정을 추정층수로 집계");
  assert.equal(ledgerRow.rawHeightMethod, "ledger_floors_estimate");
  const assumedRows = rows.filter((row) => row.heightMethod === "assumed_one_floor");
  assert.equal(assumedRows.length, 2);
  assert.ok(assumedRows.every((row) => row.heightM === 3 && row.floorsAbove === 1 && row.rawHeightM === null && row.rawFloorsAbove === null && row.rawHeightMethod === "unknown"));

  const metric = (tile, id) => tile.metrics.find((item) => item.id === id);
  const s01Tile = s01(ctx);
  assert.deepEqual([metric(s01Tile, "height_estimated_count").value, metric(s01Tile, "height_assumed_one_floor_count").value, metric(s01Tile, "height_unknown_count").value], [2, 2, 0]);
  assert.equal(metric(s01Tile, "height_known_pct").value, 71.4);

  const d05Tile = d05(ctx);
  assert.deepEqual([metric(d05Tile, "fill_floors_pct").value, metric(d05Tile, "fill_height_m_pct").value], [71.4, 42.9]);
  assert.equal(metric(d05Tile, "share_floors_2").numerator, 1);
  assert.equal(metric(d06(ctx), "tall_buildings_est").value, 1, "표제부 7층×3m는 35m 추정 고층으로 세지 않음");
  assert.equal(metric(d07(ctx), "low_buildings_est").value, 0, "표제부 7층×3m는 12m 이하 추정 저층으로 세지 않음");
} finally {
  ctx.close();
}

console.log("✓ v2 ledger height engine classification");
