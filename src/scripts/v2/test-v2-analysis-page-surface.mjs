/** 「지도 + 그래프」 장: 계획(기본 레이아웃)·화면 미리보기(SSR)·그린 지도 기준 그래프 자료. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { EMPTY_REPORT_DOC, defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { planReportDoc, recommendedPages } = await import("../../lib/v2/report/report-doc-plan.ts");
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
assert.doesNotMatch(markup, /표본 한계 문구 가나다|보조 메모 라마바/, "각주 문구는 장 본문에 없다");
assert.match(markup, /<button[^>]*aria-expanded="false"[^>]*>주석 2<\/button>/, "중복을 뺀 주석 2개 칩");
assert.doesNotMatch(markup, /aria-controls|aria-describedby/, "팝오버가 닫혀 있으면 가리킬 대상이 없다");
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
if (!analysisCharts(a01Plan("map-summary").map)) {
  assert.equal(a01Page.layout, "map-summary", "그래프 자료가 없는 A01 쪽은 map-summary");
  assert.equal(render(a01Plan("map-charts")).replaceAll("map-charts", "map-summary"), render(a01Plan("map-summary")), "자료 없는 map-charts는 map-summary와 같은 화면");
}

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
      for (const [name, shapes, box] of [["구성비", compositionShapes(data.composition, column.composition, scale), column.composition], ["거리", distanceShapes(data.distance, data.radiusM, column.distance, scale), column.distance]]) {
        const texts = shapes.filter((shape) => shape.kind === "text");
        assert.ok(texts.length > 0, `${format} ${scale} ${name}: 글자가 있다`);
        for (const t of texts) assert.ok(t.x >= box.x - 1e-9 && t.y >= box.y - 1e-9 && t.x + t.w <= box.x + box.w + 1e-9 && t.y + t.h <= box.y + box.h + 1e-9, `${format} ${scale} ${name}: ${t.name}이 칸 안`);
        for (let i = 0; i < texts.length; i += 1) for (let j = i + 1; j < texts.length; j += 1) assert.equal(areaOf(texts[i], texts[j]), 0, `${format} ${scale} ${name} ${data.distance.kind}: ${texts[i].name} ↔ ${texts[j].name} 겹침`);
      }
    }
  }
}

console.log("✓ v2 analysis page surface");
