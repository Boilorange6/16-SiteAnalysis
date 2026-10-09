import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");

const input = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-10-01" };
const dataDir = mkdtempSync(join(tmpdir(), "v2-d17-"));
const appDb = openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-d17-app-")), "app.sqlite"));

try {
  await buildEngineFixture(dataDir, "v1", { terrain: true });
  const outcome = runAnalysis(appDb, dataDir, input);
  assert.equal(outcome.ok, true);
  const view = outcome.results.find((result) => result.tileCode === "D17");
  assert.ok(view);
  assert.equal(view.status, "complete");

  const metric = new Map(view.metrics.map((item) => [item.id, item]));
  assert.ok(Math.abs(metric.get("center_elevation_m").value - 50) <= 0.5);
  assert.equal(metric.get("fill_dem_pct").value, 100);
  assert.ok(metric.get("relief_min_m").value < 0);
  assert.ok(metric.get("relief_max_m").value > 25);
  assert.ok(metric.get("relief_median_m").value > -5 && metric.get("relief_median_m").value < 5);
  const shares = [
    "share_relief_lt_m20",
    "share_relief_m20_m5",
    "share_relief_m5_5",
    "share_relief_5_20",
    "share_relief_ge20",
    "share_nodata_pct",
  ].map((id) => metric.get(id).value);
  assert.ok(Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) <= 1, `shares ${shares}`);
  assert.ok(metric.get("share_relief_ge20").value > 0);
  assert.equal(metric.get("contour_interval_m").value, 5);
  assert.ok(view.presentation.polygons.some((polygon) => polygon.layer === "relief_ge20"));
  assert.ok(view.presentation.lines.length >= 10);
  assert.ok(view.presentation.lines.every((line) => line.layer === "contour"));
  const contourLabels = view.presentation.lines.map((line) => line.label).filter((label) => label !== null);
  assert.ok(contourLabels.length > 0, "계곡선에는 표고 라벨이 있다");
  assert.ok(contourLabels.every((label) => /^표고 -?\d+(?:\.\d+)?m$/.test(label)));
  assert.ok(contourLabels.every((label) => Number.parseFloat(label.replace(/^표고 |m$/g, "")) % 25 === 0), "25m 배수만 라벨한다");
  assert.ok(view.presentation.lines.some((line) => line.label === null), "간곡선 라벨은 생략한다");
  assert.ok([...metric.values()].filter((item) => item.id.startsWith("share_relief_")).every((item) => !item.label.includes("relief_")), "지표 라벨에 내부 레이어 id가 없다");
  assert.match(view.judgment.sentence, /중심 표고 .*채움률 .*중앙값/);
  assert.ok(view.limitations.some((limitation) => limitation.note.includes("등고선은 30m 격자 보간선")));
  assert.ok(!/도보|\d\s*분|종합|법적 적합|개발 가능/.test(JSON.stringify(view)));

  const noTerrainDir = mkdtempSync(join(tmpdir(), "v2-d17-no-terrain-"));
  await buildEngineFixture(noTerrainDir, "v1");
  const noTerrain = runAnalysis(appDb, noTerrainDir, { ...input, analysisDate: "2026-10-02" });
  assert.equal(noTerrain.ok, true);
  assert.equal(noTerrain.results.find((result) => result.tileCode === "D17").status, "not_provided");
} finally {
  appDb.close();
}

console.log("✓ v2 D17 terrain and contours");
