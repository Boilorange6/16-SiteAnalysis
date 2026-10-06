import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { closeDataFilePool } = await import("../../lib/v2/data/file-pool.ts");
const { HEAVY_TILE_CODES, runAnalysis } = await import("../../lib/v2/engine/run.ts");
const { measureElapsed, sumTimings } = await import("../../lib/v2/engine/timing.ts");

const dataDir = mkdtempSync(join(tmpdir(), "v2-analysis-timing-data-"));
const appDbPath = join(mkdtempSync(join(tmpdir(), "v2-analysis-timing-app-")), "app.sqlite");
const appDb = openV2AppDb(appDbPath);
try {
  await buildEngineFixture(dataDir, "v1", { buildings: true, parcels: true });
  const outcome = runAnalysis(appDb, dataDir, {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
  });
  assert.equal(outcome.ok, true);
  for (const code of HEAVY_TILE_CODES) assert.ok(Number.isFinite(outcome.timingsMs.tiles[code]), `${code} queue lookup timing`);
  assert.equal(sumTimings(outcome.timingsMs.tiles, ["A01", "A02"]), outcome.timingsMs.tiles.A01 + outcome.timingsMs.tiles.A02);
  const measured = measureElapsed(() => 42);
  assert.equal(measured.value, 42);
  assert.ok(measured.elapsedMs >= 0);
} finally {
  appDb.close();
  closeDataFilePool();
  rmSync(dataDir, { recursive: true, force: true });
}

console.log("✓ v2 analysis timing contract");
