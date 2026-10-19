/** v2 보고서 페이지 스타일·추가 페이지 영속 모델 회귀 테스트. */
import assert from "node:assert/strict";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const {
  extraPageKey,
  initBoard,
  boardReducer,
  reportPages,
  restoreBoardState,
  rewriteSnapshotIds,
  serializeBoardState,
} = await import("../../lib/v2/ui/board-state.ts");

const styleKeys = ["t-A01", "t-A02"];
let board = initBoard(GODEOK_RESULTS);
assert.deepEqual(board.report, { styles: {}, extra: [] }, "새 보드의 report 기본값");

// 여러 페이지에 한 번에 스타일을 병합하고, 페이지별 필드는 독립적으로 저장한다.
board = boardReducer(board, {
  type: "pageStyle",
  keys: styleKeys,
  patch: {
    pinnedKeys: ["station|1"],
    hiddenKeys: ["bus|2"],
    legendFocus: "rail",
    zoomDelta: 1.25,
    offsetM: [12, -8],
    summary: true,
    titleScale: 1.2,
    summaryScale: 0.9,
    legendScale: 1.1,
  },
});
assert.deepEqual(board.report.styles["t-A01"], board.report.styles["t-A02"], "pageStyle 다중 적용");
assert.deepEqual(board.report.styles["t-A01"].offsetM, [12, -8]);
assert.deepEqual(board.report.styles["t-A01"].hiddenKeys, ["bus|2"], "hiddenKeys 다중 적용");
const hiddenBeforeUndo = board.report;
board = boardReducer(board, { type: "pageStyle", keys: ["t-A01"], patch: { hiddenKeys: ["bus|2", "station|3"] } });
assert.deepEqual(board.report.styles["t-A01"].hiddenKeys, ["bus|2", "station|3"], "hiddenKeys 추가 patch");
board = boardReducer(board, { type: "undo" });
assert.deepEqual(board.report, hiddenBeforeUndo, "hiddenKeys pageStyle undo 복원");

// 패널은 슬라이드 비율로 저장하고, nested patch는 기존 패널을 보존한다.
let panelBoard = initBoard(GODEOK_RESULTS);
const panelGeometry = {
  title: { x: -0.2, y: 0.12, w: 0.32, h: 0.14 },
  summary: { x: 0.64, y: 0.1, w: 0.3, h: 0.72 },
  legend: { x: 0.08, y: 0.64, w: 0.26, h: 0.2 },
};
panelBoard = boardReducer(panelBoard, { type: "pageStyle", keys: styleKeys, patch: { panels: panelGeometry, titleScale: 1.4 } });
assert.deepEqual(panelBoard.report.styles["t-A01"].panels, {
  title: { x: 0, y: 0.12, w: 0.32, h: 0.14 },
  summary: { x: 0.64, y: 0.1, w: 0.3, h: 0.72 },
  legend: { x: 0.08, y: 0.64, w: 0.26, h: 0.2 },
}, "panels 좌표·크기 0..1 정규화");
assert.notStrictEqual(panelBoard.report.styles["t-A01"].panels, panelBoard.report.styles["t-A02"].panels, "다중 적용 패널은 페이지별 clone");
panelBoard = boardReducer(panelBoard, {
  type: "pageStyle",
  keys: ["t-A01"],
  patch: { panels: { summary: { x: 0.58, y: 0.16, w: 0.34, h: 0.66 }, legend: { x: "bad", y: 0, w: 0.2, h: 0.2 } } },
});
assert.equal(panelBoard.report.styles["t-A01"].panels.title.x, 0, "nested panels patch가 기존 title을 보존");
assert.deepEqual(panelBoard.report.styles["t-A01"].panels.summary, { x: 0.58, y: 0.16, w: 0.34, h: 0.66 }, "nested panels patch 적용");
assert.deepEqual(panelBoard.report.styles["t-A01"].panels.legend, { x: 0.08, y: 0.64, w: 0.26, h: 0.2 }, "malformed panel field 안전 드롭");
const panelSnapshot = serializeBoardState(panelBoard);
assert.deepEqual(restoreBoardState(GODEOK_RESULTS, JSON.stringify(panelSnapshot)).report, panelBoard.report, "panels serialize→restore 왕복");
const panelBeforeClear = panelBoard.report;
panelBoard = boardReducer(panelBoard, { type: "pageStyle", keys: styleKeys, patch: { panels: undefined } });
assert.equal(panelBoard.report.styles["t-A01"].panels, undefined, "panels undefined는 전체 geometry override 삭제");
assert.equal(panelBoard.report.styles["t-A02"].panels, undefined, "panels undefined 다중 적용");
panelBoard = boardReducer(panelBoard, { type: "undo" });
assert.deepEqual(panelBoard.report, panelBeforeClear, "panels 삭제 undo 복원");

