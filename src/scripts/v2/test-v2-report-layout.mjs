import assert from "node:assert/strict";

const { reportLayoutDecision } = await import("../../lib/v2/report/report-layout.ts");
const { defaultFrame, reportDocReducer } = await import("../../lib/v2/report/report-doc.ts");

const map = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: true });
assert.deepEqual(map.choices.map((choice) => choice.value), ["map-full", "map-summary", "numbers-first"], "지도 타일은 실제로 다른 세 레이아웃만 노출한다");
assert.ok(map.choices.every((choice) => !choice.label.includes("side-by-side")), "옛 나란히 식별자를 UI에 노출하지 않는다");

const picture = reportLayoutDecision({ pageKind: "tile", hasMap: false, hasSummary: true });
assert.ok(picture.choices.every((choice) => choice.label.includes("그림") || choice.label === "숫자 먼저"), "지도 없는 타일은 그림 이름을 쓴다");

const deduped = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: true, renderSignatures: { "map-full": "same", "map-summary": "same", "numbers-first": "numbers" } });
assert.deepEqual(deduped.choices.map((choice) => choice.value), ["map-full", "numbers-first"], "실제 렌더 시그니처가 같은 버튼은 제거한다");

const compare = reportLayoutDecision({ pageKind: "compare" });
assert.equal(compare.choices.length, 0, "조판에는 일반 레이아웃을 보이지 않는다");
assert.deepEqual(compare.gridChoices.map((choice) => choice.value), ["2x2", "3x2", "3x1"], "조판에는 칸 수만 보인다");

for (const pageKind of ["cover", "sources", "blank"]) {
  const fixed = reportLayoutDecision({ pageKind });
  assert.equal(fixed.choices[0]?.disabled, true, `${pageKind} 레이아웃 버튼은 disabled다`);
  assert.ok(fixed.choices[0]?.tooltip, `${pageKind} 레이아웃 버튼은 툴팁을 가진다`);
}

const comparePage = {
  id: "p1", layout: "map-summary", panels: {}, textBoxes: [], notes: "", kind: "compare", grid: "2x2",
  sameExtent: false,
  cells: [
    { tileId: "t1", settings: {}, frame: { ...defaultFrame(), zoomDelta: 1, offsetM: [1, 2] } },
    { tileId: "t2", settings: {}, frame: { ...defaultFrame(), zoomDelta: -1, offsetM: [-1, -2] } },
  ],
};
const gridChanged = reportDocReducer({ v: 1, format: "wide", pages: [comparePage] }, { type: "grid", id: "p1", grid: "3x2" });
assert.equal(gridChanged.pages[0].grid, "3x2", "격자 변경은 compare grid만 바꾼다");
assert.equal(gridChanged.pages[0].cells[0].frame.zoomDelta, 1, "격자 변경은 첫 칸 frame을 보존한다");
assert.equal(gridChanged.pages[0].cells[1].frame.offsetM[1], -2, "격자 변경은 다른 칸 frame도 보존한다");

console.log("v2 report layout contract tests passed");
