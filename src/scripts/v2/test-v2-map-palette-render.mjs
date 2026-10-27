/**
 * 모델에 실린 팔레트·바탕 테마·바탕 숨김이 화면 SVG·PPT 도형·범례에 그대로 나타난다.
 * 모델에 아무것도 없으면 기존 출력과 같다(기본값 불변).
 */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";
import JSZip from "jszip";

globalThis.React = React;

const { toUtmk } = await import("../../lib/v2/crs.ts");
const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { mapBaseFromScene } = await import("../../lib/v2/ui/basemap.ts");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { paletteColors } = await import("../../lib/v2/ui/map-palette.ts");
const { LAYER_STYLES } = await import("../../lib/v2/ui/map-layers.ts");
const { BASE_THEMES } = await import("../../lib/v2/ui/map-theme.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");

// ── 손 장면(test-v2-ppt-vector-basemap.mjs와 같은 모양) ──
const ORIGIN_LNG = 127.0636;
const ORIGIN_LAT = 37.4979;
const [ox, oy] = toUtmk([ORIGIN_LNG, ORIGIN_LAT]);
const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
const scene = {
  version: "v2-scene@2", analysisId: "a-palette-render", manifestHash: "h",
  origin: { epsg: "EPSG:5179", x: ox, y: oy, lng: ORIGIN_LNG, lat: ORIGIN_LAT },
  radiusM: 500, ground: { kind: "flat" }, site: null,
  buildings: Array.from({ length: 12 }, (_, i) => ({
    id: `b${i}`, name: null, sublabel: null, labelPriority: 0,
    rings: [box(-300 + (i % 4) * 60, -200 + Math.floor(i / 4) * 50, 30, 25)],
    baseZ: null, heightM: 9, heightMethod: "source", floorsAbove: 3, useCode: null, approvalDate: null,
  })),
  parcels: [0, 1, 2].map((i) => ({ pnu: `p${i}`, rings: [box(-100 + i * 40, 40, 36, 36)], jimok: null, areaM2: 1000, isSite: i === 0 })),
  context: {
    roads: [
      { points: line(-450, -60, 450, -60), widthM: 20, hierarchy: "간선", name: "테헤란로" },
      { points: line(-450, 120, 450, 140), widthM: 10, hierarchy: "집산", name: "도곡로77길" },
    ],
    green: [[box(-400, -400, 120, 100)], [box(250, 200, 100, 100)]],
    greenKinds: ["forest", "park"],
    water: [[box(300, -380, 120, 60)]],
    rail: [], stations: [],
    places: [{ name: "역삼동", kind: "dong", x: 60, y: -300 }, { name: "개나리공원", kind: "park", x: -100, y: 220 }],
  },
  counts: { buildingsTotal: 12, buildingsIncluded: 12, parcelsTotal: 3, parcelsIncluded: 3 },
  sources: [], limitations: [],
};
const base = mapBaseFromScene(scene);

