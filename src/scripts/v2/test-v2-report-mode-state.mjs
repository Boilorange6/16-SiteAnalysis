import assert from "node:assert/strict";
import { defaultFrame, reportDocReducer } from "../../lib/v2/report/report-doc.ts";
import {
  insertIndexAfter,
  initialReportRail,
  moveByKey,
  pagesUsingTile,
  reportPageMapSelectable,
  dropMoveIndex,
  isTypingTarget,
  reorderMessage,
  stripKeyIntent,
  stripNavIndex,
  transitionMapInteraction,
} from "../../lib/v2/ui/report-mode-logic.ts";

const doc = {
  v: 1,
  format: "wide",
  pages: [
    { id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "blank" },
    {
      id: "p2",
      layout: "map-summary",
      panels: {},
      textBoxes: [],
      notes: "",
      kind: "tile",
      tileId: "S02",
      part: 0,
      settings: {},
      frame: defaultFrame(),
    },
    {
      id: "p3",
      layout: "map-full",
      panels: {},
      textBoxes: [],
      notes: "",
      kind: "compare",
      grid: 2,
      sameExtent: true,
      cells: [
        { tileId: "S02", frame: defaultFrame(), settings: {} },
        { tileId: "S03", frame: defaultFrame(), settings: {} },
      ],
    },
  ],
};

assert.equal(insertIndexAfter(doc, null), 3);
assert.equal(insertIndexAfter(doc, "p2"), 2);
assert.equal(initialReportRail(true), null, "모바일 보고서 모드는 서랍을 열지 않고 시작한다");
assert.equal(initialReportRail(false), "pages", "데스크톱 보고서 모드는 페이지 서랍을 유지한다");
assert.equal(reportPageMapSelectable(doc.pages[0]), false, "표지 파생 지도는 보고서 지도 선택 대상이 아니다");
assert.equal(reportPageMapSelectable(doc.pages[1]), true, "분석 타일 지도는 보고서 지도 선택 대상이다");
assert.equal(reportPageMapSelectable(doc.pages[2]), true, "비교 페이지 지도는 보고서 지도 선택 대상이다");
assert.deepEqual(pagesUsingTile(doc, "S02"), [2, 3]);
assert.deepEqual(pagesUsingTile(doc, "S99"), []);
assert.equal(moveByKey(doc, "p1", "ArrowLeft"), null);
assert.deepEqual(moveByKey(doc, "p1", "ArrowRight"), { type: "move", id: "p1", to: 1 });
assert.deepEqual(moveByKey(doc, "p2", "Home"), { type: "move", id: "p2", to: 0 });
assert.deepEqual(moveByKey(doc, "p2", "End"), { type: "move", id: "p2", to: 2 });

