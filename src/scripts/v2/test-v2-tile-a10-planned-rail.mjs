import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { PLANNED_STAGES } = await import("../../lib/v2/tile/a10/d24.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const d24 = TILES.find(([code]) => code === "A10")[1];
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

  assert.equal(tile.tileCode, "A10");
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
  assert.equal(tile.presentation.features.filter((f) => f.layer === "planned_rail_line").length, 0, "A10은 노선 위 샘플 점을 만들지 않는다");
  const lineFeatures = tile.presentation.lines.filter((line) => line.layer === "planned_rail_line");
  assert.ok(lineFeatures.length > 0);
  assert.ok(lineFeatures.every((line) => line.label === "[개략]"), "개략 선형은 지도에 [개략]을 표시한다");
  assert.ok(lineFeatures.every((line) => line.points.length >= 2));
  assert.equal(tile.metrics.filter((item) => item.id.startsWith("stage_")).length, 0, "A10은 구형 단계 지표를 중복하지 않는다");
  assert.equal(tile.metrics.filter((item) => item.id.startsWith("back_stage_")).length, 6, "A10은 D24 고정 6단계만 사용한다");
  assert.doesNotMatch(tile.judgment.sentence, / · /, "A10 판단 문장은 흡수 타일 문장 하나만 표시한다");
  const view = toTileView(tile);
  assert.ok(tile.metrics.some((item) => item.id === "planned_projects"), "A10의 기존 핵심 지표를 보존한다");
  assert.deepEqual(view.layerOptions, [{ id: "all", label: "기본 계획" }], "A10은 같은 내용을 바꾸는 칩을 제공하지 않는다");
  assert.equal(view.headlineMetricId, "planned_projects", "A10 headline은 기존 핵심 지표를 유지한다");
  assert.equal(view.hasFace, true, "A10 지도/도판 면은 칩을 숨겨도 유지한다");
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
