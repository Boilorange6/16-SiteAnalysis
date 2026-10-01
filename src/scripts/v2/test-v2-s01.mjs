/** S01 3D 매스 엔진 타일 계약·높이 집계 테스트. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { s01 } = await import("../../lib/v2/engine/tiles/s01.ts");

const metric = (tile, id) => tile.metrics.find((entry) => entry.id === id);

const dataDir = mkdtempSync(join(tmpdir(), "v2-s01-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const manifest = M.readManifest(dataDir);
const ctx = new EngineContext(dataDir, manifest, "s01-test", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: null,
});

const tile = s01(ctx);
assert.equal(tile.tileType, "simulation");
assert.equal(tile.status, "partial");
assert.equal(tile.engineVersion, "v2-p3-terrain-1");
assert.equal(metric(tile, "buildings").value, 6);
assert.deepEqual(
  [metric(tile, "height_known_pct").value, metric(tile, "height_known_pct").numerator, metric(tile, "height_known_pct").denominator],
  [66.7, 4, 6],
);
assert.equal(metric(tile, "height_source_pct").value, 50);
assert.equal(metric(tile, "height_estimated_count").value, 1);
assert.equal(metric(tile, "height_unknown_count").value, 2);
assert.deepEqual([metric(tile, "height_median_m").value, metric(tile, "height_median_m").status], [26, "estimated"]);
assert.deepEqual([metric(tile, "height_max_m").value, metric(tile, "height_max_m").status], [90, "estimated"]);
assert.deepEqual(tile.presentation.camera, { kind: "axonometric", azimuthDeg: 225, elevationDeg: 35, radiusM: 800 });
assert.deepEqual(tile.presentation.layers, ["mass_source", "mass_estimated", "mass_unknown"]);
assert.deepEqual(tile.conditions.simulation, {
  scene: "v2-scene@1",
  buildingsIncluded: 6,
  buildingsTotal: 6,
  cap: 5000,
  ground: "flat",
});
assert.ok(tile.limitations.some((entry) => entry.note.includes("공개 도형과 확보 높이로 만든 매스")));
assert.ok(tile.limitations.some((entry) => entry.note.includes("지반 평탄")));
assert.doesNotMatch(JSON.stringify(tile), /법적/);
ctx.close();

const absentDir = mkdtempSync(join(tmpdir(), "v2-s01-absent-"));
await buildEngineFixture(absentDir, "v1");
const absentManifest = M.readManifest(absentDir);
const absentCtx = new EngineContext(absentDir, absentManifest, "s01-absent", {
  address: "경기도 남양주시 다산동 100",
  center: CENTER,
  radiusM: 800,
  analysisDate: "2026-09-30",
  pnu: null,
});
const absent = s01(absentCtx);
assert.equal(absent.status, "not_provided");
assert.equal(absent.metrics.length, 0);
absentCtx.close();

console.log("✓ v2 S01 engine tile");
