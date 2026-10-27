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
async function slideXml(plan, options = {}) {
  const zip = await JSZip.loadAsync(await renderReportPptx([plan], {}, { basemap: "vector", ...options }));
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
  // 범례 판(GRP|panel-legend)의 견본: 항목 글자 도형 바로 앞 도형이 견본이다.
  const legendSwatch = (slide, label) => {
    const blocks = spBlocks(slide);
    const at = blocks.findIndex((b) => b.includes("GRP|panel-legend|") && b.match(/<a:t>([^<]*)/)?.[1] === label);
    assert.ok(at > 0, `범례 항목 "${label}"`);
    assert.ok(blocks[at - 1].includes("GRP|panel-legend|"), "견본도 범례 판 도형");
    return fillOf(blocks[at - 1]);
  };
  assert.equal(legendSwatch(xml, "주거"), "F2A900", "범례 견본도 F2A900");
  assert.equal(legendSwatch(baseline, "주거"), origHex, "팔레트 없으면 범례 견본은 원래 색");
  assert.notEqual(legendSwatch(xml, "버스정류장"), "F2A900", "다른 항목 견본은 그대로");
  assert.ok(!xml.includes(`srgbClr val="${origHex}"`), "원래 주거 색이 슬라이드에 남지 않음");

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
  const mineRings = named(mine, /map-D03-radius/);
  assert.ok(mineRings.length >= 1, "어두운 만든 바탕의 반경 원 도형이 있다");
  for (const r of mineRings) assert.ok(r.includes('val="CFCFCF"'), "어두운 만든 바탕의 PPT 반경 원은 CFCFCF");

  // 최근접 지시선: 어두운 바탕에서는 고리 색(잉크색은 먹 바탕에서 1.1:1이라 안 보인다), 밝은 바탕은 그대로.
  const nearest = { layer: "bus_stop", fid: "near", lng: ORIGIN_LNG + 0.0004, lat: ORIGIN_LAT + 0.0003, name: "가까운 정류장", label: "가까운 정류장", labelPriority: 1, highlight: true, distanceM: 60 };
  const nearestLines = (xml) => named(xml, /map-D03-nearest-.*최근접 지시선|map-D03-nearest-/);
  const inkNearest = nearestLines(await slideXml(tilePlan(modelOf({ baseTheme: "ink", features: [nearest] }), "near-ink")));
  assert.ok(inkNearest.length >= 1, "최근접 지시선 도형이 있다");
  for (const b of inkNearest) assert.ok(b.includes('val="CFCFCF"') && !b.includes('val="16181D"'), "ink 바탕의 최근접 지시선은 고리 색");
  const lightNearest = nearestLines(await slideXml(tilePlan(modelOf({ features: [nearest] }), "near-light")));
  assert.ok(lightNearest.length >= 1);
  for (const b of lightNearest) assert.ok(b.includes('val="16181D"'), "밝은 바탕의 최근접 지시선은 그대로");
  const figNearest = (model) => svgOf(model).match(/<line [^>]*stroke-dasharray[^>]*>/g) ?? [];
  assert.ok(figNearest(modelOf({ baseTheme: "ink", features: [nearest] })).some((l) => l.includes('stroke="#cfcfcf"')), "화면 ink 바탕 최근접 지시선도 고리 색");
  assert.ok(figNearest(modelOf({ features: [nearest] })).some((l) => l.includes('stroke="#16181d"')), "화면 밝은 바탕 최근접 지시선은 그대로");
  // 대지 표식(addSite): 모델 테마가 옵션 테마보다 앞. 필지 대지가 있어야 테마색 면이 그려진다.
  const siteOf = (xml) => named(xml, /map-D03-site\|분석 대지\|outline/)[0];
  const withSite = (extra) => modelOf({ siteParcel: [{ layer: "site_parcel", fid: "s", rings: [ring] }], ...extra });
  const modelWins = siteOf(await slideXml(tilePlan(withSite({ baseTheme: "ink" }), "site-model"), { baseTheme: "sand" }));
  assert.equal(fillOf(modelWins), BASE_THEMES.ink.site.fill.slice(1).toUpperCase(), "모델 테마(ink)의 대지 면색이 옵션(sand)보다 앞");
  assert.ok(modelWins.includes(`val="${BASE_THEMES.ink.site.line.slice(1).toUpperCase()}"`), "모델 테마의 대지 선색");
  const optionOnly = siteOf(await slideXml(tilePlan(withSite({}), "site-option"), { baseTheme: "sand" }));
  assert.equal(fillOf(optionOnly), BASE_THEMES.sand.site.fill.slice(1).toUpperCase(), "모델 테마가 없으면 옵션 테마");
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

// ── A05 설명선: 준공 연대 점·범례 견본도 팔레트를 따른다(D04 면과 같은 bldg_* 칸) ──
{
  const C = await import("../../lib/v2/ui/callout-layout.ts");
  const O = await import("../../lib/v2/ui/overlay-layout.ts");
  const { calloutForA05 } = await import("../../lib/v2/tile/a05/view.ts");
  const { withCalloutPalette } = await import("../../lib/v2/ui/tile-view.ts");
  const { paletteLayerStyle } = await import("../../lib/v2/ui/map-palette.ts");
  const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
  const result = {
    status: "complete",
    conditions: { center: [127, 37], radiusM: 800, analysisDate: "2026-09-30" },
    metrics: [],
    presentation: { features: [
      { layer: "apt", lng: 127, lat: 37, name: "옛 단지", households: 300, approvalYear: 1975 },
      { layer: "apt", lng: 127.001, lat: 37, name: "새 단지", households: 200, approvalYear: 2022 },
      { layer: "apt", lng: 127.002, lat: 37, name: "미상 단지", households: 100, approvalYear: null },
    ] },
  };
  const app = calloutForA05(result, "출처");
  const [old, fresh, unknown] = app.complexes;
  const want = (layer, palette) => paletteLayerStyle(layer, layerStyle(layer), palette).color;
  const swatch = (model, label) => model.legend.items.find((item) => item.label === label).color;

  // 팔레트가 없으면 오늘 색 그대로, 모델도 같은 객체
  assert.equal(C.dotColor(old), layerStyle("bldg_pre1980").color);
  assert.equal(C.dotColor(old, "app"), layerStyle("bldg_pre1980").color);
  assert.equal(C.decadeColor(1975), layerStyle("bldg_pre1980").color);
  assert.equal(withCalloutPalette(app, undefined), app, "팔레트 없음 → 같은 모델");
  assert.equal(C.paletteCalloutLegend(C.STOCK_LEGEND), C.STOCK_LEGEND);
  assert.equal(swatch(app, "1970년대 이전"), layerStyle("bldg_pre1980").color);

  // vivid: 점 색 = 범례 견본 = 팔레트가 정한 bldg_* 색
  const vividOld = want("bldg_pre1980", "vivid");
  const vividNew = want("bldg_2020s", "vivid");
  assert.notEqual(vividOld, layerStyle("bldg_pre1980").color, "팔레트가 실제로 색을 바꾼다");
  assert.equal(C.dotColor(old, "vivid"), vividOld, "1970년대 이전 점");
  assert.equal(C.dotColor(fresh, "vivid"), vividNew, "2020년 이후 점");
  assert.equal(C.dotColor(unknown, "vivid"), layerStyle("bldg_unknown").color, "미상은 팔레트 대상이 아님");
  const painted = withCalloutPalette(app, "vivid");
  assert.equal(painted.palette, "vivid");
  assert.equal(swatch(painted, "1970년대 이전"), vividOld, "범례 견본 = 점 색");
  assert.equal(swatch(painted, "2020년 이후"), vividNew);
  assert.equal(swatch(painted, "미상"), layerStyle("bldg_unknown").color);
  assert.equal(swatch(app, "1970년대 이전"), layerStyle("bldg_pre1980").color, "원래 모델은 바뀌지 않음(불변)");
  // 범례 활성(색 일치), 좁은 범례, 띠 카드, 보고서 범례 항목이 같은 색을 쓴다
  assert.ok(C.calloutLegendMatches(old, vividOld, "vivid") && !C.calloutLegendMatches(fresh, vividOld, "vivid"));
  assert.deepEqual(C.compactCalloutLegend(painted.legend, painted.complexes, 3, "vivid").map((i) => i.color).sort(), [vividOld, vividNew, layerStyle("bldg_unknown").color].sort());
  assert.deepEqual(C.stripCards(painted.complexes, 2026, "vivid").map((c) => c.color), [vividOld, vividNew, layerStyle("bldg_unknown").color]);
  const entries = O.calloutLegendEntries(painted);
  assert.equal(entries.find((e) => e.text === "1970년대 이전").color, vividOld, "보고서 범례 견본");
  // 만든 팔레트도 같은 경로
  const mine = { name: "내 색", colors: paletteColors("vivid") };
  assert.equal(C.dotColor(old, mine), vividOld);
  // A06 입주 시기 점은 팔레트와 무관
  const supplyDot = C.dotColor({ ...old, supply: { timing: "past" } }, "vivid");
  assert.equal(supplyDot, C.TIMING_STYLE.past.color);
}

console.log("map palette render: ok");
