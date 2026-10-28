import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { buildEngineFixture, CENTER, at } = await import("./engine-fixture.mjs");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { a09, collectMaintenance } = await import("../../lib/v2/tile/a09/engine.ts");
const { a09ServerModule } = await import("../../lib/v2/tile/a09/server.ts");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");

const make = async (options) => {
  const dir = mkdtempSync(join(tmpdir(), "v2-d23-"));
  await buildEngineFixture(dir, "v1", options);
  if (options.mzoneSource) {
    const manifest = M.readManifest(dir);
    const db = new Database(M.resolveDataPath(dir, manifest.files.reference.path));
    insertRelease(db, {
      sourceId: "mzone_zone",
      provider: "테스트 정비구역",
      sourceUrl: "https://example.invalid/mzone-zone",
      sourceAsOf: "2026-09-09",
      fetchedAt: "2026-09-30T00:00:00Z",
      checksum: "mzone-zone-test",
      licenseCode: "TEST",
    });
    db.close();
  }
  if (options.edgeZone) {
    // 북쪽 반경 가장자리(799.7~800 m)에 0.3 m만 걸치는 가는 구역 하나 — 엔진(UTM-K)은 센다
    const manifest = M.readManifest(dir);
    const db = new Database(M.resolveDataPath(dir, manifest.files.reference.path));
    const releaseId = db.prepare("SELECT release_id FROM source_release WHERE source_id = 'maintenance_zone'").pluck().get();
    const rect = (x0, x1, y0, y1) => ({ type: "Polygon", coordinates: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]] });
    insertFeature(db, { stableId: "maintenance_zone:zedge", kind: "maintenance_zone", sourceKey: "zedge", releaseId, geometry: rect(-20, 20, 799.7, 900), name: "가장자리구역", properties: { type: "재개발", stage: "착공" } });
    db.close();
  }
  const manifest = M.readManifest(dir);
  return new EngineContext(dir, manifest, "an-d23", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM: options.radiusM ?? 800,
    analysisDate: "2026-09-30",
    pnu: null,
  });
};

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const forbidden = /도보|\d\s*분|종합/;

{
  const ctx = await make({ maint: "zones", mzoneSource: true });
  const collected = collectMaintenance(ctx);
  assert.ok(collected, "정비구역 수집 결과");
  assert.equal(collected.zones.length, 2, "반경과 교차하는 구역만 수집");
  assert.equal(collected.projects.size, 2, "연결된 사업은 구역 단위로 한 번만 집계");

  const base = a09(ctx);
  parseTileResult(base);
  assert.equal(base.presentation.features, undefined, "A09 기본 엔진은 D23에 중복 점을 내지 않음");
  assert.equal(base.presentation.polygons, undefined, "A09 기본 엔진은 D23에 중복 면을 내지 않음");
  assert.ok(base.provenance.sources.some((source) => source.sourceId === "mzone_zone"), "실제 mzone_* 원천 provenance");

  const tile = a09ServerModule.compute(ctx);
  parseTileResult(tile);
  assert.equal(tile.status, "partial");
  assert.equal(tile.tileCode, "A09");
  assert.equal(tile.tileType, "analysis");
  assert.equal(value(tile, "back_stage_2"), 1, "조합 단계 사업");
  assert.equal(value(tile, "back_stage_0"), 1, "구역지정 단계 사업");
  assert.equal(value(tile, "back_stage_7"), 0, "미확인 단계도 0 observed");
  assert.equal(value(tile, "fill_boundary_pct"), 66.7, "경계 사업 2 / 반경 시군구 명부 3");
  assert.equal(value(tile, "fill_stage_pct"), 100, "두 사업의 단계가 모두 확인됨");
  assert.equal(value(tile, "zone_area_in_radius_m2"), 80000, "교차 정비구역 면적 합");
  assert.equal(value(tile, "planned_households"), 1300, "A09와 동일한 예정 세대 합");
  const polygons = tile.presentation.polygons ?? [];
  const features = tile.presentation.features ?? [];
  assert.ok(polygons.length >= 2);
  assert.ok(polygons.every((p) => p.layer.startsWith("maint_stage:")), "기본 도형은 D23 반경 절단 단계 면");
  assert.ok(!polygons.some((p) => p.layer === "maint_zone"), "A09 원본 면 중복 없음");
  assert.ok(polygons.some((p) => p.layer === "maint_stage:조합"));
  assert.ok(!features.some((f) => f.layer === "maint_zone_center"), "A09 원본 대표점 중복 없음");
  assert.ok(polygons.every((p) => p.label === null), "새 계약 면은 긴 legacy label을 우회하지 않음");
  assert.ok(polygons.every((p) => p.name === "다산1구역" || p.name === "다산2구역"), "단계 면 name은 원천 구역명");
  assert.equal(polygons.filter((p) => p.name === "다산1구역").length, 1, "같은 구역명은 한 조각에만 name");
  assert.ok(polygons.every((p) => ["조합", "구역지정"].includes(p.sublabel)), "단계 면 sublabel은 단계");
  assert.ok(polygons.every((p) => p.labelPriority === 1), "정비구역 면은 주요 면 자동 라벨 우선순위 1");
  assert.ok(!polygons.some((p) => features.some((f) => f.fid === p.fid)), "면이 있는 정비구역의 같은 fid 대표점 제거");
  assert.ok(features.every((f) => f.label === null && f.name !== null && f.sublabel !== null && [0, 1, 2].includes(f.labelPriority)), "fallback 점도 새 라벨 계약을 지킴");
  assert.ok(tile.presentation.layers.includes("maint_stage:조합"));
  assert.ok(tile.presentation.layers.includes("maint_stage:구역지정"));
  assert.ok(tile.provenance.sources.some((source) => source.sourceId === "mzone_zone"), "흡수된 A09 결과에도 mzone_* provenance");
  assert.match(tile.judgment.sentence, / → .+ → /);
  assert.equal(tile.judgment.level, null);
  assert.doesNotMatch(JSON.stringify(tile), forbidden);
  ctx.close();
}

