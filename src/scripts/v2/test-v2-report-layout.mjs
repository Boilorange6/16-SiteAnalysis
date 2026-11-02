import assert from "node:assert/strict";

const { reportLayoutDecision, resolveReportLayout } = await import("../../lib/v2/report/report-layout.ts");
const { defaultFrame, reportDocReducer } = await import("../../lib/v2/report/report-doc.ts");

const map = reportLayoutDecision({ pageKind: "tile", hasMap: true });
assert.deepEqual(map.choices.map((choice) => choice.value), ["map-key"], "그래프 자료가 없는 지도 타일은 지도 + 숫자 하나뿐이다");
assert.deepEqual(map.choices.map((choice) => choice.label), ["지도 + 숫자"]);
assert.ok(map.choices.every((choice) => !choice.label.includes("side-by-side")), "옛 나란히 식별자를 UI에 노출하지 않는다");

// 지도도 그림도 없는 비그림 타일 장(뒷면 표 등): 숫자 먼저 하나뿐
const noMap = reportLayoutDecision({ pageKind: "tile", hasMap: false });
assert.deepEqual(noMap.choices.map((choice) => [choice.value, choice.label]), [["numbers-first", "숫자 먼저"]], "지도·그림 없는 장은 숫자 먼저 하나뿐이다");

// resolveReportLayout: 그리는 단계의 공통 판정
const resolve = (layout, hasMap, figure, hasCharts) => resolveReportLayout(layout, { hasMap, figure, hasCharts });
assert.equal(resolve("numbers-first", true, false, true), "map-charts", "숫자 먼저 + 지도 + 그래프 → 지도 + 그래프");
assert.equal(resolve("numbers-first", true, false, false), "map-key", "숫자 먼저 + 지도 + 그래프 없음 → 지도 + 숫자");
assert.equal(resolve("map-charts", true, false, false), "map-key", "그래프 자료를 잃은 map-charts → map-key (빈 그래프 카드를 남기지 않는다)");
assert.equal(resolve("map-charts", false, true, true), "map-key", "그림 장의 map-charts → map-key");
assert.equal(resolve("numbers-first", false, false, false), "numbers-first", "지도·그림 없는 장은 numbers-first 그대로");
assert.equal(resolve("map-key", true, false, true), "map-key", "map-key를 고른 장은 그래프가 있어도 map-key");
assert.equal(resolve("map-charts", true, false, true), "map-charts");
assert.equal(resolve("map-summary", true, false, true), "map-key", "옛 값은 map-key");

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
const withCharts = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasCharts: true });
assert.deepEqual(withCharts.choices.map((choice) => choice.value), ["map-key", "map-charts"], "그래프 자료가 있으면 지도 + 숫자·지도 + 그래프 둘");
assert.deepEqual(withCharts.choices.map((choice) => choice.label), ["지도 + 숫자", "지도 + 그래프"], "두 이름");
assert.deepEqual(reportLayoutDecision({ pageKind: "tile", hasMap: true, hasCharts: true }).choices.map((choice) => choice.value), ["map-key", "map-charts"], "그래프가 있으면 둘");
assert.ok(!reportLayoutDecision({ pageKind: "tile", hasMap: true, hasCharts: false }).choices.some((choice) => choice.value === "map-charts"), "그래프 자료가 없으면 map-charts를 고를 수 없다");
assert.ok(!map.choices.some((choice) => choice.value === "map-charts"), "hasCharts를 주지 않으면 map-charts가 없다");

const { restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
const restorePage = (layout) => ({ id: "p-chart", kind: "tile", layout, panels: {}, textBoxes: [], notes: "", tileId: "t-A01", part: { type: "single" }, settings: { face: "front", callout: "overview" }, frame: defaultFrame() });
assert.equal(restoreReportDoc({ v: 1, format: "wide", pages: [restorePage("map-charts")] }, new Set(["t-A01"])).pages[0]?.layout, "map-charts", "restore는 map-charts를 받아들인다");
assert.equal(restoreReportDoc({ v: 1, format: "wide", pages: [restorePage("map-weird")] }, new Set(["t-A01"])).pages.length, 0, "모르는 레이아웃 값은 버린다");

const { chartsColumnLayout, slidePanelRects, layoutRects } = await import("../../lib/v2/ui/overlay-layout.ts");
assert.deepEqual(layoutRects("map-charts", "wide"), layoutRects("map-key", "wide"), "map-charts는 map-key와 같은 사각형");
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

// ── 그림 타일(바람장미·3D 매스): 「숫자 먼저」 없이 「그림 + 숫자」만
{
  const figure = reportLayoutDecision({ pageKind: "tile", hasMap: false, figure: true });
  assert.deepEqual(figure.choices.map((choice) => choice.value), ["map-key"], "그림 타일은 숫자 먼저를 뺀다");
  assert.deepEqual(figure.choices.map((choice) => choice.label), ["그림 + 숫자"]);
  // 지도 없는 다른 장(뒷면 표 등)은 그대로 숫자 먼저를 갖는다.
  assert.ok(reportLayoutDecision({ pageKind: "tile", hasMap: false }).choices.some((choice) => choice.value === "numbers-first"), "그림 타일이 아닌 지도 없는 장은 숫자 먼저 유지");
  assert.ok(!map.choices.some((choice) => choice.value === "numbers-first"), "지도 타일에는 숫자 먼저가 없다");

  const { isFigureTileId } = await import("../../lib/v2/report/report-layout.ts");
  assert.ok(isFigureTileId("t-D22") && isFigureTileId("fe9e688b-f7d0-4eda-b00a-7867ea6636ee-S01"), "D22·S01 타일 id");
  assert.ok(!isFigureTileId("t-A01") && !isFigureTileId("t-D17"), "그 밖의 타일 id");

  const savedPage = (tileId, layout, panels = {}) => ({ id: `p-${tileId}`, kind: "tile", layout, panels, textBoxes: [], notes: "", tileId, part: { type: "single" }, settings: { face: "front", callout: "overview" }, frame: defaultFrame() });
  const customPanel = { title: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } };
  const restored = restoreReportDoc({
    v: 1,
    format: "wide",
    pages: [
      savedPage("t-D22", "numbers-first", customPanel),
      savedPage("t-S01", "numbers-first"),
      savedPage("t-A01", "numbers-first", customPanel),
      savedPage("t-D22", "map-full"),
    ].map((page, index) => ({ ...page, id: `p-${index}` })),
  }, new Set(["t-D22", "t-S01", "t-A01"]));
  assert.deepEqual(restored.pages.map((page) => page.layout), ["map-key", "map-key", "numbers-first", "map-key"], "저장된 숫자 먼저 그림 장은 그림 + 숫자로, 지도 장의 numbers-first는 그리는 단계가 정하므로 그대로, map-full은 map-key");
  assert.deepEqual(restored.pages[0].panels, {}, "숫자 먼저 기준으로 옮긴 패널 자리는 버린다");
  assert.ok(restored.pages[2].panels.title, "지도 장의 패널 자리는 그대로");

  // ── 저장 장 이관: 한 문서에 옛 값 다섯 가지
  const north = { x: 0.1, y: 0.1, w: 0.05, h: 0.05 };
  const oldPanels = { north, title: { x: 0.2, y: 0.1, w: 0.3, h: 0.1 }, summary: { x: 0.6, y: 0.2, w: 0.3, h: 0.5 }, source: { x: 0.2, y: 0.9, w: 0.3, h: 0.05 } };
  const mixed = restoreReportDoc({
    v: 1,
    format: "wide",
    pages: ["map-summary", "map-charts", "numbers-first", "map-full", "side-by-side"].map((layout, index) => ({ ...savedPage("t-A01", layout, oldPanels), id: `p-m${index}` })),
  }, new Set(["t-A01"]));
  assert.deepEqual(mixed.pages.map((page) => page.layout), ["map-key", "map-charts", "numbers-first", "map-key", "map-key"], "옛 다섯 값 이관");
  assert.deepEqual(mixed.pages.map((page) => (page.deletedElementKeys ?? []).includes("summary")), [false, false, false, true, false], "map-full 쪽만 숫자 카드를 지운 요소에 넣는다");
  // Ruling 18a: 요약 판·출처 줄 자리는 복원이 layout을 map-key로 바꿀 때만 버린다. numbers-first·map-charts는 그리는 단계가 판정하므로 저장 문서에는 남긴다.
  const rewritten = [true, false, false, true, true];
  mixed.pages.forEach((page, index) => {
    assert.deepEqual(page.panels.north, north, `${index}: 방위표 자리는 남는다(새 틀 안인지는 기하가 판정)`);
    assert.ok(page.panels.title, `${index}: 제목 자리도 남는다`);
    assert.equal(!page.panels.summary && !page.panels.source, rewritten[index], `${index}: layout을 map-key로 바꾼 쪽만 옛 요약 판·출처 줄 자리를 버린다`);
  });
  // 뒷면 표(numbers-first, 지도·그림 없음)의 옮긴 자리는 복원·저장(복원 반복)을 거쳐도 남는다.
  const backTable = restoreReportDoc({ v: 1, format: "wide", pages: [savedPage("t-A01", "numbers-first", oldPanels)] }, new Set(["t-A01"]));
  const backTableAgain = restoreReportDoc(JSON.parse(JSON.stringify(backTable)), new Set(["t-A01"]));
  assert.ok(backTableAgain.pages[0].panels.summary && backTableAgain.pages[0].panels.source, "numbers-first의 요약·출처 자리는 저장을 거듭해도 남는다");
  // 이미 map-key인 문서의 자리는 사용자가 새로 옮긴 것이라 남긴다.
  const keyed = restoreReportDoc({ v: 1, format: "wide", pages: [savedPage("t-A01", "map-key", oldPanels)] }, new Set(["t-A01"]));
  assert.equal(keyed.pages[0].layout, "map-key");
  assert.ok(keyed.pages[0].panels.summary && keyed.pages[0].panels.source, "map-key 문서의 요약·출처 자리는 그대로");
  assert.ok(!(keyed.pages[0].deletedElementKeys ?? []).includes("summary"), "map-key는 숫자 카드를 지우지 않는다");

  // M3: 타일이 아닌 장(표지·출처·빈 장·조판)에 남은 옛 값도 복원 때 새 값(map-key) 하나로 바꾼다. 타입에는 옛 값이 없다.
  const simple = (kind, layout, extra = {}) => ({ id: `s-${kind}-${layout}`, kind, layout, panels: {}, textBoxes: [], notes: "", ...extra });
  const compareCell = { tileId: "t-A01", settings: { face: "front", callout: "overview" }, frame: defaultFrame() };
  const others = restoreReportDoc({
    v: 1,
    format: "wide",
    pages: [
      simple("cover", "map-summary"), simple("sources", "map-summary"), simple("blank", "map-full"),
      simple("compare", "side-by-side", { grid: "2x2", sameExtent: false, cells: [compareCell, compareCell] }),
      simple("compare", "map-summary", { id: "s-compare-2", grid: "2x2", sameExtent: false, cells: [compareCell, compareCell] }),
    ],
  }, new Set(["t-A01"]));
  assert.equal(others.pages.length, 5, "다섯 장 모두 복원된다(전제)");
  assert.deepEqual(others.pages.map((page) => page.layout), ["map-key", "map-key", "map-key", "map-key", "map-key"], "타일이 아닌 장의 옛 값도 map-key로");
}

// ── Ruling 37: 단면이 있는 D17은 선택지가 「지도 + 그래프」 하나, 저장 map-key·numbers-first도 map-charts로 읽는다. 단면이 없으면 둘.
{
  const terrain = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasCharts: true, terrain: true });
  assert.deepEqual(terrain.choices.map((choice) => choice.value), ["map-charts"], "단면 있는 D17 선택지는 map-charts 하나");
  const plain = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasCharts: true });
  assert.deepEqual(plain.choices.map((choice) => choice.value), ["map-key", "map-charts"], "단면 없는 D17은 둘");
  for (const stored of ["map-key", "map-charts", "numbers-first", "map-summary"]) assert.equal(resolveReportLayout(stored, { hasMap: true, figure: false, hasCharts: true, terrain: true }), "map-charts", `저장 ${stored} → map-charts`);
  assert.equal(resolveReportLayout("map-key", { hasMap: true, figure: false, hasCharts: true }), "map-key", "단면이 없으면 저장 map-key는 그대로");
}

console.log("v2 report layout contract tests passed");
