/** D22 바람장미: 쐐기 모델·SVG·보고서 전면 이미지 계약. */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";

const { roseWedges } = await import("../../lib/v2/ui/wind-rose.ts");
const { WindRoseFigure } = await import("../../components/v2/wind-rose-figure.tsx");
const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const dirs = Array.from({ length: 16 }, (_, dir) => (dir === 14 ? [0, 40, 0, 0, 0] : [1, 0, 0, 0, 0]));
const model = { station: "near", dirs, calmHours: 10, missingHours: 5, totalHours: 100 };
const wedges = roseWedges(model, 240, 180, 120);
assert.equal(wedges.length, 80);
assert.ok(Math.abs(wedges.reduce((sum, wedge) => sum + wedge.pct, 0) - 100) < 0.1);
assert.ok(wedges.every((wedge) => wedge.path.startsWith("M")));

const markup = renderToStaticMarkup(React.createElement(WindRoseFigure, { model, width: 960, height: 540, fixed: true, label: "D22 바람장미" }));
assert.ok((markup.match(/<path/g) ?? []).length >= 80);
assert.match(markup, /정온 10%/);
assert.match(markup, /결측 5% · 지점 near/);
const summerMarkup = renderToStaticMarkup(React.createElement(WindRoseFigure, { model, width: 960, height: 540, fixed: true, season: "summer" }));
assert.match(summerMarkup, /data-season="summer"/);
assert.match(summerMarkup, /여름 바람장미/);

const d22Result = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "D04"));
d22Result.tileId = "t-D22";
d22Result.tileCode = "D22";
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
assert.deepEqual(view.rose, model);
assert.deepEqual(view.roses.summer, model);
const board = initBoard([d22Result]);
const plan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, [d22Result]), views: new Map([[d22Result.tileId, view]]), board, analysisDate: "2026-09-30" });
const d22Slide = plan.find((p) => p.kind === "tile" && p.view.code === "D22");
assert.ok(d22Slide?.rose);
assert.equal(d22Slide.map, null);
assert.deepEqual(mapKeysOf(d22Slide), ["t-D22:rose"]);

const zip = await JSZip.loadAsync(await renderReportPptx(plan));
const slide = await zip.file("ppt/slides/slide2.xml").async("string");
assert.match(slide, /바람장미/);
assert.match(slide, /정온/);

console.log("✓ v2 D22 wind rose figure and report");
