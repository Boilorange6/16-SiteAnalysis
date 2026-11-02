import assert from "node:assert/strict";
import { PAGE_PANEL_KEYS, clonePagePanels, normalizePagePanelRect, normalizePagePanels, pagePanelGeometryKey, pagePanelHasOverride, placeActionBar } from "../../lib/v2/report/report-geometry.ts";
import { defaultFrame, historyApply, historyUndo, reportDocReducer } from "../../lib/v2/report/report-doc.ts";

assert.deepEqual(PAGE_PANEL_KEYS, ["title", "summary", "legend", "source", "north", "scaleBar", "locator"], "7종 페이지 요소 사각형 키를 고정한다");
assert.deepEqual(normalizePagePanelRect({ x: -0.2, y: 0.4, w: 2, h: 0 }), { x: 0, y: 0.4, w: 1, h: 0.01 }, "정규화 사각형은 페이지 안에 남긴다");
const panels = normalizePagePanels({
  title: { x: 0.01, y: 0.02, w: 0.3, h: 0.1 },
  source: { x: 0.1, y: 0.9, w: 0.7, h: 0.03 },
  north: { x: 0.8, y: 0.1, w: 0.08, h: 0.08 },
  scaleBar: { x: 0.1, y: 0.8, w: 0.2, h: 0.08 },
  locator: { x: 0.7, y: 0.7, w: 0.2, h: 0.2 },
  ignored: { x: 0, y: 0, w: 1, h: 1 },
});
assert.ok(panels?.source && panels?.north && panels?.scaleBar && panels?.locator, "장식 사각형도 정규화한다");
assert.equal(pagePanelHasOverride(panels ?? undefined, "scaleBar"), true);
assert.equal(pagePanelHasOverride(panels ?? undefined, "legend"), false);
assert.match(pagePanelGeometryKey(panels ?? undefined), /source=.*north=.*scaleBar=.*locator=/, "캐시 키에 장식 사각형을 포함한다");
assert.deepEqual(clonePagePanels(panels), panels, "복제 시 7종 사각형을 보존한다");

const stage = { w: 960, h: 540 };
assert.deepEqual(placeActionBar({ x: 320, y: 120, w: 120, h: 80 }, stage), { left: 320, top: 72, placement: "above" }, "공통 막대는 요소 위 8px에 둔다");
assert.deepEqual(placeActionBar({ x: 320, y: 4, w: 120, h: 80 }, stage), { left: 320, top: 92, placement: "below" }, "위 공간이 없으면 공통 막대를 요소 아래 8px에 둔다");
assert.deepEqual(placeActionBar({ x: 320, y: 0, w: 120, h: 520 }, stage), { left: 320, top: 8, placement: "inside-top" }, "아래 공간도 없으면 공통 막대를 요소 안쪽 위에 둔다");
assert.deepEqual(placeActionBar({ x: -40, y: 120, w: 120, h: 80 }, stage), { left: 4, top: 72, placement: "above" }, "공통 막대는 좌우 무대 안으로 자른다");

const page = { id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "tile", tileId: "A01", part: { type: "single" }, settings: { face: "front", callout: "overview" }, frame: defaultFrame() };
const doc = { v: 1, format: "wide", pages: [page] };
const next = reportDocReducer(doc, { type: "panels", id: "p1", panels: panels ?? {} });
assert.deepEqual(next.pages[0].panels, panels, "문서 reducer가 모든 요소 사각형을 저장한다");
const history = historyApply({ past: [], present: doc, future: [] }, { type: "panels", id: "p1", panels: panels ?? {} });
assert.deepEqual(historyUndo(history).present.pages[0].panels, {}, "사각형 변경을 undo로 되돌린다");

const compare = {
  id: "p2",
  layout: "map-summary",
  panels: {},
  textBoxes: [],
  notes: "",
  kind: "compare",
  grid: "2x2",
  sameExtent: false,
  cells: [
    { tileId: "A01", settings: page.settings, frame: defaultFrame() },
    null,
    null,
    null,
  ],
};
const compareDoc = { v: 1, format: "wide", pages: [compare] };
const cellNext = reportDocReducer(compareDoc, { type: "cellPanels", id: "p2", cell: 0, panels: { scaleBar: panels?.scaleBar } });
assert.deepEqual(cellNext.pages[0].cells[0].panels, { scaleBar: panels?.scaleBar }, "조판 칸도 장식 사각형을 저장한다");
const cellCleared = reportDocReducer(cellNext, { type: "cellPanels", id: "p2", cell: 0, panels: {} });
assert.equal(cellCleared.pages[0].cells[0].panels, undefined, "빈 조판 칸 사각형은 자동 배치로 되돌린다");
const cellHistory = historyApply({ past: [], present: compareDoc, future: [] }, { type: "cellPanels", id: "p2", cell: 0, panels: { scaleBar: panels?.scaleBar } });
assert.equal(historyUndo(cellHistory).present.pages[0].cells[0].panels, undefined, "조판 칸 사각형도 undo로 되돌린다");

console.log("test-v2-report-element-geometry: PASS");
