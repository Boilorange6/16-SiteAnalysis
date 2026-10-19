import assert from "node:assert/strict";
import { defaultFrame, reportDocReducer } from "../../lib/v2/report/report-doc.ts";
import {
  insertIndexAfter,
  moveByKey,
  pagesUsingTile,
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
assert.deepEqual(pagesUsingTile(doc, "S02"), [2, 3]);
assert.deepEqual(pagesUsingTile(doc, "S99"), []);
assert.equal(moveByKey(doc, "p1", "ArrowLeft"), null);
assert.deepEqual(moveByKey(doc, "p1", "ArrowRight"), { type: "move", id: "p1", to: 1 });
assert.deepEqual(moveByKey(doc, "p2", "Home"), { type: "move", id: "p2", to: 0 });
assert.deepEqual(moveByKey(doc, "p2", "End"), { type: "move", id: "p2", to: 2 });

const idleMap = { selected: false, moveActive: false };
const selectedMap = { selected: true, moveActive: false };
const movingMap = { selected: true, moveActive: true };
assert.deepEqual(transitionMapInteraction(idleMap, "select"), selectedMap, "select는 선택만 한다");
assert.deepEqual(transitionMapInteraction(movingMap, "select"), movingMap, "select는 이동 활성 상태를 보존한다");
assert.deepEqual(transitionMapInteraction(idleMap, "enter-move"), movingMap, "enter-move는 선택과 이동을 활성화한다");
assert.deepEqual(transitionMapInteraction(idleMap, "toggle-move"), movingMap, "toggle-move는 선택을 보장하고 이동을 켠다");
assert.deepEqual(transitionMapInteraction(movingMap, "toggle-move"), selectedMap, "toggle-move는 이동을 끈다");
assert.deepEqual(transitionMapInteraction(movingMap, "end-move"), selectedMap, "end-move는 선택을 보존한다");
assert.deepEqual(transitionMapInteraction(movingMap, "escape"), selectedMap, "활성 중 Escape는 선택을 보존한다");
assert.deepEqual(transitionMapInteraction(selectedMap, "escape"), idleMap, "비활성 Escape는 선택을 해제한다");
assert.deepEqual(transitionMapInteraction(movingMap, "outside-slide"), selectedMap, "활성 중 슬라이드 바깥 클릭은 선택을 보존한다");
assert.deepEqual(transitionMapInteraction(selectedMap, "outside-slide"), idleMap, "비활성 슬라이드 바깥 클릭은 선택을 해제한다");
assert.deepEqual(transitionMapInteraction(movingMap, "outside-page"), idleMap, "페이지 바깥 클릭은 항상 해제한다");

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