assert.deepEqual(stripKeyIntent({ key: "ArrowRight", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }), { kind: "navigate", key: "ArrowRight" });
assert.deepEqual(stripKeyIntent({ key: "ArrowLeft", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), { kind: "reorder", key: "ArrowLeft" });
assert.deepEqual(stripKeyIntent({ key: "ArrowLeft", ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }), { kind: "reorder", key: "ArrowLeft" }, "mac ⌘+Shift");
assert.equal(stripKeyIntent({ key: "ArrowLeft", ctrlKey: false, metaKey: false, shiftKey: false, altKey: true }), null, "Alt+←는 브라우저 뒤로 가기에 맡긴다");
assert.equal(stripKeyIntent({ key: "Home", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }), null, "Home은 재배치 대상이 아니다");
assert.equal(stripNavIndex(5, 2, "ArrowRight"), 3);
assert.equal(stripNavIndex(5, 0, "ArrowLeft"), null);
assert.equal(stripNavIndex(5, 2, "End"), 4);
assert.equal(stripNavIndex(5, 4, "PageDown"), null);
assert.equal(stripNavIndex(5, 3, "PageUp"), 2);
const ids = ["p1", "p2", "p3", "p4", "p5"];
assert.equal(dropMoveIndex(ids, "p3", "p5", "after"), 4, "3쪽을 5쪽 뒤로");
assert.equal(dropMoveIndex(ids, "p3", "p1", "before"), 0);
assert.equal(dropMoveIndex(ids, "p3", "p4", "before"), null, "제자리");
assert.equal(dropMoveIndex(ids, "p3", "p3", "after"), null, "자기 자신(이어지는 장 포함)");
assert.equal(dropMoveIndex(ids, "p9", "p1", "before"), null);
assert.equal(reorderMessage(2, 4), "3쪽을 5쪽 뒤로 옮겼습니다");
assert.equal(reorderMessage(2, 0), "3쪽을 1쪽 앞으로 옮겼습니다");
assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
assert.equal(isTypingTarget({ tagName: "input" }), true, "tagName 대소문자를 구분하지 않는다");
assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
assert.equal(isTypingTarget(null), false);
const idleMap = { selected: false, moveActive: false, settingsOpen: false };
const selectedMap = { selected: true, moveActive: false, settingsOpen: false };
const movingMap = { selected: true, moveActive: true, settingsOpen: false };
const editingWithSettings = { selected: true, moveActive: true, settingsOpen: true };
assert.deepEqual(transitionMapInteraction(idleMap, "select"), selectedMap, "select는 선택만 한다");
assert.deepEqual(transitionMapInteraction(movingMap, "select"), movingMap, "select는 이동 활성 상태를 보존한다");
assert.deepEqual(transitionMapInteraction(selectedMap, "enter-move", true), selectedMap, "고정된 지도는 편집에 들어가지 않는다");
assert.deepEqual(transitionMapInteraction(movingMap, "toggle-move", true), movingMap, "고정된 지도는 이동 상태를 바꾸지 않는다");
assert.deepEqual(transitionMapInteraction(idleMap, "enter-move"), movingMap, "enter-move는 선택과 이동을 활성화한다");
assert.deepEqual(transitionMapInteraction(idleMap, "toggle-move"), movingMap, "toggle-move는 선택을 보장하고 이동을 켠다");
assert.deepEqual(transitionMapInteraction(movingMap, "toggle-move"), selectedMap, "toggle-move는 이동을 끈다");
assert.deepEqual(transitionMapInteraction(movingMap, "end-move"), selectedMap, "end-move는 선택을 보존한다");
assert.deepEqual(transitionMapInteraction(movingMap, "escape"), selectedMap, "활성 중 Escape는 선택을 보존한다");
assert.deepEqual(transitionMapInteraction(selectedMap, "escape"), idleMap, "비활성 Escape는 선택을 해제한다");
assert.deepEqual(transitionMapInteraction(selectedMap, "open-settings"), { selected: true, moveActive: false, settingsOpen: true });
assert.deepEqual(transitionMapInteraction({ selected: true, moveActive: false, settingsOpen: true }, "close-settings"), selectedMap);
assert.deepEqual(transitionMapInteraction(editingWithSettings, "escape"), { selected: true, moveActive: false, settingsOpen: true }, "Esc 1: 편집 끝");
assert.deepEqual(transitionMapInteraction({ selected: true, moveActive: false, settingsOpen: true }, "escape"), selectedMap, "Esc 2: 카드 닫기");
assert.deepEqual(transitionMapInteraction(selectedMap, "escape"), { selected: false, moveActive: false, settingsOpen: false }, "Esc 3: 선택 해제");
assert.deepEqual(transitionMapInteraction(movingMap, "outside-slide"), selectedMap, "활성 중 슬라이드 바깥 클릭은 선택을 보존한다");
assert.deepEqual(transitionMapInteraction(selectedMap, "outside-slide"), idleMap, "비활성 슬라이드 바깥 클릭은 선택을 해제한다");
assert.deepEqual(transitionMapInteraction(movingMap, "outside-page"), idleMap, "페이지 바깥 클릭은 항상 해제한다");
assert.deepEqual(transitionMapInteraction(editingWithSettings, "outside-page"), idleMap);

const compareWithoutExtent = reportDocReducer(doc, { type: "sameExtent", id: "p3", value: false });
assert.equal(compareWithoutExtent.pages[2].sameExtent, false, "compare sameExtent를 끌 수 있다");
assert.equal(doc.pages[2].sameExtent, true, "sameExtent reducer는 입력을 바꾸지 않는다");
const sharedFramePatch = { zoomDelta: 1.5, offsetM: [42, -17], scaleDenominator: 2500 };
const firstCompareCell = reportDocReducer(compareWithoutExtent, { type: "frame", id: "p3", cell: 0, patch: sharedFramePatch });
const bothCompareCells = reportDocReducer(firstCompareCell, { type: "frame", id: "p3", cell: 1, patch: sharedFramePatch });
assert.deepEqual(bothCompareCells.pages[2].cells[0].frame, bothCompareCells.pages[2].cells[1].frame, "두 compare 셀에 같은 frame patch를 순서대로 적용한다");
assert.deepEqual(bothCompareCells.pages[2].cells[0].frame.offsetM, [42, -17]);
assert.equal(reportDocReducer(compareWithoutExtent, { type: "sameExtent", id: "p3", value: true }).pages[2].sameExtent, true, "compare sameExtent를 다시 켤 수 있다");

console.log("report mode state: PASS");
