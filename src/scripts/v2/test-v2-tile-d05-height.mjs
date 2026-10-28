import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const d05 = TILES.find(([code]) => code === "D05")[1];
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildingMapExtra, buildingSublabel } = await import("../../lib/v2/tile/d05/presentation.ts");

function metric(tile, id) {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode} metric ${id}`);
  return found;
}

function layerCounts(tile) {
  return new Map(tile.presentation.polygons.map((polygon) => [polygon.layer, (tile.presentation.polygons.filter((item) => item.layer === polygon.layer).length)]));
}

function makeContext(dataDir, analysisId) {
  return new EngineContext(dataDir, M.readManifest(dataDir), analysisId, {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: 800,
    analysisDate: "2026-09-30",
    pnu: "4136011800101000000",
  });
}

const dataDir = mkdtempSync(join(tmpdir(), "v2-d05-d07-data-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const ctx = makeContext(dataDir, "d05-d07");

try {
  const d05Tile = d05(ctx);

  assert.equal(d05Tile.status, "partial");
  assert.equal(metric(d05Tile, "fill_floors_pct").value, 66.7);
  assert.equal(metric(d05Tile, "fill_height_m_pct").value, 50);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((i) => metric(d05Tile, `share_floors_${i}`).numerator),
    [2, 0, 1, 0, 1, 0],
  );
  assert.deepEqual([metric(d05Tile, "share_floors_assumed_1f").numerator, metric(d05Tile, "share_floors_assumed_1f").status], [2, "estimated"]);
  assert.equal(metric(d05Tile, "share_floors_1").denominator, 6);
  assert.equal(metric(d05Tile, "share_floors_1").value, 33.3);
  assert.equal(metric(d05Tile, "share_floors_6").value, 0);
  assert.equal(d05Tile.presentation.polygons.length, 18, "D05 기본·고층·저층 지도를 함께 보존");
  assert.equal(d05Tile.presentation.polygonsTotal, 18);
  assert.ok(d05Tile.presentation.polygons.every((polygon) => polygon.label === null), "D05는 legacy label 대신 새 계약 필드를 쓴다");
  const towerBase = d05Tile.presentation.polygons.find((polygon) => polygon.layer === "floors_26p" && polygon.name === "b_tower");
  assert.ok(towerBase);
  assert.equal(towerBase.sublabel, "30층");
  assert.equal(towerBase.labelPriority, 1);
  const towerTall = d05Tile.presentation.polygons.find((polygon) => polygon.layer === "tall_ge35_est" && polygon.name === "b_tower");
  assert.ok(towerTall);
  assert.equal(towerTall.sublabel, "30층");
  assert.equal(towerTall.labelPriority, 2, "고층 보기의 주요 건물은 priority 2");
  const missingHeight = d05Tile.presentation.polygons.find((polygon) => polygon.name === "b_unknown");
  assert.ok(missingHeight);
  assert.equal(missingHeight.sublabel, null, "1층 가정은 실제 층수 라벨로 오인하지 않는다");
  assert.equal(buildingSublabel({ floorsAbove: null, heightM: 48, heightMethod: "source" }), "48m", "층수 없고 확인 높이만 있으면 미터를 쓴다");
  assert.deepEqual(
    buildingMapExtra({ hit: { name: null }, floorsAbove: 18, heightM: 54, heightMethod: "source" }, "tall_ge35"),
    { name: null, sublabel: "18층", labelPriority: 0 },
    "이름이 없으면 name=null을 보존하고 값 라벨만 낸다",
  );
  const floorLabels = d05Tile.presentation.polygons
    .filter((polygon) => polygon.layer.startsWith("floors_") && polygon.sublabel?.endsWith("층"))
    .map((polygon) => Number.parseInt(polygon.sublabel, 10));
  assert.deepEqual(floorLabels, [...floorLabels].sort((a, b) => b - a), "D05 층수 라벨은 내림차순으로 낸다");
  assert.deepEqual([...layerCounts(d05Tile).entries()].sort(), [
    ["floors_1_4", 2],
    ["floors_9_14", 1],
    ["floors_26p", 1],
    ["floors_assumed_1f_est", 2],
    ["tall_ge35", 1],
    ["tall_ge35_est", 1],
    ["tall_assumed_1f_est", 2],
    ["tall_lt35", 2],
    ["low_le12", 2],
    ["low_assumed_1f_est", 2],
    ["low_gt12", 2],
  ].sort());
  // 그래프용 값: 확인된 지상 층수만 숫자, 미상·1층 가정은 null(생략이 아님)
  assert.deepEqual(d05Tile.presentation.valueAxis, { label: "지상 층수", unit: "층", countUnit: "동" });
  assert.deepEqual(toTileView(d05Tile).map.valueAxis, d05Tile.presentation.valueAxis);
  const floorPolygons = d05Tile.presentation.polygons.filter((polygon) => polygon.layer.startsWith("floors_"));
  assert.equal(floorPolygons.length, 6);
  for (const polygon of floorPolygons) {
    assert.ok(Object.hasOwn(polygon, "value"), `${polygon.layer} value 키 존재`);
    if (polygon.layer === "floors_unknown" || polygon.layer === "floors_assumed_1f_est") assert.equal(polygon.value, null, `${polygon.layer}는 값 없음`);
    else assert.ok(Number.isFinite(polygon.value) && polygon.value >= 1, `${polygon.layer} 층수 값`);
  }
  assert.equal(towerBase.value, 30, "b_tower 30층");
  assert.equal(floorPolygons.filter((polygon) => polygon.value === null).length, 2);
  assert.equal(toTileView(d05Tile).chart.length, 15, "D05 카드 차트에 층수·고층·저층 지표를 함께 보존");
  assert.equal(toTileView(d05Tile).chart.some((item) => item.label.includes("미터")), false);

  assert.equal(metric(d05Tile, "tall_buildings").value, 1);
  assert.equal(metric(d05Tile, "tall_buildings").status, "observed");
  assert.equal(metric(d05Tile, "tall_buildings_est").value, 1);
  assert.equal(metric(d05Tile, "tall_buildings_est").status, "estimated");
  assert.equal(metric(d05Tile, "share_tall_pct").numerator, 2);
  assert.equal(metric(d05Tile, "share_not_tall_pct").numerator, 2);
  assert.equal(metric(d05Tile, "tall_buildings_assumed").value, 2);
  assert.equal(metric(d05Tile, "back_tall_area_m2").value, 625);
  assert.ok(d05Tile.presentation.polygons.some((polygon) => polygon.layer === "tall_ge35_est"));
  assert.ok(d05Tile.presentation.polygons.some((polygon) => polygon.layer === "tall_assumed_1f_est"));
  assert.ok(d05Tile.limitations.some((limitation) => limitation.note.includes("높이·층수 자료가 없는 건물 2동(33.3%)은 1층(3 m)으로 가정")));
  assert.ok(d05Tile.limitations.some((limitation) => limitation.kind === "estimated" && limitation.note.includes("층수×3m")));
  assert.ok(!d05Tile.judgment.sentence.includes("고층건축물"));

  assert.equal(metric(d05Tile, "low_buildings").value, 2);
  assert.equal(metric(d05Tile, "low_buildings_est").value, 0);
  assert.equal(metric(d05Tile, "share_low_pct").numerator, 2);
  assert.equal(metric(d05Tile, "share_not_low_pct").numerator, 2);
  assert.equal(metric(d05Tile, "low_buildings_assumed").value, 2);
  assert.equal(metric(d05Tile, "back_low_area_m2").value, 244);
  assert.ok(d05Tile.presentation.polygons.some((polygon) => polygon.layer === "low_le12_est") === false);
  assert.ok(d05Tile.presentation.polygons.some((polygon) => polygon.layer === "low_assumed_1f_est"));

  for (const view of [d05Tile].map(toTileView)) {
    assert.ok(!/도보|\d\s*분|종합/.test(JSON.stringify(view)));
    assert.equal(new Set(view.rows.map((row, index) => `${row.label}-${index}`)).size, view.rows.length, "D05 행 key는 반복 라벨이어도 렌더 순번으로 고유");
    assert.equal(new Set((view.chart ?? []).map((item, index) => `${item.label}-${index}`)).size, view.chart.length, "D05 구성비 행 key는 반복 라벨이어도 렌더 순번으로 고유");
  }
} finally {
  ctx.close();
}

// ── counted: 모든 건물 면(D05·D06·D07 층)이 엔진이 동수로 센 건물인지 싣고, 그래프 건물 수가 엔진 동수와 같다
{
  const { viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
  const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
  const buildingOf = (polygon) => Math.floor(Number(polygon.fid) / 1000); // D05 면 fid = 지물 번호 × 1000 + 조각 번호
  for (const radiusM of [800, 120, 64]) { // 120·64 m는 반경에 걸친 건물이 있다(중심은 밖). 64 m는 센 건물이 3동뿐이라 항목이 하나여서 그래프가 나오지 않는다.
    const countCtx = new EngineContext(dataDir, M.readManifest(dataDir), `d05-counted-${radiusM}`, { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM, analysisDate: "2026-09-30", pnu: "4136011800101000000" });
    try {
      const tile = d05(countCtx);
      const polygons = tile.presentation.polygons;
      assert.ok(polygons.length > 0 && polygons.every((polygon) => typeof polygon.counted === "boolean"), `${radiusM} m: 모든 건물 면에 boolean counted`);
      const floors = polygons.filter((polygon) => polygon.layer.startsWith("floors_"));
      const denominator = metric(tile, "share_floors_1").denominator;
      const countedBuildings = new Set(floors.filter((polygon) => polygon.counted).map(buildingOf));
      assert.equal(countedBuildings.size, denominator, `${radiusM} m: counted 건물 수 = 엔진 동수(분모 ${denominator})`);
      for (const [key, flags] of Map.groupBy(polygons, buildingOf)) assert.equal(new Set(flags.map((polygon) => polygon.counted)).size, 1, `${radiusM} m: 건물 ${key}의 floors·tall·low 면은 같은 counted`);
      if (radiusM !== 800) assert.ok(floors.some((polygon) => !polygon.counted), "반경에 걸린 건물은 counted=false");
      else assert.ok(floors.every((polygon) => polygon.counted));
      const view = toTileView(tile);
      const chart = analysisCharts(viewWithLayer(view, view.defaultLayer).map);
      if (radiusM !== 64) assert.equal(chart.total, denominator, `${radiusM} m: 그래프 건물 수 = 엔진 동수`);
      else assert.equal(chart, null);
    } finally {
      countCtx.close();
    }
  }
}

// ── 도형 오류로 면을 못 그리는 건물도 동수에는 든다: 대표점 하나를 counted로 싣고, 그래프 건물 수는 엔진 동수와 같다
{
  const { viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
  const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
  const { toUtmk } = await import("../../lib/v2/crs.ts");
  const [ux, uy] = toUtmk(CENTER);
  const brokenCtx = makeContext(dataDir, "d05-broken-footprint");
  const originalHits = brokenCtx.hits.bind(brokenCtx);
  brokenCtx.hits = (key, kinds, radiusM) => originalHits(key, kinds, radiusM).map((hit) => hit.stableId === "building:b_unknown"
    ? { ...hit, geometry: { type: "Polygon", coordinates: [[[ux - 10, uy - 10], [ux + 10, uy - 10], [ux, uy + 10]]] } }
    : hit);
  try {
    const tile = d05(brokenCtx);
    const points = tile.presentation.features ?? [];
    assert.equal(points.length, 1, "면을 못 그린 건물은 대표점 하나");
    assert.equal(points[0].counted, true);
    assert.ok(points[0].layer.startsWith("floors_"), "층수 레이어 위의 점");
    assert.ok(!tile.presentation.polygons.some((polygon) => Math.floor(Number(polygon.fid) / 1000) === Number(points[0].fid)), "면이 있는 건물에는 점을 더하지 않는다");
    const view = toTileView(tile);
    assert.equal(analysisCharts(viewWithLayer(view, view.defaultLayer).map).total, metric(tile, "share_floors_1").denominator, "그래프 건물 수 = 엔진 동수(대표점 포함)");
    assert.equal(tile.presentation.countedCapped, undefined, "상한에 걸리지 않았다");
  } finally {
    brokenCtx.close();
  }
}

const absentDir = mkdtempSync(join(tmpdir(), "v2-d05-d07-absent-"));
await buildEngineFixture(absentDir, "v1", { buildings: false });
const absentCtx = makeContext(absentDir, "d05-d07-absent");
try {
  assert.equal(d05(absentCtx).status, "not_provided");
} finally {
  absentCtx.close();
}

console.log("✓ v2 D05/D06/D07 engine tiles");