// scale은 0.7..1.5, zoomDelta는 MapView 고정 상한이 없어 요구된 -3..3 fallback을 쓴다.
board = boardReducer(board, {
  type: "pageStyle",
  keys: ["t-A01"],
  patch: {
    titleScale: 99,
    summaryScale: 0,
    legendScale: -10,
    zoomDelta: -99,
    legendFocus: null,
    summary: undefined,
    pinnedKeys: undefined,
  },
});
assert.equal(board.report.styles["t-A01"].titleScale, 1.5, "titleScale 상한 clamp");
assert.equal(board.report.styles["t-A01"].summaryScale, 0.7, "summaryScale 하한 clamp");
assert.equal(board.report.styles["t-A01"].legendScale, 0.7, "legendScale 하한 clamp");
assert.equal(board.report.styles["t-A01"].zoomDelta, -3, "zoomDelta 하한 clamp");
assert.equal(board.report.styles["t-A01"].legendFocus, null, "legendFocus null은 전체 강조 해제로 유지");
assert.equal(board.report.styles["t-A01"].summary, undefined, "undefined patch는 필드 삭제");
assert.equal(board.report.styles["t-A01"].pinnedKeys, undefined, "undefined 배열 patch는 필드 삭제");
assert.deepEqual(board.report.styles["t-A01"].hiddenKeys, ["bus|2"], "hiddenKeys는 다른 필드 삭제에서 보존");

board = boardReducer(board, { type: "pageStyleReset", keys: styleKeys });
assert.deepEqual(board.report.styles, {}, "pageStyleReset은 지정 페이지 스타일만 삭제");

// 같은 tileId의 추가 페이지는 허용하지만, board order/원본 결과에 없는 tileId는 거부한다.
board = boardReducer(board, { type: "addPage", id: "extra-1", after: "t-A01", tileId: "t-A01", face: "front" });
board = boardReducer(board, { type: "addPage", id: "extra-2", after: "t-A01", tileId: "t-A01", face: "back" });
assert.equal(board.report.extra.length, 2, "같은 tileId 추가 페이지 중복 허용");
assert.notEqual(board.report.extra[0].id, board.report.extra[1].id, "추가 페이지 id는 중복되지 않음");
const beforeInvalidAdd = board;
assert.equal(boardReducer(board, { type: "addPage", after: "t-A01", tileId: "missing-tile", face: "front" }), beforeInvalidAdd, "invalid tileId 추가 거부");

