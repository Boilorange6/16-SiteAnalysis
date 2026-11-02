/** 「지도 + 그래프」 장: 계획(기본 레이아웃)·화면 미리보기(SSR)·그린 지도 기준 그래프 자료. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  return [{ layer: floors, rings: square(east, north), value, counted: true }, { layer: tall, rings: square(east, north), value, counted: true }, { layer: low, rings: square(east, north), value, counted: true }];
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
  keyFigure: {
    question: "가장 많은 층수대",
    answer: { value: "1~4층", post: " 건물", kind: "number" },
    sub: "층수가 확인된 12동 기준",
    stats: [{ value: "100%", label: "층수 확인률" }, { value: "0%", label: "1층 가정 비율" }, { value: "12동", label: "반경 건물" }],
  },
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
assert.equal(planReportDoc(savedDoc, views, ctx).find((slide) => slide.kind === "tile").page.layout, "map-key", "저장된 map-summary 쪽은 map-key로 그린다");
const noFeatureView = { ...view, map: { ...view.map, features: [], polygons: [], total: 0 } };
const noChartPages = recommendedPages(EMPTY_REPORT_DOC, new Map([[d05Result.tileId, noFeatureView]]), board, { ...ctx, views: new Map([[d05Result.tileId, noFeatureView]]) });
assert.equal(noChartPages.find((page) => page.kind === "tile").layout, "map-key", "그래프 자료가 없으면 map-key");

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
  assert.equal(undeclaredPage.layout, "map-key", "밝히지 않은 타일의 새 쪽은 map-key");
  const undeclaredSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [undeclaredPage] }, undeclaredViews, undeclaredCtx).find((slide) => slide.kind === "tile");
  assert.equal(analysisCharts(undeclaredSlide.map), null, "그래프 자료 없음");
  const menu = reportLayoutDecision({ pageKind: "tile", hasMap: true, hasCharts: analysisCharts(undeclaredSlide.map) !== null });
  assert.ok(!menu.choices.some((choice) => choice.value === "map-charts"), "레이아웃 창에 「지도 + 그래프」가 없다");
  const declaredSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...tilePage, layout: "map-summary" }] }, views, ctx).find((slide) => slide.kind === "tile");
  assert.ok(reportLayoutDecision({ pageKind: "tile", hasMap: true, hasCharts: analysisCharts(declaredSlide.map) !== null }).choices.some((choice) => choice.value === "map-charts"), "밝힌 타일(D05)은 같은 자료에서 메뉴에 나온다");
}

const planOf = (page, v = views) => planReportDoc({ ...EMPTY_REPORT_DOC, pages: [page] }, v, { ...ctx, views: v }).find((slide) => slide.kind === "tile");
const render = (slide, mode = "edit", selection) => renderToStaticMarkup(createElement(SlideSurface, { slide, basemap: "none", mode, ...(selection ? { selection } : {}) }));
const { reportPageFrame, reportMapAvoid } = await import("../../lib/v2/report/report-page-frame.ts");
// SSR은 표면 폭을 못 재서 1 inch = 1 px로 그린다. 그래서 style의 px 값이 곧 inch다.
const partTag = (m, name) => new RegExp(`<[a-z0-9]+\\s[^>]*data-part="${name}"[^>]*>`).exec(m)?.[0];
const px = (tag, prop) => Number(new RegExp(`[; "]${prop}:(-?[\\d.]+(?:e-?\\d+)?)(?:px)?[;"]`).exec(tag)?.[1] ?? NaN);
const partRect = (m, name) => { const tag = partTag(m, name); assert.ok(tag, `${name} 요소가 있다`); return { x: px(tag, "left"), y: px(tag, "top"), w: px(tag, "width"), h: px(tag, "height") }; };
const near = (a, b, msg, eps = 0.011) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≈ ${b}`);
const frameOf = (slide) => reportPageFrame(slide, analysisCharts(slide.map));

// ── Task 6: 새 장 배치(① 지도 + 숫자 · ② 지도 + 그래프)의 화면 기하는 reportPageGeometry와 같다
{
  const one = planOf({ ...tilePage, layout: "map-key" });
  const m1 = render(one);
  const f1 = frameOf(one);
  const card1 = partRect(m1, "key-figure");
  near(card1.x, 0.25, "① 카드 x");
  near(card1.y, 0.875, "① 카드 y");
  near(card1.w, 3.125, "① 카드 폭");
  near(card1.h, f1.fit.height, "① 카드 높이는 keyFigureFit이 정한다");
  near(partRect(m1, "map").w, 13.333, "① 지도 틀은 장 전체 폭", 0.001);
  near(partRect(m1, "map").h, 7.21, "① 지도 틀은 각주 띠 위에서 끝난다", 0.001);
  assert.equal((m1.match(/data-chart=/g) ?? []).length, 0, "① 쪽에는 그래프 카드가 없다");

  const two = planOf({ ...tilePage, layout: "map-charts" });
  const m2 = render(two);
  const f2 = frameOf(two);
  near(partRect(m2, "map").w, 13.333 * 0.68, "② 지도 틀 폭 = 장 폭 × (1 − 0.32)", 0.001);
  const column = partRect(m2, "analysis-column");
  const card2 = partRect(m2, "key-figure");
  near(column.x, partRect(m2, "map").w + 0.21, "② 열은 지도 틀 + 0.21 in에서 시작");
  near(column.x + column.w, 13.333 - 0.25, "② 열은 오른쪽 0.25 in까지");
  near(column.x + card2.x, f2.geometry.column.key.x, "② 카드는 열의 왼쪽 위(열 상자 기준 좌표)");
  near(card2.w, f2.geometry.column.key.w, "② 카드 폭 = 열 폭");
  assert.equal((m2.match(/<svg[^>]*data-chart="[a-z]+"[^>]*role="img"|<svg[^>]*role="img"[^>]*data-chart="[a-z]+"/g) ?? []).length, 2, "② 쪽의 그래프 카드는 둘(role=img SVG)");
  assert.equal((m2.match(/data-part="chart-card"/g) ?? []).length, 2, "그래프 카드 상자 둘");

  // 각주 띠: `출처 `로 시작하고 첫 한계 문구를 포함한다. 쪽 번호가 오른쪽에 있다.
  const foot = /<span class="slideFooterText"[^>]*>([^<]*)<\/span>/.exec(m1)?.[1];
  assert.ok(foot?.startsWith("출처 "), `각주 글이 출처로 시작: ${foot}`);
  assert.ok(foot.includes("표본 한계 문구 가나다"), "각주 글에 첫 한계 문구");
  near(partRect(m1, "footer").y, 7.21, "각주 띠 y", 0.001);
  near(partRect(m1, "footer").h, 0.29, "각주 띠 높이", 0.001);

  // 숫자 카드를 지우면 ②도 ①처럼 지도가 전체 폭이다
  const gone = planOf({ ...tilePage, layout: "map-charts", deletedElementKeys: ["summary"] });
  const mg = render(gone);
  near(partRect(mg, "map").w, 13.333, "카드를 지운 ②는 지도 전체 폭", 0.001);
  assert.ok(!partTag(mg, "key-figure") && !/data-chart=/.test(mg), "카드를 지우면 열도 없다");
  assert.equal(gone.page.layout, "map-charts", "판정값은 map-charts로 남는다");

  // 선택 막대·핸들: 범례는 크기 핸들 없이 옮기기만, ① 카드는 8개, ② 열은 지우기만(옮기기·크기 없음)
  const handles = (m) => (m.match(/data-panel-handle=/g) ?? []).length;
  assert.equal(handles(render(one, "edit", { kind: "panel", key: "legend" })), 0, "범례 선택: 크기 핸들 0개");
  assert.equal(handles(render(one, "edit", { kind: "panel", key: "summary" })), 8, "① 숫자 카드 선택: 핸들 8개");
  const colSel = render(two, "edit", { kind: "panel", key: "summary" });
  assert.equal(handles(colSel), 0, "② 열 선택: 핸들 0개");
  const bar = /<div[^>]*data-element-action-bar="true"[^>]*>[\s\S]*?<\/div>/.exec(colSel)?.[0] ?? "";
  assert.equal((bar.match(/<button/g) ?? []).length, 1, "② 열 선택 막대에는 버튼이 하나");
  assert.match(bar, /지우기/, "② 열 선택 막대에는 지우기");
  assert.doesNotMatch(bar, /위치 초기화/, "② 열은 옮길 수 없어 위치 초기화가 없다");
  const footSel = render(one, "edit", { kind: "element", key: "source" });
  assert.equal(handles(footSel), 0, "각주 띠 선택: 핸들 0개");
  assert.match(/<div[^>]*data-element-action-bar="true"[^>]*>[\s\S]*?<\/div>/.exec(footSel)?.[0] ?? "", /지우기/, "각주 띠는 지우기만");

  // 썸네일·내보내기에는 선택 표시와 주석 칩이 없다
  assert.doesNotMatch(render(one, "export"), /주석 \d|data-panel-selected="true"/, "내보내기 화면에는 칩·선택 표시가 없다");
  assert.match(m1, /<button[^>]*>주석 2<\/button>/, "편집 화면의 ① 카드 아래에는 주석 칩");
  const chipRect = partRect(m1, "notes-chip");
  assert.ok(chipRect.y >= card1.y + card1.h - 1e-6, "① 주석 칩은 카드 아래");
}

// ── 구성 막대(A12 모양, Ruling 6): 큰 % + 두 줄 설명, 막대 조각마다 한 칸(대지 칸 표시), 항목 목록
{
  const parts = [{ label: "제3종일반주거지역", share: 50, color: "#F2C94C", site: true }, { label: "제2종일반주거지역", share: 24.9, color: "#F2C94C" }, { label: "제1종일반주거지역", share: 18.5, color: "#F2C94C" }, { label: "일반상업지역", share: 5, color: "#E05A47" }, { label: "그 밖", share: 1.6, color: "#B9BDC6" }];
  const zoneView = { ...view, keyFigure: { question: "대지 용도지역", answer: { value: "제3종일반주거지역", kind: "name" }, stats: [{ value: "50.0%", label: "반경 1km 중 같은 용도지역" }, { value: "95.0%", label: "반경 1km 중 주거지역" }], parts } };
  const zoneViews = new Map([[d05Result.tileId, zoneView]]);
  const m = render(planOf({ ...tilePage, layout: "map-key" }, zoneViews));
  assert.match(m, /data-part="key-lead"[^>]*>50\.0%</, "큰 %");
  assert.ok(m.includes("반경 1km 중 같은 용도지역") && m.includes("주거지역 전체"), "두 줄 설명");
  assert.equal((m.match(/data-part="key-parts-segment"/g) ?? []).length, parts.length, "막대 조각 수 = 항목 수");
  assert.equal((m.match(/data-site="true"/g) ?? []).length, 1, "대지 칸은 하나");
  assert.equal((m.match(/data-part="key-part-label"/g) ?? []).length, parts.length, "항목 목록");
  assert.ok(m.includes(">제3종일반주거<") && m.includes(">24.9%<"), "항목 이름(지역 줄임)과 몫");
}

// ── 설명선(장면 라벨) 카드·지시선이 ① 숫자 카드를 가리지 않는다: 카드는 지도 avoid에 들어간다(실제 지도 크기 1280 px)
{
  const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
  const A01 = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
  const model0 = toTileView(A01).map;
  const [lng0, lat0] = model0.center;
  const rect = (e0, n0, e1, n1) => [[[e0, n0], [e1, n0], [e1, n1], [e0, n1], [e0, n0]].map(([e, n]) => [lng0 + e / 88300, lat0 + n / 111200])];
  const zones = ["제3종일반주거지역", "제2종일반주거지역", "일반상업지역", "준주거지역", "제1종일반주거지역"];
  const model = { ...model0, features: [], lines: [], polygons: zones.map((name, i) => ({ layer: "zoning", rings: rect(-700 + i * 260, -500 + (i % 2) * 500, -480 + i * 260, -100 + (i % 2) * 500), name, label: name, fid: `z${i}`, counted: true })) };
  const slide = planOf({ ...tilePage, layout: "map-key" });
  const frame = frameOf(slide);
  const unit = 96;
  const card = frame.geometry.keyCard;
  const chip = frame.geometry.keyNotesChip;
  assert.ok(chip, "전제: 주석이 있어 카드 아래 칩이 있다");
  // 카드와 그 아래 주석 칩을 한 덩어리로 본다(칩은 카드 오른쪽 끝에 맞춰 아래에 붙는다).
  const cardBox = { x0: card.x * unit, y0: card.y * unit, x1: (card.x + card.w) * unit, y1: (chip.y + chip.h) * unit };
  const W = Math.round(frame.geometry.map.w * unit);
  const H = Math.round(frame.geometry.map.h * unit);
  const scene = (avoid) => buildMapScene({ model, width: W, height: H, activeLayer: "white", scale: true, north: 30, avoid, calloutTop: 24, calloutLeftBottom: H - 24, pinnedKeys: buildMapScene({ model, width: W, height: H, activeLayer: "white", scale: true, north: 30, avoid: [] }).labels.map((l) => l.key) });
  const segHit = (a, b, r) => {
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]]) {
      if (p === 0) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return true;
  };
  const overlapsCard = (s) => s.labelPlacements.filter((p) => (p.box.x0 < cardBox.x1 && cardBox.x0 < p.box.x1 && p.box.y0 < cardBox.y1 && cardBox.y0 < p.box.y1) || segHit(p.entry.p, p.placed.knee, cardBox) || segHit(p.placed.knee, p.placed.edge, cardBox));
  assert.ok(scene([]).labelPlacements.length >= 3 && overlapsCard(scene([])).length > 0, "전제: 카드를 모르면 설명선이 카드를 지난다(이 검사가 헛돌지 않는다)");
  const placed = scene(reportMapAvoid(frame.geometry, unit));
  assert.ok(placed.labelPlacements.length >= 3, "설명선이 그려진다");
  assert.equal(overlapsCard(placed).length, 0, "설명선 카드·지시선이 숫자 카드와 겹치지 않는다");
  const slideSurfaceSource = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
  assert.match(slideSurfaceSource, /reportMapAvoid\(/, "MapLayer가 같은 avoid를 쓴다");
}

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
assert.doesNotMatch(markup.replace(POPOVER, "").replace(/<span class="slideFooterText"[^>]*>[^<]*<\/span>/, ""), /표본 한계 문구 가나다|보조 메모 라마바/, "각주 문구는 각주 띠(첫 한계 한 줄)와 숨긴 팝오버 밖에는 없다");
assert.match(popover, /표본 한계 문구 가나다[\s\S]*보조 메모 라마바/, "팝오버에 각주 목록");
assert.match(markup, /<button[^>]*aria-expanded="false"[^>]*>주석 2<\/button>/, "중복을 뺀 주석 2개 칩");
const popoverId = /id="([^"]+)"/.exec(popover)[1];
assert.match(markup, new RegExp(`<button[^>]*aria-controls="${popoverId}"[^>]*aria-describedby="${popoverId}"`), "칩은 첫 포커스부터 유효한 팝오버를 가리킨다");
// 제목(J1): 데이터와 기하에서 온 같은 글이 두 그래프 맨 위에 있다
assert.ok(markup.includes(">지상 층수 구성비</text>") && markup.includes(">대지에서 거리와 지상 층수</text>"), "그래프 제목");
assert.ok(markup.includes(view.badges[0].text), "배지 문구는 있다");
assert.ok(markup.includes(view.keyFigure.question), "카드 질문 줄");
assert.ok(markup.includes(">1~4층<"), "카드 큰 답");
assert.ok(view.keyFigure.stats.every((stat) => markup.includes(`>${stat.value}<`) && markup.includes(`>${stat.label}<`)), "카드 보조 숫자 셋(값·이름)");
assert.doesNotMatch(markup, /층수 중앙값/, "headline은 카드가 있으면 쓰지 않는다");

// 같은 쪽을 map-summary로 그리면 ①(지도 + 숫자): 각주는 있고 그래프는 없다(위 판정이 헛돌지 않는다)
const summaryMarkup = render(planOf({ ...tilePage, layout: "map-summary" }));
assert.match(summaryMarkup, /표본 한계 문구 가나다/, "map-summary는 각주를 장에 그린다");
assert.doesNotMatch(summaryMarkup, /data-chart=/, "map-summary에는 그래프가 없다");

// ── 그린 지도 기준: 통계는 쪽이 실제로 그리는 건물 수(12동)이고 3배(36)가 아니다
const charts = analysisCharts(chartsSlide.map);
assert.equal(charts.total, BUILDINGS.length, "그래프 건물 수 = 장이 그리는 건물 수");
assert.ok(markup.includes(analysisStatLine(charts)), "한 줄 통계");
assert.ok(markup.includes("건물 12동"), "화면 통계는 12동");
assert.ok(!markup.includes("36동"), "3배(36동)가 아니다");
const sentenceOf = (m) => (/data-part="column-sentence"[^>]*>([^<]*)</.exec(m)?.[1] ?? "").replace(/\s/g, "");
assert.equal(sentenceOf(markup), view.sentence.replace(/\s/g, ""), "해석 문장은 지금의 view.sentence 그대로(줄만 나뉜다)");
assert.doesNotMatch(markup, /중앙값은|대지 평균은/, "그래프 숫자로 만든 새 문장은 없다");

// 끈 레이어(frame.hiddenLayers)도 반영한다: 9~14층을 끄면 10동
const hiddenSlide = planOf({ ...tilePage, layout: "map-charts", frame: { ...defaultFrame(), hiddenLayers: ["floors_9_14"] } });
const hiddenMarkup = render(hiddenSlide);
assert.ok(hiddenMarkup.includes("건물 10동"), "끈 레이어는 그래프에서도 빠진다");
assert.ok(!hiddenMarkup.includes("건물 12동"));

// 사용자가 고친 요약은 해석 문장 자리에 그대로
const edited = render(planOf({ ...tilePage, layout: "map-charts", summaryOverride: "사용자가 고친 요약 문장" }));
assert.equal(sentenceOf(edited), "사용자가고친요약문장", "고친 요약을 해석 문장 자리에 쓴다");
assert.ok(!edited.includes(view.sentence), "고친 요약이 있으면 view.sentence는 장에 없다");

// 글자 크기 24 pt에서도 해석 문장은 줄 수를 묶는다(넘치지 않는다)
const bigSlide = planOf({ ...tilePage, layout: "map-charts", fontSizes: { summary: 24 }, summaryOverride: "아주 긴 요약 문장입니다. ".repeat(30) });
const bigMarkup = render(bigSlide);
const bigSentence = /<div[^>]*data-part="column-sentence"[^>]*>([^<]*)<\/div>/.exec(bigMarkup)?.[1] ?? "";
assert.ok(bigSentence.length > 0 && bigSentence.split("\n").length <= 2, "해석 문장은 두 줄 이하");
assert.match(bigSentence, /…$/, "넘치는 해석 문장은 …로 닫는다");
assert.match(bigMarkup, /data-chart="composition"/, "24 pt에서도 구성비 그래프를 그린다");

// 썸네일은 버튼이 없고, 내보내기 화면에는 칩이 없다
assert.equal((render(chartsSlide, "thumb").match(/<button\b/g) ?? []).length, 0, "thumb 표면은 버튼이 없다");
const exportMarkup = render(chartsSlide, "export");
assert.doesNotMatch(exportMarkup, /주석 \d/, "내보내기 화면에는 칩이 없다");
assert.match(exportMarkup, /data-chart="composition"/, "내보내기 화면에도 그래프");

// ── 저장된 map-charts 쪽이 그래프 자료를 잃으면 map-key 내용(표 줄·각주)으로 그린다
const lostViews = new Map([[d05Result.tileId, { ...noFeatureView, caveats: view.caveats, notes: view.notes }]]);
const lostSlide = planOf({ ...tilePage, layout: "map-charts" }, lostViews);
const lostMarkup = render(lostSlide);
assert.doesNotMatch(lostMarkup, /data-chart=/, "자료가 없으면 그래프가 없다");
assert.match(lostMarkup, /표본 한계 문구 가나다/, "자료가 없으면 각주를 장에 그린다");
assert.equal(lostSlide.page.layout, "map-key", "그래프 자료를 잃은 map-charts 장은 map-key로 판정된다");
assert.equal(lostMarkup, render(planOf({ ...tilePage, layout: "map-key" }, lostViews)), "자료를 잃은 map-charts는 같은 자료로 고른 map-key와 같은 화면이다");
assert.notEqual(markup, summaryMarkup, "자료가 있는 map-charts 장은 map-key 장과 다른 화면이다(그래프 열)");

// 다른 타일(고덕 A01)에는 영향 없음: 그래프 자료가 없는 장은 옛 값 map-summary·map-charts·numbers-first로 저장돼 있어도 같은 화면(map-key)으로 그린다
const a01 = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
const a01Views = new Map([[a01.tileId, toTileView(a01)]]);
const a01Board = initBoard([a01]);
const a01Page = recommendedPages(EMPTY_REPORT_DOC, a01Views, a01Board, { summary: toSummaryView(GODEOK_SUMMARY, [a01]), analysisDate: "2026-10-27", views: a01Views }).find((page) => page.kind === "tile");
const a01Plan = (layout) => planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...a01Page, layout }] }, a01Views, { summary: toSummaryView(GODEOK_SUMMARY, [a01]), analysisDate: "2026-10-27", views: a01Views }).find((slide) => slide.kind === "tile");
assert.equal(analysisCharts(a01Plan("map-summary").map), null, "고덕 A01 지도에는 그래프 자료가 없다(이 비교의 전제)");
assert.equal(a01Page.layout, "map-key", "그래프 자료가 없는 A01 쪽은 map-key");
for (const stored of ["map-summary", "map-charts", "numbers-first"]) {
  assert.equal(a01Plan(stored).page.layout, "map-key", `자료 없는 ${stored} 쪽은 map-key로 판정된다`);
  assert.equal(render(a01Plan(stored)), render(a01Plan("map-key")), `자료 없는 ${stored}는 map-key와 같은 화면`);
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

// ── 필터 줄: 옛 요약이 그리던 「적용 필터」 줄을 카드의 보조 줄 아래에 그린다(고덕 A05, 설명선 없는 쪽)
{
  const a05 = GODEOK_RESULTS.find((result) => result.tileCode === "A05");
  const rawA05 = { ...toTileView(a05, null, null, { distance: { max: 900 } }), callout: null };
  const a05View = { ...rawA05, keyFigure: rawA05.keyFigure ?? { question: "반경 확인 세대", answer: { value: "21,549세대", kind: "number" }, stats: [{ value: "1곳", label: "아파트 단지" }] } };
  assert.ok(a05View.filterLine, "A05 필터 줄이 있다(이 검사의 전제)");
  const a05Views = new Map([[a05.tileId, a05View]]);
  const a05Ctx = { summary: toSummaryView(GODEOK_SUMMARY, [a05]), analysisDate: "2026-10-27", views: a05Views };
  const a05Pages = recommendedPages(EMPTY_REPORT_DOC, a05Views, initBoard([a05]), a05Ctx);
  const a05Page = a05Pages.find((page) => page.kind === "tile");
  assert.equal(a05Page.layout, "map-charts", "그래프 자료가 있는 A05 쪽은 map-charts");
  for (const fontSizes of [undefined, { summary: 24 }]) {
    const slide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...a05Page, ...(fontSizes ? { fontSizes } : {}) }] }, a05Views, a05Ctx).find((s) => s.kind === "tile");
    const m = render(slide);
    const frame = frameOf(slide);
    assert.ok(frame.fit?.filterText, `카드에 필터 줄이 있다 (${fontSizes ? "24 pt" : "기본"})`);
    assert.ok(m.includes(`>${frame.fit.filterText}<`), "필터 줄이 장에 있다");
    const card = partRect(m, "key-figure");
    const filter = partRect(m, "key-filter");
    assert.ok(filter.y >= 0 && filter.y + filter.h <= card.h + 1e-6, "필터 줄은 카드 안(카드 왼쪽 위 기준 좌표)");
  }
  // 필터 줄이 없으면 카드에는 필터 줄이 없다
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
  assert.deepEqual(calloutPages.map((page) => page.layout), ["map-charts", "map-key"], "개요는 map-charts, 설명 상세 장은 map-key");
}

// ── 옛 보고서 가져오기는 쪽 모양을 바꾸지 않는다
{
  const legacy = importLegacyReport(EMPTY_REPORT_DOC, board, views, ctx);
  const legacyTile = legacy.find((page) => page.kind === "tile");
  assert.ok(legacyTile, "가져온 D05 쪽");
  assert.equal(legacyTile.layout, "map-key", "가져온 쪽은 map-key(새 추천 구성만 map-charts)");
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
