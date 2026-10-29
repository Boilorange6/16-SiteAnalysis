/** §9-12 대지 치수선(A형)·꼭짓점 표고(C형): 장면 기하, 바탕 라벨 회피, 화면 SVG, PPT 도형, 장식 상태. */
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { createElement } from "react";

globalThis.React = React;

const { toLngLat, toUtmk } = await import("../../lib/v2/crs.ts");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { makeProjector } = await import("../../lib/v2/ui/map-projection.ts");
const { mapBaseFromScene } = await import("../../lib/v2/ui/basemap.ts");
const { default: MapFigure } = await import("../../components/v2/map-figure.tsx");
const { addEditableMap } = await import("../../lib/v2/report/map-pptx.ts");
const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");

const near = (actual, expected, message, eps = 1e-6) => assert.ok(Math.abs(actual - expected) <= eps, `${message}: ${actual} vs ${expected}`);
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

const CENTER = [127.0636, 37.4979];
const [cx0, cy0] = toUtmk(CENTER);
/** 대지 중심 기준 로컬 m 좌표 → LngLat. */
const lngLatOf = ([x, y]) => toLngLat([cx0 + x, cy0 + y]);
const rect = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
const outlineOf = (locals, elevations = locals.map(() => 18)) => ({ rings: [{ points: locals.map(lngLatOf), elevations }] });
const modelOf = (siteOutline, extra = {}) => ({ center: CENTER, radiusM: 100, features: [], polygons: [], lines: [], total: 0, notes: [], ...(siteOutline === undefined ? {} : { siteOutline }), ...extra });
const W = 800;
const H = 330;
const build = (model, siteMarks, extra = {}) => buildMapScene({ model, width: W, height: H, activeLayer: "white", north: false, scale: false, avoid: [], ...(siteMarks ? { siteMarks } : {}), ...extra });
const BOTH = { dims: true, elevations: true };

// dims: 100×60 m 직사각형 → 변 4개, 글자 "100.0 m"/"60.0 m", 평행선은 대지 밖으로 8u
{
  const outline = outlineOf(rect(100, 60));
  const scene = build(modelOf(outline), { dims: true, elevations: false });
  const u = scene.unit;
  assert.equal(scene.siteDims.length, 4);
  assert.deepEqual(scene.siteDims.map((d) => d.text).sort(), ["100.0 m", "100.0 m", "60.0 m", "60.0 m"]);
  assert.deepEqual(scene.siteElevations, [], "표고는 꺼짐");
  const project = makeProjector(scene.viewport);
  const v = outline.rings[0].points.map(([lng, lat]) => project(lng, lat));
  const cen = [v.reduce((s, p) => s + p[0], 0) / 4, v.reduce((s, p) => s + p[1], 0) / 4];
  for (const dim of scene.siteDims) {
    const i = [0, 1, 2, 3].find((k) => {
      const a = v[k];
      const b = v[(k + 1) % 4];
      return Math.abs(len(dim.line[0], a) - 8 * u) < 1e-6 && Math.abs(len(dim.line[1], b) - 8 * u) < 1e-6;
    });
    assert.ok(i !== undefined, `${dim.text} 평행선은 변에서 8u 띄움`);
    const a = v[i];
    const b = v[(i + 1) % 4];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const lineMid = [(dim.line[0][0] + dim.line[1][0]) / 2, (dim.line[0][1] + dim.line[1][1]) / 2];
    near(len(lineMid, cen) - len(mid, cen), 8 * u, `${dim.text} 대지 밖쪽으로 8u`);
    // 연장선: 꼭짓점 + n·2u → + n·(8+4)u
    assert.equal(dim.ext.length, 2);
    near(len(dim.ext[0][0], a), 2 * u, "연장선 시작 2u");
    near(len(dim.ext[0][1], a), 12 * u, "연장선 끝 (8+4)u");
    near(len(dim.ext[1][0], b), 2 * u, "연장선 시작 2u");
    near(len(dim.ext[1][1], b), 12 * u, "연장선 끝 (8+4)u");
    // 사선: 평행선 끝을 가운데로 반길이 3.2·√2·u
    assert.equal(dim.ticks.length, 2);
    for (const [k, tick] of dim.ticks.entries()) {
      near(len(tick[0], tick[1]), 2 * 3.2 * Math.SQRT2 * u, "사선 길이");
      near((tick[0][0] + tick[1][0]) / 2, dim.line[k][0], "사선 중심 x");
      near((tick[0][1] + tick[1][1]) / 2, dim.line[k][1], "사선 중심 y");
    }
    // 글자: 가운데 + n·(8 + 0.8·10.5)u, 10.5u, 읽는 방향
    near(dim.fontSize, 10.5 * u, "글자 10.5u");
    near(len([dim.x, dim.y], lineMid), 0.8 * 10.5 * u, "글자는 평행선에서 0.8배 글자 크기");
    assert.ok(dim.angle >= -90 && dim.angle <= 90, `각도 ${dim.angle}`);
    assert.ok(dim.box.x1 > dim.box.x0 && dim.box.y1 > dim.box.y0 && dim.x >= dim.box.x0 && dim.x <= dim.box.x1);
  }
}

