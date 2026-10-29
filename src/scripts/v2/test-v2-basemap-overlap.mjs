/**
 * M-1: 같은 층 안에서 겹친 면이 even-odd 구멍으로 그려지던 문제.
 * 바탕(MapBase)은 겹친 면을 합치고, PPT 주제 면은 같은 스타일 묶음 안에서 겹치는 면끼리 다른 custGeom으로 나눈다.
 */
import assert from "node:assert/strict";
import React from "react";
import JSZip from "jszip";

globalThis.React = React;

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { mapBaseFromScene } = await import("../../lib/v2/ui/basemap.ts");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { makeProjector } = await import("../../lib/v2/ui/map-projection.ts");

const ORIGIN_LNG = 127.0636;
const ORIGIN_LAT = 37.4979;
const [ox, oy] = toUtmk([ORIGIN_LNG, ORIGIN_LAT]);
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

function sceneOf({ buildings, green = [], greenKinds = [], water = [] }) {
  return {
    version: "v2-scene@2", analysisId: "a-overlap", manifestHash: "h",
    origin: { epsg: "EPSG:5179", x: ox, y: oy, lng: ORIGIN_LNG, lat: ORIGIN_LAT },
    radiusM: 500, ground: { kind: "flat" }, site: null,
    buildings: buildings.map((rings, i) => ({
      id: `b${i}`, name: null, sublabel: null, labelPriority: 0, rings,
      baseZ: null, heightM: 9, heightMethod: "source", floorsAbove: 3, useCode: null, approvalDate: null,
    })),
    parcels: [],
    context: {
      roads: [{ points: line(-450, -60, 450, -60), widthM: 20, hierarchy: "간선", name: "테헤란로" }],
      green, greenKinds, water, rail: [], stations: [], places: [],
    },
    counts: { buildingsTotal: buildings.length, buildingsIncluded: buildings.length, parcelsTotal: 0, parcelsIncluded: 0 },
    sources: [], limitations: [],
  };
}

// ── 바탕: 겹친 건물은 하나로, 떨어진 건물은 그대로 ──
const overlapScene = sceneOf({ buildings: [[box(0, 0, 20, 20)], [box(10, 10, 20, 20)]] });
const overlapBase = mapBaseFromScene(overlapScene);
assert.equal(overlapBase.buildings.length, 1, "겹친 두 건물은 한 건물로 합쳐진다");
assert.equal(mapBaseFromScene(sceneOf({ buildings: [[box(0, 0, 20, 20)], [box(100, 100, 20, 20)]] })).buildings.length, 2, "떨어진 건물은 그대로 2개");
assert.equal(mapBaseFromScene(sceneOf({ buildings: [[box(0, 0, 20, 20)], [box(20, 0, 20, 20)]] })).buildings.length, 2, "변만 닿은 건물은 합치지 않는다");
assert.equal(mapBaseFromScene(sceneOf({ buildings: [[box(0, 0, 20, 20)], [box(10, 10, 20, 20)], [box(25, 25, 20, 20)]] })).buildings.length, 1, "연쇄로 겹친 셋은 한 건물");

// 경계가 꼭짓점·변 위에서 만나는 경우도 정밀 판정으로 맞는다
{
  const buildingCount = (...buildings) => mapBaseFromScene(sceneOf({ buildings })).buildings.length;
  assert.equal(buildingCount([box(0, 0, 20, 20)], [box(0, 0, 20, 20)]), 1, "같은 자리 중복 발자국은 하나");
  assert.equal(buildingCount([box(0, 0, 20, 20)], [[[10, 0], [20, 10], [10, 20], [0, 10], [10, 0]]]), 1, "변 위에 꼭짓점이 놓인 안쪽 마름모");
  assert.equal(buildingCount([box(0, 0, 20, 20)], [box(5, 20, 10, 10)]), 2, "변 일부만 닿은 건물은 따로");
  assert.equal(buildingCount([box(0, 0, 40, 40), box(10, 10, 20, 20)], [box(15, 15, 5, 5)]), 2, "안뜰(구멍) 안의 건물은 겹치지 않는다");
  assert.equal(buildingCount([box(0, 0, 40, 40), box(10, 10, 20, 20)], [box(30, 30, 20, 20)]), 1, "구멍 있는 건물에 걸친 건물은 합친다");
}

