import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React = React;

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
const { layerStyle, legendItems, legendItemsForModel } = await import("../../lib/v2/ui/map-layers.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

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

    assert.deepEqual(a04ClientModule.layers.options.map(({ id }) => id), ["all", "park_only", "green_space"], "A04 레이어 선택지와 legacy green_space 유지");
    assert.equal(a04ClientModule.layers.options[0].label, "전체");
    assert.equal(a04ClientModule.layers.baseExcludes, undefined, "A04 기본 보기에서 녹지·수면을 함께 표시");
    const a04BaseMap = filterMapForLayer(tile.presentation, "A04", "all");
    assert.ok(a04BaseMap);
    assert.ok(a04BaseMap.polygons?.some((polygon) => ["green_zone", "green_parcel", "water_parcel"].includes(polygon.layer)), "A04 전체 보기에는 녹지·수면 면을 포함");
    const a04ParkOnly = filterMapForLayer(tile.presentation, "A04", "park_only");
    assert.ok(a04ParkOnly);
    assert.ok(a04ParkOnly.features?.every((feature) => ["park", "park_nearest"].includes(feature.layer)), "A04 공원만 보기의 점 필터");
    assert.ok(a04ParkOnly.polygons?.every((polygon) => ["park", "park_nearest"].includes(polygon.layer)), "A04 공원만 보기의 면 필터");
    assert.ok(a04ParkOnly.lines?.every((line) => line.layer === "walk_route"), "A04 공원만 보기의 보행선 유지");
    const a04LegacyGreen = filterMapForLayer(tile.presentation, "A04", "green_space");
    assert.ok(a04LegacyGreen);
    assert.ok(a04LegacyGreen.polygons?.length > 0);
    assert.ok(a04LegacyGreen.polygons?.every((polygon) => ["green_zone", "green_parcel", "water_parcel"].includes(polygon.layer)), "legacy green_space 필터 호환");
    assert.ok(!a04LegacyGreen.features?.some((feature) => feature.layer.startsWith("park")), "legacy green_space에 공원 점을 섞지 않음");

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
    assert.equal(layerStyle("park").label, "지정 공원");
    assert.equal(layerStyle("park").color, "#6CC24A");
    assert.equal(layerStyle("park").fill, "#6CC24A");
    assert.equal(layerStyle("park").stroke, "#6CC24A");
    assert.equal(layerStyle("park").fillOpacity, 1);
    assert.equal(layerStyle("park").strokeWidth, 0);
    assert.equal(layerStyle("park_nearest").color, "#6CC24A");
    assert.equal(layerStyle("park_nearest").fill, "#6CC24A");
    assert.equal(layerStyle("park_nearest").stroke, "#2F6B1F");
    assert.equal(layerStyle("park_nearest").strokeWidth, 2.4);
    assert.equal(layerStyle("park_nearest").showInLegend, true);
    assert.equal(layerStyle("green_zone").label, "그 밖의 녹지");
    assert.equal(layerStyle("green_parcel").label, "그 밖의 녹지");
    assert.equal(layerStyle("green_zone").fill, "#BFE3A5");
    assert.equal(layerStyle("green_parcel").fill, "#BFE3A5");
    assert.equal(layerStyle("water_parcel").label, "하천·수면");
    assert.equal(layerStyle("water_parcel").fill, "#A8D5F0");
    const a04Model = {
      center: tile.conditions.center,
      radiusM: tile.conditions.radiusM,
      tileCode: "A04",
      features: tile.presentation.features ?? [],
      polygons: tile.presentation.polygons ?? [],
      lines: tile.presentation.lines ?? [],
      legend: tile.presentation.legend,
      total: tile.presentation.features?.length ?? 0,
      notes: [],
    };
    assert.deepEqual(legendItems(a04Model).map((item) => item.label), ["지정 공원", "그 밖의 녹지", "하천·수면", "최근접 공원", "보행 경로"], "A04 범례 순서");
    assert.equal(legendItems(a04Model).filter((item) => item.label === "그 밖의 녹지").length, 1, "A04 녹지 범례 통합");
    assert.equal(legendItems(a04Model).filter((item) => item.label === "하천·수면").length, 1, "A04 수면 범례 라벨");
    assert.equal(legendItemsForModel(a04Model).filter((item) => item.label === "그 밖의 녹지").length, 1, "A04 보드 녹지 범례 통합");
    assert.equal(legendItemsForModel(a04Model).filter((item) => item.label === "하천·수면").length, 1, "A04 보드 수면 범례 라벨");
    assert.deepEqual(legendItemsForModel(a04Model).map((item) => item.label), ["지정 공원", "그 밖의 녹지", "하천·수면", "최근접 공원", "보행 경로"], "A04 보드 범례 순서");
    assert.equal(layerStyle("walk_route").label, "보행 경로");
  } finally {
    ctx.close();
  }
}

