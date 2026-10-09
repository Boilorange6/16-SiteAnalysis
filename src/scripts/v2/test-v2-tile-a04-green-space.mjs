import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const Database = (await import("better-sqlite3")).default;
const { buildEngineFixture, at, CENTER } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");
const { insertFeature } = await import("../../lib/v2/data/features.ts");
const { EngineContext } = await import("../../lib/v2/engine/context.ts");
const { TILES } = await import("../../lib/v2/engine/run.ts");
const d09 = TILES.find(([code]) => code === "A04")[1];
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { a04ClientModule } = await import("../../lib/v2/tile/a04/view.ts");
const { filterMapForLayer } = await import("../../lib/v2/ui/tile-layers.ts");
const { formatDistanceM } = await import("../../lib/v2/ui/tile-view.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");

const metric = (tile, id) => tile.metrics.find((m) => m.id === id);
const value = (tile, id) => metric(tile, id)?.value;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

const makeContext = async (options, radiusM = 800) => {
  const dataDir = mkdtempSync(join(tmpdir(), "v2-d09-"));
  await buildEngineFixture(dataDir, "v1", options);
  const manifest = M.readManifest(dataDir);
  if (options.parkPolygon) {
    const reference = new Database(M.resolveDataPath(dataDir, manifest.files.reference.path));
    const parkRelease = reference.prepare("SELECT release_id FROM source_release WHERE source_id = 'park'").pluck().get();
    insertFeature(reference, {
      stableId: "park:polygon",
      kind: "park",
      sourceKey: "polygon",
      releaseId: parkRelease,
      geometry: { type: "Polygon", coordinates: [[at(450, -100), at(550, -100), at(550, 100), at(450, 100), at(450, -100)]] },
      name: "다산근린공원",
      properties: { parkType: "근린공원", areaM2: 20000, designatedAt: null, jibunAddress: null },
    });
    if (options.roads) {
      const roadRelease = reference.prepare("SELECT release_id FROM source_release WHERE source_id = 'osm_roads'").pluck().get();
      insertFeature(reference, {
        stableId: "road:test-walk",
        kind: "road",
        sourceKey: "test-walk",
        releaseId: roadRelease,
        geometry: { type: "LineString", coordinates: [at(0, 0), at(300, 0)] },
        name: null,
        properties: { osmId: "test-walk", fclass: "residential", hierarchy: "보행·자전거", name: null },
      });
    }
    reference.close();
  }
  return new EngineContext(dataDir, manifest, "d09-test", {
    address: "경기도 남양주시 다산동 100",
    center: CENTER,
    radiusM,
    analysisDate: "2026-09-30",
  });
};

