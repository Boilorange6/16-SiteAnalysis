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

const fitted = reportDocReducer({ v: 1, format: "wide", pages: [comparePage] }, { type: "copyExtent", id: "p1", cell: 1 });
assert.equal(fitted.pages[0].cells[0].frame.zoomDelta, -1, "범위 맞추기는 선택 칸의 축척을 모든 칸에 복사한다");
assert.deepEqual(fitted.pages[0].cells[0].frame.offsetM, [-1, -2], "범위 맞추기는 선택 칸의 이동을 모든 칸에 복사한다");
assert.deepEqual(fitted.pages[0].cells[1].frame.offsetM, [-1, -2], "범위 맞추기는 한 history action으로 선택 칸도 유지한다");

const removedCell = reportDocReducer({ v: 1, format: "wide", pages: [comparePage] }, { type: "removeCell", id: "p1", cell: 0 });
assert.equal(removedCell.pages[0].cells[0], null, "조판 칸 지우기는 빈 슬롯으로 되돌린다");
assert.equal(removedCell.pages[0].cells[1].tileId, "t2", "조판 칸 지우기는 다른 칸 위치를 당기지 않는다");

// ── 「지도 + 그래프」 (map-charts)
const withCharts = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: true, hasCharts: true });
assert.deepEqual(withCharts.choices.map((choice) => choice.value), ["map-full", "map-summary", "map-charts", "numbers-first"], "그래프 자료가 있으면 map-summary 다음에 map-charts가 있다");
assert.equal(withCharts.choices.find((choice) => choice.value === "map-charts")?.label, "지도 + 그래프", "map-charts 이름");
assert.ok(!reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: true, hasCharts: false }).choices.some((choice) => choice.value === "map-charts"), "그래프 자료가 없으면 map-charts를 고를 수 없다");
assert.ok(!map.choices.some((choice) => choice.value === "map-charts"), "hasCharts를 주지 않으면 map-charts가 없다");
assert.ok(!reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: false, hasCharts: true }).choices.some((choice) => choice.value === "map-charts"), "요약 칸이 없으면 map-charts는 「지도 크게」와 같은 모양이라 뺀다");
assert.deepEqual(reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: true, hasCharts: true, renderSignatures: { "map-charts": "지도:summary:summary" } }).choices.map((choice) => choice.value), ["map-full", "map-summary", "numbers-first"], "시그니처가 같으면 map-charts도 중복으로 뺀다");

const { restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
const restorePage = (layout) => ({ id: "p-chart", kind: "tile", layout, panels: {}, textBoxes: [], notes: "", tileId: "t-A01", part: { type: "single" }, settings: { face: "front", callout: "overview" }, frame: defaultFrame() });
assert.equal(restoreReportDoc({ v: 1, format: "wide", pages: [restorePage("map-charts")] }, new Set(["t-A01"])).pages[0]?.layout, "map-charts", "restore는 map-charts를 받아들인다");
assert.equal(restoreReportDoc({ v: 1, format: "wide", pages: [restorePage("map-weird")] }, new Set(["t-A01"])).pages.length, 0, "모르는 레이아웃 값은 버린다");

const { chartsColumnLayout, slidePanelRects, layoutRects } = await import("../../lib/v2/ui/overlay-layout.ts");
assert.deepEqual(layoutRects("map-charts", "wide"), layoutRects("map-summary", "wide"), "map-charts는 map-summary와 같은 사각형");
for (const format of ["wide", "a3", "a4"]) {
  const summary = slidePanelRects({}, true, undefined, format).summary;
  for (const scale of [1, 1.85]) {
    const column = chartsColumnLayout(summary, scale);
    const names = ["headline", "stat", "composition", "distance", "sentence", "notesChip"];
    assert.deepEqual(Object.keys(column).sort(), [...names].sort(), `${format} ${scale}: 6칸`);
    const eps = 1e-9;
    for (const name of names) {
      const r = column[name];
      assert.ok(r.w > 0 && r.h > 0, `${format} ${scale}: ${name} 크기 > 0`);
      assert.ok(r.x >= summary.x - eps && r.y >= summary.y - eps && r.x + r.w <= summary.x + summary.w + eps && r.y + r.h <= summary.y + summary.h + eps, `${format} ${scale}: ${name}이 요약 칸 안`);
    }
    for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
      const a = column[names[i]];
      const b = column[names[j]];
      const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > eps && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > eps;
      assert.ok(!overlap, `${format} ${scale}: ${names[i]}와 ${names[j]}가 겹치지 않는다`);
    }
    const order = names.map((name) => column[name].y);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${format} ${scale}: 위에서 아래로 headline → stat → composition → distance → sentence → notesChip`);
  }
}
{
  const summary = slidePanelRects({}, true, undefined, "wide").summary;
  const { distance } = chartsColumnLayout(summary, 1);
  assert.ok(distance.w >= 3.9 && distance.h >= 1.9, `16:9 거리 그래프 칸은 3.9 × 1.9 in 이상이다 (${distance.w.toFixed(2)} × ${distance.h.toFixed(2)})`);
  assert.deepEqual(chartsColumnLayout(summary, 1.85).distance, distance, "거리 그래프 칸은 글자 배율에 따라 줄지 않는다");
}

console.log("v2 report layout contract tests passed");
