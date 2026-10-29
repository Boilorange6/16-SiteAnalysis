/** §9-12 지도 부속(방위표 A형·축척 막대 134/12 px) 계약: 장면 값 하나를 화면과 PPT가 같이 쓴다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// 이미지 내보내기: 방위표 중심 y는 NORTH_INSET × u여야 한다(u = 1.5인 960×540에서 원이 위로 잘리지 않는다)
{
  for (const [width, height] of [[960, 540], [320, 440], [800, 330]]) {
    const u = Math.min(1.5, Math.max(1, height / 360));
    const north = NORTH_INSET * u;
    const figure = renderToStaticMarkup(createElement(MapFigure, { model: modelOf(), width, height, basemap: "none", legend: false, fixed: true, north }));
    const m = figure.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#fff"/);
    assert.ok(m, `${width}×${height} 방위표 원`);
    near(Number(m[2]), NORTH_INSET * u, `${width}×${height} 중심 y = NORTH_INSET·u`);
    assert.ok(Number(m[2]) - Number(m[3]) >= 0, `${width}×${height} 원 위 끝이 지도 안`);
  }
  // map-image는 중심 y를 u 배율 없이 넘기지 않는다(import 줄 제외, NORTH_INSET 뒤에는 * 단위가 온다)
  const mapImage = readFileSync(new URL("../../lib/v2/report/map-image.ts", import.meta.url), "utf8")
    .split("\n").filter((line) => !/^import /.test(line)).join("\n");
  for (const m of mapImage.matchAll(/NORTH_INSET(.{0,4})/g)) assert.match(m[1], /^\s*\*/, `map-image의 NORTH_INSET은 u를 곱해 쓴다: ${m[0]}`);
}

// 저장 축척 상자: 옛(88u) 상자를 저장값으로 주어도 새 134u 막대가 상자·지도 밖으로 나가지 않는다
{
  for (const [width, height] of [[800, 330], [960, 540], [560, 250]]) {
    const base = { model: modelOf(), width, height, activeLayer: "white", scale: true, north: false, avoid: [] };
    const old = buildMapScene({ ...base, scaleMaxPx: 88 });
    const u = old.unit;
    const box = old.scaleBox;
    const now = buildMapScene({ ...base, scaleBoxOverride: box, scaleX: box.x0 + 6 * u, scaleY: box.y1 - 8 * u });
    assert.ok(now.scale.x1 <= box.x1 + 1e-6, `${width}×${height} 막대 끝 ${now.scale.x1} ≤ 저장 상자 오른쪽 ${box.x1}`);
    assert.ok(now.scale.x0 >= box.x0 - 1e-6, `${width}×${height} 막대 시작이 저장 상자 안`);
    assert.ok(now.scale.x1 <= width, `${width}×${height} 막대 끝이 지도 안`);
    assert.match(now.scale.label, /^[125]0*k?m$/, `${width}×${height} 1·2·5×10ⁿ 규칙 유지: ${now.scale.label}`);
    assert.ok(now.scale.meters >= old.scale.meters, `${width}×${height} 옛 상자 안에 옛 막대가 그대로 들어간다: ${old.scale.label} → ${now.scale.label}`);
  }
}

