import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const { readManifest, openDataFile } = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s03 } = await import("../../lib/v2/tile/s03/engine.ts");
const { LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");

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
    const annual = tile.conditions.simulation?.case?.inflow?.annual;
    const inflowLine = tile.presentation.lines?.find((line) => line.layer === "wind_inflow");
    assert.ok(inflowLine);
    assert.equal(inflowLine.label, null);
    assert.equal(inflowLine.sublabel, null);
    assert.equal(inflowLine.labelPriority, 1);
    assert.match(inflowLine.name ?? "", new RegExp(`^주풍향 .+\\(${annual.name}\\) 유입$`));
    assert.equal(inflowLine.points.length, 2);
    assert.deepEqual(tile.presentation.legend, [
      { label: "U/U유입 · 0~0.5", min: 0, max: 0.5 },
      { label: "U/U유입 · 0.5~0.8", min: 0.5, max: 0.8 },
      { label: "U/U유입 · 0.8~1.2", min: 0.8, max: 1.2 },
      { label: "U/U유입 · 1.2 이상", min: 1.2, max: null },
    ]);
    assert.equal(LAYER_STYLES.wind_inflow.arrow, true);
    assert.equal(LAYER_STYLES.wind_inflow.casing, "#FFFFFF");
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
