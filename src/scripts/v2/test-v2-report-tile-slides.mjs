/** 타일 하나의 보고서 슬라이드 분리 계약. */
import assert from "node:assert/strict";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { boardReducer, initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { calloutReportPages } = await import("../../lib/v2/ui/callout-layout.ts");
const { tileClientModuleFor } = await import("../../lib/v2/tile/client.ts");
const { complexCounts, buildReportPlan, tileReportSettingsFromBoard, tileSlides } = await import("../../lib/v2/report/report-plan.ts");

const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const counts = complexCounts(views);
const context = { summary, complexCounts: counts };

const board = initBoard(GODEOK_RESULTS);
const plan = buildReportPlan({ summary, views, board, analysisDate: "2026-09-30" });
for (const tileId of board.order.filter((id) => board.included[id])) {
  const view = views.get(tileId);
  assert.ok(view, `${tileId} view`);
  const direct = tileSlides(tileId, view, {
    face: board.faces[tileId] ?? "front",
    callout: board.callout[tileId] ?? "top10",
    labels: board.labels[tileId]?.map((label) => ({ ...label })),
  }, context);
  const planned = plan.filter((slide) => slide.key.startsWith(`${tileId}:`));
  assert.equal(direct.length, planned.length, `${tileId} 분리 슬라이드 장수`);
}

// S02 컷은 조판 장과 단일 장을 각각 하나의 슬라이드로 센다.
const s02Result = structuredClone(GODEOK_RESULTS.find((result) => result.tileCode === "D04"));
s02Result.tileId = "t-S02";
s02Result.tileCode = "S02";
s02Result.tileType = "simulation";
const s02View = toTileView(s02Result);
let s02Board = initBoard([s02Result]);
s02Board = boardReducer(s02Board, { type: "cut", id: "t-S02", cut: { tile: "S02", mode: "single", date: "winter" } });
const s02Cut = s02Board.cuts["t-S02"];
const s02Plan = tileClientModuleFor("S02")?.cut?.plan?.(s02View, s02Cut);
assert.ok(s02Plan, "S02 cut plan");
const s02Slides = tileSlides("t-S02", s02View, tileReportSettingsFromBoard(s02Board, "t-S02"), {
  summary: toSummaryView(GODEOK_SUMMARY, [s02Result]),
  complexCounts: {},
});
assert.equal(s02Slides.length, s02Plan.sheets.length + (s02Plan.single ? 1 : 0), "S02 컷 plan 장수");

const a05View = views.get("t-A05");
assert.ok(a05View, "A05 view");
const a05Slides = tileSlides("t-A05", a05View, {
  ...tileReportSettingsFromBoard(board, "t-A05"),
  callout: "top10",
}, context);
assert.equal(a05Slides.length, calloutReportPages("top10", counts["t-A05"]), "A05 top10 설명선 장수");

console.log("v2 report tile slides tests passed");
