/** 보고서 문서 → 기존 슬라이드 계획 어댑터 계약. */
import assert from "node:assert/strict";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, REPORT_SOURCE_ROWS_PER_SLIDE, tileReportSettingsFromBoard, tileSlides } = await import("../../lib/v2/report/report-plan.ts");
const { EMPTY_REPORT_DOC, defaultFrame, mergeReportFontSizes, reportDocReducer } = await import("../../lib/v2/report/report-doc.ts");
const { importLegacyReport, pagesForTile, planReportDoc, printedPageCount, recommendedPages } = await import("../../lib/v2/report/report-doc-plan.ts");
const { pageStripItems, pageStripLabel } = await import("../../lib/v2/report/report-page-strip.ts");
const { sheetView } = await import("../../lib/v2/ui/sheet.ts");
const { withLegacyStyle } = await import("./legacy-report-fixture.mjs");

const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const board = initBoard(GODEOK_RESULTS);
const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const context = { summary, analysisDate: "2026-09-30" };
const tileContext = { ...context, views };

const legacy = importLegacyReport(EMPTY_REPORT_DOC, board, views, context);
const oldPlan = buildReportPlan({ summary, views, board, analysisDate: context.analysisDate });
assert.deepEqual(legacy.map((page) => page.kind), oldPlan.map((slide) => slide.kind), "옛 구성의 페이지 종류·순서");
const styledBoard = withLegacyStyle(board, [oldPlan.find((slide) => slide.kind === "tile")?.key], { offsetM: [80, -20] });
const styledPages = importLegacyReport(EMPTY_REPORT_DOC, styledBoard, views, context);
const styledTile = styledPages.find((page) => page.kind === "tile");
assert.deepEqual(styledTile?.frame.offsetM, [80, -20], "옛 styles의 offsetM을 페이지 frame으로 이관");

const restoredLegacyLayout = restoreReportDoc({
  v: 1,
  format: "wide",
  pages: [{ id: "legacy-tile", kind: "tile", layout: "side-by-side", panels: {}, textBoxes: [], notes: "", tileId: "t-A01", part: { type: "single" }, settings: { face: "front", callout: "overview" }, frame: defaultFrame() }],
}, new Set(["t-A01"]));
assert.equal(restoredLegacyLayout.pages[0]?.layout, "map-summary", "저장된 단일 타일 side-by-side는 map-summary로 마이그레이션");

const sheetSourceViews = [...views.values()].slice(0, 2);
assert.equal(sheetSourceViews.length, 2, "조판 변환용 원본 타일");
const sheetParent = sheetView("t-SHEET", sheetSourceViews, "2x2");
const sheetPages = pagesForTile(EMPTY_REPORT_DOC, sheetParent.tileId, sheetParent, tileReportSettingsFromBoard(board, sheetSourceViews[0].tileId), { ...tileContext, settingsFor: (id) => tileReportSettingsFromBoard(board, id) });
assert.equal(sheetPages.length, 1, "SHEET는 한 페이지로 변환");
assert.equal(sheetPages[0]?.kind, "compare", "SHEET는 compare 문서 페이지로 저장");
assert.equal(sheetPages[0]?.layout, "map-summary", "compare는 사용자 레이아웃 선택 없이 공통 형식을 쓴다");
assert.equal(sheetPages[0]?.sameExtent, false, "새 compare는 sameExtent 기본 false");
assert.equal(sheetPages[0]?.cells.length, 4, "SHEET의 격자 빈 칸 위치를 보존");
assert.equal(sheetPages[0]?.cells[2], null, "SHEET의 빈 칸은 null로 남긴다");
const framedSheetDoc = reportDocReducer({ ...EMPTY_REPORT_DOC, pages: sheetPages }, { type: "frame", id: sheetPages[0].id, cell: 0, patch: { zoomDelta: 2, offsetM: [12, -4] } });
const framedSheetPlan = planReportDoc(framedSheetDoc, views, tileContext);
assert.equal(framedSheetPlan[0]?.kind, "sheet", "compare 페이지는 미리보기/PPT 공통 sheet 계획을 만든다");
assert.equal(framedSheetPlan[0]?.cells[0]?.reportFrame.zoomDelta, 2, "칸 frame은 계획에 전달된다");
assert.deepEqual(framedSheetPlan[0]?.cells[0]?.reportFrame.offsetM, [12, -4], "칸 이동도 계획에 전달된다");