// A04 보고서/PPT 공용 MapFigure도 녹지 → 수면 → 공원 순서와 불투명 평면 속성을 보장한다.
{
  const ring = [
    [CENTER[0] - 0.001, CENTER[1] - 0.001],
    [CENTER[0] + 0.001, CENTER[1] - 0.001],
    [CENTER[0] + 0.001, CENTER[1] + 0.001],
    [CENTER[0] - 0.001, CENTER[1] + 0.001],
    [CENTER[0] - 0.001, CENTER[1] - 0.001],
  ];
  const svg = renderToStaticMarkup(createElement(MapFigure, {
    model: {
      center: CENTER,
      radiusM: 800,
      tileCode: "A04",
      features: [{ layer: "park_nearest", fid: "nearest", lng: CENTER[0] + 0.0005, lat: CENTER[1], weight: 1, highlight: true, name: "다산근린공원", sublabel: "직선 120m", labelPriority: 2, distanceM: 120 }],
      polygons: [
        { layer: "park", fid: "park-polygon", rings: [ring] },
        { layer: "park_nearest", fid: "nearest-polygon", rings: [ring] },
        { layer: "water_parcel", fid: "water", rings: [ring] },
        { layer: "green_zone", fid: "zone", rings: [ring] },
        { layer: "green_parcel", fid: "parcel", rings: [ring] },
      ],
      lines: [],
      total: 1,
      notes: [],
    },
    width: 640,
    height: 360,
    basemap: "none",
    fixed: true,
    legend: false,
    north: false,
    scale: false,
    showSiteMarker: false,
    onFeaturePin: () => {},
  }));
  const drawOrder = [...svg.matchAll(/<path[^>]*data-map-layer="([^"]+)"/g)].map(([, layer]) => layer);
  assert.deepEqual(drawOrder, ["green_zone", "green_parcel", "water_parcel", "park", "park_nearest"], "A04 SVG 면 그리기 순서");
  assert.match(svg, /data-map-layer="green_zone"[^>]*fill="#BFE3A5"[^>]*fill-opacity="1"[^>]*stroke="#BFE3A5"[^>]*stroke-width="0"/);
  assert.match(svg, /data-map-layer="water_parcel"[^>]*fill="#A8D5F0"[^>]*fill-opacity="1"[^>]*stroke="#A8D5F0"[^>]*stroke-width="0"/);
  assert.match(svg, /data-map-layer="park_nearest"[^>]*fill="#6CC24A"[^>]*fill-opacity="1"[^>]*stroke="#2F6B1F"[^>]*stroke-width="2\.4"/);
  const nearestCircle = svg.match(/<circle[^>]*data-map-feature="park_nearest\|nearest"[^>]*>/)?.[0];
  assert.ok(nearestCircle, "최근접 공원 SVG 점 식별자");
  assert.match(nearestCircle, /fill="#6CC24A"/);
  assert.match(nearestCircle, /stroke="#16181d"/);
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
