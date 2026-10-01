import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d24, PLANNED_STAGES } = await import("../../lib/v2/engine/tiles/d24.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-d24-"));
  await buildEngineFixture(dir, "v1", options);
  const manifest = M.readManifest(dir);
  return (radiusM = 800) => new EngineContext(dir, manifest, "an-d24", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM,
    analysisDate: "2026-09-30",
    pnu: null,
  });
};

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const noForbidden = (tile) => {
  const forbidden = /도보|\d\s*분|종합/;
  assert.doesNotMatch(JSON.stringify(tile), forbidden, "D24: 금지 표현");
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), forbidden, "D24 화면: 금지 표현");
};

assert.equal(PLANNED_STAGES.under_construction, "공사");
assert.equal(PLANNED_STAGES.cancelled, "중단/변경");

{
  const ctxFor = await make({ planned: true });
  const ctx = ctxFor();
  const tile = d24(ctx);

  assert.equal(tile.status, "partial");
  assert.equal(value(tile, "back_stations"), 1);
  assert.equal(metric(tile, "back_stage_3").label, "단계: 공사");
  assert.equal(value(tile, "back_stage_3"), 1);
  assert.equal(value(tile, "line_length_in_radius_m"), 1483);
  assert.equal(value(tile, "fill_geometry_pct"), 100);
  assert.deepEqual(
    [metric(tile, "fill_geometry_pct").numerator, metric(tile, "fill_geometry_pct").denominator],
    [1, 1],
  );
  assert.equal(value(tile, "fill_schedule_pct"), 0);
  assert.equal(metric(tile, "fill_schedule_pct").status, "observed");
  assert.match(metric(tile, "fill_schedule_pct").formulaVersion, /원천에 일정 없음/);

  assert.ok(tile.presentation.layers.includes("planned_rail_line"));
  assert.ok(tile.presentation.layers.includes("planned_rail_station"));
  assert.equal(tile.presentation.features.filter((f) => f.layer === "planned_rail_line").length, 0, "계획 선형은 대표점이 아니라 선 지물이다");
  const lineFeatures = tile.presentation.lines.filter((line) => line.layer === "planned_rail_line");
  assert.ok(lineFeatures.length > 0);
  assert.ok(lineFeatures.every((line) => line.label === "[개략]"), "개략 선형은 지도에 [개략]을 표시한다");
  assert.ok(lineFeatures.every((line) => line.points.length >= 2));
  noForbidden(tile);
  ctx.close();
}

{
  const ctxFor = await make({ rail: true });
  const ctx = ctxFor();
  const tile = d24(ctx);
  assert.equal(tile.status, "not_provided");
  assert.equal(tile.metrics.length, 0);
  assert.equal(tile.limitations[0].kind, "not_provided");
  ctx.close();
}

console.log("D24 planned rail tile ok");
