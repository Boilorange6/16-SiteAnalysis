/** §9-12 주제 레이어 톤: 떨어진 면(외곽선 없음·25 %) / 구역 면(흰 1.7u·30 %). 분류, 화면 SVG, 우선순위, 위성, PPT. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;

const { POLYGON_TONES, polygonTone, polygonPaint, layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const { addEditableMap } = await import("../../lib/v2/report/map-pptx.ts");
const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");

// 값
assert.deepEqual(POLYGON_TONES, { separate: { fillOpacity: 0.25, stroke: null, strokeWidth: 0 }, zone: { fillOpacity: 0.3, stroke: "#ffffff", strokeWidth: 1.7 } });

// 분류
for (const l of ["use:주거", "floors_5_8", "bldg_1990s", "tall_ge35", "low_le12", "building"]) assert.equal(polygonTone(l), "separate", l);
for (const l of ["zone:주거", "district:지구단위계획", "facility:교통", "jimok:대", "lot_lt100", "block_lt05", "maint_stage:조합"]) assert.equal(polygonTone(l), "zone", l);
// 스타일이 fillOpacity·stroke·strokeWidth·dash·hatch를 직접 정하면 지금 값 그대로(null)
for (const l of ["use:미상", "maint_area:모아타운", "maint_stage:정비계획", "school_zone_elem", "park", "trade_district_q1", "dens_0", "block_open", "svf_building", "sun_face", "topo_coverage", "parcel_picker"]) assert.equal(polygonTone(l), null, l);

// polygonPaint
assert.deepEqual(polygonPaint("use:주거", layerStyle("use:주거"), false), { fillOpacity: 0.25, stroke: null, strokeWidth: 0 });
assert.deepEqual(polygonPaint("zone:주거", layerStyle("zone:주거"), false), { fillOpacity: 0.3, stroke: "#ffffff", strokeWidth: 1.7 });
assert.deepEqual(polygonPaint("use:주거", layerStyle("use:주거"), true), { fillOpacity: 0.45, stroke: null, strokeWidth: 0 }, "위성은 채움만 0.45");
assert.deepEqual(polygonPaint("zone:주거", layerStyle("zone:주거"), true), { fillOpacity: 0.45, stroke: "#ffffff", strokeWidth: 1.7 });
const park = layerStyle("park");
assert.deepEqual(polygonPaint("park", park, false), { fillOpacity: park.fillOpacity, stroke: park.stroke, strokeWidth: park.strokeWidth }, "예외 레이어는 지금 값");
const moa = layerStyle("maint_area:모아타운");
assert.deepEqual(polygonPaint("maint_area:모아타운", moa, true), { fillOpacity: moa.fillOpacity, stroke: moa.stroke, strokeWidth: moa.strokeWidth });
// 톤이 null이면 지금 식(채움 style ?? 0.35/0.45, 선 style.stroke ?? color · strokeWidth ?? 1)
assert.deepEqual(polygonPaint("park", { label: "x", color: "#123456" }, false), { fillOpacity: 0.35, stroke: "#123456", strokeWidth: 1 });
assert.deepEqual(polygonPaint("park", { label: "x", color: "#123456" }, true), { fillOpacity: 0.45, stroke: "#123456", strokeWidth: 1 });

// 추정 면(estimated): 선은 옛 값(점선·색 유지), 채움 투명도만 톤
const tallEst = layerStyle("tall_ge35_est");
assert.deepEqual(polygonPaint("tall_ge35_est", tallEst, false, true), { fillOpacity: 0.25, stroke: tallEst.color, strokeWidth: 1 }, "추정 + 떨어진 면: 선 옛 값, 채움 0.25");
assert.deepEqual(polygonPaint("tall_ge35_est", tallEst, true, true), { fillOpacity: 0.45, stroke: tallEst.color, strokeWidth: 1 }, "추정 위성: 채움 0.45");
assert.deepEqual(polygonPaint("tall_ge35_est", tallEst, false), { fillOpacity: 0.25, stroke: null, strokeWidth: 0 }, "추정이 아니면 톤 그대로");

// svg
const CENTER = [127.1505, 37.6205];
const ring = (dx) => [[127.15 + dx, 37.62], [127.151 + dx, 37.62], [127.151 + dx, 37.621], [127.15 + dx, 37.621], [127.15 + dx, 37.62]];
const model = {
  center: CENTER, radiusM: 500, features: [], total: 2, notes: [],
  polygons: [
    { layer: "use:주거", rings: [ring(0)], label: null },
    { layer: "zone:주거", rings: [ring(0.002)], label: null },
    { layer: "floors_assumed_1f_est", rings: [ring(0.004)], label: null },
  ],
  polygonsTotal: 3,
};
const render = (props = {}, m = model) => renderToStaticMarkup(createElement(MapFigure, { model: m, width: 800, height: 500, basemap: "none", fixed: true, ...props }));
const poly = (svg, layer) => (svg.match(/<path[^>]*data-poly[^>]*>/g) ?? []).find((p) => p.includes(`data-map-layer="${layer}"`));
{
  const svg = render();
  const use = poly(svg, "use:주거");
  const zone = poly(svg, "zone:주거");
  assert.match(use, /fill-opacity="0\.25"/);
  assert.match(use, /stroke="none"/);
  assert.match(zone, /fill-opacity="0\.3"/);
  assert.match(zone, /stroke="#ffffff"/);
  const u = Number(/stroke-width="([\d.]+)"/.exec(zone)[1]) / 1.7;
  assert.ok(u >= 1 && u <= 1.5, `구역 면 선 굵기는 1.7u (u=${u})`);
  // 추정 면: 빗금 채움이 톤보다 먼저, 빗금 칸 바탕은 톤 투명도
  const est = poly(svg, "floors_assumed_1f_est");
  assert.match(est, /fill="url\(#hatch[^)]*\)"/);
  assert.doesNotMatch(est, /stroke="none"/, "추정 면은 선을 유지(§8-1)");
  assert.match(est, /stroke="#B9BDC6"/i);
  assert.match(svg, /<pattern[^>]*>\s*<rect[^>]*fill-opacity="0\.25"/, "빗금 칸 바탕은 떨어진 면 25 %");
}
// states: 범례 강조 중인 zone 면 → INK 선, 선택 → 파랑 띠는 유지(고르기는 별도), 흐림
{
  const svg = render({ highlightLabel: "주거지역" });
  const zone = poly(svg, "zone:주거");
  assert.doesNotMatch(zone, /stroke="#ffffff"/, "강조하면 흰 선이 아니다");
  assert.match(zone, /stroke="#[0-9a-fA-F]{6}"/);
  assert.match(zone, /stroke-width="[\d.]+"/);
  const dimmedUse = poly(svg, "use:주거");
  assert.match(dimmedUse, /opacity="0\.2"/, "강조 밖은 흐림");
}
// 위성 바탕: 채움 0.45
{
  const svg = render({ layer: "Satellite" });
  assert.match(poly(svg, "use:주거"), /fill-opacity="0\.45"/);
  assert.match(poly(svg, "use:주거"), /stroke="none"/);
  assert.match(poly(svg, "zone:주거"), /fill-opacity="0\.45"/);
  assert.match(poly(svg, "zone:주거"), /stroke="#ffffff"/);
}

// pptx
{
  const calls = [];
  const slide = new Proxy({}, { get: (_, method) => (...args) => { calls.push({ method: String(method), args }); } });
  const source = GODEOK_RESULTS[0];
  const plan = buildReportPlan({
    summary: toSummaryView(GODEOK_SUMMARY, [source]),
    views: new Map([[source.tileId, toTileView(source)]]),
    board: initBoard([source]),
    analysisDate: "2026-10-29",
  }).find((s) => s.kind === "tile" && s.map);
  assert.ok(plan, "PPT 검증용 지도 장");
  const [lng, lat] = plan.map.center;
  const sq = (dx) => [[lng + dx, lat], [lng + dx + 0.001, lat], [lng + dx + 0.001, lat + 0.001], [lng + dx, lat + 0.001], [lng + dx, lat]];
  const map = { ...plan.map, polygons: [{ layer: "use:주거", rings: [sq(-0.002)], label: null }, { layer: "zone:주거", rings: [sq(0.0005)], label: null }, { layer: "tall_ge35_est", rings: [sq(0.003)], label: null }] };
  addEditableMap(slide, plan, map, { style: plan.style, format: "wide", reportFrame: defaultFrame() });
  const shapes = calls.filter((c) => c.method === "addShape" && c.args[0] === "custGeom");
  const named = (display) => shapes.find((c) => String(c.args[1].objectName).split("|")[2] === `범례 ${display}`)?.args[1];
  const use = named("주거");
  const zone = named("주거지역");
  assert.ok(use && zone, "두 면 도형");
  assert.equal(use.line.transparency, 100, "떨어진 면은 선 없음");
  assert.equal(use.fill.transparency, 75, "채움 25 % → 투명도 75");
  assert.equal(String(zone.line.color).toUpperCase(), "FFFFFF", "구역 면은 흰 선");
  assert.equal(zone.line.transparency, 0);
  assert.ok(zone.line.width > 0.1, "선 굵기");
  assert.equal(zone.fill.transparency, 70, "채움 30 % → 투명도 70");
  const est = shapes.map((c) => c.args[1]).find((o) => String(o.objectName).split("|")[2] === `범례 ${layerStyle("tall_ge35_est").label}`);
  assert.ok(est, "추정 면 도형");
  assert.ok(est.line.transparency < 100, "추정 면은 선이 보인다(PPT에는 빗금이 없다)");
  assert.equal(est.line.dashType, "dash", "점선");
  assert.equal(String(est.line.color).toUpperCase(), "AA4465");
  assert.equal(est.fill.transparency, 75, "추정 면도 채움은 떨어진 면 25 %");
}

console.log("test-v2-polygon-tone: ok");