// short: 35 m 미만 변은 뺀다(30 m 변 2개)
{
  const scene = build(modelOf(outlineOf(rect(30, 60))), { dims: true, elevations: false });
  assert.deepEqual(scene.siteDims.map((d) => d.text), ["60.0 m", "60.0 m"]);
  assert.equal(build(modelOf(outlineOf(rect(34.9, 34.9))), { dims: true, elevations: false }).siteDims.length, 0, "35 m 미만");
  assert.equal(build(modelOf(outlineOf(rect(35.5, 35.5))), { dims: true, elevations: false }).siteDims.length, 4, "35 m 이상은 그림");
}

// els: 표고 [18.9, 17.5, null, 18.0] → 3개, 숫자만
{
  const outline = outlineOf(rect(100, 60), [18.9, 17.5, null, 18.0]);
  const scene = build(modelOf(outline), { dims: false, elevations: true });
  const u = scene.unit;
  assert.deepEqual(scene.siteDims, [], "치수는 꺼짐");
  assert.deepEqual(scene.siteElevations.map((e) => e.text), ["18.9", "17.5", "18.0"]);
  const project = makeProjector(scene.viewport);
  const v = outline.rings[0].points.map(([lng, lat]) => project(lng, lat));
  const cen = [v.reduce((s, p) => s + p[0], 0) / 4, v.reduce((s, p) => s + p[1], 0) / 4];
  const first = scene.siteElevations[0];
  near(first.x, v[0][0], "× 중심 x");
  near(first.y, v[0][1], "× 중심 y");
  near(first.fontSize, 8.5 * u, "글자 8.5u");
  near(len([first.tx, first.ty], v[0]), 1.1 * 8.5 * u, "글자는 꼭짓점에서 1.1배 글자 크기, 중심 쪽");
  assert.ok(len([first.tx, first.ty], cen) < len(v[0], cen), "중심 쪽으로 놓는다");
  assert.equal(first.anchor, "start", "중심이 오른쪽이면 start");
  assert.deepEqual(scene.siteElevations.map((e) => e.anchor), ["start", "end", "start"]);
  assert.ok(first.box.x0 <= first.x - 3 * u && first.box.x1 >= first.tx, "상자는 × 와 글자를 덮는다");
  // 가까운 꼭짓점(3.2·8.5u 안)은 생략한다: 5 m ≈ 6 px
  const crowded = build(modelOf(outlineOf([[-50, -30], [-45, -30], [50, -30], [50, 30], [-50, 30]])), { dims: false, elevations: true });
  assert.equal(crowded.siteElevations.length, 4, "가까운 둘째 꼭짓점 생략");
  // 중심과 같은 x면 middle
  const tri = build(modelOf(outlineOf([[0, -30], [40, 30], [-40, 30]])), { dims: false, elevations: true });
  assert.equal(tri.siteElevations[0].anchor, "middle", "|n.x| < 0.35면 middle");
}

