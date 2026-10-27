/** 지도 색 선택의 저장·적용 범위: 보드 왕복, 보고서 전체/이 쪽만, 우선순위, 계획(planReportDoc)에 붙는 색. */
import assert from "node:assert/strict";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer, serializeBoardState, restoreBoardState, restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView, withPalette } = await import("../../lib/v2/ui/tile-view.ts");
const { tileReportSettingsFromBoard } = await import("../../lib/v2/report/report-plan.ts");
const { EMPTY_REPORT_DOC, historyApply, historyUndo, reportDocReducer } = await import("../../lib/v2/report/report-doc.ts");
const { pagesForTile, planReportDoc } = await import("../../lib/v2/report/report-doc-plan.ts");
const { resolveMapColors, withMapColors } = await import("../../lib/v2/ui/map-colors.ts");
const { sheetView } = await import("../../lib/v2/ui/sheet.ts");

const clone = (v) => JSON.parse(JSON.stringify(v));
const BASE = { name: "내 테마 1", colors: { bg: "#101820", building: "#2a3642", parcel: "#34414e", road: "#41505f", green: "#2f4a35", water: "#1d3a52", site: "#ff8a8a" } };
const PAL = { name: "내 테마 2", colors: { cat: ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6"], seq: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"] } };

// 보드: 액션 → 저장본 → 복원이 같은 값이다.
{
  let s = initBoard(GODEOK_RESULTS);
  assert.equal(s.palette, undefined);
  assert.equal(s.baseHide, undefined);
  const plain = serializeBoardState(s);
  assert.ok(!("palette" in plain) && !("baseHide" in plain) && !("baseTheme" in plain), "고르지 않으면 저장본에 키가 없다");
  for (const ref of ["ink", BASE]) {
    const next = boardReducer(s, { type: "baseTheme", ref });
    assert.deepEqual(next.baseTheme, ref);
    assert.deepEqual(restoreBoardState(GODEOK_RESULTS, clone(serializeBoardState(next))).baseTheme, ref);
  }
  for (const ref of ["vivid", PAL]) {
    const next = boardReducer(s, { type: "palette", ref });
    assert.deepEqual(next.palette, ref);
    assert.deepEqual(restoreBoardState(GODEOK_RESULTS, clone(serializeBoardState(next))).palette, ref);
  }
  s = boardReducer(s, { type: "baseHide", layers: ["building", "parcel", "building"] });
  assert.deepEqual(s.baseHide, ["building", "parcel"], "중복은 합친다");
  assert.deepEqual(restoreBoardState(GODEOK_RESULTS, clone(serializeBoardState(s))).baseHide, ["building", "parcel"]);
  assert.equal(boardReducer(s, { type: "baseHide", layers: [] }).baseHide, undefined, "모두 켜면 키가 없어진다");
  assert.equal(boardReducer(s, { type: "palette", ref: "nope" }), s, "모르는 id는 무시");
  assert.equal(boardReducer(s, { type: "baseTheme", ref: { name: "x", colors: { ...BASE.colors, bg: "red" } } }), s, "잘못된 색은 무시");
  // 프리셋 객체를 바꾸지 않고 참조를 복사해 둔다.
  const held = clone(BASE);
  const withHeld = boardReducer(initBoard(GODEOK_RESULTS), { type: "baseTheme", ref: held });
  held.colors.bg = "#ffffff";
  assert.equal(withHeld.baseTheme.colors.bg, "#101820", "입력 객체를 나중에 바꿔도 보드 값은 그대로");
}

// restore: 모르는 id·잘못된 색·cat 7개·모르는 레이어는 그 필드만 빠진다.
{
  const snap = clone(serializeBoardState(initBoard(GODEOK_RESULTS)));
  const bad = { ...snap, baseTheme: "zzz", palette: { name: "x", colors: { cat: PAL.colors.cat.slice(0, 7), seq: PAL.colors.seq } }, baseHide: "building" };
  const restored = restoreBoardState(GODEOK_RESULTS, bad);
  assert.equal(restored.baseTheme, undefined);
  assert.equal(restored.palette, undefined);
  assert.equal(restored.baseHide, undefined);
  const mixed = restoreBoardState(GODEOK_RESULTS, { ...snap, baseTheme: { name: "x", colors: { ...BASE.colors, road: "#12" } }, palette: "earth", baseHide: ["water", "x", 3] });
  assert.equal(mixed.baseTheme, undefined);
  assert.equal(mixed.palette, "earth");
  assert.deepEqual(mixed.baseHide, ["water"]);
}

