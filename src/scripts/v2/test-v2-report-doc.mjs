/** 보고서 문서 모델·리듀서·되돌리기 기록 계약. */
import assert from "node:assert/strict";

const {
  EMPTY_REPORT_DOC,
  SITE_FIT_PATCH,
  defaultFrame,
  historyApply,
  historyRedo,
  historyUndo,
  newPageId,
  reportDocReducer,
} = await import("../../lib/v2/report/report-doc.ts");

const settings = { face: "front", callout: "top10" };
const page = (id, overrides = {}) => ({
  id,
  layout: "map-summary",
  panels: { title: { x: 0.05, y: 0.05, w: 0.3, h: 0.1 } },
  textBoxes: [],
  notes: "발표 메모",
  kind: "tile",
  tileId: "t-A01",
  part: { type: "single" },
  settings: { ...settings },
  frame: defaultFrame(),
  ...overrides,
});
const docWithPages = {
  v: 1,
  format: "wide",
  pages: [page("p1"), page("p2"), page("p3")],
};

assert.deepEqual(EMPTY_REPORT_DOC, { v: 1, format: "wide", pages: [] });
assert.deepEqual(SITE_FIT_PATCH, { offsetM: [0, 0] }, "대지 맞춤 패치는 중심만 초기화한다");
assert.equal("zoomDelta" in SITE_FIT_PATCH, false, "대지 맞춤 패치는 확대를 건드리지 않는다");
assert.equal("scaleDenominator" in SITE_FIT_PATCH, false, "대지 맞춤 패치는 축척 입력을 건드리지 않는다");
assert.deepEqual(defaultFrame(), {
  zoomDelta: 0,
  offsetM: [0, 0],
  scaleDenominator: null,
  locked: false,
  basemap: "base",
  hiddenLayers: [],
  labelRule: "site-near",
  pinnedKeys: [],
  legend: { order: [], hidden: [], visibleOnly: true, placement: "below" },
  decorations: { north: true, scaleBar: true, locator: false },
});

let doc = { ...EMPTY_REPORT_DOC };
doc = reportDocReducer(doc, { type: "add", pages: [page("p1"), page("p2")], index: 0 });
doc = reportDocReducer(doc, { type: "add", pages: [page("p3")], index: 1 });
assert.deepEqual(doc.pages.map((item) => item.id), ["p1", "p3", "p2"], "add 순서");
doc = reportDocReducer(doc, { type: "move", id: "p2", to: 0 });
assert.deepEqual(doc.pages.map((item) => item.id), ["p2", "p1", "p3"], "move 순서");
doc = reportDocReducer(doc, { type: "duplicate", id: "p1" });
assert.deepEqual(doc.pages.map((item) => item.id), ["p2", "p1", "p4", "p3"], "duplicate는 새 id로 바로 뒤");
assert.notEqual(doc.pages[1], doc.pages[2], "duplicate page reference 분리");
doc = reportDocReducer(doc, { type: "remove", id: "p1" });
assert.deepEqual(doc.pages.map((item) => item.id), ["p2", "p4", "p3"], "remove 순서");
assert.equal(newPageId(doc), "p1", "빈 id를 재사용할 수 있다");

const original = structuredClone(docWithPages);
const laidOut = reportDocReducer(docWithPages, { type: "layout", id: "p1", layout: "numbers-first" });
assert.equal(laidOut.pages[0].layout, "numbers-first");
assert.deepEqual(laidOut.pages[0].panels, {}, "layout 변경은 panels를 기본 자리로 되돌린다");
assert.deepEqual(laidOut.pages[0].frame, original.pages[0].frame, "layout 변경은 frame을 보존한다");
assert.deepEqual(docWithPages, original, "layout reducer는 입력을 바꾸지 않는다");