// 녹지는 종류 안에서만, 물은 모두 합친다
{
  const merged = mapBaseFromScene(sceneOf({
    buildings: [],
    green: [[box(0, 0, 50, 50)], [box(30, 30, 50, 50)], [box(30, 30, 50, 50)]],
    greenKinds: ["park", "park", "forest"],
    water: [[box(200, 0, 40, 40)], [box(220, 20, 40, 40)]],
  }));
  assert.deepEqual(merged.green.map((g) => g.kind).sort(), ["forest", "park"], "다른 종류 녹지는 겹쳐도 따로 둔다");
  assert.equal(merged.water.length, 1, "겹친 물은 하나");
}

// ── 화면(svg): 합친 바탕 건물 경로에서 겹친 점이 even-odd로도 채워진다 ──
{
  const model = { center: [ORIGIN_LNG, ORIGIN_LAT], radiusM: 500, features: [], total: 0, notes: [], tileCode: "A04", base: overlapBase };
  const scene = buildMapScene({ model, width: 800, height: 600, activeLayer: "vector" });
  const bucket = scene.base.buckets.find((b) => b.layer === "building");
  assert.ok(bucket, "건물 묶음");
  const [px, py] = makeProjector(scene.viewport)(...toLngLat([ox + 15, oy + 15]));
  const crossings = (rings, x, y) => {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return inside;
  };
  assert.ok(crossings(bucket.paths, px, py), "겹친 곳(15,15)이 even-odd로 칠해진다");
  assert.ok(!crossings(bucket.paths, ...makeProjector(scene.viewport)(...toLngLat([ox + 25, oy + 5]))), "비어 있는 곳(25,5)은 칠하지 않는다");
}

// ── PPT 주제 면: 겹치는 면은 다른 custGeom으로 ──
const fixture = toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A01"));
const polygonOf = (fid, lng, lat, s) => ({ layer: "use:주거", fid, rings: [[[lng, lat], [lng + s, lat], [lng + s, lat + s], [lng, lat + s], [lng, lat]]] });
const planOf = (polygons) => {
  const map = { center: [ORIGIN_LNG, ORIGIN_LAT], radiusM: 500, total: 0, notes: [], tileCode: "D03", features: [], lines: [], polygons };
  return {
    kind: "tile", view: { ...fixture, tileId: "overlap", code: "D03", title: "D03 겹침", tileType: "analysis", hasFace: false, map, backdrop: map },
    body: { kind: "result", face: "single" }, faceLabel: null, map, muted: false, pinnedKeys: [],
    footer: "출처 구조 회귀 fixture · 기준일 2026-10-14", no: 1, total: 1,
  };
};
async function residentialGeometries(polygons) {
  const zip = await JSZip.loadAsync(await renderReportPptx([planOf(polygons)], {}, { basemap: "white" }));
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  const blocks = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).filter((b) => b.includes("GRP|map-D03-legend-주거"));
  return blocks.filter((b) => b.includes("<a:custGeom>")).length;
}
{
  const s = 0.0006;
  assert.equal(
    await residentialGeometries([polygonOf("a", ORIGIN_LNG, ORIGIN_LAT, s), polygonOf("b", ORIGIN_LNG + s / 2, ORIGIN_LAT + s / 2, s)]),
    2,
    "겹치는 같은 스타일 면 둘은 하위 묶음 2개",
  );
  assert.equal(
    await residentialGeometries(Array.from({ length: 10 }, (_, i) => polygonOf(`d${i}`, ORIGIN_LNG - 0.004 + i * 0.0008, ORIGIN_LAT, s))),
    1,
    "안 겹치는 면 10개는 묶음 1개",
  );
}

console.log("test-v2-basemap-overlap: ok");