const fixture = toTileView(GODEOK_RESULTS.find((r) => r.tileCode === "A01"));
const ring = [[ORIGIN_LNG - 0.0015, ORIGIN_LAT - 0.0012], [ORIGIN_LNG + 0.0015, ORIGIN_LAT - 0.0012], [ORIGIN_LNG + 0.0015, ORIGIN_LAT + 0.0012], [ORIGIN_LNG - 0.0015, ORIGIN_LAT - 0.0012]];
const modelOf = (extra = {}) => ({
  center: [ORIGIN_LNG, ORIGIN_LAT], radiusM: 500, total: 1, notes: [], tileCode: "D03", base,
  features: [{ layer: "bus_stop", fid: "bus", lng: ORIGIN_LNG + 0.0004, lat: ORIGIN_LAT + 0.0003, name: "정류장", label: "정류장", labelPriority: 1 }],
  lines: [], polygons: [{ layer: "use:주거", fid: "p1", rings: [ring] }], ...extra,
});
const viewFor = (code, map, suffix) => ({ ...fixture, tileId: suffix, code, title: `${code} 팔레트`, tileType: "analysis", hasFace: false, map, backdrop: map });
const tilePlan = (map, suffix) => ({
  kind: "tile", view: viewFor("D03", map, suffix), body: { kind: "result", face: "single" }, faceLabel: null, map, muted: false, pinnedKeys: [],
  footer: "출처 구조 회귀 fixture · 기준일 2026-10-14", no: 1, total: 1,
});
async function slideXml(plan) {
  const zip = await JSZip.loadAsync(await renderReportPptx([plan], {}, { basemap: "vector" }));
  return zip.file("ppt/slides/slide1.xml").async("string");
}
const spBlocks = (xml) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
const named = (xml, re) => spBlocks(xml).filter((b) => re.test(b.match(/name="([^"]*)"/)?.[1] ?? ""));
const fillOf = (block) => block.match(/<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"/)?.[1]?.toUpperCase();
const svgOf = (model, props = {}) => renderToStaticMarkup(createElement(MapFigure, { model, width: 800, height: 500, fixed: true, layer: "vector", ...props }));
const polyFill = (svg) => svg.match(/<path[^>]*data-poly="true"[^>]*? fill="(#[0-9a-fA-F]{6})"/)?.[1]?.toLowerCase();

const original = (LAYER_STYLES["use:주거"].fill ?? LAYER_STYLES["use:주거"].color).toLowerCase();
const vivid = paletteColors("vivid").cat[0].toLowerCase();
assert.equal(vivid, "#f2a900");
assert.notEqual(original, vivid);

// ── 화면: 팔레트가 지물 fill과 범례에 ──
{
  assert.equal(polyFill(svgOf(modelOf())), original, "팔레트가 없으면 원래 색");
  assert.equal(polyFill(svgOf(modelOf({ palette: "app" }))), original, "app도 원래 색");
  const svg = svgOf(modelOf({ palette: "vivid" }));
  assert.equal(polyFill(svg), vivid, "vivid 지물 fill");
  assert.ok(!svg.toLowerCase().includes(original) || original === "#ffffff", "원래 주거 색이 남지 않음");
  const mine = svgOf(modelOf({ palette: { name: "내 색", colors: paletteColors("vivid") } }));
  assert.equal(polyFill(mine), vivid, "만든 팔레트도 같은 경로");
}

// ── 화면: 바탕 테마와 반경 원 ──
{
  const light = svgOf(modelOf());
  const lightRing = [...light.matchAll(/<circle[^>]*fill="none" stroke="(#[0-9a-fA-F]{6})"[^>]*stroke-opacity="0.75"/g)].map((m) => m[1].toLowerCase());
  assert.deepEqual(lightRing, ["#16181d"], "밝은 테마의 반경 원은 잉크색 그대로");
  assert.match(svgOf(modelOf(), { baseTheme: "ink" }), /fill="#22252a"|#22252A/i, "prop 테마");
  const ink = svgOf(modelOf({ baseTheme: "ink" }));
  assert.ok(/#22252a/i.test(ink), "model.baseTheme ink 바탕색");
  assert.ok(/stroke="#cfcfcf"/i.test(ink), "ink 반경 원");
  // 우선순위: 모델 > prop
  const both = svgOf(modelOf({ baseTheme: "ink" }), { baseTheme: "cool" });
  assert.ok(/#22252a/i.test(both) && !/#f2f3f5/i.test(both), "model.baseTheme이 prop보다 앞");
  const custom = { name: "내 바탕", colors: { bg: "#102030", building: "#203040", parcel: "#304050", road: "#405060", green: "#506070", water: "#607080", site: "#ffcc00" } };
  const mine = svgOf(modelOf({ baseTheme: custom }));
  assert.ok(/#102030/i.test(mine), "만든 바탕색");
  assert.ok(/stroke="#cfcfcf"/i.test(mine), "어두운 만든 색 → 밝은 반경 원");
  const otherCustom = svgOf(modelOf({ baseTheme: { ...custom, colors: { ...custom.colors, bg: "#0a0b0c", water: "#112233" } } }));
  assert.ok(/#0a0b0c/i.test(otherCustom) && !/#102030/i.test(otherCustom), "만든 색이 바뀌면 바탕 캐시도 새로 계산");
}

// ── 화면·장면: 바탕 숨김 ──
{
  const hide = modelOf({ baseHide: ["parcel", "road"] });
  const built = buildMapScene({ model: hide, width: 800, height: 500, activeLayer: "vector" });
  const layers = new Set(built.base.buckets.map((b) => b.layer));
  assert.ok(!layers.has("parcel") && !layers.has("road"), `숨긴 층 없음: ${[...layers]}`);
  assert.ok(layers.has("building") && layers.has("water") && layers.has("green"), "나머지 층은 그대로");
  assert.ok(!built.base.labels.some((l) => l.kind === "road"), "도로명 라벨 없음");
  const shown = buildMapScene({ model: modelOf(), width: 800, height: 500, activeLayer: "vector" });
  assert.ok(shown.base.labels.some((l) => l.kind === "road"), "숨기지 않으면 도로명 라벨 있음");
  assert.ok(shown.base.labels.some((l) => l.kind === "park"), "숨기지 않으면 공원 라벨 있음");
  const noGreen = buildMapScene({ model: modelOf({ baseHide: ["green"] }), width: 800, height: 500, activeLayer: "vector" });
  assert.ok(!noGreen.base.buckets.some((b) => b.layer === "green"), "녹지 층 없음");
  assert.ok(!noGreen.base.labels.some((l) => l.kind === "park"), "공원 라벨 없음");
  assert.ok(noGreen.base.labels.some((l) => l.kind === "road"), "도로명 라벨은 남음");
  const svg = svgOf(hide);
  assert.ok(!svg.includes('data-map-base-layer="road"') && !svg.includes('data-map-base-layer="parcel"'), "화면 SVG에 숨긴 층 없음");
  assert.ok(svg.includes('data-map-base-layer="building"'), "화면 SVG에 나머지 층");
  // 타일 고정 숨김(D13 road)과 합쳐진다
  const d13 = buildMapScene({ model: modelOf({ tileCode: "D13", baseHide: ["parcel"] }), width: 800, height: 500, activeLayer: "vector" });
  assert.ok(!d13.base.buckets.some((b) => b.layer === "road" || b.layer === "parcel"), "BASE_SUPPRESS와 baseHide의 합");
}

// ── PPT: 팔레트 ──
{
  const baseline = await slideXml(tilePlan(modelOf(), "plain"));
  const origHex = original.slice(1).toUpperCase();
  assert.ok(named(baseline, /map-D03-.*주거/).some((b) => fillOf(b) === origHex), "팔레트 없음 → 원래 색 도형");

  const xml = await slideXml(tilePlan(modelOf({ palette: "vivid" }), "vivid"));
  const shapes = named(xml, /map-D03-.*주거/);
  assert.ok(shapes.length >= 1, `주거 지물 도형 ${shapes.length}`);
  assert.ok(shapes.some((b) => fillOf(b) === "F2A900"), "지물 도형 fill F2A900");
  assert.ok(!shapes.some((b) => fillOf(b) === origHex), "원래 색 지물 도형이 남지 않음");
  // 오른쪽 범례 판의 견본: 지물 도형 말고도 같은 색 칠이 하나 더 있다.
  const hexCount = (s, hex) => (s.match(new RegExp(`srgbClr val="${hex}"`, "g")) ?? []).length;
  assert.ok(hexCount(xml, "F2A900") >= 2, `범례 견본도 F2A900 (${hexCount(xml, "F2A900")})`);
  assert.equal(hexCount(xml, origHex), 0, "원래 주거 색이 슬라이드에 남지 않음");
  assert.ok(hexCount(baseline, origHex) >= 2, "팔레트 없으면 지물·범례가 원래 색");

  // 조판 칸
  const sheet = {
    kind: "sheet", view: { ...fixture, tileId: "sheet", code: "SHEET", title: "조판", tileType: "stack", map: null }, grid: "2x2",
    cells: [{ view: viewFor("D03", modelOf({ palette: "vivid", baseTheme: "ink" }), "c0"), face: "front", mapKey: "c0", pinnedKeys: [] }],
    footer: "조판 · 기준일 2026-10-14", no: 1, total: 1,
  };
  const sheetZip = await JSZip.loadAsync(await renderReportPptx([sheet], {}, { basemap: "vector" }));
  const cellXml = await sheetZip.file("ppt/slides/slide1.xml").async("string");
  const cellShapes = named(cellXml, /map-cell-0-D03-.*주거/);
  assert.ok(cellShapes.some((b) => fillOf(b) === "F2A900"), "조판 칸 도형에도 팔레트");
  const cellBg = named(cellXml, /map-cell-0-base-bg/);
  assert.equal(fillOf(cellBg[0]), "22252A", "조판 칸 바탕색도 모델 테마");
}

// ── PPT: 바탕 테마 ──
{
  const xml = await slideXml(tilePlan(modelOf({ baseTheme: "ink" }), "ink"));
  const bg = named(xml, /map-base-bg/);
  assert.equal(bg.length, 1);
  assert.equal(fillOf(bg[0]), "22252A", "ink 바탕색");
  const rings = named(xml, /map-D03-radius/);
  assert.ok(rings.length >= 1);
  for (const r of rings) assert.ok(r.includes('val="CFCFCF"'), `반경 원 CFCFCF: ${r.match(/name="([^"]*)"/)[1]}`);
  const light = await slideXml(tilePlan(modelOf(), "light"));
  assert.equal(fillOf(named(light, /map-base-bg/)[0]), BASE_THEMES.warm.bg.slice(1).toUpperCase(), "기본 바탕색");
  assert.ok(named(light, /map-D03-radius/).length >= 1);
  for (const r of named(light, /map-D03-radius/)) assert.ok(r.includes('val="16181D"'), "밝은 테마 반경 원 그대로");

  const custom = { name: "내 바탕", colors: { bg: "#102030", building: "#203040", parcel: "#304050", road: "#405060", green: "#506070", water: "#607080", site: "#ffcc00" } };
  const mine = await slideXml(tilePlan(modelOf({ baseTheme: custom }), "custom"));
  assert.equal(fillOf(named(mine, /map-base-bg/)[0]), "102030", "만든 바탕색");
  // 대지 표식은 테마 site 색을 따른다(모델 테마 기준). 이 모델은 필지 대지가 없어 십자 표식이라 화면 쪽 site 색만 확인한다.
  assert.ok(svgOf(modelOf({ baseTheme: "ink", siteParcel: [{ layer: "site_parcel", fid: "s", rings: [ring] }] })).includes(BASE_THEMES.ink.site.fill), "화면 대지 표식이 모델 테마 색");
}

// ── PPT: 바탕 숨김 ──
{
  const xml = await slideXml(tilePlan(modelOf({ baseHide: ["parcel", "road"] }), "hide"));
  assert.equal(named(xml, /map-base-parcel/).length, 0, "필지선 도형 없음");
  assert.equal(named(xml, /map-base-road/).length, 0, "도로 도형 없음");
  assert.ok(named(xml, /map-base-building/).length >= 1, "건물 도형은 남음");
  assert.ok(!xml.includes("<a:t>테헤란로</a:t>"), "도로명 라벨 없음");
  const green = await slideXml(tilePlan(modelOf({ baseHide: ["green"] }), "hide-green"));
  assert.equal(named(green, /map-base-green/).length, 0);
  assert.ok(!green.includes("<a:t>개나리공원</a:t>"), "공원 라벨 없음");
  const shown = await slideXml(tilePlan(modelOf(), "shown"));
  assert.ok(shown.includes("<a:t>개나리공원</a:t>") && shown.includes("<a:t>테헤란로</a:t>"), "숨기지 않으면 라벨 있음");
}

console.log("map palette render: ok");
