/** 보고서 문서 → 기존 슬라이드 계획 어댑터 계약. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, REPORT_SOURCE_ROWS_PER_SLIDE, sourcePageCountForViews, sourceRowCountForViews, tileReportSettingsFromBoard, tileSlides } = await import("../../lib/v2/report/report-plan.ts");
const { EMPTY_REPORT_DOC, defaultFrame, historyApply, historyUndo, mergeReportFontSizes, reportDocReducer } = await import("../../lib/v2/report/report-doc.ts");
const { calloutPageFor, importLegacyReport, pagesForTile, planReportDoc, printedPageCount, recommendedPages } = await import("../../lib/v2/report/report-doc-plan.ts");
const { pageStripItems, pageStripLabel } = await import("../../lib/v2/report/report-page-strip.ts");
const { sheetView } = await import("../../lib/v2/ui/sheet.ts");
const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
const { withLegacyStyle } = await import("./legacy-report-fixture.mjs");

const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const board = initBoard(GODEOK_RESULTS);
const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const results = new Map(GODEOK_RESULTS.map((result) => [result.tileId, result]));
const context = { summary, analysisDate: "2026-09-30" };
const tileContext = { ...context, views };
const reportContext = { ...tileContext, results, scene: null, analysisSiteParcel: null };

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
assert.equal(restoredLegacyLayout.pages[0]?.layout, "map-key", "저장된 단일 타일 side-by-side는 map-key로 마이그레이션");

// 새 쪽 기본: 그림 타일(장미·매스)은 「그림 + 숫자」, 그 밖의 지도 없는 장은 「숫자 먼저」 (2026-10-30 결정 C)
{
  const base = views.get("t-A01");
  const roseModel = { station: "near", dirs: Array.from({ length: 16 }, () => [1, 0, 0, 0, 0]), calmHours: 1, missingHours: 0, totalHours: 100 };
  const figureCtx = { ...tileContext, views: new Map([["t-D22", { ...base, tileId: "t-D22", code: "D22", rose: roseModel }]]) };
  const rosePages = pagesForTile(EMPTY_REPORT_DOC, "t-D22", figureCtx.views.get("t-D22"), tileReportSettingsFromBoard(board, "t-A01"), figureCtx);
  assert.equal(rosePages[0]?.layout, "map-key", "새 바람장미 쪽 기본은 그림 + 숫자");
  assert.equal(pagesForTile(EMPTY_REPORT_DOC, "t-A01", views.get("t-A01"), tileReportSettingsFromBoard(board, "t-A01"), tileContext)[0]?.layout, "map-key", "지도 타일 기본은 지도 + 숫자");

  // 그리는 단계: 저장된 numbers-first·그래프 자료 없는 map-charts 지도 장은 map-key로 그린다(저장 문서는 그대로).
  const pageFor = (tileId) => pagesForTile(EMPTY_REPORT_DOC, tileId, views.get(tileId), tileReportSettingsFromBoard(board, tileId), tileContext)[0];
  const planOne = (page) => planReportDoc({ ...EMPTY_REPORT_DOC, pages: [page] }, views, tileContext)[0];
  const mapPage = pageFor("t-A01"); // 지도는 있고 그래프 자료는 없다
  assert.ok(planOne(mapPage).map && !analysisCharts(planOne(mapPage).map), "전제: A01은 지도가 있고 그래프 자료가 없다");
  for (const stored of ["numbers-first", "map-charts"]) {
    const drawn = planOne({ ...mapPage, layout: stored });
    assert.equal(drawn.page.layout, "map-key", `${stored} 지도 장(그래프 자료 없음)은 map-key로 그린다`);
  }
  // 그래프 자료가 있는 지도 장: numbers-first → map-charts. 끈 레이어로 자료를 잃으면 map-charts → map-key.
  const chartPage = pageFor("t-D04");
  assert.ok(analysisCharts(planOne(chartPage).map), "전제: D04에는 그래프 자료가 있다");
  assert.equal(planOne({ ...chartPage, layout: "numbers-first" }).page.layout, "map-charts", "numbers-first + 그래프 자료 → map-charts");
  assert.equal(planOne({ ...chartPage, layout: "map-key" }).page.layout, "map-key", "map-key를 고른 장은 그래프 자료가 있어도 map-key");
  const hiddenAll = { ...defaultFrame(), hiddenLayers: ["bldg_pre1980", "bldg_1980s", "bldg_1990s", "bldg_2000s", "bldg_2010s", "bldg_2020s", "bldg_unknown"] };
  assert.equal(planOne({ ...chartPage, layout: "map-charts", frame: hiddenAll }).page.layout, "map-key", "끈 레이어로 자료를 잃은 map-charts → map-key");

  // Ruling 18: 저장 문서의 자리는 판정이 바뀌어도 그대로, 그리는 복사본에서만 옛 요약·출처 자리를 뺀다.
  const summaryRect = { x: 0.7, y: 0.1, w: 0.25, h: 0.5 };
  const sourceRect = { x: 0.1, y: 0.9, w: 0.3, h: 0.05 };
  const oldPanels = { title: { x: 0.05, y: 0.05, w: 0.3, h: 0.08 }, summary: summaryRect, source: sourceRect };
  const restoreDoc = (page) => restoreReportDoc(JSON.parse(JSON.stringify({ v: 1, format: "wide", pages: [page] })), new Set(["t-A01", "t-A02", "t-D04"]));
  for (const stored of ["numbers-first", "map-charts"]) {
    const doc = restoreDoc({ ...mapPage, layout: stored, panels: oldPanels });
    assert.equal(doc.pages[0].layout, stored, `${stored}: 복원은 layout을 바꾸지 않는다`);
    assert.deepEqual(doc.pages[0].panels.summary, summaryRect, `${stored}: 저장 문서에는 요약 자리가 남는다`);
    assert.deepEqual(doc.pages[0].panels.source, sourceRect, `${stored}: 저장 문서에는 출처 자리가 남는다`);
    const drawn = planReportDoc(doc, views, tileContext)[0];
    assert.equal(drawn.page.layout, "map-key");
    assert.ok(!drawn.page.panels.summary && !drawn.page.panels.source, `${stored}: 그리는 복사본에는 옛 요약·출처 자리가 없다`);
    assert.ok(drawn.page.panels.title, "제목 자리는 그린다");
    // 화면(slide.style.panels)과 PPT(slide.page.panels)가 같은 자리를 읽는다(spec §7).
    assert.ok(!drawn.style.panels?.summary && !drawn.style.panels?.source, `${stored}: 그리는 style에도 옛 요약·출처 자리가 없다`);
    assert.deepEqual(drawn.style.panels, drawn.page.panels, `${stored}: slide.style.panels와 slide.page.panels가 같다`);
    // 실제 드래그 경로: 입력은 {...slide.style.panels, [옮긴 키]: rect}이고 그려진 layout을 함께 저장한다.
    const movedTitle = { x: 0.1, y: 0.1, w: 0.3, h: 0.08 };
    const afterDrag = (key, rect) => {
      const saved = reportDocReducer(doc, { type: "panels", id: doc.pages[0].id, panels: { ...drawn.style.panels, [key]: rect }, layout: drawn.page.layout });
      assert.equal(saved.pages[0].layout, "map-key", "그려진 layout도 함께 저장");
      const restored = restoreDoc(saved.pages[0]);
      return { restored, plan: planReportDoc(restored, views, tileContext)[0] };
    };
    const titleDrag = afterDrag("title", movedTitle);
    assert.deepEqual(titleDrag.restored.pages[0].panels.title, movedTitle, `${stored}: 옮긴 제목 자리가 저장된다`);
    assert.ok(!titleDrag.restored.pages[0].panels.summary && !titleDrag.restored.pages[0].panels.source, `${stored}: 제목을 옮겨도 옛 요약·출처 자리는 새 문서 자리로 둔갑하지 않는다`);
    assert.deepEqual(titleDrag.plan.style.panels?.title, movedTitle, "옮긴 제목은 style에도");
    assert.ok(!titleDrag.plan.style.panels?.summary && !titleDrag.plan.style.panels?.source, "계획 style에도 옛 자리가 없다");
    // 카드(요약 판)를 옮기면 옮긴 자리가 저장·복원·계획 뒤에도 남는다.
    const movedRect = { x: 0.6, y: 0.2, w: 0.3, h: 0.5 };
    const cardDrag = afterDrag("summary", movedRect);
    assert.deepEqual(cardDrag.plan.page.panels.summary, movedRect, `${stored}: 옮긴 요약 자리는 저장·복원·계획 뒤에도 남는다`);
    assert.deepEqual(cardDrag.plan.style.panels?.summary, movedRect, "style에도 남는다");
  }
  // 저장 numbers-first가 지도 + 그래프(map-charts)로 판정돼도 옛 요약·출처 자리는 그리는 page·style에서 뺀다(②에서는 카드를 옮길 수 없다).
  {
    const doc = restoreDoc({ ...chartPage, layout: "numbers-first", panels: oldPanels });
    assert.deepEqual(doc.pages[0].panels.summary, summaryRect, "저장 문서에는 요약 자리가 남는다");
    const drawn = planReportDoc(doc, views, tileContext)[0];
    assert.equal(drawn.page.layout, "map-charts");
    assert.ok(!drawn.page.panels.summary && !drawn.page.panels.source, "map-charts로 판정돼도 그리는 page에는 옛 자리가 없다");
    assert.deepEqual(drawn.style.panels, drawn.page.panels, "style도 같다");
    const chartsKept = planReportDoc(restoreDoc({ ...chartPage, layout: "map-charts", panels: oldPanels }), views, tileContext)[0];
    assert.equal(chartsKept.page.layout, "map-charts");
    assert.ok(!chartsKept.page.panels.summary && !chartsKept.page.panels.source, "저장 map-charts가 그대로 map-charts로 그려져도 옛 자리는 뺀다");
  }
  // 뒷면 표(지도·그림 없음)는 numbers-first 그대로 그리며 자리도 건드리지 않는다.
  const backPage = pagesForTile(EMPTY_REPORT_DOC, "t-A01", views.get("t-A01"), { ...tileReportSettingsFromBoard(board, "t-A01"), face: "back" }, tileContext)[0];
  assert.equal(backPage.layout, "numbers-first", "전제: 뒷면 표 쪽 기본은 numbers-first");
  backPage.panels = oldPanels;
  assert.ok(!planOne(backPage).map, "전제: 뒷면 표 장에는 지도가 없다");
  const backDrawn = planReportDoc(restoreDoc(backPage), views, tileContext)[0];
  assert.equal(backDrawn.page.layout, "numbers-first");
  assert.deepEqual(backDrawn.page.panels.summary, summaryRect, "뒷면 표의 요약 자리는 복원·계획을 거쳐도 남는다");
  assert.deepEqual(backDrawn.page.panels.source, sourceRect, "뒷면 표의 출처 자리도 남는다");
}

// 옛 보고서 가져오기: map-key로 쓰면서 옛 요약·출처 자리는 넣지 않는다(spec §5).
{
  const key = buildReportPlan({ summary, views, board, analysisDate: context.analysisDate }).find((slide) => slide.kind === "tile")?.key;
  const stylePanels = { title: { x: 0.05, y: 0.05, w: 0.3, h: 0.08 }, summary: { x: 0.7, y: 0.1, w: 0.25, h: 0.5 }, source: { x: 0.1, y: 0.9, w: 0.3, h: 0.05 } };
  const importedPages = importLegacyReport(EMPTY_REPORT_DOC, withLegacyStyle(board, [key], { panels: stylePanels }), views, context);
  const importedTile = importedPages.find((page) => page.kind === "tile" && page.id === key);
  assert.ok(importedTile?.panels.title, "옛 제목 자리는 가져온다");
  assert.ok(!importedTile.panels.summary && !importedTile.panels.source, "옛 요약·출처 자리는 가져오지 않는다");
}

const sheetSourceViews =[...views.values()].slice(0, 2);
assert.equal(sheetSourceViews.length, 2, "조판 변환용 원본 타일");
const sheetParent = sheetView("t-SHEET", sheetSourceViews, "2x2");
const sheetPages = pagesForTile(EMPTY_REPORT_DOC, sheetParent.tileId, sheetParent, tileReportSettingsFromBoard(board, sheetSourceViews[0].tileId), { ...tileContext, settingsFor: (id) => tileReportSettingsFromBoard(board, id) });
assert.equal(sheetPages.length, 1, "SHEET는 한 페이지로 변환");
assert.equal(sheetPages[0]?.kind, "compare", "SHEET는 compare 문서 페이지로 저장");
assert.equal(sheetPages[0]?.layout, "map-key","compare는 사용자 레이아웃 선택 없이 공통 형식을 쓴다");
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
assert.equal(a05Pages.length, 2, "A05 추천 구성은 개요와 빈 설명표");
assert.equal(a05Pages[0].part.shownKeys, undefined, "개요는 옛 pageItems 규칙과 호환");
assert.deepEqual(a05Pages[1].part.shownKeys, [], "초기 설명표는 빈 장");
const initialA05Plan = planReportDoc({ ...EMPTY_REPORT_DOC, pages: a05Pages }, views, tileContext);
assert.deepEqual(initialA05Plan.find((slide) => slide.page?.id === a05Pages[1].id)?.callout.shownKeys, [], "빈 설명표 계획은 shownKeys=[]를 전달");
assert.equal(initialA05Plan.find((slide) => slide.page?.id === a05Pages[1].id)?.callout.numberStart, 1, "빈 설명표의 번호 시작은 1");
const a05AllSettings = { ...tileReportSettingsFromBoard(board, "t-A05"), callout: "all" };

const continuationKeys = a05View.callout.complexes.slice(0, 8).map((complex) => complex.key);
const continuationNextKeys = a05View.callout.complexes.slice(8, 12).map((complex) => complex.key);
const continuationFirst = calloutPageFor(EMPTY_REPORT_DOC, a05View, a05AllSettings, tileContext, 1, continuationKeys, null);
const continuationBlank = calloutPageFor({ ...EMPTY_REPORT_DOC, pages: [continuationFirst] }, a05View, a05AllSettings, tileContext, 2, [], null);
const continuationNext = calloutPageFor({ ...EMPTY_REPORT_DOC, pages: [continuationFirst, continuationBlank] }, a05View, a05AllSettings, tileContext, 3, continuationNextKeys, null);
const continuationPlan = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [continuationFirst, continuationBlank, continuationNext] }, views, tileContext);
assert.deepEqual(
  [continuationFirst, continuationBlank, continuationNext].map((page) => continuationPlan.find((slide) => slide.page?.id === page.id)?.callout.numberStart),
  [1, 9, 9],
  "같은 타일의 앞 장 라벨 수만 번호를 이어가고 빈 장은 0개로 센다",
);
const a06View = views.get("t-A06");
assert.ok(a06View?.callout, "A06 view");
const a06Page = calloutPageFor({ ...EMPTY_REPORT_DOC, pages: [continuationFirst] }, a06View, tileReportSettingsFromBoard(board, "t-A06"), tileContext, 1, a06View.callout.complexes.slice(0, 2).map((complex) => complex.key), null);
const crossTilePlan = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [continuationFirst, a06Page, continuationNext] }, views, tileContext);
assert.equal(crossTilePlan.find((slide) => slide.page?.id === continuationNext.id)?.callout.numberStart, 9, "다른 타일 장은 번호 연속 계산에 영향을 주지 않는다");
assert.equal(crossTilePlan.find((slide) => slide.page?.id === a06Page.id)?.callout.numberStart, 1, "A06도 자체 장 순서로 번호를 시작한다");

// 설명표 장수 변경은 연속 callout 구간만 새 계획으로 바꾸고 같은 page 번호의 편집을 보존한다.
const editedTop10Pages = a05Pages.map((page, index) => page.kind === "tile" ? {
  ...page,
  panels: { title: { x: 0.1 + index * 0.01, y: 0.1, w: 0.3, h: 0.2 } },
  notes: `기존 메모 ${index}`,
  textBoxes: [{ id: `box-${index}`, x: 0.2, y: 0.2, w: 1, h: 0.5, text: `기존 글상자 ${index}`, pt: 12 }],
  frame: { ...page.frame, offsetM: [index + 1, -(index + 2)] },
  fontSizes: { labels: 14 },
} : page);
const editedTop10Doc = { ...EMPTY_REPORT_DOC, pages: editedTop10Pages };
const filteredYear = { year: { min: 2000, max: null } };
const retainedKey = a05View.callout.complexes.find((complex) => complex.approvalYear !== null && complex.approvalYear >= 2000)?.key;
const filteredOutKey = a05View.callout.complexes.find((complex) => complex.approvalYear === null || complex.approvalYear < 2000)?.key;
assert.ok(retainedKey && filteredOutKey, "A05 필터 격리용 유지·제외 단지");
const filteredPage = calloutPageFor({ ...EMPTY_REPORT_DOC, pages: a05Pages }, a05View, a05AllSettings, reportContext, 1, [retainedKey, filteredOutKey], filteredYear);
const filteredOverview = calloutPageFor({ ...EMPTY_REPORT_DOC, pages: [filteredPage] }, a05View, a05AllSettings, reportContext, 0);
const filteredPlan = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [filteredOverview, filteredPage] }, views, reportContext);
const filteredSlide = filteredPlan.find((slide) => slide.page?.id === filteredPage.id);
const unfilteredSlide = filteredPlan.find((slide) => slide.page?.id === filteredOverview.id);
const expectedFilteredView = toTileView(results.get("t-A05"), null, null, filteredYear);
assert.equal(filteredSlide?.callout?.model.complexes.length, expectedFilteredView.callout.complexes.length, "장 필터는 해당 설명표 장의 모델만 다시 계산한다");
assert.equal(unfilteredSlide?.callout?.model.complexes.length, a05View.callout.complexes.length, "장 필터는 개요 장을 바꾸지 않는다");
const isolatedFilterDoc = reportDocReducer({ ...EMPTY_REPORT_DOC, pages: [filteredPage, a05Pages[0]] }, { type: "calloutFilter", id: filteredPage.id, filter: filteredYear, keys: [retainedKey] });
assert.deepEqual(isolatedFilterDoc.pages[0].part.shownKeys, [retainedKey], "필터 밖 키는 해당 장 shownKeys에서 제거한다");
assert.equal(isolatedFilterDoc.pages[1].part.type, "callout");
assert.equal(isolatedFilterDoc.pages[1].part.shownKeys, undefined, "다른 설명표 장의 shownKeys는 건드리지 않는다");
assert.equal(a05View.callout.complexes.length, 25, "자동 생성 fixture는 25개 단지");
const generatedGroups = Array.from({ length: Math.ceil(a05View.callout.complexes.length / 10) }, (_, index) => a05View.callout.complexes.slice(index * 10, (index + 1) * 10).map((complex) => complex.key));
assert.equal(generatedGroups.length, 3, "25개 단지는 자동 생성 시 3장");
const generatedPages = [];
let generatedDoc = editedTop10Doc;
for (const [index, keys] of generatedGroups.entries()) {
  const generated = calloutPageFor(generatedDoc, a05View, a05AllSettings, tileContext, index + 1, keys, null);
  generatedPages.push(generated);
  generatedDoc = { ...generatedDoc, pages: [...generatedDoc.pages, generated] };
}
const allHistory = historyApply({ past: [], present: editedTop10Doc, future: [] }, { type: "tileCallout", id: editedTop10Pages[1].id, pages: generatedPages });
const allCalloutPages = allHistory.present.pages.filter((page) => page.kind === "tile" && page.tileId === "t-A05" && page.part.type === "callout");
assert.equal(allCalloutPages.length, 1 + generatedGroups.length, "자동 생성은 개요를 보존하고 설명표를 ceil(n/10)장으로 교체");
assert.equal(allCalloutPages[0].id, editedTop10Pages[0].id, "개요 장은 교체하지 않는다");
assert.deepEqual(allCalloutPages[0].frame.offsetM, [1, -2], "개요 frame 보존");
assert.notEqual(allCalloutPages[1].id, editedTop10Pages[1].id, "교체된 설명표 장 id는 새로 만든다");
assert.deepEqual(allCalloutPages[1].frame.offsetM, [2, -3], "같은 page 1의 frame 보존");
assert.equal(allCalloutPages[0].notes, "기존 메모 0", "개요 메모 보존");
assert.equal(allCalloutPages[1].textBoxes[0].text, "기존 글상자 1", "같은 page의 글상자 보존");
assert.equal(allCalloutPages[1].fontSizes.labels, 14, "같은 page의 글자 크기 보존");
const generatedPlan = planReportDoc(allHistory.present, views, tileContext);
assert.deepEqual(
  generatedPages.map((page) => generatedPlan.find((slide) => slide.page?.id === page.id)?.callout.numberStart),
  [1, 11, 21],
  "25개 자동 생성은 1–10, 11–20, 21–25로 번호를 잇는다",
);
const oldDetailPage = calloutPageFor(EMPTY_REPORT_DOC, a05View, a05AllSettings, tileContext, 2);
const oldDetailSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [oldDetailPage] }, views, tileContext).find((slide) => slide.page?.id === oldDetailPage.id);
assert.equal(oldDetailSlide?.callout.numberStart, 11, "shownKeys 없는 옛 장은 기존 전역 순위를 유지한다");
assert.equal(historyUndo(allHistory).present.pages[0].id, editedTop10Pages[0].id, "tileCallout은 history undo 대상");

// 「이 쪽만」 지도 색은 자동 구성으로 장이 다시 만들어져도 같은 번호 장에 남는다(복사본).
const coloredDoc = reportDocReducer(editedTop10Doc, { type: "mapColors", scope: "page", id: editedTop10Pages[1].id, patch: { base: "ink" } });
const coloredBefore = coloredDoc.pages.find((page) => page.id === editedTop10Pages[1].id).mapColors;
assert.ok(coloredBefore, "고른 쪽에 mapColors가 있다");
const coloredPages = historyApply({ past: [], present: coloredDoc, future: [] }, { type: "tileCallout", id: editedTop10Pages[1].id, pages: generatedPages })
  .present.pages.filter((page) => page.kind === "tile" && page.tileId === "t-A05" && page.part.type === "callout");
assert.deepEqual(coloredPages[1].mapColors, coloredBefore, "같은 page의 지도 색 보존");
assert.notEqual(coloredPages[1].mapColors, coloredBefore, "원본 객체를 공유하지 않는다");
assert.equal(coloredPages[0].mapColors, undefined, "색을 고르지 않은 개요 장은 그대로");
assert.equal(coloredPages[2].mapColors, undefined, "새로 생긴 장에는 색이 없다");

const a05OverviewPages = [calloutPageFor(allHistory.present, a05View, a05AllSettings, tileContext, 0)];
const overviewDoc = reportDocReducer(allHistory.present, { type: "tileCallout", id: allCalloutPages.at(-1).id, pages: a05OverviewPages });
assert.equal(overviewDoc.pages.filter((page) => page.kind === "tile" && page.tileId === "t-A05" && page.part.type === "callout").length, 1, "all → overview는 1장");
assert.equal(overviewDoc.pages.find((page) => page.kind === "tile" && page.tileId === "t-A05" && page.part.type === "callout")?.part.page, 0, "overview 교체는 0번 장");

const recommended = recommendedPages(EMPTY_REPORT_DOC, views, board, context);
assert.equal(recommended[0]?.kind, "cover", "추천 구성 첫 장은 표지");
assert.equal(recommended.at(-1)?.kind, "sources", "추천 구성 마지막 장은 출처");

// Ruling 32: D02(건물)는 추천 구성에서 뺀다. 타일·보드는 그대로이고 사용자가 직접 추가하면 장을 만들 수 있다.
{
  const d02Result = { ...GODEOK_RESULTS[0], tileId: "t-D02", tileCode: "D02" };
  const withD02Board = initBoard([...GODEOK_RESULTS, d02Result]);
  const d02View = { ...views.get("t-A01"), tileId: "t-D02", code: "D02" };
  const withD02Views = new Map([...views, ["t-D02", d02View]]);
  const withD02 = recommendedPages(EMPTY_REPORT_DOC, withD02Views, withD02Board, { ...context, results: new Map([...results, ["t-D02", d02Result]]) });
  assert.ok(!withD02.some((page) => page.kind === "tile" && page.tileId === "t-D02"), "추천 구성에 D02가 없다");
  assert.equal(withD02.length, recommended.length, "D02를 빼면 D02 없는 구성과 쪽수가 같다");
  const added = pagesForTile(EMPTY_REPORT_DOC, "t-D02", d02View, tileReportSettingsFromBoard(withD02Board, "t-D02"), { ...tileContext, views: withD02Views });
  assert.ok(added.length > 0 && added.every((page) => page.tileId === "t-D02"), "직접 추가하면 D02 장을 만들 수 있다");
}

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

// 출처 메타 연결(2026-11-03 회귀 수정): 매니페스트 메타를 넘기면 출처 장 행에 제공처·이용조건·링크가 들어가고,
// 장수 추정(sourceRowCountForViews)도 같은 메타를 쓴다. 메타가 없으면(요청 실패) 정의 표로 내려간다.
{
  const refFor = (sourceId) => ({ sourceId, releaseId: `${sourceId}-r1`, sourceAsOf: "2026-01-01" });
  const metaRow = (sourceId, provider, sourceUrl, licenseCode) => [`${sourceId}:${sourceId}-r1`, { sourceId, releaseId: `${sourceId}-r1`, provider, sourceUrl, licenseCode }];
  // 같은 자료명(국토교통부 VWorld 용도지구·구역)을 쓰는 두 원천이 제공처만 다르면 메타가 있을 때만 두 행이 된다.
  const sourceMeta = new Map([
    metaRow("district_area", "국토교통부", "https://example.test/area", "UNRESTRICTED"),
    metaRow("district_greenbelt", "서울특별시", "https://example.test/green", "UNRESTRICTED"),
  ]);
  const one = new Map([["t-A01", { ...views.get("t-A01"), sourceRefs: [refFor("district_area"), refFor("district_greenbelt")] }]]);
  const oneContext = { ...context, views: one };
  const doc = { v: 1, format: "wide", pages: recommendedPages(EMPTY_REPORT_DOC, one, board, oneContext) };
  const plannedWith = (ctx) => planReportDoc(doc, one, ctx);
  const sourceRowsOf = (plan) => plan.filter((slide) => slide.kind === "sources").flatMap((slide) => slide.rows);

  const bare = plannedWith(oneContext);
  assert.equal(sourceRowsOf(bare).length, 1, "메타 없음: 이름·기준일이 같아 한 행");
  assert.ok(sourceRowsOf(bare).every((row) => row.provider === "제공처 미기록" && row.license === "미기록" && row.url === ""), "메타 없음: 정의 표 폴백(미기록)");

  const withMeta = plannedWith({ ...oneContext, sourceMeta });
  const metaRows = sourceRowsOf(withMeta);
  assert.deepEqual(metaRows.map((row) => row.provider).sort(), ["국토교통부", "서울특별시"], "메타 제공처가 출처 행에 들어간다");
  assert.ok(metaRows.every((row) => row.license === "이용허락범위 제한 없음" && row.url.startsWith("https://example.test/")), "메타 이용조건·링크가 출처 행에 들어간다");
  assert.ok(withMeta.filter((slide) => slide.kind === "tile").every((slide) => slide.footer.includes("국토교통부")), "각주 띠에도 메타 제공처가 들어간다");

  assert.equal(sourceRowCountForViews(one.values()), sourceRowsOf(bare).length, "메타 없는 장수 추정 = 실제 행 수");
  assert.equal(sourceRowCountForViews(one.values(), sourceMeta), metaRows.length, "메타를 넘긴 장수 추정 = 실제 행 수");
  assert.equal(sourcePageCountForViews(one.values(), sourceMeta), withMeta.filter((slide) => slide.kind === "sources").length, "메타를 넘긴 출처 장 수 = 실제 출처 장 수");

  // 앱 경로 두 곳(발표·쪽 수 계산용 page.tsx, 편집·내보내기용 report-mode.tsx)이 같은 메타를 계획에 넘긴다.
  const lineOf = (path, needle) => readFileSync(new URL(path, import.meta.url), "utf8").split("\n").find((line) => line.includes(needle)) ?? "";
  const pageLine = lineOf("../../app/v2/page.tsx", "const reportPlanContext = useMemo");
  assert.ok(pageLine.split("sourceMeta").length >= 3, "page.tsx reportPlanContext가 sourceMeta를 값과 의존성으로 넘긴다");
  const modeLine = lineOf("../../components/v2/report/report-mode.tsx", "const planContext = useMemo");
  assert.ok(modeLine.split("sourceMeta").length >= 3, "report-mode.tsx planContext가 sourceMeta를 값과 의존성으로 넘긴다");
  // 메타가 오기 전에는 내보내기·발표를 막는다(출처 장이 「미기록」으로 나가는 경쟁 상태).
  assert.ok(lineOf("../../components/v2/report/report-mode.tsx", 'aria-label="발표 미리보기"').includes("sourceMetaPending"), "발표 미리보기가 메타를 기다린다");
  assert.ok(lineOf("../../components/v2/report/report-mode.tsx", "ref={exportTriggerRef}").includes("sourceMetaPending"), "내보내기가 메타를 기다린다");
  assert.ok(lineOf("../../app/v2/page.tsx", "<ReportMode ").includes("sourceMetaPending={!sourceMetaReady}"), "page.tsx가 메타 대기 상태를 ReportMode에 넘긴다");
}

// 이용조건 고지문(2026-11-03): Copernicus DEM 행이 있는 출처 장에는 제6조 고정 고지문이 표 아래에 따라오고, 표는 그만큼 줄어 띠를 침범하지 않는다.
{
  const { sourceLayout, sourceNotices } = await import("../../lib/v2/report/pptx-kit.ts");
  const ref = (sourceId) => ({ sourceId, releaseId: `${sourceId}-r1`, sourceAsOf: "2026-01-01" });
  const withDem = new Map([["t-A01", { ...views.get("t-A01"), sourceRefs: [ref("terrain_tiles"), ref("building")] }]]);
  const demContext = { ...context, views: withDem };
  const demDoc = { v: 1, format: "wide", pages: recommendedPages(EMPTY_REPORT_DOC, withDem, board, demContext) };
  const demSlides = planReportDoc(demDoc, withDem, demContext).filter((slide) => slide.kind === "sources");
  const demRow = demSlides.flatMap((slide) => slide.rows).find((row) => row.source.includes("Copernicus"));
  assert.ok(demRow, "Copernicus DEM 행이 출처 장에 있다");
  assert.match(demRow.license, /Copernicus WorldDEM-30 라이선스/);
  const notices = sourceNotices(demSlides.flatMap((slide) => slide.rows));
  assert.equal(notices.length, 2);
  assert.ok(notices[0].startsWith("produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018"));
  assert.deepEqual(sourceNotices([{ source: "x" }]), [], "고지문이 없는 쪽은 그대로");
  for (const rowCount of [3, 14]) {
    const bare = sourceLayout(rowCount, {}, "wide");
    const noted = sourceLayout(rowCount, {}, "wide", notices);
    assert.equal(bare.notice.h, 0, "고지문 없음: 자리 없음");
    assert.deepEqual(bare.footer.y, bare.table.y + bare.table.h + 0.08, "고지문 없음: 기존 자리 그대로");
    assert.ok(noted.notice.h > 0.2 && noted.notice.y >= noted.table.y + noted.table.h, "고지문은 표 바로 아래");
    assert.ok(noted.footer.y >= noted.notice.y + noted.notice.h && noted.footer.y + noted.footer.h <= 7.14, `기준일 줄이 띠 위(${rowCount}행)`);
    if (rowCount === 14) assert.ok(noted.table.h < bare.table.h, "꽉 찬 쪽은 표를 줄여 자리를 만든다");
  }
}

// PPT 출처 표 맞춤(2026-11-04): 줄바꿈이 많은 14행은 고지문 아래로 넘치지 않게 글자를 줄이고, 짧은 행은 그대로 둔다. 하한은 미리보기와 같다.
{
  const { sourceLayout, sourceTableFit, SOURCE_TABLE_MIN_FIT } = await import("../../lib/v2/report/pptx-kit.ts");
  const short = Array.from({ length: 5 }, (_, i) => ({ provider: "기관", source: `자료 ${i}`, asOf: "2026-01-01", license: "제한 없음", url: "https://x", tiles: "도로" }));
  const long = Array.from({ length: 14 }, (_, i) => ({ provider: "국토교통부(VWorld GIS건물통합정보) 긴 제공처 이름", source: `행정안전부 도로명주소 건물(CC BY-NC-ND) ${i}`, asOf: "2026-09-09", license: "공공누리 제4유형(출처표시·상업적 이용금지·변경금지) · ODbL 1.0(선형)", url: "https://x", tiles: "건축물 용도, 준공 연대, 건축물 높이, 수관·녹지, 건물 밀도, 개방감(하늘열림), 3D 매스, 일조·그림자" }));
  const shortLayout = sourceLayout(short.length, {}, "wide");
  assert.equal(sourceTableFit(short, 9, shortLayout.tableContent, shortLayout.dense), 1, "짧은 표는 줄이지 않는다");
  const longLayout = sourceLayout(long.length, {}, "wide", ["국토포털(국토정보플랫폼) 오픈API의 결과물"]);
  const fit = sourceTableFit(long, 9, longLayout.tableContent, longLayout.dense);
  assert.ok(fit < 1 && fit >= SOURCE_TABLE_MIN_FIT, `줄바꿈이 많은 표는 하한 안에서 줄인다(${fit})`);
}

console.log("v2 report doc plan tests passed");