// reportDocReducer mapColors: 전체 / 이 쪽만 / null / 되돌리기.
const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const board = initBoard(GODEOK_RESULTS);
const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const ctx = { summary, analysisDate: "2026-09-30", views, results: new Map(GODEOK_RESULTS.map((r) => [r.tileId, r])), scene: null, analysisSiteParcel: null, settingsFor: (id) => tileReportSettingsFromBoard(board, id) };
const tilePage = (tileId) => pagesForTile(EMPTY_REPORT_DOC, tileId, views.get(tileId), tileReportSettingsFromBoard(board, tileId), ctx).find((page) => page.kind === "tile");
const p1 = tilePage("t-A01");
const p2 = { ...tilePage("t-A03"), id: "p2" };
const baseDoc = { ...EMPTY_REPORT_DOC, pages: [{ id: "cv", kind: "cover", layout: "map-full", panels: {}, textBoxes: [], notes: "" }, p1, p2] };
{
  const d1 = reportDocReducer(baseDoc, { type: "mapColors", scope: "document", patch: { palette: "earth", hide: ["road"] } });
  assert.deepEqual(d1.mapColors, { palette: "earth", hide: ["road"] });
  assert.equal(d1.pages, baseDoc.pages, "document 범위는 쪽을 건드리지 않는다");
  const d2 = reportDocReducer(d1, { type: "mapColors", scope: "document", patch: { base: "ink" } });
  assert.deepEqual(d2.mapColors, { palette: "earth", hide: ["road"], base: "ink" }, "patch는 필드 단위로 합친다");
  const d3 = reportDocReducer(d2, { type: "mapColors", scope: "page", id: p1.id, patch: { palette: "vivid" } });
  assert.deepEqual(d3.pages.find((p) => p.id === p1.id).mapColors, { palette: "vivid" });
  assert.equal(d3.pages.find((p) => p.id === "p2").mapColors, undefined, "다른 쪽은 그대로");
  assert.deepEqual(d3.mapColors, d2.mapColors);
  const d4 = reportDocReducer(d3, { type: "mapColors", scope: "page", id: p1.id, patch: null });
  assert.equal(d4.pages.find((p) => p.id === p1.id).mapColors, undefined, "page null은 덮어쓰기를 지운다");
  assert.equal(reportDocReducer(d4, { type: "mapColors", scope: "page", id: p1.id, patch: null }), d4, "이미 없으면 같은 객체");
  assert.equal(reportDocReducer(d4, { type: "mapColors", scope: "page", id: "nope", patch: { palette: "vivid" } }), d4);
  assert.equal(reportDocReducer(d4, { type: "mapColors", scope: "document", patch: { palette: "nope" } }), d4, "잘못된 값은 무시");
  const cleared = reportDocReducer(d2, { type: "mapColors", scope: "document", patch: null });
  assert.equal(cleared.mapColors, undefined, "document null은 보고서 선택을 지운다");

  let h = { past: [], present: baseDoc, future: [] };
  h = historyApply(h, { type: "mapColors", scope: "document", patch: { palette: "earth" } });
  h = historyApply(h, { type: "mapColors", scope: "page", id: p1.id, patch: { palette: "vivid" } });
  h = historyUndo(h);
  assert.equal(h.present.pages.find((p) => p.id === p1.id).mapColors, undefined);
  assert.deepEqual(h.present.mapColors, { palette: "earth" });
  h = historyUndo(h);
  assert.equal(h.present.mapColors, undefined, "되돌리기 후 이전 값");

  // 복원 왕복: 문서·쪽 모두, 잘못된 값은 빠진다.
  const full = reportDocReducer(reportDocReducer(baseDoc, { type: "mapColors", scope: "document", patch: { base: BASE, palette: PAL, hide: ["water"] } }), { type: "mapColors", scope: "page", id: p1.id, patch: { palette: "sea" } });
  const ids = new Set(GODEOK_RESULTS.map((r) => r.tileId));
  const back = restoreReportDoc(clone(full), ids);
  assert.deepEqual(back.mapColors, full.mapColors);
  assert.deepEqual(back.pages.find((p) => p.id === p1.id).mapColors, { palette: "sea" });
  const dirty = clone(full);
  dirty.mapColors = { base: "zzz", palette: "earth", hide: ["x"] };
  dirty.pages.find((p) => p.id === p1.id).mapColors = { palette: "nope" };
  const clean = restoreReportDoc(dirty, ids);
  assert.deepEqual(clean.mapColors, { palette: "earth" });
  assert.equal(clean.pages.find((p) => p.id === p1.id).mapColors, undefined);
  assert.ok(!("mapColors" in restoreReportDoc(clone(baseDoc), ids)), "선택이 없으면 키도 없다");
  // 보드 직렬화에서도 유지된다.
  const boardWithDoc = boardReducer(board, { type: "reportDoc", doc: full });
  assert.deepEqual(restoreBoardState(GODEOK_RESULTS, clone(serializeBoardState(boardWithDoc))).reportDoc.mapColors, full.mapColors);
}

