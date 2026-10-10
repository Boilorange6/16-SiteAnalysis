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

console.log("✓ v2 D22 wind rose figure and report");
