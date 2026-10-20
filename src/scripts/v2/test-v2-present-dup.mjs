/** W1 회귀: copy:N 보드 인스턴스, 저장/복원, 모드별 PPT 계획과 mapKey 독립성. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { boardReducer, initBoard, reportPages, restoreBoardState, serializeBoardState, sourceTileId, rewriteSnapshotIds } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, complexCounts, mapKeysOf, sourcePageCountForViews } = await import("../../lib/v2/report/report-plan.ts");
const { withLegacyTileState } = await import("./legacy-report-fixture.mjs");

const sourceResult = GODEOK_RESULTS.find((result) => {
  const view = toTileView(result);
  return view.layerOptions.length > 1 && !["A05", "A06", "S01", "S02", "S03", "S04", "D22"].includes(result.tileCode);
});
assert.ok(sourceResult, "복제 모드 테스트용 다중 레이어 타일이 필요하다");
const sourceId = sourceResult.tileId;
const otherResult = GODEOK_RESULTS.find((result) => result.tileId !== sourceId);
assert.ok(otherResult, "끝 append 테스트에 두 번째 결과 타일이 필요하다");
const otherId = otherResult.tileId;
const sourceView = toTileView(sourceResult);
const alternateLayer = sourceView.layerOptions.find((option) => option.id !== sourceView.defaultLayer);
assert.ok(alternateLayer, `${sourceResult.tileCode}에 원본과 다른 레이어가 필요하다`);

let board = initBoard([sourceResult]);
board = withLegacyTileState(board, sourceId, { face: "both" });
board = boardReducer(board, { type: "toggleLabel", id: sourceId, key: "test|0" });
board = boardReducer(board, { type: "duplicate", id: sourceId });
const copyId = "copy:1";
assert.deepEqual(board.order, [sourceId, copyId], "복제본은 원본 바로 뒤에 들어간다");
assert.deepEqual(board.instances, { [copyId]: sourceId }, "복제 id는 copy:N으로 원본 결과를 가리킨다");
assert.equal(board.included[copyId], board.included[sourceId]);
assert.equal(board.faces[copyId], "both");
assert.deepEqual(board.labels[copyId], [{ key: "test|0", on: true }]);
assert.equal(boardReducer(board, { type: "layer", id: copyId, layer: alternateLayer.id }).layers[copyId], alternateLayer.id, "복제본 레이어도 원본 결과의 옵션으로 검증한다");

board = boardReducer(board, { type: "layer", id: copyId, layer: alternateLayer.id });
const saved = serializeBoardState(board);
assert.deepEqual(saved.instances, { [copyId]: sourceId }, "복제 인스턴스가 저장된다");
const restored = restoreBoardState([sourceResult], saved);
assert.deepEqual(restored.order, board.order, "복제 순서 저장→복원");
assert.deepEqual(restored.instances, board.instances, "복제 원본 저장→복원");
assert.deepEqual(restored.labels[copyId], board.labels[copyId], "복제 라벨 저장→복원");
assert.equal(restored.layers[copyId], alternateLayer.id, "복제 레이어 저장→복원");
assert.equal(sourceTileId(restored, copyId), sourceId, "copy:N은 마지막 '-' 파싱 없이 원본 결과를 찾는다");

const rewritten = rewriteSnapshotIds(saved, (id) => id === copyId ? "copy:2" : id);
assert.deepEqual(rewritten.instances, { "copy:2": sourceId }, "analysis id 재작성에서도 copy:N 키와 원본 참조를 함께 유지한다");

const removedCopy = boardReducer(board, { type: "remove", id: copyId });
assert.ok(!removedCopy.order.includes(copyId));
assert.equal(removedCopy.instances[copyId], undefined);
assert.ok(!removedCopy.removed.some((item) => item.id === copyId), "복제본 삭제는 편집 트레이에 보내지 않는다");
const restoredAfterRemove = boardReducer(removedCopy, { type: "undo" });
assert.ok(restoredAfterRemove.order.includes(copyId));
assert.equal(restoredAfterRemove.instances[copyId], sourceId, "복제본 삭제도 undo로 되돌린다");
const undoneDuplicate = boardReducer(boardReducer(initBoard([sourceResult]), { type: "duplicate", id: sourceId }), { type: "undo" });
assert.deepEqual(undoneDuplicate.order, [sourceId], "복제 추가를 undo하면 인스턴스와 순서가 함께 사라진다");
assert.deepEqual(undoneDuplicate.instances, {});

// 마지막 + 칸의 addCopy는 기존 타일 설정을 복제해 보드 끝에 붙이고, 기존 duplicate undo 경로를 사용한다.
let appended = initBoard([sourceResult, otherResult]);
appended = withLegacyTileState(appended, sourceId, { face: "both" });
appended = boardReducer(appended, { type: "toggleLabel", id: sourceId, key: "add-copy|0" });
appended = boardReducer(appended, { type: "layer", id: sourceId, layer: alternateLayer.id });
appended = boardReducer(appended, { type: "addCopy", sourceId });
const appendedCopyId = "copy:1";
assert.deepEqual(appended.order, [sourceId, otherId, appendedCopyId], "addCopy 복제본은 보드 끝에 append된다");
assert.equal(appended.instances[appendedCopyId], sourceId, "addCopy 인스턴스가 원본 결과를 가리킨다");
assert.equal(appended.faces[appendedCopyId], "both", "addCopy가 원본 면 설정을 복제한다");
assert.deepEqual(appended.labels[appendedCopyId], [{ key: "add-copy|0", on: true }], "addCopy가 원본 라벨 설정을 복제한다");
assert.equal(appended.layers[appendedCopyId], alternateLayer.id, "addCopy가 원본 레이어 설정을 복제한다");
assert.equal(appended.undoStack.at(-1)?.kind, "duplicate", "addCopy undo kind는 duplicate를 유지한다");
assert.equal(appended.undoStack.at(-1)?.origin, "addCopy", "addCopy undo origin을 구분한다");

const appendedSnapshot = serializeBoardState(appended);
assert.equal("undoStack" in appendedSnapshot, false, "보드 snapshot에는 undoStack을 추가하지 않는다");
const restoredAppended = restoreBoardState([sourceResult, otherResult], appendedSnapshot);
assert.deepEqual(restoredAppended.order, appended.order, "addCopy 끝 append 저장→복원");
assert.deepEqual(restoredAppended.instances, appended.instances, "addCopy 인스턴스 저장→복원");
assert.deepEqual(restoredAppended.faces, appended.faces, "addCopy 설정 저장→복원");
assert.deepEqual(restoredAppended.labels, appended.labels, "addCopy 라벨 저장→복원");
assert.deepEqual(restoredAppended.layers, appended.layers, "addCopy 레이어 저장→복원");

const undoneAddCopy = boardReducer(appended, { type: "undo" });
assert.deepEqual(undoneAddCopy.order, [sourceId, otherId], "addCopy undo는 끝 복제본 order를 제거한다");
assert.equal(undoneAddCopy.instances[appendedCopyId], undefined, "addCopy undo는 인스턴스를 제거한다");
assert.equal(undoneAddCopy.faces[appendedCopyId], undefined, "addCopy undo는 복제 설정을 제거한다");
assert.equal(undoneAddCopy.layers[appendedCopyId], undefined, "addCopy undo는 복제 레이어를 제거한다");

const stackBoard = boardReducer(initBoard([sourceResult, otherResult]), { type: "stack", layers: [sourceId, otherId] });
const stackCopyGuard = boardReducer(stackBoard, { type: "addCopy", sourceId: "stack:1" });
assert.equal(stackCopyGuard, stackBoard, "스택 addCopy는 no-op");
const sheetBoard = boardReducer(initBoard([sourceResult, otherResult]), { type: "sheet", tiles: [sourceId, otherId], grid: "2x2" });
const sheetCopyGuard = boardReducer(sheetBoard, { type: "addCopy", sourceId: "sheet:1" });
assert.equal(sheetCopyGuard, sheetBoard, "조판 addCopy는 no-op");
const missingCopyGuard = initBoard([sourceResult]);
assert.equal(boardReducer(missingCopyGuard, { type: "addCopy", sourceId: "missing-tile" }), missingCopyGuard, "결과가 없는 addCopy는 no-op");

const views = new Map([
  [sourceId, viewWithLayer(sourceView, board.layers[sourceId] ?? sourceView.defaultLayer)],
  [copyId, viewWithLayer({ ...toTileView(sourceResult), tileId: copyId }, board.layers[copyId] ?? sourceView.defaultLayer)],
]);
assert.notEqual(views.get(sourceId).defaultLayer, views.get(copyId).defaultLayer, "원본과 복제본은 서로 다른 모드로 계획할 수 있다");
const plan = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, [sourceResult]),
  views,
  board,
  analysisDate: "2026-09-30",
});
assert.equal(plan.length, reportPages(board, complexCounts(views), sourcePageCountForViews(views.values())).pages, "복제 보드의 PPT 장수도 reportPages와 동치");
const tileSlides = plan.filter((slide) => slide.kind === "tile");
assert.deepEqual(tileSlides.map((slide) => slide.view.tileId), [sourceId, sourceId, copyId, copyId], "원본·복제본의 출력 면 두 장이 각각 계획에 들어간다");
assert.deepEqual(tileSlides.map((slide) => slide.view.defaultLayer), [sourceView.defaultLayer, sourceView.defaultLayer, alternateLayer.id, alternateLayer.id], "PPT 계획은 원본·복제본의 서로 다른 layers 모드를 보존한다");
const tileMapKeys = tileSlides.flatMap(mapKeysOf).filter(Boolean);
const sourceMapKeys = tileSlides.filter((slide) => slide.view.tileId === sourceId).flatMap(mapKeysOf).filter(Boolean);
const copyMapKeys = tileSlides.filter((slide) => slide.view.tileId === copyId).flatMap(mapKeysOf).filter(Boolean);
assert.ok(copyMapKeys.length > 0, "복제본에 지도 이미지 키가 있어야 한다");
assert.ok(copyMapKeys.every((key) => !sourceMapKeys.includes(key)), `복제 PPT mapKey가 원본과 충돌한다: ${tileMapKeys.join(",")}`);

// buildMapImages가 mapKey가 같은 셀을 재사용하는 기존 guard를 유지하는 동시에,
// copy:N 계획이 서로 다른 key를 제공하는 계약을 고정한다(브라우저 DOM 렌더는 로그인 게이트 환경에서 실행하지 않는다).
const mapImageSource = readFileSync(new URL("../../lib/v2/report/map-image.ts", import.meta.url), "utf8");
assert.match(mapImageSource, /if \(out\[cell\.mapKey\]\) continue;/, "buildMapImages의 셀별 중복 guard 유지");

console.log(`v2 presentation/duplicate tests passed (${plan.length} slides, ${tileMapKeys.length} tile map keys)`);
