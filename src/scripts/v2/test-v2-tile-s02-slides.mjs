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
board = boardReducer(board, { type: "cut", id: "t-S02", cut: { tile: "S02", mode: "hours3", date: "winter" } });
assert.deepEqual(board.cuts["t-S02"], { tile: "S02", mode: "hours3", date: "winter" });
assert.equal(board.undoStack.length, 0);
assert.equal(boardReducer(board, { type: "cuts", id: "t-S02", cuts: 2 }), board, "옛 숫자 컷도 1 또는 3 이외는 무시");

const views = new Map([[s02Result.tileId, view]]);
const plan3 = buildReportPlan({ summary, views, board, analysisDate: "2026-09-30" });
const sheet = plan3.find((p) => p.kind === "sheet");
assert.ok(sheet);
assert.equal(sheet.grid, "3x1");
assert.equal(sheet.cells.length, 3);
assert.deepEqual(sheet.cells.map((cell) => cell.mapKey), ["t-S02:cut09", "t-S02:cut12", "t-S02:cut15"]);
assert.deepEqual(sheet.cells.map((cell) => cell.view.notes[0]), ["동지 09:00", "동지 12:00", "동지 15:00"]);
for (const [index, cell] of sheet.cells.entries()) {
  assert.deepEqual(new Set(cell.view.map.polygons.map((polygon) => polygon.layer)), new Set([`shadow_${["09", "12", "15"][index]}`, "sun_face"]));
}
assert.equal(reportPages(board).pages, 3, "3컷도 한 장으로 센다");

const oneBoard = boardReducer(board, { type: "cut", id: "t-S02", cut: { tile: "S02", mode: "single", date: "winter" } });
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

// I-4: 보고서 문서(조판 compare 쪽)로 가져와도 3컷의 칸마다 시각(그림자 층·노트)이 남는다 — 칸이 컷 칸 번호를 갖고 계획 단계가 다시 만든다.
{
  const { EMPTY_REPORT_DOC } = await import("../../lib/v2/report/report-doc.ts");
  const { importLegacyReport, planReportDoc } = await import("../../lib/v2/report/report-doc-plan.ts");
  const ctx = { summary, analysisDate: "2026-09-30", views };
  const pages = importLegacyReport(EMPTY_REPORT_DOC, board, views, ctx);
  const compare = pages.find((page) => page.kind === "compare");
  assert.ok(compare, "3컷은 조판 쪽으로 온다");
  assert.deepEqual(compare.cells.map((cell) => cell.cutCell), [0, 1, 2].map((index) => ({ sheet: 0, index })));
  const drawn = planReportDoc({ ...EMPTY_REPORT_DOC, pages }, views, ctx).find((slide) => slide.kind === "sheet");
  assert.deepEqual(drawn.cells.map((cell) => cell.view.notes[0]), ["동지 09:00", "동지 12:00", "동지 15:00"], "칸마다 그 시각");
  for (const [index, cell] of drawn.cells.entries()) {
    assert.deepEqual(new Set(cell.view.map.polygons.map((polygon) => polygon.layer)), new Set([`shadow_${["09", "12", "15"][index]}`, "sun_face"]), "칸마다 그 시각의 그림자 층");
  }
}

// M-6: PPT 조판 칸 범례는 값 래스터 단계(일조시간 16단계 등)를 싣지 않는다 — 칸 4개 한도가 래스터 단계로 차지 않고, 화면 조판 칸도 범례를 그리지 않는다.
{
  const { cellLegendItems } = await import("../../lib/v2/report/map-pptx.ts");
  const { slideLegend } = await import("../../lib/v2/ui/overlay-layout.ts");
  const ref = { name: "sun", kind: "value", crs: "EPSG:5179", x0: 960000, y0: 1950000, cellM: 1, cols: 10, rows: 10, dtype: "u8", bands: 1, scale: 1, offset: 0, nodata: 255, palette: "sun_hours", label: "일조시간", bytes: 100, sha256: "a".repeat(64) };
  const model = { ...view.map, rasters: [ref] };
  assert.ok(slideLegend(model, true).items.filter((item) => item.swatch === "raster").length >= 10, "전제: 쪽 범례에는 래스터 단계가 여럿 있다");
  const shown = cellLegendItems(model);
  assert.equal(shown.filter((item) => item.swatch === "raster").length, 0, "칸 범례에는 래스터 단계가 없다");
  assert.ok(shown.some((item) => item.site), "대지 항목은 남는다");
  assert.ok(shown.length <= 5, "칸 범례 항목 한도");
}

console.log("✓ v2 S02 1/3 cut report slides");
