/** 「지도 + 그래프」 장: 계획(기본 레이아웃)·화면 미리보기(SSR)·그린 지도 기준 그래프 자료. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { EMPTY_REPORT_DOC, defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { importLegacyReport, pagesForTile, planReportDoc, recommendedPages } = await import("../../lib/v2/report/report-doc-plan.ts");
const { tileReportSettingsFromBoard } = await import("../../lib/v2/report/report-plan.ts");
const { terrainSectionLayout, slideLayout } = await import("../../lib/v2/ui/overlay-layout.ts");
const { analysisCharts, analysisStatLine } = await import("../../lib/v2/report/analysis-charts.ts");
const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");

// ── 픽스처: 건물 12동(층수 3구간). D05 결과는 같은 건물을 floors_*·tall_*·low_* 세 벌로 싣는다.
const CENTER = [127.15, 37.62];
const M_LNG = 88300;
const M_LAT = 111200;
const square = (east, north, half = 5) => [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => [CENTER[0] + (east + x * half) / M_LNG, CENTER[1] + (north + y * half) / M_LAT])];
const BUILDINGS = [
  ["floors_1_4", "tall_lt35", "low_le12", 2], ["floors_1_4", "tall_lt35", "low_le12", 3], ["floors_1_4", "tall_lt35", "low_le12", 4],
  ["floors_1_4", "tall_lt35", "low_le12", 3], ["floors_1_4", "tall_lt35", "low_le12", 2], ["floors_1_4", "tall_lt35", "low_le12", 4],
  ["floors_5_8", "tall_lt35", "low_gt12", 6], ["floors_5_8", "tall_lt35", "low_gt12", 7], ["floors_5_8", "tall_lt35", "low_gt12", 8], ["floors_5_8", "tall_lt35", "low_gt12", 5],
  ["floors_9_14", "tall_ge35", "low_gt12", 12], ["floors_9_14", "tall_ge35", "low_gt12", 14],
];
const polygons = BUILDINGS.flatMap(([floors, tall, low, value], i) => {
  const east = -400 + i * 70;
  const north = (i % 3) * 120 - 100;
  return [{ layer: floors, rings: square(east, north), value }, { layer: tall, rings: square(east, north), value }, { layer: low, rings: square(east, north), value }];
});
const d05Result = {
  tileId: "x-D05", analysisId: "x", tileType: "diagram", tileCode: "D05", status: "complete", engineVersion: "test",
  conditions: { address: "a", center: CENTER, radiusM: 1000, analysisDate: "2026-10-27", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [], judgment: null,
  presentation: { legend: [], camera: null, layers: [], outputFace: "front", features: [], polygons, valueAxis: { label: "지상 층수", unit: "층", countUnit: "동" } },
  provenance: { manifestHash: "a".repeat(64), sources: [] }, limitations: [],
};

// 앱(page.tsx)과 같이: 보드의 레이어 고르기를 view에 반영한 뒤 보고서에 넘긴다.
const rawView = toTileView(d05Result);
assert.equal(rawView.map.polygons.length, 36, "고르기 전 D05 지도는 같은 건물을 세 벌 싣는다");
assert.equal(analysisCharts(rawView.map).total, 36, "걸러지지 않은 모델은 건물을 3배로 센다(이 테스트가 막는 오류)");
const filtered = viewWithLayer(rawView, rawView.defaultLayer);
assert.equal(filtered.map.polygons.length, 12, "기본 레이어를 고르면 건물 12동만 남는다");
const view = {
  ...filtered,
  caveats: ["표본 한계 문구 가나다"],
  notes: ["보조 메모 라마바", "표본 한계 문구 가나다"],
  badges: [{ text: "일부 자료만 집계", tone: "limit" }],
  headline: { value: "4층", label: "층수 중앙값" },
  sentence: "낮은 층 건물이 대부분이고 높은 건물은 일부다",
};

const board = initBoard([d05Result]);
const summary = toSummaryView(GODEOK_SUMMARY, [d05Result]);
const views = new Map([[d05Result.tileId, view]]);
const ctx = { summary, analysisDate: "2026-10-27", views };

// ── 계획: 새 추천 구성의 D05 쪽은 map-charts, 저장된 쪽은 그대로
const pages = recommendedPages(EMPTY_REPORT_DOC, views, board, ctx);
const tilePage = pages.find((page) => page.kind === "tile");
assert.ok(tilePage, "추천 구성에 D05 쪽");
assert.equal(tilePage.layout, "map-charts", "새 추천 구성의 D05 쪽은 map-charts");
const savedDoc = { ...EMPTY_REPORT_DOC, pages: [{ ...tilePage, id: "saved", layout: "map-summary" }] };
assert.equal(planReportDoc(savedDoc, views, ctx).find((slide) => slide.kind === "tile").page.layout, "map-summary", "저장된 map-summary 쪽은 그대로");
const noFeatureView = { ...view, map: { ...view.map, features: [], polygons: [], total: 0 } };
const noChartPages = recommendedPages(EMPTY_REPORT_DOC, new Map([[d05Result.tileId, noFeatureView]]), board, { ...ctx, views: new Map([[d05Result.tileId, noFeatureView]]) });
assert.equal(noChartPages.find((page) => page.kind === "tile").layout, "map-summary", "그래프 자료가 없으면 map-summary");

// ── 세는 대상을 밝히지 않은 타일(A12)은 같은 지도 자료가 있어도 「지도 + 요약」에 머물고, 레이아웃 창도 「지도 + 그래프」를 내놓지 않는다
{
  const { reportLayoutDecision } = await import("../../lib/v2/report/report-layout.ts");
  const undeclaredResult = { ...d05Result, tileId: "x-A12", tileCode: "A12" };
  const undeclaredFiltered = viewWithLayer(toTileView(undeclaredResult), undefined);
  assert.equal(undeclaredFiltered.map.tileCode, "A12");
  assert.ok(undeclaredFiltered.map.polygons.length > 0, "전제: 지도 자료는 있다");
  const undeclaredViews = new Map([[undeclaredResult.tileId, { ...undeclaredFiltered, headline: view.headline, sentence: view.sentence }]]);
  const undeclaredCtx = { ...ctx, views: undeclaredViews };
  const undeclaredPage = recommendedPages(EMPTY_REPORT_DOC, undeclaredViews, initBoard([undeclaredResult]), undeclaredCtx).find((page) => page.kind === "tile");
  assert.ok(undeclaredPage, "추천 구성에 A12 쪽");
  assert.equal(undeclaredPage.layout, "map-summary", "밝히지 않은 타일의 새 쪽은 map-summary");
  const undeclaredSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [undeclaredPage] }, undeclaredViews, undeclaredCtx).find((slide) => slide.kind === "tile");
  assert.equal(analysisCharts(undeclaredSlide.map), null, "그래프 자료 없음");
  const menu = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: true, hasCharts: analysisCharts(undeclaredSlide.map) !== null });
  assert.ok(!menu.choices.some((choice) => choice.value === "map-charts"), "레이아웃 창에 「지도 + 그래프」가 없다");
  const declaredSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...tilePage, layout: "map-summary" }] }, views, ctx).find((slide) => slide.kind === "tile");
  assert.ok(reportLayoutDecision({ pageKind: "tile", hasMap: true, hasSummary: true, hasCharts: analysisCharts(declaredSlide.map) !== null }).choices.some((choice) => choice.value === "map-charts"), "밝힌 타일(D05)은 같은 자료에서 메뉴에 나온다");
}

const planOf = (page, v = views) => planReportDoc({ ...EMPTY_REPORT_DOC, pages: [page] }, v, { ...ctx, views: v }).find((slide) => slide.kind === "tile");
const render = (slide, mode = "edit") => renderToStaticMarkup(createElement(SlideSurface, { slide, basemap: "none", mode }));

// ── 화면: 그래프 SVG·주석 칩·배지
const chartsSlide = planOf({ ...tilePage, layout: "map-charts" });
const markup = render(chartsSlide);
assert.match(markup, /<svg[^>]*data-chart="composition"[^>]*>/, "구성비 SVG");
assert.match(markup, /<svg[^>]*data-chart="distance"[^>]*>/, "거리 SVG");
for (const kind of ["composition", "distance"]) {
  const svg = new RegExp(`<svg[^>]*data-chart="${kind}"[^>]*>`).exec(markup)[0];
  assert.match(svg, /role="img"/, `${kind} SVG는 role=img`);
  assert.match(svg, /aria-label="[^"]*[가-힣][^"]*"/, `${kind} SVG는 한국어 aria-label`);
}
const POPOVER = /<div[^>]*role="tooltip"[^>]*>[\s\S]*?<\/ul><\/div><\/div>/;
const popover = POPOVER.exec(markup)?.[0];
assert.ok(popover, "팝오버 요소는 늘 있다");
assert.match(popover, /^<div[^>]*\shidden=""/, "닫혀 있으면 숨김");
assert.doesNotMatch(markup.replace(POPOVER, ""), /표본 한계 문구 가나다|보조 메모 라마바/, "각주 문구는 장 본문에 없다(숨긴 팝오버 안에만 있다)");
assert.match(popover, /표본 한계 문구 가나다[\s\S]*보조 메모 라마바/, "팝오버에 각주 목록");
assert.match(markup, /<button[^>]*aria-expanded="false"[^>]*>주석 2<\/button>/, "중복을 뺀 주석 2개 칩");
const popoverId = /id="([^"]+)"/.exec(popover)[1];
assert.match(markup, new RegExp(`<button[^>]*aria-controls="${popoverId}"[^>]*aria-describedby="${popoverId}"`), "칩은 첫 포커스부터 유효한 팝오버를 가리킨다");
// 제목(J1): 데이터와 기하에서 온 같은 글이 두 그래프 맨 위에 있다
assert.ok(markup.includes(">지상 층수 구성비</text>") && markup.includes(">대지에서 거리와 지상 층수</text>"), "그래프 제목");
assert.ok(markup.includes(view.badges[0].text), "배지 문구는 있다");
assert.ok(markup.includes(view.headline.value), "큰 숫자(기존 headline)");
assert.ok(markup.includes(view.headline.label), "큰 숫자 라벨");

// 같은 쪽을 map-summary로 그리면 각주는 있고 그래프·칩은 없다(위 판정이 헛돌지 않는다)
const summaryMarkup = render(planOf({ ...tilePage, layout: "map-summary" }));
assert.match(summaryMarkup, /표본 한계 문구 가나다/, "map-summary는 각주를 장에 그린다");
assert.doesNotMatch(summaryMarkup, /data-chart=|주석 \d/, "map-summary에는 그래프·칩이 없다");

// ── 그린 지도 기준: 통계는 쪽이 실제로 그리는 건물 수(12동)이고 3배(36)가 아니다
const charts = analysisCharts(chartsSlide.map);
assert.equal(charts.total, BUILDINGS.length, "그래프 건물 수 = 장이 그리는 건물 수");
assert.ok(markup.includes(analysisStatLine(charts)), "한 줄 통계");
assert.ok(markup.includes("건물 12동"), "화면 통계는 12동");
assert.ok(!markup.includes("36동"), "3배(36동)가 아니다");
assert.ok(markup.includes(`>${view.sentence}</div>`), "해석 문장은 지금의 view.sentence 그대로");
assert.doesNotMatch(markup, /중앙값은|대지 평균은/, "그래프 숫자로 만든 새 문장은 없다");

// 끈 레이어(frame.hiddenLayers)도 반영한다: 9~14층을 끄면 10동
const hiddenSlide = planOf({ ...tilePage, layout: "map-charts", frame: { ...defaultFrame(), hiddenLayers: ["floors_9_14"] } });
const hiddenMarkup = render(hiddenSlide);
assert.ok(hiddenMarkup.includes("건물 10동"), "끈 레이어는 그래프에서도 빠진다");
assert.ok(!hiddenMarkup.includes("건물 12동"));

// 사용자가 고친 요약은 해석 문장 자리에 그대로
const edited = render(planOf({ ...tilePage, layout: "map-charts", summaryOverride: "사용자가 고친 요약 문장" }));
assert.ok(edited.includes(">사용자가 고친 요약 문장</div>"), "고친 요약을 해석 문장 자리에 쓴다");
assert.ok(!edited.includes(view.sentence), "고친 요약이 있으면 view.sentence는 장에 없다");

// 글자 크기 24 pt에서도 해석 문장은 줄 수를 묶는다(넘치지 않는다)
const bigSlide = planOf({ ...tilePage, layout: "map-charts", fontSizes: { summary: 24 }, summaryOverride: "아주 긴 요약 문장입니다. ".repeat(30) });
const bigMarkup = render(bigSlide);
const clamp = /-webkit-line-clamp:\s*(\d+)/.exec(bigMarkup);
assert.ok(clamp && Number(clamp[1]) >= 1, "해석 문장은 줄 수 상한이 있다");
assert.match(bigMarkup, /data-chart="distance"/, "24 pt에서도 그래프를 그린다");

// 썸네일은 버튼이 없고, 내보내기 화면에는 칩이 없다
assert.equal((render(chartsSlide, "thumb").match(/<button\b/g) ?? []).length, 0, "thumb 표면은 버튼이 없다");
const exportMarkup = render(chartsSlide, "export");
assert.doesNotMatch(exportMarkup, /주석 \d/, "내보내기 화면에는 칩이 없다");
assert.match(exportMarkup, /data-chart="composition"/, "내보내기 화면에도 그래프");

// ── 저장된 map-charts 쪽이 그래프 자료를 잃으면 map-summary 내용(표 줄·각주)으로 그린다
const lostViews = new Map([[d05Result.tileId, { ...noFeatureView, caveats: view.caveats, notes: view.notes }]]);
const lostSlide = planOf({ ...tilePage, layout: "map-charts" }, lostViews);
const lostMarkup = render(lostSlide);
assert.doesNotMatch(lostMarkup, /data-chart=|주석 \d/, "자료가 없으면 그래프·칩이 없다");
assert.match(lostMarkup, /표본 한계 문구 가나다/, "자료가 없으면 각주를 장에 그린다");

// 다른 타일(고덕 A01)에는 영향 없음: 같은 쪽을 map-summary로 그린 결과와 map-charts로 그린 결과가 같다(그래프 자료가 없을 때)
const a01 = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
const a01Views = new Map([[a01.tileId, toTileView(a01)]]);
const a01Board = initBoard([a01]);
const a01Page = recommendedPages(EMPTY_REPORT_DOC, a01Views, a01Board, { summary: toSummaryView(GODEOK_SUMMARY, [a01]), analysisDate: "2026-10-27", views: a01Views }).find((page) => page.kind === "tile");
const a01Plan = (layout) => planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...a01Page, layout }] }, a01Views, { summary: toSummaryView(GODEOK_SUMMARY, [a01]), analysisDate: "2026-10-27", views: a01Views }).find((slide) => slide.kind === "tile");
assert.equal(analysisCharts(a01Plan("map-summary").map), null, "고덕 A01 지도에는 그래프 자료가 없다(이 비교의 전제)");
assert.equal(a01Page.layout, "map-summary", "그래프 자료가 없는 A01 쪽은 map-summary");
assert.equal(render(a01Plan("map-charts")).replaceAll("map-charts", "map-summary"), render(a01Plan("map-summary")), "자료 없는 map-charts는 map-summary와 같은 화면");

// ── 오른쪽 열 칸에 그래프 기하를 놓아도 글자가 칸 안에 있고 서로 겹치지 않는다(16:9·A3·A4 × 글자 배율 1·1.85)
const { compositionShapes, distanceShapes } = await import("../../lib/v2/report/chart-geometry.ts");
const { chartsColumnLayout, slidePanelRects } = await import("../../lib/v2/ui/overlay-layout.ts");
const bandsCharts = analysisCharts({ ...chartsSlide.map, polygons: chartsSlide.map.polygons.map(({ value, ...rest }) => rest) });
assert.equal(bandsCharts.distance.kind, "bands", "값이 없으면 거리대 막대");
const areaOf = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) - 1e-9) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) - 1e-9);
for (const format of ["wide", "a3", "a4"]) {
  for (const scale of [1, 1.85]) {
    const column = chartsColumnLayout(slidePanelRects({}, true, undefined, format).summary, scale);
    for (const data of [charts, bandsCharts]) {
      for (const [name, shapes, box] of [["구성비", compositionShapes(data.composition, column.composition, scale, data.titles.composition), column.composition], ["거리", distanceShapes(data.distance, data.radiusM, column.distance, scale, data.titles.distance), column.distance]]) {
        const texts = shapes.filter((shape) => shape.kind === "text");
        assert.ok(texts.length > 0, `${format} ${scale} ${name}: 글자가 있다`);
        assert.ok(texts.some((t) => t.name.endsWith("-title")), `${format} ${scale} ${name}: 제목이 있다`);
        for (const t of texts) assert.ok(t.x >= box.x - 1e-9 && t.y >= box.y - 1e-9 && t.x + t.w <= box.x + box.w + 1e-9 && t.y + t.h <= box.y + box.h + 1e-9, `${format} ${scale} ${name}: ${t.name}이 칸 안`);
        for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) assert.equal(areaOf(texts[i], texts[j]), 0, `${format} ${scale} ${name} ${data.distance.kind}: ${texts[i].name} ↔ ${texts[j].name} 겹침`);
      }
    }
  }
}

// ── 필터 줄: 옛 요약이 그리던 「적용 필터」 줄을 한 줄 통계 칸의 둘째 줄로 그린다(고덕 A05, 설명선 없는 쪽)
{
  const a05 = GODEOK_RESULTS.find((result) => result.tileCode === "A05");
  const a05View = { ...toTileView(a05, null, null, { distance: { max: 900 } }), callout: null };
  assert.ok(a05View.filterLine, "A05 필터 줄이 있다(이 검사의 전제)");
  const a05Views = new Map([[a05.tileId, a05View]]);
  const a05Ctx = { summary: toSummaryView(GODEOK_SUMMARY, [a05]), analysisDate: "2026-10-27", views: a05Views };
  const a05Pages = recommendedPages(EMPTY_REPORT_DOC, a05Views, initBoard([a05]), a05Ctx);
  const a05Page = a05Pages.find((page) => page.kind === "tile");
  assert.equal(a05Page.layout, "map-charts", "그래프 자료가 있는 A05 쪽은 map-charts");
  for (const fontSizes of [undefined, { summary: 24 }]) {
    const slide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...a05Page, ...(fontSizes ? { fontSizes } : {}) }] }, a05Views, a05Ctx).find((s) => s.kind === "tile");
    const m = render(slide);
    const stat = analysisStatLine(analysisCharts(slide.map));
    const at = m.indexOf(`>${a05View.filterLine}</div>`);
    assert.ok(at > 0, `필터 줄이 장에 있다 (${fontSizes ? "24 pt" : "기본"})`);
    assert.ok(m.indexOf(`>${stat}</div>`) > 0 && m.indexOf(`>${stat}</div>`) < at, "통계 줄 아래에 필터 줄");
    assert.match(m.slice(Math.max(0, at - 400), at), /-webkit-line-clamp:\s*1/, "필터 줄은 한 줄로 묶는다");
  }
  // 필터 줄이 없으면 통계 칸에는 통계만 있다
  assert.ok(!render(planOf({ ...tilePage, layout: "map-charts" })).includes("적용 필터"), "필터가 없으면 필터 줄이 없다");
}

// ── 「지도 + 그래프」는 요약 칸이 있는 장에서만 고른다
{
  const a05 = GODEOK_RESULTS.find((result) => result.tileCode === "A05");
  const raw = toTileView(a05);
  assert.ok(raw.callout, "A05는 설명선 타일");
  // 설명선 상세 장(page > 0)은 요약 칸이 없어 map-charts가 map-summary와 다르게 그려지지 않는다. 개요(page 0)는 요약 칸이 있다.
  const calloutView = { ...raw, backdrop: raw.map };
  const calloutPages = pagesForTile(EMPTY_REPORT_DOC, a05.tileId, calloutView, tileReportSettingsFromBoard(initBoard([a05]), a05.tileId), { summary: toSummaryView(GODEOK_SUMMARY, [a05]), analysisDate: "2026-10-27", views: new Map([[a05.tileId, calloutView]]) });
  assert.deepEqual(calloutPages.map((page) => page.layout), ["map-charts", "map-summary"], "개요는 map-charts, 설명 상세 장은 map-summary");
}

// ── 옛 보고서 가져오기는 쪽 모양을 바꾸지 않는다
{
  const legacy = importLegacyReport(EMPTY_REPORT_DOC, board, views, ctx);
  const legacyTile = legacy.find((page) => page.kind === "tile");
  assert.ok(legacyTile, "가져온 D05 쪽");
  assert.equal(legacyTile.layout, "map-summary", "가져온 쪽은 map-summary(새 추천 구성만 map-charts)");
}

// ── 주석 칩은 아래로 자라 해석 문장을 가리지 않고, 요약 칸을 벗어나지 않는다(슬라이드 폭 850 px 이상 = unit 64 이상)
{
  const summary = slidePanelRects({}, true, undefined, "wide").summary;
  const column = chartsColumnLayout(summary, 1);
  for (const unit of [55, 64, 80, 96, 140]) {
    const chipTop = column.notesChip.y * unit;
    const chipBottom = chipTop + Math.max(24, column.notesChip.h * unit);
    assert.ok(chipTop >= (column.sentence.y + column.sentence.h) * unit - 1e-9, `unit ${unit}: 칩이 해석 문장 아래에서 시작`);
    assert.ok(chipBottom <= (summary.y + summary.h) * unit + 1e-9, `unit ${unit}: 칩(24 px 이상)이 요약 칸 안`);
  }
}

// ── 주석 팝오버 자리: 1024·1440 화면에서 화면과 슬라이드 표면 안에 머문다
{
  const { placeNotesPopover } = await import("../../components/v2/report/analysis-column.tsx");
  const summary = slidePanelRects({}, true, undefined, "wide").summary;
  const column = chartsColumnLayout(summary, 1);
  for (const [W, H] of [[1024, 900], [1440, 900], [1440, 600]]) {
    // 왼쪽 도구 막대 72 px, 위 머리 줄 56 px, 아래 페이지 줄 120 px을 뺀 무대에 16:9를 맞춘다.
    const stageW = W - 72 - 16;
    const stageH = H - 56 - 120;
    const unit = Math.min(stageW / 13.333, stageH / 7.5);
    const surface = { left: 72, top: 56 + 8, right: 72 + 13.333 * unit, bottom: 56 + 8 + 7.5 * unit };
    const chip = { left: surface.left + column.notesChip.x * unit, top: surface.top + column.notesChip.y * unit, right: 0, bottom: 0 };
    chip.right = chip.left + 54;
    chip.bottom = chip.top + 24;
    const bounds = { left: Math.max(0, surface.left), top: Math.max(0, surface.top), right: Math.min(W, surface.right), bottom: Math.min(H, surface.bottom) };
    const p = placeNotesPopover(chip, bounds);
    assert.ok(p.width <= 288 && chip.left + p.width <= bounds.right, `${W}×${H}: 폭이 288 px 이하이고 슬라이드 오른쪽 끝 안`);
    const top = p.up ? chip.top - 6 - p.maxHeight : chip.bottom + 6;
    const bottom = p.up ? chip.top - 6 : chip.bottom + 6 + p.maxHeight;
    assert.ok(top >= bounds.top - 1e-9 && bottom <= bounds.bottom + 1e-9 && top >= 0 && bottom <= H, `${W}×${H}: 최대 높이(${Math.round(p.maxHeight)} px)까지 커져도 화면 안 (${Math.round(top)}–${Math.round(bottom)})`);
  }
  // 위가 좁고 아래가 넓으면 아래로 연다
  const down = placeNotesPopover({ left: 700, right: 754, top: 100, bottom: 124 }, { left: 72, top: 64, right: 1000, bottom: 700 });
  assert.equal(down.up, false, "위 여유가 작으면 아래로");
  assert.equal(down.maxHeight, 700 - 124 - 6 - 8, "아래 여유가 최대 높이");
  const narrow = placeNotesPopover({ left: 800, right: 854, top: 500, bottom: 524 }, { left: 72, top: 64, right: 1000, bottom: 700 });
  assert.equal(narrow.width, 1000 - 800 - 8, "슬라이드 끝까지 남은 폭이 288보다 작으면 그 폭");
}

// ── D17처럼 요약 칸이 위쪽만 남은 경우에도 여섯 칸이 칸 안에서 겹치지 않고 그래프 글자가 칸 안에 있다
{
  const panels = slidePanelRects({}, true, undefined, "wide");
  const squeezed = terrainSectionLayout(panels, slideLayout("wide"), "wide");
  assert.equal(squeezed.mode, "summary", "16:9 D17은 단면을 요약 열 아래에 둔다");
  assert.ok(squeezed.summary.h < panels.summary.h, "요약 칸이 줄었다");
  for (const scale of [1, 1.85]) {
    const column = chartsColumnLayout(squeezed.summary, scale);
    const names = Object.keys(column);
    for (const name of names) {
      const r = column[name];
      assert.ok(r.w > 0 && r.h > 0 && r.x >= squeezed.summary.x - 1e-9 && r.y >= squeezed.summary.y - 1e-9 && r.x + r.w <= squeezed.summary.x + squeezed.summary.w + 1e-9 && r.y + r.h <= squeezed.summary.y + squeezed.summary.h + 1e-9, `D17 ${scale}: ${name}이 줄어든 요약 칸 안`);
    }
    for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) assert.equal(areaOf(column[names[i]], column[names[j]]), 0, `D17 ${scale}: ${names[i]}↔${names[j]} 겹침`);
    for (const data of [charts, bandsCharts]) {
      for (const [shapes, box] of [[compositionShapes(data.composition, column.composition, scale, data.titles.composition), column.composition], [distanceShapes(data.distance, data.radiusM, column.distance, scale, data.titles.distance), column.distance]]) {
        const texts = shapes.filter((shape) => shape.kind === "text");
        for (const t of texts) assert.ok(t.x >= box.x - 1e-9 && t.y >= box.y - 1e-9 && t.x + t.w <= box.x + box.w + 1e-9 && t.y + t.h <= box.y + box.h + 1e-9, `D17 ${scale}: ${t.name}이 칸 안`);
        for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) assert.equal(areaOf(texts[i], texts[j]), 0, `D17 ${scale} ${data.distance.kind}: ${texts[i].name}↔${texts[j].name} 겹침`);
      }
    }
  }
}

console.log("✓ v2 analysis page surface");
