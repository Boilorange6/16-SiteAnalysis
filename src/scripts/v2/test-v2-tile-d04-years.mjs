import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { d04 } = await import("../../lib/v2/tile/d04/engine.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");

const metric = (tile, id) => {
  const found = tile.metrics.find((item) => item.id === id);
  assert.ok(found, `${tile.tileCode}: metric ${id}`);
  return found;
};

const context = (dataDir, analysisId) => new EngineContext(
  dataDir,
  M.readManifest(dataDir),
  analysisId,
  { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM: 800, analysisDate: "2026-09-30", pnu: null },
);

// 정상 도형은 발자국만 그려 대표점과의 중복을 만들지 않는다.
const dataDir = mkdtempSync(join(tmpdir(), "v2-d04-years-"));
await buildEngineFixture(dataDir, "v1", { buildings: true });
const ctx = context(dataDir, "d04-years");
try {
  const tile = d04(ctx);
  assert.equal(tile.presentation.polygons.length, 6);
  assert.equal(tile.presentation.featuresTotal, 0, "정상 도형에는 중복 대표점이 없다");
  assert.equal(tile.presentation.features.length, 0);
  assert.ok(tile.presentation.polygons.every((polygon) => polygon.label === null), "레거시 label에 이름을 복사하지 않는다");
  const datedBuilding = tile.presentation.polygons.find((polygon) => polygon.name === "b_apt");
  assert.ok(datedBuilding, "D04 polygon은 원천 건물 이름을 사용한다");
  assert.equal(datedBuilding.sublabel, "1979년");
  assert.equal(datedBuilding.labelPriority, 1);
  const unknownYearBuilding = tile.presentation.polygons.find((polygon) => polygon.name === "b_noledger");
  assert.ok(unknownYearBuilding);
  assert.equal(unknownYearBuilding.sublabel, null, "승인연도 미상 건물에는 sublabel을 붙이지 않는다");
  assert.equal(unknownYearBuilding.labelPriority, 1);

  // 그래프용 값: 사용승인 연도, 미상만 null
  assert.deepEqual(tile.presentation.valueAxis, { label: "사용승인 연도", unit: "년", countUnit: "동" });
  assert.deepEqual(toTileView(tile).map.valueAxis, tile.presentation.valueAxis);
  assert.equal(datedBuilding.value, 1979);
  assert.equal(unknownYearBuilding.value, null);
  for (const polygon of tile.presentation.polygons) {
    assert.ok(Object.hasOwn(polygon, "value"), `${polygon.layer} value 키 존재`);
    if (polygon.layer === "bldg_unknown") assert.equal(polygon.value, null);
    else assert.ok(Number.isInteger(polygon.value) && polygon.value >= 1900 && polygon.value <= 2100, `${polygon.layer} 연도 ${polygon.value}`);
  }
  assert.ok(tile.presentation.polygons.some((polygon) => polygon.layer === "bldg_unknown"), "미상 면이 있어야 null 경로를 검증");

  // UI 헤더는 반올림된 퍼센트 합이 아니라 세부 metric의 count 합으로 다시 계산한다.
  const rounded = structuredClone(tile);
  for (const [index, id] of ["share_pre1980", "share_1980s", "share_1990s"].entries()) {
    const part = metric(rounded, id);
    Object.assign(part, { value: index < 2 ? 33.3 : 0, numerator: index < 2 ? 1 : 0, denominator: 3 });
  }
  const roundedView = toTileView(rounded);
  assert.equal(roundedView.headlineMetricId, "share_pre2000");
  assert.equal(roundedView.headline?.label, "2000년 이전 준공");
  assert.equal(roundedView.headline?.value, "66.7%");
} finally {
  ctx.close();
}