// resolveMapColors: 쪽 > 보고서 > 보드 > 기본(warm·app·[]), hide도 같은 순서.
{
  const page = (mapColors) => ({ ...p1, ...(mapColors ? { mapColors } : {}) });
  const doc = (mapColors) => ({ ...EMPTY_REPORT_DOC, ...(mapColors ? { mapColors } : {}) });
  const rows = [
    ["아무것도 없음", {}, doc(), undefined, { base: "warm", palette: "app", hide: [] }],
    ["보드만", { baseTheme: "cool", palette: "soft", baseHide: ["parcel"] }, doc(), undefined, { base: "cool", palette: "soft", hide: ["parcel"] }],
    ["보고서가 보드를 이김", { baseTheme: "cool", palette: "soft", baseHide: ["parcel"] }, doc({ base: "sage", palette: "earth", hide: ["road"] }), undefined, { base: "sage", palette: "earth", hide: ["road"] }],
    ["쪽이 보고서를 이김", { baseTheme: "cool", palette: "soft" }, doc({ base: "sage", palette: "earth", hide: ["road"] }), page({ base: "ink", palette: "vivid", hide: [] }), { base: "ink", palette: "vivid", hide: [] }],
    ["쪽은 일부만 덮는다", { baseTheme: "cool", palette: "soft" }, doc({ palette: "earth" }), page({ hide: ["water"] }), { base: "cool", palette: "earth", hide: ["water"] }],
  ];
  for (const [label, b, d, p, want] of rows) assert.deepEqual(resolveMapColors(b, d, p), want, label);
}

// withMapColors: 새 객체로 base·palette·hide를 붙인다(입력을 바꾸지 않는다).
{
  const model = views.get("t-A01").map;
  const out = withMapColors(model, { base: "ink", palette: "vivid", hide: ["road"] });
  assert.notEqual(out, model);
  assert.equal(out.baseTheme, "ink");
  assert.equal(out.palette, "vivid");
  assert.deepEqual(out.baseHide, ["road"]);
  assert.equal(model.palette, undefined, "원본은 그대로");
  assert.equal(withMapColors(model, {}), model, "고른 것이 없으면 같은 객체");
}

// planReportDoc: 쪽별 덮어쓰기가 그 쪽 모델에만 붙는다.
{
  const mapOf = (plan, id) => plan.find((slide) => slide.page?.id === id).map;
  const off = planReportDoc(baseDoc, views, ctx);
  assert.equal(mapOf(off, p1.id).palette, undefined, "아무것도 안 골랐으면 모델은 그대로");
  assert.equal(mapOf(off, p1.id).baseHide, undefined);
  assert.equal(off.find((s) => s.kind === "cover").map.palette, undefined);

  let doc = reportDocReducer(baseDoc, { type: "mapColors", scope: "document", patch: { palette: "earth", hide: ["road"] } });
  doc = reportDocReducer(doc, { type: "mapColors", scope: "page", id: p1.id, patch: { palette: "vivid" } });
  const plan = planReportDoc(doc, views, ctx);
  assert.equal(mapOf(plan, p1.id).palette, "vivid");
  assert.equal(mapOf(plan, "p2").palette, "earth");
  assert.deepEqual(mapOf(plan, p1.id).baseHide, ["road"], "hide는 보고서 값을 이어받는다");
  assert.deepEqual(mapOf(plan, "p2").baseHide, ["road"]);
  assert.equal(plan.find((s) => s.kind === "cover").map.palette, "earth", "표지 지도는 보고서 값을 따른다");
  assert.equal(plan.find((s) => s.page?.id === p1.id).view.map.palette, "vivid", "슬라이드 view의 모델도 같은 값");

  const pageHide = reportDocReducer(doc, { type: "mapColors", scope: "page", id: "p2", patch: { hide: [] } });
  assert.equal(mapOf(planReportDoc(pageHide, views, ctx), "p2").baseHide, undefined, "쪽이 모두 켜면 보고서의 끔을 덮는다");

  // 조판 쪽: 모든 칸 모델이 같은 값을 받는다.
  const sheetParent = sheetView("t-SHEET", [views.get("t-A01"), views.get("t-A03")], "2x2");
  const comparePage = pagesForTile(EMPTY_REPORT_DOC, "t-SHEET", sheetParent, tileReportSettingsFromBoard(board, "t-A01"), ctx)[0];
  assert.equal(comparePage.kind, "compare");
  const sheetDoc = reportDocReducer({ ...EMPTY_REPORT_DOC, pages: [comparePage] }, { type: "mapColors", scope: "page", id: comparePage.id, patch: { palette: "pastel", base: "paper" } });
  const sheetPlan = planReportDoc(sheetDoc, views, ctx);
  const cells = sheetPlan[0].cells.filter(Boolean);
  assert.ok(cells.length >= 2);
  for (const cell of cells) {
    assert.equal(cell.view.map.palette, "pastel");
    assert.equal(cell.view.map.baseTheme, "paper");
  }

  // 설명선: A05 쪽의 설명선 모델도 팔레트를 따르고 범례 견본 색이 바뀐다.
  const a05 = views.get("t-A05");
  const a05Page = pagesForTile(EMPTY_REPORT_DOC, "t-A05", a05, { ...tileReportSettingsFromBoard(board, "t-A05"), callout: "top10" }, ctx)[0];
  const a05Doc = reportDocReducer({ ...EMPTY_REPORT_DOC, pages: [a05Page] }, { type: "mapColors", scope: "document", patch: { palette: "vivid" } });
  const a05Slide = planReportDoc(a05Doc, views, ctx)[0];
  assert.equal(a05Slide.callout.model.palette, "vivid");
  assert.equal(a05Slide.map.palette, "vivid");
  const plainSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [a05Page] }, views, ctx)[0];
  assert.equal(plainSlide.callout.model.palette, undefined);
  assert.equal(plainSlide.callout.model, a05.callout, "고르지 않으면 설명선 모델은 그대로");
}

