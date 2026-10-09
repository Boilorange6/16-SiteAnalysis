import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const d14 = TILES.find(([code]) => code === "A01")[1];
const { a01ClientModule } = await import("../../lib/v2/tile/a01/view.ts");
const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const noForbidden = (tile) => {
  const forbidden = /종합/;
  assert.doesNotMatch(JSON.stringify(tile), forbidden, `${tile.tileCode}: 금지 표현`);
  assert.doesNotMatch(JSON.stringify(toTileView(tile)), forbidden, `${tile.tileCode}: 화면 문자열 금지 표현`);
};

function addDirectionDuplicateSubwayLines(dataDir) {
  const db = new Database(join(dataDir, "versions", "v1", "reference.sqlite"));
  const releaseId = db.prepare("SELECT release_id FROM source_release WHERE source_id = 'osm_subway'").pluck().get();
  const relationGeometry = { type: "LineString", coordinates: [at(-4500, 300), at(4500, 300)] };
  for (const [id, name] of [
    ["relation/12497485", "서울 지하철 5호선: 하남검단산 → 방화"],
    ["relation/12497486", "서울 지하철 5호선: 방화 → 하남검단산"],
    ["relation/4744339", "서울 지하철 5호선: 상일동 → 방화"],
    ["relation/4744340", "서울 지하철 5호선: 방화 → 상일동"],
  ]) {
    insertFeature(db, {
      stableId: `rail_line:${id}`,
      kind: "rail_line",
      sourceKey: id,
      releaseId,
      geometry: relationGeometry,
      name,
      properties: { lineRef: "5", color: "#794698" },
    });
  }
  db.prepare("UPDATE feature SET name = ?, properties_json = ? WHERE stable_id = ?").run(
    "나래",
    JSON.stringify({ lineRefs: ["5"], lineNames: ["서울 지하철 5호선: 방화 → 상일동"], lineColors: [], operator: null }),
    "rail_station:나래역",
  );
  db.prepare("UPDATE feature SET properties_json = ? WHERE stable_id = ?").run(
    JSON.stringify({ lineRefs: ["5", "9"], lineNames: ["서울 지하철 5호선: 방화 → 상일동", "서울 지하철 9호선: 개화 → 중앙보훈병원"], lineColors: [], operator: null }),
    "rail_station:다온역",
  );
  db.close();
}

{
  const dir = mkdtempSync(join(tmpdir(), "v2-eng-a01-rail-"));
  await buildEngineFixture(dir, "v1", { rail: true });
  addDirectionDuplicateSubwayLines(dir);
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
  const nearestRail = tile.presentation.features.filter((feature) => feature.layer === "rail_nearest");
  assert.deepEqual(nearestRail.map((f) => [f.name, f.sublabel, f.labelPriority]), [["나래역", "5호선", 2]], "최근접은 nearest_rail_m을 정한 지물이며 역명·호선을 정규화한다");
  assert.equal(nearestRail[0]?.distanceM, 600, "최근접 거리의 근거 지물은 유지한다");
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_entrance").length, 1);
  assert.equal(tile.presentation.features.filter((feature) => ["rail_station", "rail_nearest", "rail_entrance"].includes(feature.layer)).length, 3);
  const busFeature = tile.presentation.features.find((feature) => feature.layer === "bus_stop");
  const nearestBusFeature = tile.presentation.features.find((feature) => feature.layer === "bus_nearest");
  assert.ok(["b1", "b2"].includes(busFeature?.name), "버스 정류장 name은 원천 이름");
  assert.equal(busFeature?.sublabel, null, "비최근접 정류장은 거리 부라벨 없음");
  assert.equal(busFeature?.labelPriority, 0);
  assert.equal(nearestBusFeature?.name, "b1");
  assert.match(nearestBusFeature?.sublabel ?? "", /^직선 250m$/);
  assert.equal(nearestBusFeature?.labelPriority, 2);
  const stationFeatures = tile.presentation.features.filter((feature) => ["rail_station", "rail_nearest"].includes(feature.layer));
  const station = stationFeatures.find((feature) => feature.name === "다온역");
  assert.equal(station?.badges?.map((badge) => badge.text).join(","), "5,9", "역은 원천 노선 배지를 최대 4개까지 표시");
  assert.ok(station?.badges?.every((badge) => badge.color === "#1F5FA8"));
  assert.equal(station?.sublabel, "5호선·9호선", "원천 경로명이 아니라 호선 목록을 역 sublabel로 표시");
  assert.equal(station?.layer, "rail_station", "출입구가 있는 역은 대표점을 최근접으로 쓰지 않는다");
  assert.equal(station?.labelPriority, 1);
  const entrance = tile.presentation.features.find((feature) => feature.layer === "rail_entrance");
  assert.equal(entrance?.name, "다온역 1번 출구");
  assert.deepEqual(entrance?.badges?.map((badge) => badge.text), ["1"]);
  assert.equal(entrance?.sublabel, null, "최근접이 아닌 출입구는 거리 부라벨 없음");
  assert.equal(entrance?.labelPriority, 0);
  assert.equal(tile.presentation.features.filter((feature) => feature.layer === "rail_line").length, 0, "A01은 노선 위 샘플 점을 만들지 않는다");
  assert.ok(tile.presentation.lines.filter((line) => line.layer === "rail_line").length > 0, "철도 노선 선 표시");
  const railLines = tile.presentation.lines.filter((line) => line.layer === "rail_line");
  assert.ok(railLines.every((line) => line.points.length >= 2));
  assert.equal(railLines.length, 1, "방향별 관계·way 중복은 노선 그룹당 대표 선 하나로 합친다");
  assert.equal(railLines.filter((line) => line.name === "5호선").length, 1, "원천 경로명 대신 노선 라벨을 쓴다");
  assert.equal(railLines.find((line) => line.name === "5호선")?.labelPriority, 1, "그룹당 최장 대표 조각만 자동 라벨 대상");
  assert.equal(railLines.find((line) => line.name === "5호선")?.color, "#794698", "대표 관계의 원천 노선색 하나를 사용한다");
  assert.deepEqual({ strokeWidth: layerStyle("rail_line").strokeWidth, casing: layerStyle("rail_line").casing }, { strokeWidth: 4.2, casing: "#FFFFFF" }, "철도 선은 버스 점보다 우선하는 굵은 흰 케이싱");
  assert.match(tile.judgment.sentence, /나래역/);
  assert.match(tile.judgment.sentence, /5호선/);
  assert.ok(tile.limitations.some((limitation) => limitation.note.includes("철도는 OSM 스냅샷")));
  assert.equal(tile.judgment.level, null);
  assert.deepEqual(a01ClientModule.layers.options, [
    { id: "all", label: "전체" },
    { id: "transit", label: "철도" },
    { id: "bus", label: "버스" },
  ]);
  const view = toTileView(tile);
  assert.ok(viewWithLayer(view, "transit").map?.features.every((feature) => feature.layer.startsWith("rail_")));
  assert.ok(viewWithLayer(view, "bus").map?.features.every((feature) => feature.layer.startsWith("bus_")));
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