// 기본 크기로 저장한 축척 상자(그대로·비율 왕복·드래그 평행이동)는 기본 장면과 같은 막대를 그린다(경계값 부동소수 오차로 한 단계 짧아지지 않는다)
{
  const sw = 13.333 * 72;
  const sh = 7.5 * 72;
  for (const lat of [33.2, 35.1, 36.5, 37.62, 38.1]) {
    for (const radiusM of [300, 500, 750, 1000, 1500, 2000, 3000]) {
      for (const [width, height] of [[800, 330], [960, 540], [560, 250], [640, 400], [1280, 720], [333, 217]]) {
        const model = { center: [127.15, lat], radiusM, features: [], polygons: [], lines: [], total: 0, notes: [] };
        const base = { model, width, height, activeLayer: "white", scale: true, north: false, avoid: [] };
        const def = buildMapScene(base);
        const u = def.unit;
        const b = def.scaleBox;
        const ratio = { x: b.x0 / sw, y: b.y0 / sh, w: (b.x1 - b.x0) / sw, h: (b.y1 - b.y0) / sh };
        const boxes = {
          그대로: b,
          "비율 왕복": { x0: ratio.x * sw, y0: ratio.y * sh, x1: ratio.x * sw + ratio.w * sw, y1: ratio.y * sh + ratio.h * sh },
          드래그: { x0: b.x0 - 37.3, y0: b.y0, x1: b.x1 - 37.3, y1: b.y1 },
        };
        for (const [kind, box] of Object.entries(boxes)) {
          const now = buildMapScene({ ...base, scaleBoxOverride: box, scaleX: box.x0 + 6 * u, scaleY: box.y1 - 8 * u });
          assert.equal(now.scale.meters, def.scale.meters, `${kind} lat ${lat} r ${radiusM} ${width}×${height}: ${def.scale.label} → ${now.scale.label}`);
        }
      }
    }
  }
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

// 장식 켜짐·꺼짐은 장면과 PPT가 같다: 조판 칸(D3·D5)과 설명표 상세 장(D4)
{
  const has = (calls, part) => calls.some((c) => c.args.some((a) => typeof a?.objectName === "string" && a.objectName.includes(part)));
  const cell = (reportFrame) => {
    const { slide, calls } = stub();
    addEditableMap(slide, null, plan.map, { mode: "cell", frame: { x: 0.5, y: 0.5, w: 6, h: 3.5 }, style: {}, format: "wide", reportFrame });
    return calls;
  };
  const deco = (decorations) => ({ ...defaultFrame(), decorations: { north: true, scaleBar: true, locator: false, ...decorations } });
  assert.equal(has(cell(deco({ north: false })), "|방위표|"), false, "D3 조판 칸: north=false면 방위표 도형이 없다");
  assert.ok(has(cell(deco({ north: true })), "|방위표|"), "D3 조판 칸: north=true면 방위표가 있다");
  assert.equal(has(cell(undefined), "|방위표|"), false, "D3 reportFrame 없는 조판 칸은 화면처럼 방위표가 없다");
  assert.equal(has(cell(undefined), "|축척|"), false, "D5 reportFrame 없는 조판 칸은 화면처럼 축척 막대가 없다");
  assert.equal(has(cell(deco({ scaleBar: false })), "|축척|"), false, "D5 조판 칸 scaleBar=false");
  assert.ok(has(cell(deco({ scaleBar: true })), "|축척|"), "D5 조판 칸 scaleBar=true면 축척이 있다");

  // 설명표 상세 장: 축척은 화면처럼 장식 설정이 정한다(켬 -> 있음, 끔 -> 없음). 방위표는 늘 장식대로.
  const detail = (decorations, locator = false) => {
    const { slide, calls } = stub();
    addEditableMap(slide, { ...plan, callout: { page: 1, pages: 2 } }, plan.map, { style: plan.style, format: "wide", reportFrame: deco({ locator, ...decorations }) });
    return calls;
  };
  assert.ok(has(detail({ scaleBar: true }), "|축척|"), "I2 설명표 상세 장 + 장식 scaleBar 켬 -> 축척이 있다");
  assert.equal(has(detail({ scaleBar: false }), "|축척|"), false, "I2 설명표 상세 장 + 장식 scaleBar 끔 -> 축척이 없다");
  assert.ok(has(detail({ scaleBar: false }), "|방위표|"), "I2 설명표 상세 장에도 방위표는 남는다");

  // I1: 설명표 상세 장 위치도는 그 장면이 그리는 방위표·축척을 덮지 않는다(가장자리 걸침까지, 상자 교차로 판정)
  const shapeBox = (calls, part) => {
    const o = calls.map((c) => c.args[1]).find((a) => typeof a?.objectName === "string" && a.objectName.includes(part));
    return o ? { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h } : null;
  };
  const cross = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const withLocator = detail({ scaleBar: true }, true);
  const locatorFrame = shapeBox(withLocator, "|위치도|frame");
  assert.ok(locatorFrame, "I1 상세 장 위치도 틀");
  assert.equal(cross(locatorFrame, shapeBox(withLocator, "|방위표|bg")), false, "I1 상세 장 위치도가 방위표와 겹치지 않는다");
  assert.equal(cross(locatorFrame, shapeBox(withLocator, "|축척|bg")), false, "I1 상세 장 위치도가 축척과 겹치지 않는다");
}

// I3: 조판 칸 화면(SSR)은 칸마다 위치도 하나, 칸 방위표와 안 겹치고 바탕 라벨도 위치도를 피한다
{
  const { toUtmk } = await import("../../lib/v2/crs.ts");
  const { mapBaseFromScene } = await import("../../lib/v2/ui/basemap.ts");
  const { sheetView } = await import("../../lib/v2/ui/sheet.ts");
  // SSR에는 측정할 DOM이 없어 표면이 unit = 1(폭 13.3 px)로 그려진다. 1280 px 폭을 잰 것처럼 크기 상태의 초기값만 바꿔 실제 크기로 그린다.
  const { default: ReactModule } = await import("react");
  const realUseState = ReactModule.useState;
  ReactModule.useState = (init) => realUseState(init && typeof init === "object" && init.width === 0 && init.height === 0 ? { width: 1280, height: 720 } : init);
  const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");
  const LNG = 127.0636;
  const LAT = 37.4979;
  const [ox, oy] = toUtmk([LNG, LAT]);
  const places = [];
  for (let i = 0; i < 7; i += 1) for (let j = 0; j < 5; j += 1) places.push({ name: `${"가나다라마바사"[i]}${"동서남북중"[j]}동`, kind: "dong", x: -420 + i * 140, y: -300 + j * 150 });
  const baseScene = {
    version: "v2-scene@2", analysisId: "a-i3", manifestHash: "h",
    origin: { epsg: "EPSG:5179", x: ox, y: oy, lng: LNG, lat: LAT }, radiusM: 500, ground: { kind: "flat" }, site: null,
    buildings: [{ id: "b0", name: null, sublabel: null, labelPriority: 0, rings: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]], baseZ: null, heightM: 9, heightMethod: "source", floorsAbove: 3, useCode: null, approvalDate: null }],
    parcels: [],
    context: { roads: [{ points: [[-450, -60], [450, -60]], widthM: 20, hierarchy: "간선", name: "테헤란로" }], green: [], greenKinds: [], water: [], rail: [], stations: [], places },
    counts: { buildingsTotal: 1, buildingsIncluded: 1, parcelsTotal: 0, parcelsIncluded: 0 }, sources: [], limitations: [],
  };
  const model = { center: [LNG, LAT], radiusM: 500, features: [], total: 0, notes: [], tileCode: "A04", base: mapBaseFromScene(baseScene) };
  const tile = { ...toTileView(source), map: model, backdrop: model };
  const frameOn = { ...defaultFrame(), decorations: { north: true, scaleBar: true, locator: true } };
  const cells = [0, 1, 2, 3].map((i) => ({ view: tile, face: "front", mapKey: `cell-${i}`, reportFrame: frameOn }));
  const page = { id: "p-i3", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "compare", grid: "2x2", sameExtent: false, cells: cells.map(() => ({ tileId: tile.tileId, settings: { face: "front", callout: "overview" }, frame: frameOn })) };
  const slide = { kind: "sheet", view: sheetView("sheet-i3", [tile], "2x2"), grid: "2x2", cells, no: 1, total: 1, footer: "출처 없음", key: "p-i3", style: {}, page };
  const markup = renderToStaticMarkup(createElement(SlideSurface, { slide, basemap: "vector", mode: "view" }));
  ReactModule.useState = realUseState;
  const parts = markup.split(/(?=data-map-cell-index=")/).filter((part) => part.startsWith("data-map-cell-index="));
  assert.equal(parts.length, 4, "조판 칸 4개");
  const cross = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  let labelsSeen = 0;
  for (const [index, part] of parts.entries()) {
    const locators = [...part.matchAll(/data-map-locator="true"[^>]*style="left:([\d.]+)px;top:([\d.]+)px;width:([\d.]+)px;height:([\d.]+)px/g)];
    assert.equal(locators.length, 1, `칸 ${index}: 위치도는 하나만 그린다`);
    const [, left, top, width, height] = locators[0].map(Number);
    const locator = { x0: left, y0: top, x1: left + width, y1: top + height };
    const north = [...part.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#fff"/g)].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) })).find((c) => c.r > 15);
    assert.ok(north, `칸 ${index}: 방위표 원`);
    assert.equal(cross(locator, { x0: north.cx - north.r, y0: north.cy - north.r, x1: north.cx + north.r, y1: north.cy + north.r }), false, `칸 ${index}: 위치도가 방위표와 겹치지 않는다`);
    for (const m of part.matchAll(/<text data-map-base-label="[^"]*" x="([\d.]+)" y="([\d.]+)"/g)) {
      labelsSeen += 1;
      const [x, y] = [Number(m[1]), Number(m[2])];
      assert.ok(!(x > locator.x0 && x < locator.x1 && y > locator.y0 && y < locator.y1), `칸 ${index}: 바탕 라벨 (${x}, ${y})이 위치도 안`);
    }
  }
  assert.ok(labelsSeen > 0, "칸 화면에 바탕 라벨이 그려진다(검증이 비어 있지 않다)");
}

console.log("v2 map chrome (§9-12) contracts passed");