// A04가 흡수한 D09: 공원 점·지목 도형·녹지지역 도형을 각각 계산한다.
{
  const ctx = await makeContext({ parcels: true, zoning: "overlap", roads: true, parkPolygon: true });
  try {
    const tile = d09(ctx);
    parseTileResult(tile);
    assert.equal(tile.tileCode, "A04");
    assert.equal(tile.status, "partial");
    assert.equal(value(tile, "parks"), 4, "기존 park 점 p1~p3와 polygon park");
    assert.equal(metric(tile, "parks").unit, "곳");
    assert.equal(metric(tile, "park_area_source_m2"), undefined, "흡수 D09의 공원 원천 면적 중복 지표 제거");
    assert.equal(tile.presentation.features.filter((feature) => feature.layer === "park").length, 2, "D09가 A04 공원 대표점을 다시 내지 않음");
    assert.equal(tile.presentation.features.filter((feature) => feature.layer === "park_nearest").length, 1, "A04 최근접 공원 대표점은 유지");
    const nearestPark = tile.presentation.features.find((feature) => feature.layer === "park_nearest");
    assert.equal(nearestPark?.name, "p1");
    assert.equal(nearestPark?.highlight, true);
    assert.equal(nearestPark?.label, undefined, "최근접 공원 legacy label 없음");
    assert.equal(nearestPark?.sublabel, formatDistanceM(nearestPark?.distanceM), "최근접 공원 거리 sublabel");
    assert.equal(nearestPark?.labelPriority, 2);
    const polygonPark = tile.presentation.polygons.find((polygon) => polygon.layer === "park");
    assert.equal(polygonPark?.name, "다산근린공원");
    assert.equal(polygonPark?.label, null);
    assert.equal(polygonPark?.sublabel, null);
    assert.equal(polygonPark?.labelPriority, 0);
    const pointFids = new Set((tile.presentation.features ?? []).filter((feature) => feature.layer.startsWith("park")).map((feature) => feature.fid));
    assert.ok(tile.presentation.polygons.filter((polygon) => polygon.layer.startsWith("park")).every((polygon) => !pointFids.has(polygon.fid)), "같은 공원 면·대표점 중복 금지");
    assert.equal(tile.presentation.lines?.length, 1, "최근접 공원 보행선 하나");
    assert.equal(tile.presentation.lines?.[0]?.name, "p1");
    assert.match(tile.presentation.lines?.[0]?.label ?? "", /^공원 도보 .+ · \d+분$/, "보행선 legacy label 하위 호환");
    assert.match(tile.presentation.lines?.[0]?.sublabel ?? "", /^도보 .+ · \d+분$/);
    assert.equal(tile.presentation.lines?.[0]?.labelPriority, 2);
    assert.doesNotMatch(tile.judgment.sentence, /운영 공원/);

    assert.deepEqual(a04ClientModule.layers.baseExcludes, ["green_space"], "A04 기본 보기에서 녹지·수면 레이어 제외");
    const a04BaseMap = filterMapForLayer(tile.presentation, "A04", "all");
    assert.ok(a04BaseMap);
    assert.equal(a04BaseMap.polygons?.some((polygon) => ["green_zone", "green_parcel", "water_parcel"].includes(polygon.layer)), false, "A04 기본 보기에는 녹지·수면 면을 중복 표시하지 않음");

    const water = metric(tile, "share_water_pct");
    const greenParcel = metric(tile, "share_green_parcel_pct");
    const greenZone = metric(tile, "share_green_zone_pct");
    assert.equal(water.status, "observed");
    assert.equal(greenParcel.status, "observed");
    assert.equal(greenZone.status, "observed");
    near(water.numerator, 20000, 10, "천 지목 반경 교차면적");
    near(greenParcel.numerator, 40000, 10, "임 지목 반경 교차면적");
    assert.ok(greenZone.numerator > 0, "녹지지역 교차면적");
    assert.equal(metric(tile, "back_other_pct").status, "observed");

    assert.ok(tile.presentation.features.some((f) => f.layer === "park"));
    assert.ok(tile.presentation.polygons.some((p) => p.layer === "green_zone"));
    assert.ok(tile.presentation.polygons.some((p) => p.layer === "water_parcel"));
    assert.ok(tile.presentation.polygons.some((p) => p.layer === "green_parcel"));
    assert.ok(tile.limitations.some((l) => l.note.includes("OSM 수계 자료는 확인하지 못했습니다")));
    assert.ok(tile.limitations.some((l) => l.note.includes("계획 공원")));
    assert.ok(tile.limitations.some((l) => l.note.includes("녹지지역은 지목과 겹칠 수 있어")));
    assert.equal(tile.judgment.level, null);
    assert.equal(layerStyle("park").label, "공원");
    assert.equal(layerStyle("walk_route").label, "보행 경로");
  } finally {
    ctx.close();
  }
}

// zoning_area 원천이 없으면 녹지지역만 missing이고, park·parcel 지표는 유지한다.
{
  const ctx = await makeContext({ parcels: true });
  try {
    const tile = d09(ctx);
    assert.equal(value(tile, "parks"), 3);
    assert.equal(metric(tile, "share_green_zone_pct").status, "missing");
    assert.equal(metric(tile, "share_water_pct").status, "observed");
    assert.equal(metric(tile, "share_green_parcel_pct").status, "observed");
    assert.equal(metric(tile, "back_other_pct").status, "observed");
  } finally {
    ctx.close();
  }
}

// parcels 파일이 없으면 지목 기반 지표만 missing이고 park·zoning은 유지한다.
{
  const ctx = await makeContext({ zoning: "overlap" });
  try {
    const tile = d09(ctx);
    assert.equal(value(tile, "parks"), 3);
    assert.equal(metric(tile, "share_water_pct").status, "missing");
    assert.equal(metric(tile, "share_green_parcel_pct").status, "missing");
    assert.equal(metric(tile, "back_other_pct").status, "missing");
    assert.equal(metric(tile, "share_green_zone_pct").status, "observed");
  } finally {
    ctx.close();
  }
}

console.log("✓ v2 D09 tile");
