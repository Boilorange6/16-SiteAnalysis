/** S02 보고서 컷 선택: 보드 저장·3×1 조판·시각별 수광면 지도. */
import assert from "node:assert/strict";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { sheetCells } = await import("../../lib/v2/ui/sheet.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const ring = (offset) => [[127.15 + offset, 37.55], [127.151 + offset, 37.55], [127.151 + offset, 37.551], [127.15 + offset, 37.551]];
const s02Result = structuredClone(GODEOK_RESULTS.find((r) => r.tileCode === "D04"));
s02Result.tileId = "t-S02";
s02Result.tileCode = "S02";
s02Result.tileType = "simulation";
s02Result.presentation = {
  ...s02Result.presentation,
  features: [],
  featuresTotal: 0,
  lines: [],
  polygons: [
    { layer: "sun_face", rings: [ring(0)] },
    { layer: "shadow_09", rings: [ring(0.002)] },
    { layer: "shadow_12", rings: [ring(0.004)] },
    { layer: "shadow_15", rings: [ring(0.006)] },
  ],
  polygonsTotal: 4,
};
const view = toTileView(s02Result);
const summary = toSummaryView(GODEOK_SUMMARY, [s02Result]);

let board = initBoard([s02Result]);
assert.deepEqual(board.cuts, {});
board = boardReducer(board, { type: "cuts", id: "t-S02", cuts: 3 });
assert.equal(board.cuts["t-S02"], 3);
assert.equal(board.undoStack.length, 0);
assert.equal(boardReducer(board, { type: "cuts", id: "t-S02", cuts: 2 }), board, "1 또는 3 이외의 컷 수는 무시");

const views = new Map([[s02Result.tileId, view]]);
const plan3 = buildReportPlan({ summary, views, board, analysisDate: "2026-09-30" });
const sheet = plan3.find((p) => p.kind === "sheet");
assert.ok(sheet);
assert.equal(sheet.grid, "3x1");
assert.equal(sheet.cells.length, 3);
assert.deepEqual(sheet.cells.map((cell) => cell.mapKey), ["t-S02:cut09", "t-S02:cut12", "t-S02:cut15"]);
assert.deepEqual(sheet.cells.map((cell) => cell.view.notes[0]), ["09:00", "12:00", "15:00"]);
for (const [index, cell] of sheet.cells.entries()) {
  assert.deepEqual(new Set(cell.view.map.polygons.map((polygon) => polygon.layer)), new Set([`shadow_${["09", "12", "15"][index]}`, "sun_face"]));
}
assert.equal(reportPages(board).pages, 3, "3컷도 한 장으로 센다");

const oneBoard = boardReducer(board, { type: "cuts", id: "t-S02", cuts: 1 });
const plan1 = buildReportPlan({ summary, views, board: oneBoard, analysisDate: "2026-09-30" });
assert.equal(plan1.filter((p) => p.kind === "sheet").length, 0);
assert.equal(plan1.filter((p) => p.kind === "tile" && p.view.code === "S02").length, 1);
assert.equal(reportPages(oneBoard).pages, reportPages(board).pages);

const cells = sheetCells("3x1");
assert.equal(cells.length, 3);
assert.ok(cells.every((cell) => Math.abs(cell.w / cell.h - 16 / 9) < 0.01));
assert.ok(cells[1].x - (cells[0].x + cells[0].w) > 0.14);

const zip = await JSZip.loadAsync(await renderReportPptx(plan3));
const slide = await zip.file("ppt/slides/slide2.xml").async("string");
assert.match(slide, /09:00/);
assert.match(slide, /12:00/);
assert.match(slide, /15:00/);

console.log("✓ v2 S02 1/3 cut report slides");