// 미리보기에서 만든 빈 sheet extra 페이지는 칸 수를 유지한 채 plan/PPT로 내려가며,
// 채운 칸만 이미지로 출력한다. 셀 변경·격자 변경·undo·serialize/restore도 같은 report undo를 쓴다.
let sheetBoard = initBoard(GODEOK_RESULTS);
sheetBoard = boardReducer(sheetBoard, {
  type: "addPage",
  id: "sheet-extra",
  after: "cover",
  tileId: "",
  face: "front",
  sheet: { grid: "2x2", tiles: ["t-A01", "", "t-A02", ""] },
});
assert.deepEqual(sheetBoard.report.extra[0].sheet, { grid: "2x2", tiles: ["t-A01", "", "t-A02", ""] }, "빈 sheet extra 추가");
const sheetBeforeCell = sheetBoard.report;
sheetBoard = boardReducer(sheetBoard, { type: "setSheetCell", id: "sheet-extra", index: 1, tileId: "t-A03" });
assert.deepEqual(sheetBoard.report.extra[0].sheet.tiles, ["t-A01", "t-A03", "t-A02", ""], "sheet 셀 지정");
sheetBoard = boardReducer(sheetBoard, { type: "undo" });
assert.deepEqual(sheetBoard.report, sheetBeforeCell, "sheet 셀 변경 undo");
sheetBoard = boardReducer(sheetBoard, { type: "setSheetCell", id: "extra:sheet-extra", index: 1, tileId: "t-A03" });
sheetBoard = boardReducer(sheetBoard, { type: "setSheetGrid", id: "sheet-extra", grid: "3x1" });
assert.deepEqual(sheetBoard.report.extra[0].sheet, { grid: "3x1", tiles: ["t-A01", "t-A03", "t-A02"] }, "sheet 격자 변경");
sheetBoard = boardReducer(sheetBoard, { type: "undo" });
assert.deepEqual(sheetBoard.report.extra[0].sheet, { grid: "2x2", tiles: ["t-A01", "t-A03", "t-A02", ""] }, "sheet 격자 변경 undo");
const sheetSnapshot = serializeBoardState(sheetBoard);
assert.deepEqual(restoreBoardState(GODEOK_RESULTS, JSON.stringify(sheetSnapshot)).report, sheetBoard.report, "sheet serialize→restore 왕복");
const sheetViews = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const sheetPlan = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS),
  views: sheetViews,
  board: sheetBoard,
  analysisDate: "2026-10-16",
});
const extraSheetSlide = sheetPlan.find((slide) => slide.key === extraPageKey("sheet-extra"));
assert.ok(extraSheetSlide && extraSheetSlide.kind === "sheet", "extra sheet가 report-plan kind sheet로 생성");
assert.equal(extraSheetSlide.cells.length, 4, "sheet 칸 수 보존");
assert.equal(extraSheetSlide.cells.filter(Boolean).length, 3, "plan은 채운 sheet 칸만 cell로 유지");
assert.equal(extraSheetSlide.cells[3], null, "빈 sheet 칸은 plan에서 null 자리로 유지");
const onePixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const sheetImages = Object.fromEntries(mapKeysOf(extraSheetSlide).map((key) => [key, onePixel]));
const sheetZip = await JSZip.loadAsync(await renderReportPptx([extraSheetSlide], sheetImages));
const sheetXml = await sheetZip.file("ppt/slides/slide1.xml").async("string");
assert.equal((sheetXml.match(/<p:pic>/g) ?? []).length, 3, "빈 sheet 칸은 PPT 이미지에서 생략");

// removePage는 extra id와 extra:${id} 스타일만 제거하고, 기존 페이지 스타일은 보존한다.
const removablePage = board.report.extra[0];
board = boardReducer(board, { type: "pageStyle", keys: ["t-A01", extraPageKey(removablePage.id)], patch: { summary: true, titleScale: 1.25 } });
board = boardReducer(board, { type: "removePage", id: removablePage.id });
assert.equal(board.report.extra.some((page) => page.id === removablePage.id), false, "removePage extra 삭제");
assert.equal(board.report.styles[extraPageKey(removablePage.id)], undefined, "removePage extra style 삭제");
assert.equal(board.report.styles["t-A01"].summary, true, "removePage가 일반 page style을 삭제하지 않음");
board = boardReducer(board, { type: "undo" });
assert.ok(board.report.extra.some((page) => page.id === removablePage.id), "removePage undo로 extra 복원");
assert.equal(board.report.styles[extraPageKey(removablePage.id)].summary, true, "removePage undo로 style 복원");

// 원본 결과에 존재하지만 현재 board order에서 빠진 tile도 추가 페이지의 대상이 될 수 있다.
board = boardReducer(board, { type: "remove", id: "t-A03" });
board = boardReducer(board, { type: "addPage", id: "extra-3", after: "t-A02", tileId: "t-A03", face: "front" });
assert.equal(board.report.extra.at(-1).tileId, "t-A03", "원본 결과 tileId 허용");

// tile 삭제는 해당 tileId의 모든 extra와 extra style을 정리하고, 기존 remove undo 규칙으로 함께 복원한다.
board = boardReducer(board, { type: "addPage", id: "extra-4", after: "t-A02", tileId: "t-A04", face: "front" });
board = boardReducer(board, { type: "pageStyle", keys: [extraPageKey(board.report.extra.at(-1).id)], patch: { legendScale: 1.4 } });
const extraForDeletedTile = board.report.extra.filter((page) => page.tileId === "t-A04");
assert.ok(extraForDeletedTile.length > 0);
board = boardReducer(board, { type: "remove", id: "t-A04" });
assert.equal(board.report.extra.some((page) => page.tileId === "t-A04"), false, "tile 삭제 시 extra 정리");
for (const page of extraForDeletedTile) assert.equal(board.report.styles[extraPageKey(page.id)], undefined, "tile 삭제 시 extra style 정리");
board = boardReducer(board, { type: "undo" });
assert.equal(board.report.extra.filter((page) => page.tileId === "t-A04").length, extraForDeletedTile.length, "tile 삭제 undo 시 extra 복원");
assert.equal(board.report.styles[extraPageKey(extraForDeletedTile.at(-1).id)].legendScale, 1.4, "tile 삭제 undo 시 style 복원");