const textBox = { id: "text-1", x: 0.1, y: 0.2, w: 0.3, h: 0.1, text: "메모", pt: 16 };
const withBox = reportDocReducer(docWithPages, { type: "textBox", id: "p1", box: textBox });
const withNote = reportDocReducer(withBox, { type: "notes", id: "p1", notes: "발표자 노트" });
assert.deepEqual(withNote.pages[0].textBoxes, [textBox]);
assert.equal(withNote.pages[0].notes, "발표자 노트");
const withoutBox = reportDocReducer(withNote, { type: "textBox", id: "p1", box: { id: "text-1", remove: true } });
assert.deepEqual(withoutBox.pages[0].textBoxes, []);

const locked = reportDocReducer(docWithPages, { type: "frame", id: "p1", patch: { locked: true } });
const ignoredMove = reportDocReducer(locked, { type: "frame", id: "p1", patch: { offsetM: [5, 5], zoomDelta: 2 } });
assert.deepEqual(ignoredMove.pages[0].frame, locked.pages[0].frame, "locked frame은 위치·확대를 무시한다");
const zoomed = reportDocReducer(docWithPages, { type: "frame", id: "p1", patch: { offsetM: [12, -4], zoomDelta: 1.25, scaleDenominator: 2500 } });
const fitted = reportDocReducer(zoomed, { type: "frame", id: "p1", patch: SITE_FIT_PATCH });
assert.deepEqual(fitted.pages[0].frame.offsetM, [0, 0], "대지 맞춤은 중심만 되돌린다");
assert.equal(fitted.pages[0].frame.zoomDelta, 1.25, "대지 맞춤은 현재 확대를 보존한다");
assert.equal(fitted.pages[0].frame.scaleDenominator, 2500, "대지 맞춤은 고정 축척을 보존한다");
const forcedFit = reportDocReducer(ignoredMove, {
  type: "frame",
  id: "p1",
  patch: { offsetM: [0, 0], zoomDelta: 0, scaleDenominator: null },
  force: true,
});
assert.deepEqual(forcedFit.pages[0].frame.offsetM, [0, 0], "force fit은 locked frame에 적용된다");
assert.equal(forcedFit.pages[0].frame.locked, true);
const unlockedMove = reportDocReducer(locked, { type: "frame", id: "p1", patch: { locked: false, offsetM: [8, -3] } });
assert.deepEqual(unlockedMove.pages[0].frame.offsetM, [8, -3], "locked:false와 함께 온 이동은 적용된다");
assert.equal(unlockedMove.pages[0].frame.locked, false);

const formatted = reportDocReducer(docWithPages, { type: "format", format: "a3" });
assert.equal(formatted.format, "a3");
assert.ok(formatted.pages.every((item) => Object.keys(item.panels).length === 0), "format 변경은 모든 panels를 비운다");
assert.deepEqual(formatted.pages.map((item) => item.frame), docWithPages.pages.map((item) => item.frame), "format 변경은 frame을 보존한다");
assert.equal(docWithPages.format, "wide", "format reducer는 입력을 바꾸지 않는다");

const rich = reportDocReducer(withNote, { type: "text", id: "p1", title: "새 제목", summary: "새 요약" });
let history = { past: [], present: rich, future: [] };
history = historyApply(history, { type: "remove", id: "p1" });
assert.equal(history.present.pages.some((item) => item.id === "p1"), false);
history = historyUndo(history);
assert.deepEqual(history.present, rich, "remove undo는 글상자·메모·문서를 깊게 복원한다");
history = historyRedo(history);
assert.equal(history.present.pages.some((item) => item.id === "p1"), false, "redo는 다시 삭제한다");

let bounded = { past: [], present: EMPTY_REPORT_DOC, future: [] };
for (let i = 0; i < 101; i += 1) bounded = historyApply(bounded, { type: "format", format: i % 2 === 0 ? "a3" : "a4" });
assert.equal(bounded.past.length, 100, "history past는 최대 100단계");

console.log("v2 report doc tests passed");