// empty: siteMarks 없음·outline 없음·둘 다 꺼짐 → []
{
  const outline = outlineOf(rect(100, 60));
  for (const scene of [build(modelOf(outline)), build(modelOf(null), BOTH), build(modelOf(undefined), BOTH), build(modelOf(outline), { dims: false, elevations: false })]) {
    assert.deepEqual(scene.siteDims, []);
    assert.deepEqual(scene.siteElevations, []);
  }
}

// labels: 바탕 라벨 상자는 대지 치수·표고 상자를 비켜 간다
{
  const box = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  const baseScene = {
    version: "v2-scene@2", analysisId: "a-site-marks", manifestHash: "h",
    origin: { epsg: "EPSG:5179", x: cx0, y: cy0, lng: CENTER[0], lat: CENTER[1] },
    radiusM: 500, ground: { kind: "flat" }, site: null, buildings: [], parcels: [],
    context: {
      roads: [
        { points: line(-450, -60, 450, -60), widthM: 20, hierarchy: "간선", name: "테헤란로" },
        { points: line(-450, 60, 450, 60), widthM: 10, hierarchy: "집산", name: "도곡로" },
        { points: line(-60, -450, -60, 450), widthM: 10, hierarchy: "집산", name: "삼성로" },
      ],
      green: [[box(100, 100, 60, 60)]], greenKinds: ["park"], water: [], rail: [], stations: [],
      places: [{ name: "역삼동", kind: "dong", x: 0, y: -80 }, { name: "대치동", kind: "dong", x: 0, y: 80 }],
    },
    counts: { buildingsTotal: 0, buildingsIncluded: 0, parcelsTotal: 0, parcelsIncluded: 0 },
    sources: [], limitations: [],
  };
  const vector = { ...modelOf(outlineOf(rect(240, 170), [18.9, 17.5, 18.2, 18.0]), { radiusM: 500, tileCode: "A04", base: mapBaseFromScene(baseScene) }) };
  const withBase = (siteMarks) => buildMapScene({ model: vector, width: 800, height: 600, activeLayer: "vector", north: false, scale: false, avoid: [], ...(siteMarks ? { siteMarks } : {}) });
  const plain = withBase(null);
  const marked = withBase(BOTH);
  const marks = [...marked.siteDims.map((d) => d.box), ...marked.siteElevations.map((e) => e.box)];
  assert.ok(marks.length >= 6, `표식 상자 ${marks.length}개`);
  assert.ok(plain.base.labels.some((l) => marks.some((m) => overlaps(l.box, m))), "표식이 없을 때는 겹치는 바탕 라벨이 있다(시험 자료 점검)");
  for (const l of marked.base.labels) for (const m of marks) assert.ok(!overlaps(l.box, m), `${l.text} 라벨이 표식 상자와 겹침`);
}

