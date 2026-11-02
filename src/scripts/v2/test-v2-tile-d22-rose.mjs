/** D22 바람장미: 쐐기 모델·SVG·보고서 전면 이미지 계약. */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";

const { roseWedges } = await import("../../lib/v2/ui/wind-rose.ts");
const { WindRoseFigure, windRoseLayout } = await import("../../components/v2/wind-rose-figure.tsx");
const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { boardReducer, initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { formatDistanceM, sourceLineOf, toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const dirs = Array.from({ length: 16 }, (_, dir) => (dir === 14 ? [0, 40, 0, 0, 0] : [1, 0, 0, 0, 0]));
const model = { station: "near", dirs, calmHours: 10, missingHours: 5, totalHours: 100 };
const wedges = roseWedges(model, 240, 180, 120);
assert.equal(wedges.length, 80);
assert.ok(Math.abs(wedges.reduce((sum, wedge) => sum + wedge.pct, 0) - 100) < 0.1);
assert.ok(wedges.every((wedge) => wedge.path.startsWith("M")));

const markup = renderToStaticMarkup(React.createElement(WindRoseFigure, { model, width: 960, height: 540, fixed: true, label: "D22 바람장미", chrome: "standalone" }));
assert.ok((markup.match(/<path/g) ?? []).length >= 80);
assert.match(markup, /정온 10%/);
assert.match(markup, /결측 5% · 지점 near/);
const summerMarkup = renderToStaticMarkup(React.createElement(WindRoseFigure, { model, width: 960, height: 540, fixed: true, season: "summer", chrome: "standalone" }));
assert.match(summerMarkup, /data-season="summer"/);
assert.match(summerMarkup, /여름 바람장미/);
assert.match(summerMarkup, /data-north-tick="true"/);
assert.match(summerMarkup, /stroke-width="4"/);
assert.match(summerMarkup, /font-size="14"/);
assert.match(summerMarkup, /stroke-width="1.1"/);
assert.match(summerMarkup, /#D8CDBE/);
assert.match(summerMarkup, /#453B33/);

// Frame chrome owns the title/footer, while the SVG keeps its rose labels and legend inside the free figure area.
const slideMarkup = renderToStaticMarkup(React.createElement(WindRoseFigure, { model, width: 960, height: 540, fixed: true, chrome: "slide" }));
assert.match(slideMarkup, /data-wind-rose-chrome="slide"/);
assert.match(slideMarkup, /data-wind-rose-legend="true"/);
assert.doesNotMatch(slideMarkup, /<text[^>]*>연간 바람장미<\/text>/);
assert.doesNotMatch(slideMarkup, /결측 5% · 지점 near/);

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const edgeGap = (a, b) => {
  const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (overlapX > 0 && overlapY > 0) return -Math.min(overlapX, overlapY);
  const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
  const dy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
  return Math.hypot(dx, dy);
};

const spaciousLayout = windRoseLayout(960, 540, "standalone", 14);
assert.deepEqual(spaciousLayout.ticks.map((tick) => tick.value), [5, 10, 15]);
const compactLayout = windRoseLayout(218.66, 162, "tile", 14);
assert.deepEqual(compactLayout.ticks.map((tick) => tick.value), [10, 20]);
assert.ok(compactLayout.tickBoxes.every((box, index) => compactLayout.tickBoxes.every((other, otherIndex) => index === otherIndex || !overlaps(box, other))), "compact: percentage ticks overlap");
assert.ok(compactLayout.tickBoxes.every((box) => compactLayout.labels.every((label) => !overlaps(box, label))), "compact: percentage tick overlaps direction label");
const compactMarkup = renderToStaticMarkup(React.createElement(WindRoseFigure, { model, width: 218.66, height: 162, fixed: true, chrome: "tile" }));
assert.equal((compactMarkup.match(/data-wind-rose-tick="true"/g) ?? []).length, 2);
const calmCircle = compactMarkup.match(/<circle[^>]*data-calm-circle="true"[^>]*>/)?.[0] ?? "";
assert.ok(calmCircle, "compact: calm circle marker");
assert.ok(Number(calmCircle.match(/r="([\d.]+)"/)?.[1]) < 30, "compact: calm circle remains oversized");

for (const chrome of ["tile", "slide"]) {
  const layout = windRoseLayout(960, 540, chrome);
  const titleCard = layout.titleReserved;
  const footer = layout.footerReserved;
  assert.ok(titleCard && footer, `${chrome} frame reservations`);
  assert.ok(layout.labels.every((label) => !overlaps(label, titleCard)), `${chrome}: label under title card`);
  assert.ok(layout.labels.every((label) => !overlaps(label, footer)), `${chrome}: label over footer`);
  assert.ok(layout.labels.every((label) => !overlaps(label, layout.legend)), `${chrome}: label under legend`);
  assert.ok(!overlaps(layout.legend, titleCard), `${chrome}: legend under title card`);
  assert.ok(!overlaps(layout.legend, footer), `${chrome}: legend over footer`);
  if (chrome === "slide") {
    const infoPanel = { x0: 631, y0: 22, x1: 960, y1: 516 };
    assert.ok(!overlaps(layout.legend, infoPanel), "slide: legend under info panel");
  }
}
for (const [columns, width, height] of [[2, 688, 455], [3, 453.33, 260], [4, 336, 162], [5, 265.59, 162], [6, 218.66, 162]]) {
  const layout = windRoseLayout(width, height, "tile");
  const rose = { x0: layout.cx - layout.rMax, y0: layout.cy - layout.rMax, x1: layout.cx + layout.rMax, y1: layout.cy + layout.rMax };
  const minGap = Math.min(...layout.labels.map((label) => edgeGap(label, layout.legend)));
  assert.ok(minGap >= 4, `${columns}열: 범례와 방향 글자 최소 간격 ${minGap.toFixed(2)}px`);
  assert.ok(!overlaps(layout.legend, rose), `${columns}열: 범례와 장미 겹침`);
  assert.ok(layout.labels.every((label, i) => !overlaps(label, layout.labels[(i + 1) % layout.labels.length])), `${columns}열: 방향 글자끼리 겹침`);
}
assert.ok(windRoseLayout(672, 492, "tile").rMax > windRoseLayout(336, 196, "tile").rMax, "4칸 바람장미도 실측 박스에 맞춰 커짐");

// 펼침 창: 오른쪽 정보 판(rightInset) 뒤로 장미 원·방위 글자·눈금·풍속 범례가 들어가면 안 된다.
for (const [width, height] of [[976, 648], [1392, 780]]) {
  const inset = 384;
  const free = width - inset;
  const layout = windRoseLayout(width, height, "tile", 16.4, inset);
  const rose = { x0: layout.cx - layout.rMax, y0: layout.cy - layout.rMax, x1: layout.cx + layout.rMax, y1: layout.cy + layout.rMax };
  const parts = { 장미: rose, 범례: layout.legend, ...Object.fromEntries(layout.labels.map((b, i) => [`방위 ${i}`, b])), ...Object.fromEntries(layout.tickBoxes.map((b, i) => [`눈금 ${i}`, b])) };
  for (const [name, b] of Object.entries(parts)) {
    assert.ok(b.x1 <= free + 0.5, `펼침 ${width}: ${name} x1 ${b.x1.toFixed(1)} > ${free}`);
    assert.ok(b.x0 >= 0, `펼침 ${width}: ${name} x0 ${b.x0.toFixed(1)} < 0`);
  }
  assert.ok(layout.labels.every((label) => !overlaps(label, layout.legend)), `펼침 ${width}: 방위 글자와 범례 겹침`);
  assert.ok(!overlaps(layout.legend, rose), `펼침 ${width}: 범례와 장미 겹침`);
  assert.ok(layout.rMax >= 150, `펼침 ${width}: 장미가 너무 작아짐 ${layout.rMax.toFixed(1)}`);
}
assert.deepEqual(windRoseLayout(976, 648, "tile", 16.4, 0), windRoseLayout(976, 648, "tile", 16.4), "inset 0 은 지금과 같다");
{
  const full = windRoseLayout(1392, 780, "tile", 16.4);
  const inset = windRoseLayout(1392, 780, "tile", 16.4, 384);
  assert.ok(inset.cx < full.cx || inset.rMax < full.rMax, "inset이 있으면 배치가 달라진다");
  const svg = renderToStaticMarkup(React.createElement(WindRoseFigure, { model, width: 976, height: 648, fixed: true, chrome: "tile", rightInset: 384 }));
  assert.match(svg, /viewBox="0 0 976 648"/, "배경 사각형·viewBox는 전체 폭 그대로");
  const legendX = Number(svg.match(/data-wind-rose-legend="true" transform="translate\(([\d.]+) /)?.[1]);
  assert.ok(legendX + 10 < 976 - 384, `SVG 범례 x ${legendX}가 정보 판 왼쪽`);
}

assert.equal(formatDistanceM(16_819), "16.8 km");
assert.equal(formatDistanceM(999), "999m");
assert.match(sourceLineOf([{ sourceId: "asos", releaseId: "real@2025-12-31", sourceAsOf: "2025-12-31", fetchedAt: "2026-10-01T00:00:00Z" }]), /^기상청 ASOS 시간자료 2025-12-31$/);

const d22Result = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "D04"));
d22Result.tileId = "t-D22";
d22Result.tileCode = "D22";
d22Result.metrics = [
  {
    id: "prevailing_dir_deg",
    label: "최빈 풍향 중심각(NNE)",
    value: 22.5,
    unit: "도",
    formulaVersion: "prevailing_dir_deg@1",
    numerator: 14,
    denominator: 100,
    status: "observed",
  },
  {
    id: "station_distance_m",
    label: "최근접 관측소 거리",
    value: 3000,
    unit: "m",
    formulaVersion: "station_distance_m@1",
    numerator: null,
    denominator: null,
    status: "observed",
  },
];
d22Result.presentation = {
  ...d22Result.presentation,
  features: [],
  featuresTotal: 0,
  polygons: [],
  lines: [],
  rose: model,
  roses: { annual: model, spring: model, summer: model, autumn: model, winter: model },
};
const view = toTileView(d22Result);
assert.equal(view.headline?.value, "최빈 풍향 북북동(NNE) 14%");
assert.deepEqual(view.rose, model);
assert.deepEqual(view.roses.summer, model);
const board = initBoard([d22Result]);
const plan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, [d22Result]), views: new Map([[d22Result.tileId, view]]), board, analysisDate: "2026-09-30" });
const d22Slide = plan.find((p) => p.kind === "tile" && p.view.code === "D22");
assert.ok(d22Slide?.rose);
assert.equal(d22Slide.roseSeason, "annual");
assert.equal(d22Slide.map, null);
assert.deepEqual(mapKeysOf(d22Slide), ["t-D22:rose"]);

const selectedBoard = boardReducer(board, { type: "cut", id: d22Result.tileId, cut: { tile: "D22", mode: "seasons4" } });
const seasonalPlan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, [d22Result]), views: new Map([[d22Result.tileId, view]]), board: selectedBoard, analysisDate: "2026-09-30" });
const d22Sheet = seasonalPlan.find((p) => p.kind === "sheet" && p.view.code === "D22");
assert.equal(d22Sheet?.grid, "2x2");
assert.deepEqual(d22Sheet?.cells.map((cell) => cell.roseSeason), ["spring", "summer", "autumn", "winter"]);
assert.deepEqual(mapKeysOf(d22Sheet), ["t-D22:rose-spring", "t-D22:rose-summer", "t-D22:rose-autumn", "t-D22:rose-winter"]);

