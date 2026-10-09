import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { runAnalysis } = await import("../../lib/v2/engine/run.ts");

const input = { address: "경기도 남양주시 다산동 100", radiusM: 800, analysisDate: "2026-10-01" };
const dataDir = mkdtempSync(join(tmpdir(), "v2-d18-"));
const appDb = openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-d18-app-")), "app.sqlite"));

try {
  await buildEngineFixture(dataDir, "v1", { terrain: true });
  const outcome = runAnalysis(appDb, dataDir, input);
  assert.equal(outcome.ok, true);
  const view = outcome.results.find((result) => result.tileCode === "D18");
  assert.ok(view);
  assert.equal(view.status, "complete");

  const metric = new Map(view.metrics.map((item) => [item.id, item]));
  assert.equal(metric.get("fill_slope_pct").value, 100);
  assert.equal(metric.get("fill_slope_pct").status, "observed", "경사 셀 채움률은 관측 상태로 표시");
  assert.ok(Math.abs(metric.get("slope_median_deg").value - 2.86) < 0.5);
  assert.ok(metric.get("slope_max_deg").value >= 10 && metric.get("slope_max_deg").value <= 17, `max ${metric.get("slope_max_deg").value}`);
  assert.ok(metric.get("share_slope_0_5").value > 85);
  assert.ok([...metric.values()].filter((item) => item.id.startsWith("share_slope_")).every((item) => !item.label.includes("slope_")), "지표 라벨에 내부 레이어 id가 없다");
  const shares = ["share_slope_0_5", "share_slope_5_10", "share_slope_10_15", "share_slope_15_20", "share_slope_ge20", "share_nodata_pct"]
    .map((id) => metric.get(id).value);
  assert.ok(Math.abs(shares.reduce((sum, value) => sum + value, 0) - 100) <= 1, `shares ${shares}`);
  assert.ok(view.presentation.polygons.some((polygon) => polygon.layer === "slope_0_5"));
  assert.ok(view.limitations.some((limitation) => limitation.note.includes("30m 표본 간격")));
  assert.match(view.judgment.sentence, /15° 이상 \d+(?:\.\d+)?%/);
  assert.ok(!/도보|\d\s*분|종합|법적 적합|개발 가능/.test(view.judgment.sentence));

  const noTerrainDir = mkdtempSync(join(tmpdir(), "v2-d18-no-terrain-"));
  await buildEngineFixture(noTerrainDir, "v1");
  const noTerrain = runAnalysis(appDb, noTerrainDir, { ...input, analysisDate: "2026-10-02" });
  assert.equal(noTerrain.ok, true);
  assert.equal(noTerrain.results.find((result) => result.tileCode === "D18").status, "not_provided");
} finally {
  appDb.close();
}

console.log("✓ v2 D18 slope");