// crowded: 작은 축척(대지가 작게 보임) — 변이 글자보다 짧으면 생략, 치수 글자끼리·표고와 치수 글자·대지 표식이 겹치지 않음
{
  const fit = 0.6;
  const textWidth = (dim) => [...dim.text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? dim.fontSize : dim.fontSize * 0.58), 0) + dim.fontSize * 0.36;
  const edgePx = (dim) => Math.hypot(dim.line[1][0] - dim.line[0][0], dim.line[1][1] - dim.line[0][1]);
  const notch = [[-100, -60], [100, -60], [100, 60], [-60, 60], [-60, 0], [-100, 0]];
  for (const [name, locals] of [["ㄱ자 윤곽", notch], ["100×60 직사각형", rect(100, 60)], ["300×200 직사각형", rect(300, 200)]]) {
    for (const radiusM of [500, 1000]) {
      const outline = outlineOf(locals, locals.map((_, i) => 17.5 + i * 0.4));
      const scene = build(modelOf(outline, { radiusM }), BOTH, { height: 600 });
      const label = `${name} 반경 ${radiusM} m (mpp ${scene.mpp.toFixed(1)})`;
      for (const dim of scene.siteDims) assert.ok(edgePx(dim) >= fit * textWidth(dim), `${label}: ${dim.text} 변 ${edgePx(dim).toFixed(1)} px < 글자 ${textWidth(dim).toFixed(1)} px × ${fit}`);
      for (const [i, a] of scene.siteDims.entries()) for (const b of scene.siteDims.slice(i + 1)) assert.ok(!overlaps(a.box, b.box), `${label}: 치수 ${a.text}·${b.text} 글자 겹침`);
      const [marker] = [scene.siteBounds]; // 링 모드(필지 없음)의 대지 표식 상자
      for (const el of scene.siteElevations) {
        for (const dim of scene.siteDims) assert.ok(!overlaps(el.box, dim.box), `${label}: 표고 ${el.text}가 치수 ${dim.text}와 겹침`);
        assert.ok(!overlaps(el.box, marker), `${label}: 표고 ${el.text}가 대지 표식과 겹침`);
      }
    }
  }
  // 긴 변은 남는다(300×200 m는 반경 500 m에서 변이 글자보다 충분히 길다)
  assert.equal(build(modelOf(outlineOf(rect(300, 200))), BOTH, { height: 600 }).siteDims.length, 4, "충분히 긴 변은 그대로");
  // 필지(◇) 모드: 표고 글자 상자가 ◇ 상자(중심 ± (1.1·siteR + 선 반폭), siteR 7)와 겹치지 않는다
  const parcel = outlineOf(rect(100, 60), [18.9, 17.5, 18.2, 18.0]);
  const ring = parcel.rings[0].points;
  const parcelModel = modelOf(parcel, { radiusM: 500, siteParcel: [{ layer: "parcel_site", fid: "p", rings: [[...ring, ring[0]]] }] });
  const parcelScene = build(parcelModel, BOTH, { height: 600 });
  assert.equal(parcelScene.siteMode, "parcel");
  const [pcx, pcy] = parcelScene.center;
  const diamond = { x0: pcx - 9.45, y0: pcy - 9.45, x1: pcx + 9.45, y1: pcy + 9.45 };
  for (const el of parcelScene.siteElevations) assert.ok(!overlaps(el.box, diamond), `필지 모드: 표고 ${el.text}가 ◇와 겹침`);
}

// real-outline: 대치동 503 실제 윤곽(변 188.5/140.6/37.3/124.0/151.6/7.5/303.2/15.0 m). 대지 확대 시안(zoomDelta 2.5, 460×330)은 치수 6개·표고 6개 그대로,
// 반경 1 km 전체 보기에서는 짧은 변이 글자보다 짧아 빠지고 남은 글자는 서로·표고와 겹치지 않는다
{
  const local = [[138.3, -117.5], [-45, -161.5], [-114.4, -39.1], [-82, -20.4], [-144.4, 86.8], [-12.7, 161.8], [-5.4, 159.8], [144.3, -103.8]];
  const outline = outlineOf(local, [19.1, 19.1, 18.9, 17.8, 18.9, 17.5, 17.4, 18]);
  const model = modelOf(outline, { radiusM: 1000 });
  const zoomed = buildMapScene({ model, width: 460, height: 330, activeLayer: "white", north: false, scale: false, avoid: [], view: { zoomDelta: 2.5, offsetM: [0, 0] }, siteMarks: BOTH });
  // 좌표를 소수 1자리로 줄여 담았으므로 길이는 ±0.2 m 안에서 같다
  const lengths = zoomed.siteDims.map((d) => Number.parseFloat(d.text));
  [188.5, 140.6, 37.3, 124.0, 151.6, 303.2].forEach((m, i) => assert.ok(Math.abs(lengths[i] - m) < 0.2, `대지 확대: ${m} m 변 치수 (${lengths[i]})`));
  assert.equal(lengths.length, 6, "대지 확대: 치수 6개(회귀 금지)");
  assert.equal(zoomed.siteElevations.length, 6, "대지 확대: 표고 6개(회귀 금지)");
  const full = buildMapScene({ model, width: 960, height: 540, activeLayer: "white", north: false, scale: false, avoid: [], siteMarks: BOTH });
  assert.ok(full.siteDims.length < 6, `전체 보기: 짧은 변은 생략(${full.siteDims.length}개)`);
  for (const [i, a] of full.siteDims.entries()) for (const b of full.siteDims.slice(i + 1)) assert.ok(!overlaps(a.box, b.box), `전체 보기: 치수 ${a.text}·${b.text} 겹침`);
  for (const el of full.siteElevations) for (const dim of full.siteDims) assert.ok(!overlaps(el.box, dim.box), `전체 보기: 표고 ${el.text}·치수 ${dim.text} 겹침`);
}

