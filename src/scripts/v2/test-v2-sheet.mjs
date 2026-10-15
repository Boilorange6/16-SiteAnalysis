import assert from "node:assert/strict";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { sheetCells, sheetView } = await import("../../lib/v2/ui/sheet.ts");
const { initBoard, boardReducer, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { buildReportPlan, complexCounts, mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { SOURCE_NAMES } = await import("../../lib/v2/ui/tile-catalog.ts");

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (cell) => cell.x >= 0 && cell.y >= 0 && cell.x + cell.w <= 13.333 + 1e-6 && cell.y + cell.h <= 7.5 + 1e-6;
const cells2 = sheetCells("2x2");
assert.equal(cells2.length, 4);
assert.ok(cells2.every(inside));
assert.ok(cells2.every((cell) => Math.abs(cell.w / cell.h - 16 / 9) < 1e-9));
for (let i = 0; i < cells2.length; i += 1) for (let j = i + 1; j < cells2.length; j += 1) assert.equal(overlap(cells2[i], cells2[j]), false);

const cells3 = sheetCells("3x2");
assert.equal(cells3.length, 6);
assert.ok(cells3.every(inside));
assert.ok(cells3.every((cell) => Math.abs(cell.w - 4.2) < 1e-9 && Math.abs(cell.h - 3) < 1e-9));
for (let i = 0; i < cells3.length; i += 1) for (let j = i + 1; j < cells3.length; j += 1) assert.equal(overlap(cells3[i], cells3[j]), false);

const results = ["A01", "A03", "A04", "D04"].map((code) => GODEOK_RESULTS.find((result) => result.tileCode === code));
const views = new Map(results.map((result) => [result.tileId, toTileView(result)]));
const layerViews = results.map((result) => views.get(result.tileId));
const composed = sheetView("sheet:1", layerViews, "2x2");
assert.equal(composed.code, "SHEET");
assert.equal(composed.sheetGrid, "2x2");
assert.deepEqual(composed.sheetTiles, results.map((result) => result.tileId));

let board = initBoard(results);
board = boardReducer(board, { type: "sheet", tiles: results.map((result) => result.tileId), grid: "2x2" });
assert.deepEqual(board.sheets, { "sheet:1": { tiles: results.map((result) => result.tileId), grid: "2x2" } });
assert.equal(board.order.at(-1), "sheet:1");
assert.equal(board.included["sheet:1"], true);
const sheetBoard = board;
board = boardReducer(board, { type: "unsheet", id: "sheet:1" });
assert.deepEqual(board.sheets, {});
assert.ok(!board.order.includes("sheet:1"));

views.set(composed.tileId, composed);
for (const result of results) sheetBoard.included[result.tileId] = false;
const plan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, results), views, board: sheetBoard, analysisDate: "2026-09-30" });
const sheetSlides = plan.filter((page) => page.kind === "sheet");
assert.equal(sheetSlides.length, 1);
assert.equal(sheetSlides[0].cells.length, 4);
assert.deepEqual(mapKeysOf(sheetSlides[0]), results.map((result) => `${result.tileId}:cell`));
assert.equal(plan.length, reportPages(sheetBoard, complexCounts(views)).pages);

const onePixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const images = Object.fromEntries(mapKeysOf(sheetSlides[0]).map((key) => [key, onePixel]));
const zip = await JSZip.loadAsync(await renderReportPptx(plan, images));
const sheetSlideNo = plan.indexOf(sheetSlides[0]) + 1;
const xml = await zip.file(`ppt/slides/slide${sheetSlideNo}.xml`).async("string");
const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join("|");
assert.equal((xml.match(/<p:pic>/g) ?? []).length, 4);
assert.ok(text.includes("A01") && text.includes("D04"));
// 긴 출처 띠는 한 줄로 축약할 수 있으므로 전체 원천명은 출처 장에서 검증한다.
assert.ok(text.includes("출처") && (text.includes(SOURCE_NAMES.rail) && text.includes("GIS건물통합정보") || text.includes("출처 장 참조")));

console.log("✓ v2 sheet layout and report");
