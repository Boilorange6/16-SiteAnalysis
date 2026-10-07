import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const d14 = TILES.find(([code]) => code === "A01")[1];
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const noForbidden = (tile) => {
  const forbidden = /종합/;
  assert.doesNotMatch(JSON.stringify(tile), forbidden, `${tile.tileCode}: 금지 표현`);
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), forbidden, `${tile.tileCode}: 화면 문자열 금지 표현`);
};

{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-a01-rail-"));
  await buildEngineFixture(dir, "v1", { rail: true });
  const manifest = M.readManifest(dir);
  const ctx = new EngineContext(dir, manifest, "an-1", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
  });
  const tile = d14(ctx);

  assert.equal(tile.tileCode, "A01");
  assert.equal(tile.tileType, "analysis");
  assert.equal(tile.status, "partial", "반경에 걸친 미적재 시도가 있어 partial");
  assert.deepEqual(
    [value(tile, "rail_stations"), value(tile, "rail_entrances"), value(tile, "bus_stops"), value(tile, "fill_entrance_pct"), value(tile, "rail_lines")],
    [2, 1, 2, 50, 1],
    "반경 800m 안 운영 철도·버스 집계",
  );
  assert.deepEqual(
    [metric(tile, "rail_stations").unit, metric(tile, "rail_entrances").unit, metric(tile, "bus_stops").unit],
    ["개", "곳", "개"],
  );
  assert.deepEqual([metric(tile, "fill_entrance_pct").numerator, metric(tile, "fill_entrance_pct").denominator], [1, 2]);
  assert.deepEqual(tile.provenance.sources.map((source) => source.sourceId), ["bus_stop", "osm_subway"]);
  assert.ok(tile.presentation.layers.includes("bus_stop"));
  assert.ok(tile.presentation.layers.includes("rail_station"));
  assert.ok(tile.presentation.layers.includes("rail_entrance"));
  assert.ok(tile.presentation.layers.includes("rail_line"));
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "bus_stop").length, 1);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "bus_nearest").length, 1);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_station").length, 1);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_nearest").length, 1);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_entrance").length, 1);
  assert.equal(tile.presentation.features.filter((feature) => ["rail_station", "rail_nearest", "rail_entrance"].includes(feature.layer)).length, 3);
  assert.ok(tile.presentation.features.filter((feature) => feature.layer === "rail_line").length > 0, "A01은 선 레이어의 지도 호환 표본점도 보존한다");
  assert.ok(tile.presentation.lines.filter((line) => line.layer === "rail_line").length > 0, "철도 노선 선 표시");
  assert.ok(tile.presentation.lines.filter((line) => line.layer === "rail_line").every((line) => line.points.length >= 2));
  assert.ok(tile.limitations.some((limitation) => limitation.note.includes("철도는 OSM 스냅샷")));
  assert.equal(tile.judgment.level, null);
  noForbidden(tile);
  ctx.close();
}

{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-a01-bus-only-"));
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
  assert.equal(value(tile, "bus_stops"), 2);
  for (const id of ["rail_stations", "rail_entrances", "fill_entrance_pct", "rail_lines"]) {
    assert.equal(metric(tile, id).status, "missing", `${id}: 철도 미적재는 missing`);
  }
  assert.ok(tile.limitations.some((limitation) => limitation.kind === "not_provided" && limitation.note.includes("철도 자료를 확인하지 못해")));
  assert.ok(!tile.presentation.features.some((feature) => feature.layer.startsWith("rail_")));
  noForbidden(tile);
  ctx.close();
}

console.log("✓ v2 A01/D14 transit tile");
