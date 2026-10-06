import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d14 } = await import("../../lib/v2/engine/tiles/d14.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const noForbidden = (tile) => {
  const forbidden = /도보|\d\s*분|종합/;
  assert.doesNotMatch(JSON.stringify(tile), forbidden, `${tile.tileCode}: 금지 표현`);
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), forbidden, `${tile.tileCode}: 화면 문자열 금지 표현`);
};

{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-d14-rail-"));
  await buildEngineFixture(dir, "v1", { rail: true });
  const manifest = M.readManifest(dir);
  const ctx = new EngineContext(dir, manifest, "an-1", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
  });
  const tile = d14(ctx);

  assert.equal(tile.tileType, "diagram");
  assert.equal(tile.status, "partial", "반경에 걸친 미적재 시도가 있어 partial");
  assert.deepEqual(
    [value(tile, "back_stations"), value(tile, "back_entrances"), value(tile, "back_bus_stops"), value(tile, "fill_entrance_pct"), value(tile, "rail_lines")],
    [2, 1, 2, 50, 1],
    "반경 800m 안 운영 철도·버스 집계",
  );
  assert.deepEqual(
    [metric(tile, "back_stations").unit, metric(tile, "back_entrances").unit, metric(tile, "back_bus_stops").unit],
    ["역", "곳", "곳"],
  );
  assert.deepEqual([metric(tile, "fill_entrance_pct").numerator, metric(tile, "fill_entrance_pct").denominator], [1, 2]);
  assert.deepEqual(tile.provenance.sources.map((source) => source.sourceId), ["bus_stop", "osm_subway"]);
  assert.deepEqual(tile.presentation.layers, ["bus_stop", "rail_station", "rail_entrance", "rail_line"]);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "bus_stop").length, 2);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_station").length, 2);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_entrance").length, 1);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_line").length, 0, "철도 노선은 대표점이 아니라 선 지물이다");
  assert.ok(tile.presentation.lines.filter((line) => line.layer === "rail_line").length > 0, "철도 노선 선 표시");
  assert.ok(tile.presentation.lines.filter((line) => line.layer === "rail_line").every((line) => line.points.length >= 2));
  assert.ok(tile.limitations.some((limitation) => limitation.note.includes("운영 시설만") && limitation.note.includes("D24")));
  assert.equal(tile.judgment.level, null);
  noForbidden(tile);
  ctx.close();
}

{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-d14-bus-only-"));
  await buildEngineFixture(dir, "v1");
  const manifest = M.readManifest(dir);
  const ctx = new EngineContext(dir, manifest, "an-1", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
  });
  const tile = d14(ctx);

  assert.equal(tile.status, "partial");
  assert.equal(value(tile, "back_bus_stops"), 2);
  for (const id of ["back_stations", "back_entrances", "fill_entrance_pct", "rail_lines"]) {
    assert.equal(metric(tile, id).status, "missing", `${id}: 철도 미적재는 missing`);
  }
  assert.ok(tile.limitations.some((limitation) => limitation.kind === "not_provided" && limitation.note.includes("철도 자료를 확인하지 못해")));
  assert.ok(!tile.presentation.features.some((feature) => feature.layer.startsWith("rail_")));
  noForbidden(tile);
  ctx.close();
}

console.log("✓ v2 D14 transit tile");