// 보드 색이 붙은 view: 필터를 건 A05 쪽·표지 지도도 보드 값을 유지한다(쪽 > 보고서 > 보드).
{
  const boardColors = { palette: "vivid", hide: ["building"] };
  const boardViews = new Map([...views].map(([id, v]) => [id, withPalette(v, boardColors)]));
  const boardSummary = { ...summary, map: withMapColors(summary.map, { hide: boardColors.hide }) };
  const boardCtx = { ...ctx, summary: boardSummary, views: boardViews };
  const a05 = boardViews.get("t-A05");
  const page = pagesForTile(EMPTY_REPORT_DOC, "t-A05", a05, { ...tileReportSettingsFromBoard(board, "t-A05"), callout: "top10" }, boardCtx)[0];
  const doc0 = { ...EMPTY_REPORT_DOC, pages: [{ id: "cv", kind: "cover", layout: "map-full", panels: {}, textBoxes: [], notes: "" }, page] };
  for (const filter of [undefined, null]) {
    const doc = filter === undefined ? doc0 : reportDocReducer(doc0, { type: "calloutFilter", id: page.id, filter: null });
    if (filter === null) assert.ok(Object.prototype.hasOwnProperty.call(doc.pages[1].part, "filter"), "calloutFilter는 filter 키를 만든다");
    const plan = planReportDoc(doc, boardViews, boardCtx);
    const slide = plan.find((s) => s.page?.id === page.id);
    const label = filter === null ? "필터 쪽" : "필터 없는 쪽";
    assert.equal(slide.callout.model.palette, "vivid", `${label} 설명선 팔레트`);
    assert.deepEqual(slide.callout.model.baseHide, ["building"], `${label} 설명선 끈 레이어`);
    assert.equal(slide.map.palette, "vivid", `${label} 지도 팔레트`);
    assert.deepEqual(slide.map.baseHide, ["building"], `${label} 지도 끈 레이어`);
    assert.deepEqual(plan.find((s) => s.kind === "cover").map.baseHide, ["building"], "표지 지도는 보드의 끈 레이어를 따른다");
  }
  // 쪽이 모두 켜면 보드의 끔을 덮는다(설명선 포함).
  const docOn = reportDocReducer(reportDocReducer(doc0, { type: "calloutFilter", id: page.id, filter: null }), { type: "mapColors", scope: "page", id: page.id, patch: { hide: [] } });
  const slideOn = planReportDoc(docOn, boardViews, boardCtx).find((s) => s.page?.id === page.id);
  assert.deepEqual(slideOn.callout.model.baseHide, []);
  assert.deepEqual(slideOn.map.baseHide, []);
}

// withPalette(view): 보드 view의 모든 모델과 설명선에 붙는다.
{
  const a05 = views.get("t-A05");
  const out = withPalette(a05, { palette: "vivid", hide: ["parcel"] });
  assert.equal(out.map.palette, "vivid");
  assert.equal(out.backdrop.palette, "vivid");
  assert.deepEqual(out.map.baseHide, ["parcel"]);
  assert.equal(out.callout.palette, "vivid");
  assert.deepEqual(out.callout.baseHide, ["parcel"], "설명선 모델에도 끈 레이어");
  assert.equal(withPalette(a05, { palette: "vivid" }).callout.baseHide, undefined, "hide를 안 고르면 키가 없다");
  assert.notDeepEqual(out.callout.legend, a05.callout.legend, "범례 견본 색도 함께 바뀐다");
  assert.equal(withPalette(a05, {}), a05, "고른 것이 없으면 같은 view");
  assert.equal(a05.map.palette, undefined, "원본은 그대로");
}

console.log("v2 map colors state tests passed");
