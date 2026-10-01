import assert from "node:assert/strict";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { stackView } = await import("../../lib/v2/ui/stack.ts");
const { initBoard, boardReducer, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { buildReportPlan, complexCounts } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const a01 = toTileView(GODEOK_RESULTS.find((result) => result.tileCode === "A01"));
const d04 = toTileView(GODEOK_RESULTS.find((result) => result.tileCode === "D04"));
const stacked = stackView("stack:1", [a01, d04]);

assert.equal(stacked.code, "STACK");
assert.equal(stacked.title, "레이어 스택");
assert.equal(stacked.kindLabel, "스택");
assert.equal(stacked.headline.value, "2층");
assert.equal(stacked.headline.label, "입지·대중교통 + 준공 연대");
assert.equal(stacked.map.features.length, a01.map.features.length + d04.map.features.length);
assert.equal(stacked.map.total, a01.map.total + d04.map.total);
assert.ok(stacked.notes.includes("입지·대중교통") && stacked.notes.includes("준공 연대"));
assert.ok(stacked.sourceLine.includes("rail") && stacked.sourceLine.includes("GIS건물통합정보"));
assert.equal(stacked.hasFace, false);
assert.equal(stacked.chart, null);
assert.doesNotMatch(JSON.stringify(stacked), /종합|도보/);

let board = initBoard(GODEOK_RESULTS);
const originalOrder = [...board.order];
board = boardReducer(board, { type: "stack", layers: ["t-A01", "t-D04"] });
assert.deepEqual(board.stacks, { "stack:1": ["t-A01", "t-D04"] });
assert.equal(board.order.at(-1), "stack:1");
assert.equal(board.included["stack:1"], true);
assert.equal(board.faces["stack:1"], "front");
const afterStack = board;
board = boardReducer(board, { type: "undo" });
assert.deepEqual(board.order, originalOrder);
assert.deepEqual(board.stacks, {});
assert.equal(board.included["stack:1"], undefined);
board = afterStack;
board = boardReducer(board, { type: "unstack", id: "stack:1" });
assert.deepEqual(board.stacks, {});
assert.ok(!board.order.includes("stack:1"));
board = boardReducer(afterStack, { type: "stack", layers: ["t-S02", "t-A01"] });
assert.deepEqual(board.stacks, { "stack:1": ["t-A01", "t-D04"] }, "시뮬레이션 타일은 스택 층이 될 수 없다");

const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
views.set(stacked.tileId, stacked);
let reportBoard = afterStack;
reportBoard = boardReducer(reportBoard, { type: "include", id: "t-A01", value: false });
reportBoard = boardReducer(reportBoard, { type: "include", id: "t-D04", value: false });
const plan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS), views, board: reportBoard, analysisDate: "2026-09-30" });
const stackSlides = plan.filter((page) => page.kind === "tile" && page.view.code === "STACK");
assert.equal(stackSlides.length, 1);
assert.equal(stackSlides[0].faceLabel, "스택");
assert.equal(plan.length, reportPages(reportBoard, complexCounts(views)).pages);
const zip = await JSZip.loadAsync(await renderReportPptx(plan));
const stackSlideNo = plan.indexOf(stackSlides[0]) + 1;
const xml = await zip.file(`ppt/slides/slide${stackSlideNo}.xml`).async("string");
const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join("|");
assert.ok(text.includes("입지·대중교통") && text.includes("준공 연대"));
assert.ok(text.includes("rail") && text.includes("GIS건물통합정보"));

console.log("✓ v2 layer stack board and report");
