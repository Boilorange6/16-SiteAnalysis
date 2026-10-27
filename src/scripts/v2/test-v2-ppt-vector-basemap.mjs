/**
 * PPT 벡터 바탕: 묶음 도형(층당 1개), 그리기 순서(바탕 < 값 래스터 PNG < 주제), 래스터 없는 장의 그림 생략,
 * 조판 칸 안 가두기, 장면 없는 분석의 기존 JPEG 폴백, 출처 띠 표기, 테마, 내보내기 바탕 결정(보고서 프레임 포함).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import JSZip from "jszip";

globalThis.React = React;

const { toUtmk } = await import("../../lib/v2/crs.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { mapBaseFromScene, frameBasemap, resolveBasemap } = await import("../../lib/v2/ui/basemap.ts");
const { BASE_THEMES } = await import("../../lib/v2/ui/map-theme.ts");
const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
const { sheetCells } = await import("../../lib/v2/ui/sheet.ts");
const { effectiveLayer } = await import("../../lib/v2/report/map-image.ts");
const { tileSvg } = await import("../../lib/v2/export/tile-image.ts");
const { VECTOR_ATTRIBUTION } = await import("../../lib/v2/ui/map-projection.ts");

const EMU = 914400;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

// ── 손 장면(벡터 바탕 테스트와 같은 모양) ──
const ORIGIN_LNG = 127.0636;
const ORIGIN_LAT = 37.4979;
const [ox, oy] = toUtmk([ORIGIN_LNG, ORIGIN_LAT]);
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
const scene = {
  version: "v2-scene@2", analysisId: "a-ppt-base", manifestHash: "h",
  origin: { epsg: "EPSG:5179", x: ox, y: oy, lng: ORIGIN_LNG, lat: ORIGIN_LAT },
  radiusM: 500, ground: { kind: "flat" }, site: null,
  // 건물 40동: 묶음 도형은 1개여야 한다
  buildings: Array.from({ length: 40 }, (_, i) => ({
    id: `b${i}`, name: null, sublabel: null, labelPriority: 0,
    rings: [box(-300 + (i % 8) * 60, -200 + Math.floor(i / 8) * 50, 30, 25)],
    baseZ: null, heightM: 9, heightMethod: "source", floorsAbove: 3, useCode: null, approvalDate: null,
  })),
  parcels: [0, 1, 2].map((i) => ({ pnu: `p${i}`, rings: [box(-100 + i * 40, 40, 36, 36)], jimok: null, areaM2: 1000, isSite: i === 0 })),
  context: {
    roads: [
      { points: line(-450, -60, 450, -60), widthM: 20, hierarchy: "간선", name: "테헤란로" },
      { points: line(-450, 120, 450, 140), widthM: 10, hierarchy: "집산", name: "도곡로77길" },
      { points: line(-120, -450, -80, 450), widthM: 6, hierarchy: "국지", name: null },
    ],
    green: [[box(-400, -400, 120, 100)], [box(250, 200, 100, 100)]],
    greenKinds: ["forest", "park"],
    water: [[box(300, -380, 120, 60)]],
    rail: [], stations: [], places: [{ name: "역삼동", kind: "dong", x: 60, y: -300 }],
  },
  counts: { buildingsTotal: 40, buildingsIncluded: 40, parcelsTotal: 3, parcelsIncluded: 3 },
  sources: [], limitations: [],
};
const base = mapBaseFromScene(scene);
const roadless = mapBaseFromScene({ ...scene, context: undefined });

const fixture = toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A01"));
const modelOf = (tileCode, extra = {}) => ({
  center: [ORIGIN_LNG, ORIGIN_LAT], radiusM: 500, total: 1, notes: [], tileCode,
  features: [{ layer: "bus_stop", fid: `${tileCode}-bus`, lng: ORIGIN_LNG + 0.0004, lat: ORIGIN_LAT + 0.0003, name: "정류장", label: "정류장", labelPriority: 1 }],
  lines: [], polygons: [], ...extra,
});
const viewFor = (code, map, suffix) => ({ ...fixture, tileId: suffix, code, title: `${code} 벡터 바탕`, tileType: "analysis", hasFace: false, map, backdrop: map });
const tilePlan = (code, map, suffix, extra = {}) => ({
  kind: "tile", view: viewFor(code, map, suffix), body: { kind: "result", face: "single" }, faceLabel: null, map, muted: false, pinnedKeys: [],
  footer: "출처 구조 회귀 fixture · 기준일 2026-10-14", no: 1, total: 1, ...extra,
});
const framePage = (basemap) => ({ id: "p-frame", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "tile", tileId: "x", part: { type: "single" }, settings: {}, frame: { ...defaultFrame(), basemap } });

async function slidesOf(plans, images, options) {
  const zip = await JSZip.loadAsync(await renderReportPptx(plans, images, options));
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return { zip, xml: await Promise.all(names.map((n) => zip.file(n).async("string"))) };
}
const count = (xml, re) => (xml.match(re) ?? []).length;
const spBlocks = (xml) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
const geometry = (block) => {
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  return off && ext ? { x: +off[1], y: +off[2], w: +ext[1], h: +ext[2] } : null;
};

const vectorModel = modelOf("A04", { base });
const key = (plan) => mapKeysOf(plan)[0];

// ── bucket-shapes: 건물이 40동이어도 GRP|map-base-building 도형은 1개 ──
{
  const plan = tilePlan("A04", vectorModel, "bucket");
  const { xml: [xml] } = await slidesOf([plan], {}, { basemap: "vector" });
  assert.equal(count(xml, /name="GRP\|map-base-building\|/g), 1, "건물 묶음 도형 1개");
  assert.equal(count(xml, /name="GRP\|map-base-water\|/g), 1, "물 묶음 도형 1개");
  assert.ok(count(xml, /name="GRP\|map-base-road\|/g) >= 2, "도로는 테두리·면 묶음");
  assert.ok(count(xml, /name="GRP\|map-base-green\|/g) >= 2, "녹지는 숲·공원 묶음");
  assert.match(xml, /name="GRP\|map-base-bg\|/, "바탕색 사각형");
  assert.match(xml, /<a:t>테헤란로<\/a:t>|<a:t>역삼동<\/a:t>/, "바탕 이름 라벨");
  const buildings = spBlocks(xml).find((b) => b.includes("GRP|map-base-building|"));
  assert.match(buildings, /<a:custGeom>/);
  assert.ok(count(buildings, /<a:moveTo>/g) >= 40, "건물 40동이 한 도형의 하위 경로");
  assert.ok(count(xml, /name="GRP\|map-base-/g) < 40, "바탕 도형은 건물 수가 아니라 층·묶음 수");
}

// ── z-order: 바탕 < 값 래스터(PNG) < 주제 ──
{
  const plan = tilePlan("A04", vectorModel, "zorder");
  const { zip, xml: [xml] } = await slidesOf([plan], { [key(plan)]: PNG }, { basemap: "vector" });
  const lastBase = xml.lastIndexOf("GRP|map-base-");
  const pic = xml.indexOf("<p:pic>");
  const thematic = xml.indexOf("GRP|map-A04-");
  assert.ok(lastBase > 0 && pic > 0 && thematic > 0, `순서 요소 ${lastBase}/${pic}/${thematic}`);
  assert.ok(lastBase < pic, "바탕 도형이 그림보다 먼저");
  assert.ok(pic < thematic, "그림이 주제 도형보다 먼저");
  assert.equal(count(xml, /<p:pic>/g), 1);
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string");
  assert.match(rels, /media\/[^"]+\.png"/, "값 래스터 그림은 PNG");
}

// ── no-picture: 래스터·밀집 층이 없는 vector 장에는 지도 배경 그림이 없다 ──
{
  const plan = tilePlan("A04", vectorModel, "nopic");
  const { xml: [xml] } = await slidesOf([plan], {}, { basemap: "vector" });
  assert.equal(count(xml, /<p:pic>/g), 0, "지도 배경 그림 없음");
  assert.ok(!xml.includes("지도 이미지를 만들지 못했습니다"), "자리표시 문구 없음");
}

// ── cell-mode: 조판 칸 안에서 바탕 묶음이 칸 프레임 안 ──
{
  const cellView = (code, suffix) => viewFor(code, modelOf(code, { base }), suffix);
  const sheet = {
    kind: "sheet", view: { ...fixture, tileId: "sheet", code: "SHEET", title: "조판", tileType: "stack", map: null }, grid: "2x2",
    cells: [
      { view: cellView("A04", "c0"), face: "front", mapKey: "c0", pinnedKeys: [] },
      { view: cellView("A06", "c1"), face: "front", mapKey: "c1", pinnedKeys: [] },
    ],
    footer: "조판 · 기준일 2026-10-14", no: 1, total: 1,
  };
  const { xml: [xml] } = await slidesOf([sheet], { c0: PNG }, { basemap: "vector" });
  const cells = sheetCells("2x2");
  for (const index of [0, 1]) {
    const r = cells[index];
    const frame = { x: r.x * EMU, y: r.y * EMU, w: r.w * EMU, h: r.h * EMU };
    const mine = spBlocks(xml).filter((b) => b.includes(`GRP|map-cell-${index}-base-`));
    assert.ok(mine.length >= 4, `칸 ${index} 바탕 도형 ${mine.length}`);
    for (const block of mine) {
      const g = geometry(block);
      assert.ok(g.x >= frame.x - 200 && g.y >= frame.y - 200 && g.x + g.w <= frame.x + frame.w + 200 && g.y + g.h <= frame.y + frame.h + 200, `칸 ${index} 바탕 도형이 칸 밖: ${block.match(/name="([^"]*)"/)[1]}`);
    }
  }
  assert.equal(count(xml, /<p:pic>/g), 1, "값 래스터가 있는 칸만 그림");
  assert.ok(!xml.includes("그림을 만들지 못했습니다"), "벡터 칸에 자리표시 문구 없음");
}

// ── fallback: 장면(바탕 자료) 없는 분석은 지금과 같은 배경 JPEG 1장 ──
{
  const plan = tilePlan("A04", modelOf("A04"), "fallback");
  const { zip, xml: [xml] } = await slidesOf([plan], { [key(plan)]: JPEG }, { basemap: "vector" });
  assert.equal(count(xml, /<p:pic>/g), 1);
  assert.ok(!xml.includes("GRP|map-base-"), "바탕 도형 없음");
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels").async("string");
  assert.match(rels, /media\/[^"]+\.jpe?g"/, "JPEG");
  // 도로 맥락 없는 바탕도 벡터로 쓰지 않는다
  const roadlessPlan = tilePlan("A04", modelOf("A04", { base: roadless }), "roadless");
  const { xml: [roadlessXml] } = await slidesOf([roadlessPlan], { [key(roadlessPlan)]: JPEG }, { basemap: "vector" });
  assert.ok(!roadlessXml.includes("GRP|map-base-") && count(roadlessXml, /<p:pic>/g) === 1);
}

// ── 출처 띠: 벡터면 OSM·국토교통부, 아니면 VWorld ──
{
  const vectorPlan = tilePlan("A04", vectorModel, "credit-v");
  const plainPlan = tilePlan("A04", modelOf("A04"), "credit-p");
  const { xml: [vectorXml] } = await slidesOf([vectorPlan], {}, { basemap: "vector" });
  const { xml: [plainXml] } = await slidesOf([plainPlan], { [key(plainPlan)]: JPEG }, { basemap: "vector" });
  assert.ok(vectorXml.includes(VECTOR_ATTRIBUTION), "벡터 장 출처");
  assert.ok(!vectorXml.includes("VWorld"), "벡터 장에 VWorld 표기 없음");
  assert.ok(plainXml.includes("VWorld"), "일반지도 장은 VWorld 표기");
  assert.ok(!plainXml.includes("OpenStreetMap"));
}

// ── 테마: 보드가 고른 테마의 바탕색 ──
{
  const plan = tilePlan("A04", vectorModel, "theme");
  const bgOf = async (baseTheme) => {
    const { xml: [xml] } = await slidesOf([plan], {}, { basemap: "vector", ...(baseTheme ? { baseTheme } : {}) });
    const bg = spBlocks(xml).find((b) => b.includes("GRP|map-base-bg|"));
    return bg.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/)[1].toUpperCase();
  };
  assert.equal(await bgOf("cool"), BASE_THEMES.cool.bg.slice(1).toUpperCase());
  assert.equal(await bgOf("paper"), BASE_THEMES.paper.bg.slice(1).toUpperCase());
  assert.equal(await bgOf(undefined), BASE_THEMES.warm.bg.slice(1).toUpperCase(), "기본 테마");
}

// ── 보고서 프레임 바탕: 화면·PPT가 같은 함수 ──
{
  assert.equal(frameBasemap({ basemap: "base" }, { base }), "vector");
  assert.equal(frameBasemap({ basemap: "base" }, { base: roadless }), "Base", "도로 맥락 없는 바탕은 VWorld 기본 지도");
  assert.equal(frameBasemap({ basemap: "base" }, {}), "Base");
  assert.equal(frameBasemap({ basemap: "road" }, { base }), "Base");
  assert.equal(frameBasemap({ basemap: "air" }, { base }), "Satellite");
  assert.equal(frameBasemap({ basemap: "none" }, { base }), "white");
  // PPT 경로: 프레임 base + 쓸 수 있는 바탕 -> 벡터 도형, 프레임 air -> 바탕 도형 없음
  const baseFrame = tilePlan("A04", vectorModel, "frame-base", { page: framePage("base") });
  const airFrame = tilePlan("A04", vectorModel, "frame-air", { page: framePage("air") });
  const { xml: [baseXml, airXml] } = await slidesOf([baseFrame, { ...airFrame, no: 2, total: 2 }], { [key(airFrame)]: JPEG }, { basemap: "white" });
  assert.ok(baseXml.includes("GRP|map-base-building|"), "프레임 base는 보드 선택(white)과 상관없이 벡터");
  assert.ok(!airXml.includes("GRP|map-base-"), "프레임 air는 벡터 바탕 없음");
  // 화면(slide-surface)·그림(map-image)·드로어가 같은 함수를 쓴다
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../../components/v2/report/slide-surface.tsx"), /frameBasemap\(/);
  assert.match(read("../../lib/v2/report/map-image.ts"), /exportBasemap\(|frameBasemap\(/);
  assert.ok(!/function frameLayer/.test(read("../../lib/v2/report/map-image.ts")), "PPT 쪽 따로 만든 frameLayer 제거");
  assert.match(read("../../components/v2/report/drawer-map.tsx"), /aria-disabled/);
}

// ── 내보내기 바탕 결정(carried): 바탕 없는 모델이 vector를 받아도 빈 격자가 아니라 VWorld 흰 지도 ──
{
  assert.equal(effectiveLayer({}, "vector"), "white");
  assert.equal(effectiveLayer({ base }, "vector"), "vector");
  assert.equal(effectiveLayer({ base }, "Base"), "Base");
  assert.equal(effectiveLayer({ basemap: "Satellite", base }, "vector"), "Satellite");
  assert.equal(effectiveLayer({ base }), resolveBasemap({ base }));
  const requested = [];
  const plain = modelOf("S02", { analysisId: "qa" });
  tileSvg({ ...viewFor("S02", plain, "tile-img"), tileType: "simulation" }, { width: 1600, height: 1200, layer: "vector", tileHref: (url) => { requested.push(url); return PNG; } });
  assert.ok(requested.length > 0 && requested.every((u) => /white/i.test(u)), `바탕 없는 모델은 흰 타일 요청: ${requested.slice(0, 2)}`);
  requested.length = 0;
  tileSvg({ ...viewFor("S02", { ...plain, base }, "tile-img-v"), tileType: "simulation" }, { width: 1600, height: 1200, layer: "vector", tileHref: (url) => { requested.push(url); return PNG; } });
  assert.equal(requested.length, 0, "벡터 바탕은 타일을 요청하지 않는다");
}

// ── 투명 그림(값 래스터용): 바탕색·격자·벡터 바탕을 그리지 않는다 ──
{
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
  const props = { model: vectorModel, width: 960, height: 540, fixed: true, layer: "vector", basemap: "none", legend: false, north: false, credit: false };
  const opaque = renderToStaticMarkup(React.createElement(MapFigure, props));
  const clear = renderToStaticMarkup(React.createElement(MapFigure, { ...props, transparent: true }));
  assert.ok(opaque.includes('data-map-base="vector"') && opaque.includes(`fill="${BASE_THEMES.warm.bg}"`), "기본은 바탕 그림");
  assert.ok(!clear.includes("data-map-base") && !clear.includes(`fill="${BASE_THEMES.warm.bg}"`), "transparent는 바탕·바탕색 없음");
  const cool = renderToStaticMarkup(React.createElement(MapFigure, { ...props, baseTheme: "cool" }));
  assert.ok(cool.includes(`fill="${BASE_THEMES.cool.bg}"`), "그림도 보드 테마를 따른다");
}

console.log("test-v2-ppt-vector-basemap: ok");