// counted: 그래프 정비구역 수 = 엔진이 센 「반경과 교차하는 정비구역」 수. 200 m는 두 구역이 모두 반경 가장자리에 걸려 잘린다(800 m는 안 걸린다).
{
  const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
  const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
  // 800 m + edgeZone: 북쪽 가장자리의 가는 구역은 엔진이 센다. 그래프(남북 거리를 0.3 % 길게 잼)는 counted 없이는 802.6 m로 밖에 둔다(음성 대조: 3곳 → 2곳).
  for (const [radiusM, edgeZone, expected] of [[800, false, 2], [800, true, 3], [200, false, 2]]) {
    const ctx = await make({ maint: "zones", radiusM, edgeZone });
    const tile = a09ServerModule.compute(ctx);
    const zones = value(tile, "zones_in_radius");
    const polygons = tile.presentation.polygons ?? [];
    assert.equal(zones, expected, `${radiusM} m${edgeZone ? " + 가장자리 구역" : ""}: 반경과 교차하는 정비구역(먼 구역 제외)`);
    assert.ok(polygons.length > 0 && polygons.every((polygon) => polygon.counted === true), `${radiusM} m: 그린 구역은 모두 counted`);
    const view = toTileView(tile);
    const chart = analysisCharts(viewWithLayer(view, view.defaultLayer).map);
    assert.ok(chart, `${radiusM} m: A09는 정비구역·곳을 밝혀 그래프가 나온다`);
    assert.equal(chart.total, zones, `${radiusM} m: 그래프 정비구역 수 = 엔진 정비구역 수`);
    assert.equal(chart.subject + chart.countUnit, "정비구역곳");
    if (edgeZone) {
      // 음성 대조: counted를 떼면(옛 분석) 반경 판정으로 돌아가지 않고 센 지물이 없어 그래프를 그리지 않는다.
      const stripped = JSON.parse(JSON.stringify(tile));
      for (const polygon of stripped.presentation.polygons ?? []) delete polygon.counted;
      for (const feature of stripped.presentation.features ?? []) delete feature.counted;
      const strippedView = toTileView(stripped);
      assert.equal(analysisCharts(viewWithLayer(strippedView, strippedView.defaultLayer).map), null, "counted가 없는 옛 분석은 「지도 + 요약」");
    }
    ctx.close();
  }
}

// 반경 교차 면적을 못 구한(도형 오류) 구역도 「정비구역 N곳」에는 든다: 대표점 하나를 counted로 싣고 그래프 수는 엔진 수와 같다
{
  const { toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
  const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
  const { toUtmk } = await import("../../lib/v2/crs.ts");
  const [ux, uy] = toUtmk(CENTER);
  const ctx = await make({ maint: "zones", radiusM: 800 });
  const originalHits = ctx.hits.bind(ctx);
  let brokenId;
  ctx.hits = (key, kinds, radiusM) => originalHits(key, kinds, radiusM).map((hit) => {
    if (!hit.stableId.startsWith("maintenance_zone:")) return hit;
    brokenId ??= hit.featureId;
    return hit.featureId === brokenId ? { ...hit, geometry: { type: "Polygon", coordinates: [[[ux - 10, uy - 10], [ux + 10, uy - 10], [ux, uy + 10]]] } } : hit;
  });
  const tile = a09ServerModule.compute(ctx);
  const zones = value(tile, "zones_in_radius");
  const points = (tile.presentation.features ?? []).filter((feature) => feature.fid === String(brokenId));
  assert.equal(points.length, 1, "면을 못 구한 구역은 대표점 하나");
  assert.equal(points[0].counted, true);
  assert.ok(!(tile.presentation.polygons ?? []).some((polygon) => polygon.fid === String(brokenId)), "면이 있는 구역에는 점을 더하지 않는다");
  const view = toTileView(tile);
  const chart = analysisCharts(viewWithLayer(view, view.defaultLayer).map);
  assert.equal(chart?.total, zones, "그래프 정비구역 수 = 엔진 정비구역 수(대표점 포함)");
  ctx.close();
}

{
  const ctx = await make({ maint: "roster" });
  const tile = a09ServerModule.compute(ctx);
  parseTileResult(tile);
  assert.equal(tile.status, "partial", "명부만 있어도 자료 없음이 아니라 부분 결과");
  assert.equal(value(tile, "planned_households"), 1500);
  assert.equal(value(tile, "back_stage_0"), 1);
  assert.equal(value(tile, "back_stage_2"), 1);
  assert.equal(tile.presentation.features, undefined, "경계 없는 명부는 지도에 그리지 않음");
  assert.equal(tile.presentation.polygons, undefined, "경계 없는 명부는 면을 그리지 않음");
  assert.match(tile.limitations.map((l) => l.note).join("\n"), /경계 (없음|미확보)/);
    assert.match(tile.judgment.sentence, /경계가 없어 반경 안에 있는지는 확인되지 않은/);
  assert.doesNotMatch(JSON.stringify(tile), forbidden);
  ctx.close();
}

console.log("v2 D23 maintenance tile: ok");