// 도형 계산에 실패한 건물만 대표점 fallback으로 남긴다.
const fallbackDataDir = mkdtempSync(join(tmpdir(), "v2-d04-years-fallback-"));
await buildEngineFixture(fallbackDataDir, "v1", { buildings: true });
const fallbackDb = new Database(join(fallbackDataDir, "versions", "v1", "buildings.sqlite"));
let unknownId;
try {
  const [cx, cy] = (await import("../../lib/v2/crs.ts")).toUtmk(CENTER);
  const invalidFootprint = {
    type: "Polygon",
    coordinates: [[[cx - 10, cy - 10], [cx + 10, cy - 10], [cx, cy + 10]]],
  };
  unknownId = fallbackDb.prepare("SELECT feature_id FROM feature WHERE stable_id = ?").get("building:b_unknown").feature_id;
  fallbackDb.prepare("UPDATE feature SET geom_json = ? WHERE stable_id = ?").run(JSON.stringify(invalidFootprint), "building:b_unknown");
} finally {
  fallbackDb.close();
}
const fallbackCtx = context(fallbackDataDir, "d04-years-fallback");
try {
  const fallback = d04(fallbackCtx);
  assert.equal(fallback.presentation.polygons.length, 5);
  assert.equal(fallback.presentation.featuresTotal, 1);
  assert.equal(fallback.presentation.features[0].fid, String(unknownId));
  assert.equal(fallback.presentation.features[0].layer, "bldg_2000s");
  assert.equal(fallback.presentation.features[0].name, "b_unknown");
  assert.equal(fallback.presentation.features[0].sublabel, "2005년");
  assert.equal(fallback.presentation.features[0].value, 2005, "대표점 fallback도 같은 연도 값을 싣는다");
  assert.equal(fallback.presentation.features[0].labelPriority, 1);
} finally {
  fallbackCtx.close();
}

// 대표 좌표조차 없는 malformed 도형은 점 fallback을 생략하되 타일은 계속 산출한다.
const malformedCtx = context(dataDir, "d04-years-malformed");
const originalMalformedHits = malformedCtx.hits.bind(malformedCtx);
malformedCtx.hits = (key, kinds, radiusM) => originalMalformedHits(key, kinds, radiusM).map((hit) => hit.stableId === "building:b_unknown"
  ? { ...hit, geometry: { type: "GeometryCollection", geometries: [] } }
  : hit);
try {
  const malformed = d04(malformedCtx);
  assert.equal(malformed.presentation.polygons.length, 5);
  assert.equal(malformed.presentation.featuresTotal, 0, "대표 좌표가 없으면 점 fallback을 생략한다");
} finally {
  malformedCtx.close();
}

// ── counted: 모든 건물 면이 엔진이 동수로 센 건물인지 싣고, 그래프 건물 수가 엔진 동수와 같다
{
  const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
  for (const radiusM of [800, 120, 64]) { // 120·64 m는 반경에 걸친 건물이 있다(중심은 밖). 64 m는 센 건물이 1동뿐이라 그래프가 나오지 않는다(항목 둘 미만).
    const countCtx = new EngineContext(dataDir, M.readManifest(dataDir), `d04-counted-${radiusM}`, { address: "경기도 남양주시 다산동 100", center: CENTER, radiusM, analysisDate: "2026-09-30", pnu: null });
    try {
      const counted = d04(countCtx);
      const polygons = counted.presentation.polygons;
      assert.ok(polygons.length > 0 && polygons.every((polygon) => typeof polygon.counted === "boolean"), `${radiusM} m: 모든 건물 면에 boolean counted`);
      const denominator = metric(counted, "confirmed_share_pct").denominator;
      assert.equal(new Set(polygons.filter((polygon) => polygon.counted).map((polygon) => polygon.fid)).size, denominator, `${radiusM} m: counted 건물 수 = 엔진 동수(분모 ${denominator})`);
      if (radiusM !== 800) assert.ok(polygons.some((polygon) => !polygon.counted), "반경에 걸린 건물은 counted=false");
      else assert.ok(polygons.every((polygon) => polygon.counted));
      if (radiusM !== 64) assert.equal(analysisCharts(toTileView(counted).map).total, denominator, `${radiusM} m: 그래프 건물 수 = 엔진 동수`);
      else assert.equal(analysisCharts(toTileView(counted).map), null, "센 건물의 항목이 하나뿐이면 그래프를 내지 않는다");
    } finally {
      countCtx.close();
    }
  }
}

console.log("✓ v2 D04 years tile");
