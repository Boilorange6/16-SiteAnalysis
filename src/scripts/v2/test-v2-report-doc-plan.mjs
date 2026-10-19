/** 보고서 문서 → 기존 슬라이드 계획 어댑터 계약. */
import assert from "node:assert/strict";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, tileReportSettingsFromBoard, tileSlides } = await import("../../lib/v2/report/report-plan.ts");
const { EMPTY_REPORT_DOC } = await import("../../lib/v2/report/report-doc.ts");
const { importLegacyReport, pagesForTile, planReportDoc, printedPageCount, recommendedPages } = await import("../../lib/v2/report/report-doc-plan.ts");

const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const board = initBoard(GODEOK_RESULTS);
const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const context = { summary, analysisDate: "2026-09-30" };
const tileContext = { ...context, views };

const legacy = importLegacyReport(EMPTY_REPORT_DOC, board, views, context);
const oldPlan = buildReportPlan({ summary, views, board, analysisDate: context.analysisDate });
assert.deepEqual(legacy.map((page) => page.kind), oldPlan.map((slide) => slide.kind), "옛 구성의 페이지 종류·순서");
const styledBoard = boardReducer(board, { type: "pageStyle", keys: [oldPlan.find((slide) => slide.kind === "tile")?.key], patch: { offsetM: [80, -20] } });
const styledPages = importLegacyReport(EMPTY_REPORT_DOC, styledBoard, views, context);
const styledTile = styledPages.find((page) => page.kind === "tile");
assert.deepEqual(styledTile?.frame.offsetM, [80, -20], "옛 styles의 offsetM을 페이지 frame으로 이관");

const a05View = views.get("t-A05");
assert.ok(a05View, "A05 view");
const a05Pages = pagesForTile(EMPTY_REPORT_DOC, "t-A05", a05View, { ...tileReportSettingsFromBoard(board, "t-A05"), callout: "top10" }, tileContext);
assert.equal(a05Pages.length, tileSlides("t-A05", a05View, { ...tileReportSettingsFromBoard(board, "t-A05"), callout: "top10" }, { summary, complexCounts: { "t-A05": a05View.callout.complexes.length }, views }).length, "타일 펼치기 장수");
assert.equal(a05Pages.length, 2, "A05 top10은 개요와 설명표");

const recommended = recommendedPages(EMPTY_REPORT_DOC, views, board, context);
assert.equal(recommended[0]?.kind, "cover", "추천 구성 첫 장은 표지");
assert.equal(recommended.at(-1)?.kind, "sources", "추천 구성 마지막 장은 출처");

const manySources = new Map(views);
const sourceView = manySources.get("t-A01");
assert.ok(sourceView, "source fixture");
manySources.set("t-A01", { ...sourceView, sourceRefs: [], sourceLine: Array.from({ length: 30 }, (_, index) => `자료 ${index + 1} 2026-09-01`).join(" · ") });
const manySourcePages = recommendedPages(EMPTY_REPORT_DOC, manySources, board, context);
assert.equal(printedPageCount({ v: 1, format: "wide", pages: manySourcePages }, manySources, context), manySourcePages.length - 1 + 3, "출처 30행은 3쪽으로 계산");
const manyPlan = planReportDoc({ v: 1, format: "wide", pages: manySourcePages }, manySources, context);
assert.equal(manyPlan.filter((slide) => slide.kind === "sources").length, 3, "출처 30행은 실제 슬라이드 3장");

const missingPages = pagesForTile(EMPTY_REPORT_DOC, "t-D17", toTileView({ ...GODEOK_RESULTS[0], tileId: "t-D17", tileCode: "D17" }), { face: "front", callout: "overview" }, tileContext);
const missingDoc = { v: 1, format: "wide", pages: missingPages };
const missingPlan = planReportDoc(missingDoc, new Map(), context);
assert.equal(missingPlan.length, missingPages.length, "결과가 없어도 페이지가 사라지지 않음");
assert.ok(missingPlan.every((slide) => slide.kind === "tile" && slide.missing === true), "없는 결과는 missing 슬라이드");
assert.ok(missingPlan.every((slide) => slide.kind === "tile" && slide.view.title === "지형·등고선"), "missing 제목은 타일 카탈로그 이름");
assert.ok(missingPlan.every((slide) => slide.kind === "tile" && slide.body.kind === "state" && slide.body.message.includes("결과 없음")), "missing 자리표시 문구");

console.log("v2 report doc plan tests passed");
