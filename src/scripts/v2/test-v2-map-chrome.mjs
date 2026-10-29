/** §9-12 지도 부속(방위표 A형·축척 막대 134/12 px) 계약: 장면 값 하나를 화면과 PPT가 같이 쓴다. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;

const { NORTH_RADIUS, NORTH_INSET, NORTH_GLYPH, SCALE_MAX_PX, SCALE_FONT_PX, SCALE_PT_TO_PX, buildMapScene, northArrowBox, scaleBarBox, scaleFontScaleForPt } = await import("../../lib/v2/ui/map-scene.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const { addEditableMap } = await import("../../lib/v2/report/map-pptx.ts");
const { defaultFrame, DEFAULT_REPORT_FONT_SIZES } = await import("../../lib/v2/report/report-doc.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { SLIDE } = await import("../../lib/v2/ui/overlay-layout.ts");

const near = (actual, expected, message, eps = 1e-6) => assert.ok(Math.abs(actual - expected) <= eps, `${message}: ${actual} vs ${expected}`);
const near2 = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

// 상수: §9-12 값(지름 46 = 반지름 23, 중심은 가장자리에서 반지름 + 7, 막대 최대 134, 글자 12).
assert.equal(NORTH_RADIUS, 23);
assert.equal(NORTH_INSET, NORTH_RADIUS + 7);
assert.equal(SCALE_MAX_PX, 134);
assert.equal(SCALE_FONT_PX, 12);

// box: 기본 방위표 상자는 반지름 23u, 중심 (W-30u, 30u). 카드(330 px)는 u = 1.
assert.deepEqual(northArrowBox(800, 330), { x0: 800 - 30 - 23, y0: 30 - 23, x1: 800 - 30 + 23, y1: 30 + 23 });
assert.deepEqual(northArrowBox(800, 330, 10, 80, 2), { x0: 800 - 10 - 60 - 46, y0: 80 - 46, x1: 800 - 10 - 60 + 46, y1: 80 + 46 }, "u 배율과 중심 y 지정");
assert.equal(northArrowBox(800, 330, 0, false), null);

// 축척 상자: 위 끝 = 막대 y − (글자 + 5)u, 좌우 6u, 아래 8u
{
  const u = 1;
  const scene = buildMapScene({ model: modelOf(), width: 800, height: 330, activeLayer: "white", scale: true, north: false, avoid: [] });
  assert.equal(scene.scaleBox.y0, scene.scale.y - (SCALE_FONT_PX + 5) * u, "판 위 끝");
  assert.equal(scene.scaleBox.y1, scene.scale.y + 8 * u, "판 아래 끝");
  assert.equal(scene.scaleBox.x1 - scene.scale.x1, 6 * u, "판 오른쪽 여백");
  assert.equal(scene.scale.x0 - scene.scaleBox.x0, 6 * u, "판 왼쪽 여백");
}

function modelOf() {
  const center = [127.15, 37.62];
  return {
    center,
    radiusM: 500,
    features: [{ layer: "rail_station", lng: center[0] + 0.001, lat: center[1], name: "강남역", labelPriority: 2 }],
    polygons: [],
    lines: [],
    total: 1,
    notes: [],
  };
}

// svg: 흰 원 r 23 + feDropShadow + 화살촉 + "N" 11px, 축척 최대 134 px·글자 12
const svg = renderToStaticMarkup(createElement(MapFigure, { model: modelOf(), width: 800, height: 330, basemap: "none", legend: false }));
assert.match(svg, /<circle[^>]*r="23"[^>]*fill="#fff"/, "방위표 불투명 흰 원");
assert.doesNotMatch(svg, /<circle[^>]*r="23"[^>]*fill-opacity/, "방위표 원은 불투명");
assert.match(svg, /<feDropShadow[^>]*dy="1"[^>]*stdDeviation="1.4"[^>]*flood-opacity="0.28"/, "그림자 아래 1u·번짐 1.4u·28 %");
assert.match(svg, /<circle[^>]*r="23"[^>]*filter="url\(#[^)]+\)"/, "원이 그림자 필터를 쓴다");
assert.match(svg, /font-size="11"[^>]*>N</, "N 11px");
{
  // 화살촉: 끝 (0, −15.6), 날개 (±7.8, 2.8), 파인 곳 (0, −0.9) — 중심 (W−30, 30) 기준
  const cx = 800 - NORTH_INSET;
  const cy = NORTH_INSET;
  const expected = [[0, -15.6], [7.8, 2.8], [0, -0.9], [-7.8, 2.8]];
  const arrows = [...svg.matchAll(/<path d="M([^"]*)Z"[^>]*fill="#16181d"/g)].map((m) => m[1].split("L").map((p) => p.split(" ").map(Number)));
  const arrow = arrows.find((points) => points.length === 4 && near2(points[0], [cx, cy - 15.6]));
  assert.ok(arrow, "화살촉 경로");
  arrow.forEach(([x, y], i) => { near(x - cx, expected[i][0], `화살촉 ${i} x`); near(y - cy, expected[i][1], `화살촉 ${i} y`); });
  assert.match(svg, new RegExp(`<text x="${cx}" y="${cy + 12.4}"[^>]*dominant-baseline="central"[^>]*>N<`), "N 중심 (0, +12.4)");
}
{
  const scene = buildMapScene({ model: modelOf(), width: 800, height: 330, activeLayer: "white", scale: true, north: false, avoid: [] });
  assert.ok(scene.scale.px <= SCALE_MAX_PX && scene.scale.px > SCALE_MAX_PX / 5, `막대 ${scene.scale.px}px는 134 안의 1·2·5×10ⁿ m`);
  assert.match(svg, /font-size="12"[^>]*>\d+ ?k?m</, "축척 글자 12px");
  assert.match(svg, /<rect[^>]*fill="#fff"[^>]*fill-opacity="0.85"/, "축척 판은 흰 85 % 그대로");
}

// 보고서 축척 글자: pt가 정본, 글자 px = pt × 9.5/9 × u. 기본 11pt.
assert.equal(DEFAULT_REPORT_FONT_SIZES.scale, 11);
near(scaleFontScaleForPt(11), (11 * SCALE_PT_TO_PX) / SCALE_FONT_PX, "기본 pt 배율");
near(SCALE_FONT_PX * scaleFontScaleForPt(14), 14 * SCALE_PT_TO_PX, "14pt 글자 px");
near(SCALE_FONT_PX * scaleFontScaleForPt(7), 7 * SCALE_PT_TO_PX, "7pt 글자 px");

// saved-box: 저장 상자 높이 30 px → 그린 원 지름이 30 px 이하(저장 상자는 크기를 지킨다)
{
  const defaultBox = northArrowBox(800, 330);
  const savedHeight = 30;
  const northScale = savedHeight / (defaultBox.y1 - defaultBox.y0);
  const small = renderToStaticMarkup(createElement(MapFigure, { model: modelOf(), width: 800, height: 330, basemap: "none", legend: false, northScale, north: 100, northX: 400 }));
  const radii = [...small.matchAll(/<circle[^>]*\br="([\d.]+)"[^>]*fill="#fff"/g)].map((m) => Number(m[1]));
  assert.ok(radii.length > 0, "저장 배율에서도 흰 원");
  for (const r of radii) assert.ok(2 * r <= savedHeight + 1e-6, `원 지름 ${2 * r} ≤ ${savedHeight}`);
}

// fits: 1024 카드(지도 높이 250)·조판 칸(높이 180)에서 방위표·축척 상자가 지도 안이고 서로 안 겹친다
{
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  for (const [width, height, bottomInset] of [[560, 250, 0], [320, 180, 0], [320, 180, 24]]) {
    const north = northArrowBox(width, height);
    const scale = scaleBarBox(width, height, 1.5, bottomInset);
    for (const [name, box] of [["north", north], ["scale", scale]]) {
      assert.ok(box.x0 >= 0 && box.y0 >= 0 && box.x1 <= width && box.y1 <= height, `${width}×${height} ${name} 상자가 지도 안`);
    }
    assert.equal(overlaps(north, scale), false, `${width}×${height} 방위표와 축척이 겹치지 않음`);
  }
}

// pptx: addNorth 원에 그림자, 지름 46u px를 인치로 / 축척 글자 12u
const stub = () => {
  const calls = [];
  const recorder = new Proxy({}, { get: (_, method) => (...args) => { calls.push({ method: String(method), args }); } });
  return { slide: recorder, calls };
};
const source = GODEOK_RESULTS[0];
const view = toTileView(source);
const plan = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, [source]),
  views: new Map([[source.tileId, view]]),
  board: initBoard([source]),
  analysisDate: "2026-10-29",
}).find((slide) => slide.kind === "tile" && slide.map);
assert.ok(plan, "PPT 검증용 지도 장");
const draw = (reportFrame) => {
  const { slide, calls } = stub();
  addEditableMap(slide, plan, plan.map, { style: plan.style, format: "wide", reportFrame });
  return calls;
};
{
  const calls = draw(defaultFrame());
  const bg = calls.find((c) => c.method === "addShape" && c.args[1].objectName?.includes("|방위표|bg"));
  assert.ok(bg, "방위표 원");
  assert.equal(bg.args[0], "ellipse");
  const unit = 1.5; // 960×540 장은 u = 1.5
  near(bg.args[1].w, (2 * NORTH_RADIUS * unit / 960) * SLIDE.w, "원 지름 46u px를 인치로");
  assert.equal(bg.args[1].fill.transparency ?? 0, 0, "PPT 원도 불투명");
  assert.equal(bg.args[1].shadow?.type, "outer", "PPT 원에 그림자");
  assert.equal(bg.args[1].shadow?.angle, 90, "그림자는 아래쪽");
  near(bg.args[1].shadow.opacity, 0.28, "그림자 28 %");
  const label = calls.find((c) => c.method === "addText" && c.args[1].objectName?.includes("|방위표|label"));
  assert.ok(label && label.args[0] === "N", "N 글자");
  near(label.args[1].fontSize, NORTH_GLYPH.letterPx * unit * 0.75, "N 11u px를 pt로");
  const scaleLabel = calls.find((c) => c.method === "addText" && c.args[1].objectName?.includes("|축척|label"));
  assert.ok(scaleLabel, "축척 글자");
  near(scaleLabel.args[1].fontSize, SCALE_FONT_PX * unit * scaleFontScaleForPt(DEFAULT_REPORT_FONT_SIZES.scale) * 0.75, "축척 글자 기본 11pt 배율");
}

// 축척 막대를 끈 프레임은 PPT에도 축척 막대가 없다(방위표는 scene이 이미 끈다)
{
  const off = { ...defaultFrame(), decorations: { north: true, scaleBar: false, locator: false } };
  const calls = draw(off);
  assert.equal(calls.some((c) => c.args.some((a) => typeof a?.objectName === "string" && a.objectName.includes("|축척|"))), false, "scaleBar=false면 축척 도형이 없다");
  assert.ok(calls.some((c) => c.args.some((a) => typeof a?.objectName === "string" && a.objectName.includes("|방위표|"))), "방위표는 남는다");
  const on = draw(defaultFrame());
  assert.ok(on.some((c) => c.args.some((a) => typeof a?.objectName === "string" && a.objectName.includes("|축척|"))), "scaleBar=true면 축척 도형이 있다");
}

console.log("v2 map chrome (§9-12) contracts passed");
