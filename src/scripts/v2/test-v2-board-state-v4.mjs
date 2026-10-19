/** 보고서 문서를 포함하는 보드 상태 v4 저장·복원 계약. */
import assert from "node:assert/strict";

const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const {
  BOARD_STATE_VERSION,
  TILE_CODE_RENAMES,
  boardReducer,
  initBoard,
  migrateSnapshot,
  restoreBoardState,
  restoreReportDoc,
  selectBoardSnapshotForLoad,
  serializeBoardState,
} = await import("../../lib/v2/ui/board-state.ts");
const { hasLegacyReport } = await import("../../lib/v2/report/report-doc-plan.ts");
const { EMPTY_REPORT_DOC, defaultFrame } = await import("../../lib/v2/report/report-doc.ts");

const page = (tileId, id = "p1") => ({
  id,
  layout: "map-summary",
  panels: {},
  textBoxes: [],
  notes: "D17 발표 메모",
  kind: "tile",
  tileId,
  part: { type: "single" },
  settings: { face: "front", callout: "overview", terrainSection: "B" },
  frame: defaultFrame(),
});

assert.equal(BOARD_STATE_VERSION, 4, "보드 저장 버전 v4");

const base = initBoard(GODEOK_RESULTS);
const v3 = { ...serializeBoardState(base), version: 3, report: { styles: {}, extra: [{ id: "old", after: null, tileId: "t-A01", face: "front" }] } };
delete v3.reportDoc;
const restoredV3 = restoreBoardState(GODEOK_RESULTS, v3);
assert.deepEqual(restoredV3.reportDoc, EMPTY_REPORT_DOC, "v3 저장본은 빈 reportDoc로 이관");
assert.equal(hasLegacyReport(restoredV3), true, "v3 legacy report는 불러오기 대상으로 표시");

const withDoc = boardReducer(base, { type: "reportDoc", doc: { v: 1, format: "a3", pages: [page("t-D17")] } });
assert.equal(withDoc.undoStack.length, base.undoStack.length, "reportDoc 액션은 보드 undo에 쌓이지 않음");
const snapshot = serializeBoardState(withDoc);
assert.equal(snapshot.version, 4);
assert.deepEqual(restoreBoardState(GODEOK_RESULTS, snapshot).reportDoc, withDoc.reportDoc, "v4 reportDoc 저장·복원 왕복");
assert.equal(restoreBoardState(GODEOK_RESULTS, snapshot).reportDoc.pages[0].settings.terrainSection, "B", "D17 단면 설정 저장·복원");

const legacyReport = { styles: {}, extra: [{ id: "legacy-extra", after: null, tileId: "t-A01", face: "front" }] };
const reportBoard = { ...withDoc, report: legacyReport };
const reportSnapshot = serializeBoardState(reportBoard);
const reportRoundTrip = restoreBoardState(GODEOK_RESULTS, reportSnapshot);
assert.equal(reportRoundTrip.reportDoc.pages.length, 1, "serialize 후 non-empty reportDoc 보존");
assert.equal(hasLegacyReport(reportRoundTrip), true, "serialize 후 legacy report 보존");

const v3WithDoc = { ...reportSnapshot, version: 3 };
const migratedWithDoc = restoreBoardState(GODEOK_RESULTS, v3WithDoc);
assert.equal(migratedWithDoc.reportDoc.pages.length, 1, "v3 reportDoc를 비우지 않고 v4로 이관");
assert.equal(hasLegacyReport(migratedWithDoc), true, "v3 legacy report와 reportDoc 동시 보존");

const selectedSnapshot = selectBoardSnapshotForLoad(v3WithDoc, reportSnapshot);
const selectedBoard = restoreBoardState(GODEOK_RESULTS, selectedSnapshot);
assert.equal(selectedBoard.reportDoc.pages.length, 1, "페이지 로더가 local/server reportDoc를 선택");
assert.equal(hasLegacyReport(selectedBoard), true, "페이지 로더가 legacy report를 함께 보존");

const cleaned = restoreReportDoc({
  v: 1,
  format: "wide",
  pages: [page("missing-D17"), page(123, "bad-tile"), { ...page("t-A01", "bad-kind"), kind: "unknown" }],
}, new Set(["t-A01"]));
assert.deepEqual(cleaned.pages.map((item) => item.tileId), ["missing-D17"], "없는 타일 페이지는 보존하고 무효 페이지는 버림");

const oldId = "analysis-D06";
const source = serializeBoardState(base);
const old = {
  ...source,
  version: 1,
  order: [oldId],
  included: { [oldId]: true },
  faces: { [oldId]: "front" },
  reportDoc: { v: 1, format: "wide", pages: [page(oldId)] },
  report: {
    styles: { [`${oldId}:front`]: { offsetM: [20, -10] } },
    extra: [{ id: "legacy-extra", after: null, tileId: oldId, face: "front" }],
  },
};
const migrated = migrateSnapshot(old);
assert.equal(migrated.version, 4);
assert.equal(migrated.reportDoc.pages[0].tileId, "analysis-D05", "reportDoc tileId도 renameTileId 적용");
assert.equal(migrated.report.styles["analysis-D05:front"].offsetM[0], 20, "legacy report styles key도 renameTileId 적용");
assert.equal(migrated.report.extra[0].tileId, "analysis-D05", "legacy report extra도 renameTileId 적용");
assert.equal(migrateSnapshot({ ...old, version: 5 }), null, "미래 버전은 null");

console.log("v2 board state v4 tests passed");