// scale-invariant: 같은 장은 화면 미리보기(고정 표식 10 px, 무대 폭마다 u가 다름)와 PPT(960 px, u 1.5)에서 같은 치수·표고가 남는다
{
  const local = [[138.3, -117.5], [-45, -161.5], [-114.4, -39.1], [-82, -20.4], [-144.4, 86.8], [-12.7, 161.8], [-5.4, 159.8], [144.3, -103.8]];
  const outline = outlineOf(local, [19.1, 19.1, 18.9, 17.8, 18.9, 17.5, 17.4, 18]);
  const ring = outline.rings[0].points;
  const model = modelOf(outline, { radiusM: 1000, siteParcel: [{ layer: "parcel_site", fid: "p", rings: [[...ring, ring[0]]] }] });
  const marksAt = (width, fixed, zoomDelta) => {
    const scene = buildMapScene({ model, width, height: Math.round((width * 9) / 16), activeLayer: "white", fixed, layoutUnit: (1.5 * width) / 960, view: { zoomDelta, offsetM: [0, 0] }, siteMarks: BOTH });
    return JSON.stringify([scene.siteDims.map((d) => d.text), scene.siteElevations.map((e) => e.text)]);
  };
  for (const zoomDelta of [0, 0.5, 1]) {
    const reference = marksAt(960, false, zoomDelta);
    for (const width of [960, 1032, 1258]) for (const fixed of [false, true]) assert.equal(marksAt(width, fixed, zoomDelta), reference, `줌 ${zoomDelta}: 폭 ${width}·fixed ${fixed}에서 PPT(960)와 같은 치수·표고`);
  }
  assert.equal(JSON.parse(marksAt(960, false, 0))[1].length, 2, "1:13,120 근처 장은 표고 2개(19.1·17.5)");
}

// svg: MapFigure siteMarks on → 글자·회전·× 경로, off면 없음
{
  const model = modelOf(outlineOf(rect(100, 60), [18.9, 17.5, 18.2, 18.0]));
  const props = { model, width: W, height: H, basemap: "none", legend: false, north: false, scale: false, credit: false };
  const off = renderToStaticMarkup(createElement(MapFigure, props));
  assert.doesNotMatch(off, /100\.0 m|data-site-marks/, "기본은 그리지 않음");
  const svg = renderToStaticMarkup(createElement(MapFigure, { ...props, siteMarks: BOTH }));
  assert.match(svg, />100\.0 m</, "가로 변 글자");
  assert.match(svg, /<text[^>]*font-weight="500"[^>]*fill="#2b2b2b"[^>]*>100\.0 m</, "치수 글자 굵기 500·#2b2b2b");
  assert.match(svg, /<text[^>]*transform="rotate\(-?(?:89\.\d+|90) [\d.]+ [\d.]+\)"[^>]*>60\.0 m</, "세로 변 글자는 회전(UTM-K 격자 수렴각 0.3° 이내)");
  assert.match(svg, />18\.9</, "표고 숫자만");
  assert.doesNotMatch(svg, />18\.9 ?m</, "표고에 단위 없음");
  const paths = [...svg.matchAll(/<path[^>]*>/g)].map((m) => m[0]);
  const crosses = paths.filter((p) => /stroke="#16181d"/.test(p) && /stroke-width="1\.2"/.test(p) && /d="M[\d.]+ [\d.]+L[\d.]+ [\d.]+M[\d.]+ [\d.]+L[\d.]+ [\d.]+"/.test(p));
  assert.equal(crosses.length, 4, "× 검은 1.2 경로 4개");
  assert.equal(paths.filter((p) => /stroke="#fff"/.test(p) && /stroke-width="3"/.test(p)).length, 4, "× 흰 3 밑선 4개");
  assert.ok(paths.filter((p) => /stroke="#2b2b2b"/.test(p) && /stroke-width="0\.8"/.test(p)).length >= 4, "평행선 0.8");
  assert.ok(paths.filter((p) => /stroke="#2b2b2b"/.test(p) && /stroke-width="0\.7"/.test(p)).length >= 4, "연장선 0.7");
  assert.ok(paths.filter((p) => /stroke="#2b2b2b"/.test(p) && /stroke-width="1\.1"/.test(p)).length >= 4, "사선 1.1");
  assert.match(svg, /<text[^>]*stroke="#fff"[^>]*stroke-width="3\.78"[^>]*>100\.0 m</, "흰 halo = 글자 × 0.36");
}