const sheetResult = { ...board.results[0], tileId: "t-SHEET", tileCode: "SHEET" };
const sheetBoard = {
  ...board,
  results: [...board.results, sheetResult],
  order: [...board.order, "t-SHEET"],
  included: { ...board.included, "t-SHEET": true },
};
const sheetViews = new Map(views);
sheetViews.set("t-SHEET", sheetParent);
const recommendedWithSheet = recommendedPages(EMPTY_REPORT_DOC, sheetViews, sheetBoard, context);
assert.ok(recommendedWithSheet.some((page) => page.kind === "compare" && page.cells[0]?.tileId === sheetSourceViews[0].tileId), "추천 구성의 SHEET는 compare로 저장");
const importedWithSheet = importLegacyReport(EMPTY_REPORT_DOC, sheetBoard, sheetViews, context);
assert.ok(importedWithSheet.some((page) => page.kind === "compare" && page.cells[0]?.tileId === sheetSourceViews[0].tileId), "옛 구성 복원의 SHEET도 compare로 저장");

assert.ok(styledTile, "font size precedence page");
const fontDoc = {
  v: 1,
  format: "wide",
  fontSizes: { title: 24, summary: 16, legend: 12, labels: 14, source: 10 },
  pages: styledPages.map((page) => page.id === styledTile.id ? { ...page, fontSizes: { title: 28, labels: 15 } } : page),
};
const fontPlan = planReportDoc(fontDoc, views, context);
const fontTile = fontPlan.find((slide) => slide.page?.id === styledTile.id);
assert.deepEqual(fontTile?.style.fontSizes, mergeReportFontSizes(fontDoc.fontSizes, { title: 28, labels: 15 }), "page fontSizes take precedence in the planned PageStyle");

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
const manySourceSlides = manyPlan.filter((slide) => slide.kind === "sources");
assert.equal(manySourceSlides.length, 3, "출처 30행은 실제 슬라이드 3장");
const sourceRowCounts = manySourceSlides.map((slide) => slide.rows.length);
assert.ok(sourceRowCounts.every((count) => count > 0 && count <= REPORT_SOURCE_ROWS_PER_SLIDE), "출처 행은 REPORT_SOURCE_ROWS_PER_SLIDE를 넘지 않는다");
assert.ok(sourceRowCounts.slice(0, -1).every((count) => count === REPORT_SOURCE_ROWS_PER_SLIDE), "마지막 전 출처 장은 REPORT_SOURCE_ROWS_PER_SLIDE만큼 채운다");
assert.equal(new Set(manySourceSlides.map((slide) => slide.key)).size, manySourceSlides.length, "확장된 출처 장의 key는 서로 다르다");
assert.equal(new Set(manyPlan.map((slide) => slide.key)).size, manyPlan.length, "전체 계획의 key도 서로 다르다");
const manyStripItems = pageStripItems(manySourcePages, manyPlan);
assert.equal(manyStripItems.length, manyPlan.length, "페이지 줄은 확장된 출력 계획의 모든 장을 표시한다");
assert.deepEqual(
  manyStripItems.filter((item) => item.page.kind === "sources").map((item) => pageStripLabel(item)),
  ["출처·기준일 1/3", "출처·기준일 2/3", "출처·기준일 3/3"],
  "출처 continuation label",
);
assert.ok(manyStripItems.every((item) => manySourcePages.some((page) => page.id === item.page.id)), "모든 strip 항목은 doc page에 매핑된다");

const noExpansionDoc = { v: 1, format: "wide", pages: a05Pages };
const noExpansionPlan = planReportDoc(noExpansionDoc, views, context);
const noExpansionStripItems = pageStripItems(a05Pages, noExpansionPlan);
assert.equal(noExpansionStripItems.length, a05Pages.length, "확장 없는 페이지 줄은 기존 장 수를 유지한다");
assert.deepEqual(noExpansionStripItems.map((item) => item.page.id), a05Pages.map((page) => page.id), "확장 없는 페이지 순서·매핑 유지");
assert.ok(noExpansionStripItems.every((item) => item.continuationCount === 1 && !pageStripLabel(item).includes("/")), "확장 없는 label은 continuation 표식을 붙이지 않는다");

const missingPages = pagesForTile(EMPTY_REPORT_DOC, "t-D17", toTileView({ ...GODEOK_RESULTS[0], tileId: "t-D17", tileCode: "D17" }), { face: "front", callout: "overview" }, tileContext);
const missingDoc = { v: 1, format: "wide", pages: missingPages };
const missingPlan = planReportDoc(missingDoc, new Map(), context);
assert.equal(missingPlan.length, missingPages.length, "결과가 없어도 페이지가 사라지지 않음");
assert.ok(missingPlan.every((slide) => slide.kind === "tile" && slide.missing === true), "없는 결과는 missing 슬라이드");
assert.ok(missingPlan.every((slide) => slide.kind === "tile" && slide.view.title === "지형·등고선"), "missing 제목은 타일 카탈로그 이름");
assert.ok(missingPlan.every((slide) => slide.kind === "tile" && slide.body.kind === "state" && slide.body.message.includes("결과 없음")), "missing 자리표시 문구");

console.log("v2 report doc plan tests passed");
