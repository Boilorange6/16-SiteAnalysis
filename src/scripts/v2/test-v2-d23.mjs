import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { collectMaintenance } = await import("../../lib/v2/engine/tiles/a09.ts");
const { d23 } = await import("../../lib/v2/engine/tiles/d23.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-d23-"));
  await buildEngineFixture(dir, "v1", options);
  const manifest = M.readManifest(dir);
  return new EngineContext(dir, manifest, "an-d23", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: null,
  });
};

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const forbidden = /도보|\d\s*분|종합/;

{
  const ctx = await make({ maint: "zones" });
  const collected = collectMaintenance(ctx);
  assert.ok(collected, "정비구역 수집 결과");
  assert.equal(collected.zones.length, 2, "반경과 교차하는 구역만 수집");
  assert.equal(collected.projects.size, 2, "연결된 사업은 구역 단위로 한 번만 집계");

  const tile = d23(ctx);
  parseTileResult(tile);
  assert.equal(tile.status, "partial");
  assert.equal(tile.tileType, "diagram");
  assert.equal(value(tile, "back_stage_2"), 1, "조합 단계 사업");
  assert.equal(value(tile, "back_stage_0"), 1, "구역지정 단계 사업");
  assert.equal(value(tile, "back_stage_7"), 0, "미확인 단계도 0 observed");
  assert.equal(value(tile, "fill_boundary_pct"), 66.7, "경계 사업 2 / 반경 시군구 명부 3");
  assert.equal(value(tile, "fill_stage_pct"), 100, "두 사업의 단계가 모두 확인됨");
  assert.equal(value(tile, "zone_area_in_radius_m2"), 80000, "교차 정비구역 면적 합");
  assert.equal(value(tile, "planned_households"), 1300, "A09와 동일한 예정 세대 합");
  assert.equal(tile.presentation.polygons.length, 2);
  assert.deepEqual(new Set(tile.presentation.polygons.map((p) => p.layer)), new Set(["maint_stage:조합", "maint_stage:구역지정"]));
  assert.ok(tile.presentation.features.every((f) => f.layer.startsWith("maint_stage:")));
  assert.ok(tile.presentation.layers.includes("maint_stage:조합"));
  assert.ok(tile.presentation.layers.includes("maint_stage:구역지정"));
  assert.match(tile.judgment.sentence, / → .+ → /);
  assert.equal(tile.judgment.level, null);
  assert.doesNotMatch(JSON.stringify(tile), forbidden);
  ctx.close();
}

{
  const ctx = await make({ maint: "roster" });
  const tile = d23(ctx);
  parseTileResult(tile);
  assert.equal(tile.status, "partial", "명부만 있어도 자료 없음이 아니라 부분 결과");
  assert.equal(value(tile, "planned_households"), 1500);
  assert.equal(value(tile, "back_stage_0"), 1);
  assert.equal(value(tile, "back_stage_2"), 1);
  assert.equal(tile.presentation.features, undefined, "경계 없는 명부는 지도에 그리지 않음");
  assert.equal(tile.presentation.polygons, undefined, "경계 없는 명부는 면을 그리지 않음");
  assert.match(tile.limitations.map((l) => l.note).join("\n"), /경계 (없음|미확보)/);
  assert.match(tile.judgment.sentence, /경계 미확보/);
  assert.doesNotMatch(JSON.stringify(tile), forbidden);
  ctx.close();
}

console.log("v2 D23 maintenance tile: ok");