// pptx: decorations.siteDims → 도형 이름 "대지 치수", 꺼짐이면 없음. 표고도 같다
{
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
  const [px, py] = toUtmk(plan.map.center);
  const map = { ...plan.map, siteOutline: { rings: [{ points: rect(700, 420).map(([x, y]) => toLngLat([px + x, py + y])), elevations: [18.9, 17.5, 18.2, 18.0] }] } };
  const names = (decorations) => {
    const { slide, calls } = stub();
    addEditableMap(slide, plan, map, { style: plan.style, format: "wide", reportFrame: { ...defaultFrame(), decorations: { north: true, scaleBar: true, locator: false, ...decorations } } });
    return calls.map((c) => c.args[1]?.objectName).filter(Boolean);
  };
  const on = names({ siteDims: true, siteElevations: false });
  assert.ok(on.some((n) => n.includes("|대지 치수|")), "치수 도형 이름");
  assert.ok(!on.some((n) => n.includes("|대지 표고|")), "표고는 꺼짐");
  const els = names({ siteDims: false, siteElevations: true });
  assert.ok(els.some((n) => n.includes("|대지 표고|")), "표고 도형 이름");
  assert.ok(!els.some((n) => n.includes("|대지 치수|")));
  const off = names({ siteDims: false, siteElevations: false });
  assert.ok(!off.some((n) => n.includes("|대지 치수|") || n.includes("|대지 표고|")), "꺼짐이면 도형 없음");
  assert.ok(!names({}).some((n) => n.includes("|대지 치수|")), "옛 장식은 기본 꺼짐");
}

// state: 기본값 꺼짐, 옛 decorations({north,scaleBar,locator})는 siteDims·siteElevations false로 정규화
{
  assert.deepEqual(defaultFrame().decorations, { north: true, scaleBar: true, locator: false, siteDims: false, siteElevations: false });
  const page = (decorations) => ({ id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "tile", tileId: "t-A01", part: { type: "single" }, settings: { face: "front" }, frame: { decorations } });
  const restore = (decorations) => restoreReportDoc({ v: 1, format: "wide", pages: [page(decorations)] }, new Set(["t-A01"])).pages[0].frame.decorations;
  assert.deepEqual(restore({ north: false, scaleBar: true, locator: true }), { north: false, scaleBar: true, locator: true, siteDims: false, siteElevations: false });
  assert.deepEqual(restore({ siteDims: true, siteElevations: true }), { north: true, scaleBar: true, locator: false, siteDims: true, siteElevations: true });
  assert.deepEqual(restore({ siteDims: "yes" }).siteDims, false, "boolean이 아니면 무시");
}

console.log("test-v2-site-marks: ok");