const zip = await JSZip.loadAsync(await renderReportPptx(plan));
const slide = await zip.file("ppt/slides/slide2.xml").async("string");
assert.match(slide, /바람장미/);
assert.match(slide, /정온/);

// ── Task 8: 그림 장은 기하 map 틀을 채우고 숫자 카드·제목·각주에 가리지 않는다. 바탕지도를 그리지 않은 장의 각주에 바탕지도 출처가 없다
{
  const { EMPTY_REPORT_DOC } = await import("../../lib/v2/report/report-doc.ts");
  const { importLegacyReport, planReportDoc } = await import("../../lib/v2/report/report-doc-plan.ts");
  const { pageFrameFor, figureSceneSize } = await import("../../lib/v2/report/report-page-frame.ts");
  const { mapKeyOf } = await import("../../lib/v2/report/report-plan.ts");
  const { isFigureSlide, reportLayoutDecision } = await import("../../lib/v2/report/report-layout.ts");
  const { d22CutModule } = await import("../../lib/v2/tile/d22/cut.ts");
  const docViews = new Map([[d22Result.tileId, view]]);
  const docContext = { summary: toSummaryView(GODEOK_SUMMARY, [d22Result]), analysisDate: "2026-09-30", views: docViews };
  const docPages = importLegacyReport(EMPTY_REPORT_DOC, board, docViews, docContext);
  const docPlan = planReportDoc({ ...EMPTY_REPORT_DOC, pages: docPages }, docViews, docContext);
  const framed = docPlan.find((slide) => slide.kind === "tile" && slide.rose);
  const frame = framed && pageFrameFor(framed);
  assert.ok(frame, "D22 장은 새 장 배치로 그린다");
  assert.doesNotMatch(frame.footer.text, /VWorld|OpenStreetMap/, "지도가 없는 장의 각주에 바탕지도 출처가 없다");
  const geo = frame.geometry;
  const rosePng = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  const slideXml = await (await JSZip.loadAsync(await renderReportPptx(docPlan, { [mapKeyOf(framed)]: rosePng }))).file(`ppt/slides/slide${docPlan.indexOf(framed) + 1}.xml`).async("string");
  assert.doesNotMatch(slideXml, /VWorld|OpenStreetMap/, "PPT 장에도 바탕지도 출처가 없다");
  const pic = /<p:pic>[\s\S]*?<a:off x="(\d+)" y="(\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(slideXml);
  assert.ok(pic, "장미 그림이 장에 놓인다");
  const [px, py, pw, ph] = pic.slice(1).map((value) => Number(value) / 914400);
  for (const [name, got, want] of [["x", px, geo.map.x], ["y", py, geo.map.y], ["w", pw, geo.map.w], ["h", ph, geo.map.h]]) assert.ok(Math.abs(got - want) < 0.001, `장미 그림 ${name}은 기하 map 틀: ${got} ≈ ${want}`);

  // 화면(SSR, 1 in = 1 px): 그림 틀도 기하 map 틀이다. 바람장미는 틀 폭에 맞춰 줄여 그려진다.
  {
    const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");
    const markup = renderToStaticMarkup(React.createElement(SlideSurface, { slide: framed, basemap: "none", mode: "edit" }));
    const tag = /<div[^>]*data-part="map"[^>]*>/.exec(markup)?.[0];
    assert.ok(tag, "그림 틀(data-part=map)이 있다");
    const num = (prop) => Number(new RegExp(`${prop}:(-?[\\d.]+)(?:px)?[;"]`).exec(tag)?.[1] ?? NaN);
    for (const [name, got, want] of [["left", num("left"), geo.map.x], ["top", num("top"), geo.map.y], ["width", num("width"), geo.map.w], ["height", num("height"), geo.map.h]]) assert.ok(Math.abs(got - want) < 0.011, `화면 그림 틀 ${name}은 기하 map: ${got} ≈ ${want}`);
    assert.match(markup, /data-surface-figure="rose"/);
  }

  // 그림 장면은 지도 틀 모양이고, 그 안의 장미·방위 글자·눈금·범례는 숫자 카드(+주석 칩)·제목 칩과 겹치지 않으며 각주 띠 위에 있다.
  // 판형(wide·a3·a4)마다 같은 검사: 카드는 inch 고정인데 장미는 틀 높이에 비례해 커서 a4에서 카드에 닿았다(I-1).
  const { reportMapAvoid } = await import("../../lib/v2/report/report-page-frame.ts");
  const hit = (a, b) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
  for (const format of ["wide", "a3", "a4"]) {
    const formatFrame = pageFrameFor({ ...framed, format });
    assert.ok(formatFrame, `${format}도 새 장 배치`);
    const fgeo = formatFrame.geometry;
    const scene = figureSceneSize(fgeo);
    const layout = windRoseLayout(scene.w, scene.h, "frame", 16.4, 0, reportMapAvoid(fgeo, fgeo.scenePxPerInch));
    const perPx = fgeo.map.w / scene.w;
    const inch = (b) => ({ x: fgeo.map.x + b.x0 * perPx, y: fgeo.map.y + b.y0 * perPx, w: (b.x1 - b.x0) * perPx, h: (b.y1 - b.y0) * perPx });
    const covers = [["제목 칩", fgeo.title], ["숫자 카드", fgeo.keyCard], ["주석 칩", fgeo.keyNotesChip]].filter(([, rect]) => rect);
    // 장미 원은 원으로 잰다(바깥 상자는 모서리가 카드에 닿아 과하다)
    const circle = { x: fgeo.map.x + layout.cx * perPx, y: fgeo.map.y + layout.cy * perPx, r: layout.rMax * perPx };
    for (const [coverName, c] of covers) {
      const nx = Math.max(c.x, Math.min(circle.x, c.x + c.w));
      const ny = Math.max(c.y, Math.min(circle.y, c.y + c.h));
      assert.ok(Math.hypot(circle.x - nx, circle.y - ny) >= circle.r - 1e-6, `${format}: 장미 원이 ${coverName}에 가리지 않는다`);
    }
    assert.ok(circle.x - circle.r >= fgeo.map.x - 1e-6 && circle.x + circle.r <= fgeo.map.x + fgeo.map.w + 1e-6 && circle.y - circle.r >= fgeo.map.y - 1e-6 && circle.y + circle.r <= fgeo.map.y + fgeo.map.h + 1e-6, `${format}: 장미 원은 지도 틀 안`);
    const parts = [["범례", layout.legend], ...layout.labels.map((b, i) => [`방위 ${i}`, b]), ...layout.tickBoxes.map((b, i) => [`눈금 ${i}`, b])];
    for (const [partName, box] of parts) {
      const rect = inch(box);
      assert.ok(rect.y + rect.h <= fgeo.footer.y + 1e-6, `${format}: ${partName}은 각주 띠 위`);
      for (const [coverName, cover] of covers) assert.ok(!hit(rect, cover), `${format}: ${partName}이 ${coverName}에 가리지 않는다`);
    }
  }

  // 카드는 계절 보기를 따른다(spec §4-2): 4계절 컷은 연간 카드를 싣지 않고, 연간 컷 장은 연간 카드를 그대로 쓴다.
  const seasons = { tile: "D22", mode: "seasons4" };
  assert.equal(d22CutModule.view(view, seasons).keyFigure, null, "계절 4컷 보기는 연간 숫자 카드를 쓰지 않는다");
  const sheetPlan = d22CutModule.plan(view, seasons);
  assert.equal(sheetPlan.sheets[0].cells.length, 4);
  assert.ok(sheetPlan.sheets[0].cells.every((cell) => cell.view.keyFigure === null), "계절 칸은 연간 카드를 싣지 않는다");
  assert.ok(view.keyFigure, "전제: 연간 카드가 있다");
  assert.deepEqual(d22CutModule.plan(view, { tile: "D22", mode: "annual" }).single.view.keyFigure, view.keyFigure, "연간 컷 장은 연간 카드");

  // 그림 컷 시트 장(타일 쪽의 cutSheet 부분): 선택지가 「그림 + 숫자」 하나(map-key)이고 저장 값도 복원 뒤 같은 값이다.
  // 예전에 저장된 값은 지도가 없는 시트라 numbers-first였다. 그리는 단계가 map-key로 맞춘다.
  const tilePage = docPages.find((page) => page.kind === "tile");
  assert.ok(tilePage, "D22 타일 쪽");
  const sheetPage = { ...tilePage, id: "legacy-sheet", layout: "numbers-first", part: { type: "cutSheet", index: 0 }, settings: { ...tilePage.settings, cut: seasons } };
  const sheetSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [sheetPage] }, docViews, docContext).find((slide) => slide.kind === "sheet");
  assert.ok(sheetSlide && isFigureSlide(sheetSlide), "그림 칸만 있는 시트는 그림 장");
  assert.equal(sheetSlide.page.layout, "map-key", "그린 복사본은 map-key(저장 문서의 numbers-first는 열 때 map-key가 되므로 같은 값)");
  const decision = reportLayoutDecision({ pageKind: "tile", hasMap: false, figure: isFigureSlide(sheetSlide) });
  assert.deepEqual(decision.choices.map((choice) => [choice.value, choice.label]), [["map-key", "그림 + 숫자"]]);
  assert.equal(isFigureSlide({ kind: "sheet", cells: [{ rose: {} }, { view: {} }] }), false, "그림이 아닌 칸이 섞인 조판은 그림 장이 아니다");

  // I-4: D22 「계절 4컷」을 가져온 조판(compare) 장은 칸마다 장미와 계절을 다시 만든다(예전엔 대지 바탕 지도 4장이었다).
  {
    const { restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
    const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");
    const sheetBoard = boardReducer(board, { type: "cut", id: d22Result.tileId, cut: seasons });
    const imported = importLegacyReport(EMPTY_REPORT_DOC, sheetBoard, docViews, docContext);
    const compare = imported.find((page) => page.kind === "compare");
    assert.ok(compare, "계절 4컷은 조판(compare) 쪽으로 온다");
    assert.deepEqual(compare.cells.map((cell) => cell.cutCell), [0, 1, 2, 3].map((index) => ({ sheet: 0, index })), "칸마다 컷 칸 번호를 저장한다");
    // 저장·복원(옛 문서처럼 cutCell이 없는 칸도 읽힌다)
    const restored = restoreReportDoc({ ...EMPTY_REPORT_DOC, pages: imported }, new Set([d22Result.tileId]));
    assert.deepEqual(restored.pages.find((page) => page.kind === "compare").cells.map((cell) => cell.cutCell), compare.cells.map((cell) => cell.cutCell), "복원해도 컷 칸 번호가 같다");
    const legacyCells = compare.cells.map(({ cutCell: _cut, ...cell }) => cell);
    const legacy = restoreReportDoc({ ...EMPTY_REPORT_DOC, pages: imported.map((page) => (page.kind === "compare" ? { ...page, cells: legacyCells } : page)) }, new Set([d22Result.tileId]));
    assert.ok(legacy.pages.find((page) => page.kind === "compare").cells.every((cell) => cell.cutCell === undefined), "컷 정보 없는 옛 compare 장은 지금처럼 읽힌다");
    // M-5: 컷 정보가 없는 옛 compare 장도 칸이 모두 같은 컷 타일이고 칸 수가 컷 시트의 칸 수와 같으면 순서대로 컷 칸을 채워 그린다(장미 4개).
    const legacyPlan = planReportDoc(legacy, docViews, docContext);
    const legacySheet = legacyPlan.find((slide) => slide.kind === "sheet");
    assert.deepEqual(legacySheet.cells.map((cell) => cell.roseSeason), ["spring", "summer", "autumn", "winter"], "옛 compare 장도 칸 4개에 계절");
    assert.ok(legacySheet.cells.every((cell) => cell.rose), "옛 compare 장도 칸 4개에 장미");
    const legacyScreen = renderToStaticMarkup(React.createElement(SlideSurface, { slide: legacySheet, basemap: "none", mode: "export" }));
    assert.equal((legacyScreen.match(/data-wind-rose-chrome=/g) ?? []).length, 4, "옛 compare 장 화면에 장미 4개");
    const mixed = { ...legacy, pages: legacy.pages.map((page) => (page.kind === "compare" ? { ...page, cells: [page.cells[0], page.cells[1], page.cells[2], null] } : page)) };
    assert.ok(planReportDoc(mixed, docViews, docContext).find((slide) => slide.kind === "sheet").cells.every((cell) => !cell?.rose), "칸이 비어 있거나 수가 어긋나면 추론하지 않는다");
    const plan = planReportDoc({ ...EMPTY_REPORT_DOC, pages: imported }, docViews, docContext);
    const sheet = plan.find((slide) => slide.kind === "sheet");
    assert.deepEqual(sheet.cells.map((cell) => cell.roseSeason), ["spring", "summer", "autumn", "winter"], "칸 4개에 계절");
    assert.ok(sheet.cells.every((cell) => cell.rose), "칸 4개에 장미");
    assert.ok(isFigureSlide(sheet), "그림 칸만 있는 조판은 그림 장");
    // 화면(export 마크업): 장미 4개. 각주에 바탕지도 출처가 없다
    const screen = renderToStaticMarkup(React.createElement(SlideSurface, { slide: sheet, basemap: "none", mode: "export" }));
    assert.equal((screen.match(/data-wind-rose-chrome=/g) ?? []).length, 4, "화면에 장미 4개");
    assert.doesNotMatch(screen, /VWorld|OpenStreetMap/);
    // PPT sheet(): 칸마다 장미 그림(이미지), 대지 지도 도형 없음
    const images = Object.fromEntries(sheet.cells.map((cell) => [cell.mapKey, rosePng]));
    const xml = await (await JSZip.loadAsync(await renderReportPptx(plan, images))).file(`ppt/slides/slide${plan.indexOf(sheet) + 1}.xml`).async("string");
    assert.equal((xml.match(/<p:pic>/g) ?? []).length, 4, "PPT에 장미 그림 4장");
    assert.doesNotMatch(xml, /VWorld|OpenStreetMap/);
  }

  // M-6: PPT 조판 칸 그림(장미·매스)은 화면 칸처럼 칸 모양 장면(`figureSceneSize(칸)`)으로 만든다. 브라우저에서만 그려져 코드 모양으로 확인한다.
  {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../../lib/v2/report/map-image.ts", import.meta.url), "utf8");
    assert.match(source, /rasterizeRose\(cell\.rose, figureScene\.w, figureScene\.h, /, "칸 장미 그림은 칸 모양 장면");
    assert.match(source, /rasterizeMass\(cell\.mass, cell\.mass\.exploded, figureScene\.w, figureScene\.h\)/, "칸 매스 그림도 칸 모양 장면");
    assert.match(source, /figureSceneSize\(\{ map: cells\[cellIndex\]! \}\)/, "칸 자리(inch)로 장면을 정한다");
    const { figureSceneSize } = await import("../../lib/v2/report/report-page-frame.ts");
    const { sheetCells } = await import("../../lib/v2/ui/sheet.ts");
    for (const grid of ["2x2", "3x2", "3x1"]) for (const cell of sheetCells(grid)) {
      const scene = figureSceneSize({ map: cell });
      assert.ok(Math.abs(scene.w / scene.h - cell.w / cell.h) < 0.01, `${grid}: 장면 비율 = 칸 비율`);
    }
  }

  // M-1: 그림 칸만 있는 시트 장의 각주에도 바탕지도 출처가 없다(화면·PPT가 같은 판정 `footerCredit`)
  {
    const sheetFooter = await (await JSZip.loadAsync(await renderReportPptx([sheetSlide]))).file("ppt/slides/slide1.xml").async("string");
    assert.doesNotMatch(sheetFooter, /VWorld|OpenStreetMap/, "PPT 시트 장 각주에 바탕지도 출처가 없다");
    const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");
    assert.doesNotMatch(renderToStaticMarkup(React.createElement(SlideSurface, { slide: sheetSlide, basemap: "none", mode: "export" })), /VWorld|OpenStreetMap/, "화면 시트 장 각주에도 없다");
  }

  // M-5: 계절 자료가 모자라 연간 장미 한 장으로 돌아가면 연간 view(연간 카드)를 쓴다
  {
    const annualOnly = { ...view, roses: { annual: model } };
    assert.equal(d22CutModule.ready(annualOnly, seasons), false, "전제: 계절 4컷이 준비되지 않았다");
    const fallback = d22CutModule.plan(annualOnly, seasons);
    assert.equal(fallback.sheets.length, 0);
    assert.deepEqual(fallback.single.view.keyFigure, view.keyFigure, "연간 장미 장은 연간 카드");
    assert.ok(!fallback.single.view.notes.includes("계절 4컷"), "연간 장에 계절 4컷 노트가 없다");
  }
}

console.log("✓ v2 D22 wind rose figure and report");
