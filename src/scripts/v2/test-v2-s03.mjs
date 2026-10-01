import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const { readManifest, openDataFile } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s03 } = await import("../../lib/v2/engine/tiles/s03.ts");

function contextFor(dataDir, manifest, analysisId = "s03-test") {
  const core = openDataFile(dataDir, manifest, "core");
  return new EngineContext(
    dataDir,
    manifest,
    analysisId,
    { address: "테스트 대지", center: CENTER, radiusM: 800, analysisDate: "2026-09-30", pnu: null },
    { core },
  );
}

{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-s03-case-"));
  await buildEngineFixture(dataDir, "s03", { buildings: true, weather: true });
  const manifest = readManifest(dataDir);
  assert.ok(manifest);
  const ctx = contextFor(dataDir, manifest);
  try {
    const tile = s03(ctx);
    assert.equal(tile.status, "pending");
    assert.equal(tile.tileCode, "S03");
    assert.equal(tile.presentation.rasters?.length, 1);
    const obstacle = tile.presentation.rasters?.[0];
    assert.equal(obstacle?.name, "obstacle_height");
    assert.equal(obstacle?.kind, "scalar");
    assert.equal(obstacle?.dtype, "u16");
    assert.equal(obstacle?.bands, 1);
    assert.equal(obstacle?.cellM, 4);
    assert.equal(obstacle?.cols, 500);
    assert.equal(obstacle?.rows, 500);
    assert.deepEqual(tile.conditions.simulation?.case?.inflow?.summer, { deg: 225, name: "SW", pct: 100, source: "season" });
    assert.equal(tile.conditions.simulation?.case?.inflow?.winter?.deg, 315);
    assert.ok(tile.conditions.simulation?.case?.bufferM === 200);
    assert.ok(ctx.takeRasters("S03").some((item) => item.ref.name === "obstacle_height"));
    assert.doesNotMatch(tile.judgment?.sentence ?? "", /종합|법적 적합|개발 가능|건강 위험 예측/);
  } finally {
    ctx.close();
  }
}

{
  const dataDir = mkdtempSync(join(tmpdir(), "v2-s03-no-weather-"));
  await buildEngineFixture(dataDir, "s03", { buildings: true });
  const manifest = readManifest(dataDir);
  assert.ok(manifest);
  const ctx = contextFor(dataDir, manifest);
  try {
    const tile = s03(ctx);
    assert.equal(tile.status, "not_provided");
    assert.match(tile.limitations[0].note, /기상/);
    assert.equal(ctx.takeRasters("S03").length, 0);
  } finally {
    ctx.close();
  }
}

console.log("✓ v2 S03 case");