// serialize → JSON → restore 왕복과 reportPages의 추가 페이지 장수.
board = boardReducer(board, { type: "pageStyle", keys: ["t-A01"], patch: { summary: false, offsetM: [20, 30], legendScale: 1.3, hiddenKeys: ["station|1"] } });
const snapshot = serializeBoardState(board);
assert.equal(snapshot.version, 4, "report additive field도 보드 schema version v4로 저장");
assert.deepEqual(snapshot.report, board.report, "serialize에 report 포함");
const restored = restoreBoardState(GODEOK_RESULTS, JSON.stringify(snapshot));
assert.deepEqual(restored.report, board.report, "report 저장→JSON→복원 왕복");
const withoutExtra = reportPages({ ...restored, report: { styles: {}, extra: [] } });
assert.deepEqual(reportPages(restored), { ...withoutExtra, pages: withoutExtra.pages + restored.report.extra.length }, "reportPages에 extra 수 반영");

// legacy report의 PageKey와 after도 타일 id rebasing 규칙을 함께 따른다.
const opaqueKey = "analysis-OLD:front:part";
const rewritten = rewriteSnapshotIds({
  ...snapshot,
  report: {
    styles: { [opaqueKey]: { titleScale: 1.1 } },
    extra: [{ id: "opaque-extra", after: opaqueKey, tileId: "analysis-OLD", face: "front" }],
  },
}, (id) => id === "analysis-OLD" ? "analysis-NEW" : id);
assert.ok(rewritten.report.styles["analysis-NEW:front:part"], "legacy PageKey style도 rebasing");
assert.equal(rewritten.report.extra[0].after, "analysis-NEW:front:part", "legacy after PageKey도 rebasing");
assert.equal(rewritten.report.extra[0].tileId, "analysis-NEW", "extra page의 tileId만 rebasing");

// report가 없는 옛 저장본은 기본값으로 복원하고, malformed report는 전체 복원을 깨뜨리지 않고 항목별로 버린다.
const old = { ...snapshot };
delete old.report;
assert.deepEqual(restoreBoardState(GODEOK_RESULTS, old).report, { styles: {}, extra: [] }, "report 없는 구버전 복원");
const malformed = {
  ...snapshot,
  report: {
    styles: {
      "t-A01": { titleScale: 10, zoomDelta: -10, offsetM: ["bad", 1], unknown: true },
      "t-A02": {
        panels: {
          title: { x: 2, y: -1, w: 0.3, h: 0.2 },
          summary: { x: "bad", y: 0.1, w: 0.3, h: 0.2 },
          legend: { x: 0.1, y: 0.7, w: 0.2, h: 0.2 },
        },
      },
      [extraPageKey("missing")]: { summary: true },
    },
    extra: [
      { id: "bad", after: "t-A01", tileId: "missing-tile", face: "front" },
      { id: "good", after: "t-A01", tileId: "t-A01", face: "back" },
      { id: "good", after: "t-A02", tileId: "t-A02", face: "front" },
    ],
  },
};
const safe = restoreBoardState(GODEOK_RESULTS, malformed);
assert.deepEqual(safe.report.extra, [{ id: "good", after: "t-A01", tileId: "t-A01", face: "back" }], "malformed/중복/없는 tile extra 드롭");
assert.deepEqual(safe.report.styles["t-A01"], { titleScale: 1.5, zoomDelta: -3 }, "malformed style field drop 및 수치 clamp");
assert.deepEqual(safe.report.styles["t-A02"].panels, {
  title: { x: 1, y: 0, w: 0.3, h: 0.2 },
  legend: { x: 0.1, y: 0.7, w: 0.2, h: 0.2 },
}, "malformed panels도 필드별 안전 드롭");
assert.equal(safe.report.styles[extraPageKey("missing")], undefined, "dangling extra style 드롭");

console.log("v2 report page model tests passed");
