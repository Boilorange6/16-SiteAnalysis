/** 「지도 + 그래프」 PPT: 그래프가 편집 가능한 도형 그룹이고, 화면과 같은 글자·글자 크기·건물 수를 쓴다. */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";

const { GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView, viewWithLayer } = await import("../../lib/v2/ui/tile-view.ts");
const { EMPTY_REPORT_DOC, defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { planReportDoc, recommendedPages } = await import("../../lib/v2/report/report-doc-plan.ts");
const { mapKeyOf } = await import("../../lib/v2/report/report-plan.ts");
const { analysisCharts, analysisStatLine } = await import("../../lib/v2/report/analysis-charts.ts");
const { compositionShapes, distanceShapes } = await import("../../lib/v2/report/chart-geometry.ts");
const { chartsColumnLayout, slidePanelRects } = await import("../../lib/v2/ui/overlay-layout.ts");
const { modelWithHiddenLayers } = await import("../../lib/v2/ui/map-layers.ts");
const { analysisColumnFit } = await import("../../lib/v2/report/analysis-column-fit.ts");
const { addChartShapes } = await import("../../lib/v2/report/analysis-column-pptx.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");

// ── 픽스처: test-v2-analysis-page-surface.mjs와 같은 D05(건물 층수 3구간). 건물 수만 바꿔 쓴다.
const CENTER = [127.15, 37.62];
const M_LNG = 88300;
const M_LAT = 111200;
const square = (east, north, half = 5) => [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => [CENTER[0] + (east + x * half) / M_LNG, CENTER[1] + (north + y * half) / M_LAT])];
const LAYERS = [["floors_1_4", "tall_lt35", "low_le12"], ["floors_5_8", "tall_lt35", "low_gt12"], ["floors_9_14", "tall_ge35", "low_gt12"]];

function fixture(count) {
  const buildings = Array.from({ length: count }, (_, i) => ({ band: i < 6 ? 0 : i < 10 ? 1 : i < 12 ? 2 : i % 3, value: 2 + (i % 13), east: -450 + ((i * 37) % 900), north: ((i * 53) % 900) - 450 }));
  const polygons = buildings.flatMap(({ band, value, east, north }, i) => {
    const e = count === 12 ? -400 + i * 70 : east;
    const n = count === 12 ? (i % 3) * 120 - 100 : north;
    return LAYERS[band].map((layer) => ({ layer, rings: square(e, n), value, counted: true }));
  });
  const result = {
    tileId: "x-D05", analysisId: "x", tileType: "diagram", tileCode: "D05", status: "complete", engineVersion: "test",
    conditions: { address: "a", center: CENTER, radiusM: 1000, analysisDate: "2026-10-27", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
    metrics: [], judgment: null,
    presentation: { legend: [], camera: null, layers: [], outputFace: "front", features: [], polygons, valueAxis: { label: "지상 층수", unit: "층", countUnit: "동" } },
    provenance: { manifestHash: "a".repeat(64), sources: [] }, limitations: [],
  };
  const raw = toTileView(result);
  const filtered = viewWithLayer(raw, raw.defaultLayer);
  const view = {
    ...filtered,
    caveats: ["표본 한계 문구 가나다"],
    notes: ["보조 메모 라마바", "표본 한계 문구 가나다"],
    badges: [{ text: "일부 자료만 집계", tone: "limit" }],
    headline: { value: "4층", label: "층수 중앙값" },
    sentence: "낮은 층 건물이 대부분이고 높은 건물은 일부다",
  };
  const board = initBoard([result]);
  const views = new Map([[result.tileId, view]]);
  const ctx = { summary: toSummaryView(GODEOK_SUMMARY, [result]), analysisDate: "2026-10-27", views };
  const tilePage = recommendedPages(EMPTY_REPORT_DOC, views, board, ctx).find((page) => page.kind === "tile");
  const planOf = (page, v = views) => planReportDoc({ ...EMPTY_REPORT_DOC, pages: [page] }, v, { ...ctx, views: v }).find((slide) => slide.kind === "tile");
  return { result, view, views, tilePage, planOf };
}

// 1x1 PNG: 지도 배경 그림 수를 세는 용도
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const unescapeXml = (s) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const shapeBlocks = (xml) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
const nameOf = (block) => block.match(/<p:cNvPr id="\d+" name="([^"]*)"/)?.[1] ?? "";
const textsOf = (block) => [...block.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unescapeXml(m[1]));
const picCount = (xml) => (xml.match(/<p:pic>/g) ?? []).length;

async function deckOf(slide, images = {}) {
  const zip = await JSZip.loadAsync(await renderReportPptx([slide], images));
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  const noteNames = Object.keys(zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  const notes = (await Promise.all(noteNames.map((name) => zip.file(name).async("string")))).join("|");
  return { xml, notes, blocks: shapeBlocks(xml) };
}

const render = (slide) => renderToStaticMarkup(createElement(SlideSurface, { slide, basemap: "none", mode: "edit" }));

// ── 12동 D05: 기본 계획
const base = fixture(12);
const chartsSlide = base.planOf({ ...base.tilePage, layout: "map-charts" });
const summarySlide = base.planOf({ ...base.tilePage, layout: "map-summary" });
assert.equal(chartsSlide.page.layout, "map-charts");
const images = { [mapKeyOf(chartsSlide) ?? chartsSlide.view.tileId]: PNG };
const charts = await deckOf(chartsSlide, images);
const plain = await deckOf(summarySlide, images);

// 그래프는 편집 가능한 도형 그룹: 구성비·거리 각각 한 그룹
assert.match(charts.xml, /name="GRP\|chart-composition-D05\|그래프 · 구성비\|chart-composition-/, "구성비 도형 이름");
assert.match(charts.xml, /name="GRP\|chart-distance-D05\|그래프 · 거리\|chart-distance-/, "거리 도형 이름");
const groupNames = [...charts.xml.matchAll(/<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="([^"]*)"/g)].map((m) => m[1]);
assert.ok(groupNames.includes("그래프 · 구성비") && groupNames.includes("그래프 · 거리"), `그래프마다 그룹 하나: ${groupNames.join(",")}`);
assert.equal(groupNames.filter((n) => n === "그래프 · 구성비").length, 1);
assert.equal(groupNames.filter((n) => n === "그래프 · 거리").length, 1);
assert.doesNotMatch(plain.xml, /GRP\|chart-/, "map-summary에는 그래프 도형이 없다");

// 그래프용 그림이 없다: 그림 수는 map-summary와 같다(지도 배경 그림만)
assert.ok(picCount(plain.xml) >= 1, "이 픽스처에는 지도 배경 그림이 있다(비교의 전제)");
assert.equal(picCount(charts.xml), picCount(plain.xml), "그래프는 그림을 더하지 않는다");

// 각주는 장 본문에 없고 발표자 노트에 있다(중복은 한 번)
for (const phrase of ["표본 한계 문구 가나다", "보조 메모 라마바"]) {
  assert.ok(!charts.blocks.some((b) => textsOf(b).some((t) => t.includes(phrase))), `${phrase}는 장 본문에 없다`);
  assert.ok(charts.notes.includes(phrase), `${phrase}는 발표자 노트에 있다`);
  assert.ok(plain.blocks.some((b) => textsOf(b).some((t) => t.includes(phrase))), `map-summary는 ${phrase}를 본문에 그린다(위 판정이 헛돌지 않는다)`);
}
assert.equal(charts.notes.split("표본 한계 문구 가나다").length - 1, 1, "중복 각주는 노트에 한 번");
assert.ok(!charts.blocks.some((b) => textsOf(b).some((t) => /^주석 \d/.test(t))), "PPT에는 주석 칩이 없다");

// 화면 그래프 글자 = PPT 그래프 글자(같은 기하)
const svgTexts = [...render(chartsSlide).matchAll(/<svg[^>]*data-chart="[^"]*"[^>]*>([\s\S]*?)<\/svg>/g)].flatMap((m) => [...m[1].matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((t) => unescapeXml(t[1])));
const pptTexts = charts.blocks.filter((b) => nameOf(b).startsWith("GRP|chart-")).flatMap(textsOf);
assert.ok(svgTexts.length > 8, "화면 그래프 글자가 충분하다");
assert.deepEqual([...pptTexts].sort(), [...svgTexts].sort(), "화면 그래프 글자 집합 = PPT 그래프 글자 집합");

// 글자는 줄바꿈하지 않고, 크기·자리는 기하 그대로
const EMU = 914400;
const summaryRect = slidePanelRects({}, true, undefined, "wide").summary;
const col = chartsColumnLayout(summaryRect, 1);
const mapCharts = analysisCharts(modelWithHiddenLayers(chartsSlide.map, []));
const geometry = [...compositionShapes(mapCharts.composition, col.composition, 1, mapCharts.titles.composition), ...distanceShapes(mapCharts.distance, mapCharts.radiusM, col.distance, 1, mapCharts.titles.distance)];
for (const shape of geometry.filter((s) => s.kind === "text")) {
  const block = charts.blocks.find((b) => nameOf(b).endsWith(`|${shape.name}`));
  assert.ok(block, `${shape.name} 글상자`);
  assert.match(block, /<a:bodyPr[^>]*wrap="none"/, `${shape.name}: 줄바꿈 없음`);
  assert.doesNotMatch(block, /normAutofit|spAutoFit/, `${shape.name}: 자동 맞춤 없음`);
  assert.match(block, new RegExp(`sz="${Math.round(shape.pt * 100)}"`), `${shape.name}: 글자 크기 그대로`);
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(Math.abs(Number(off[1]) - shape.x * EMU) <= 1 && Math.abs(Number(off[2]) - shape.y * EMU) <= 1, `${shape.name}: 자리`);
  assert.ok(Math.abs(Number(ext[1]) - shape.w * EMU) <= 1 && Math.abs(Number(ext[2]) - shape.h * EMU) <= 1, `${shape.name}: 크기`);
}
for (const shape of geometry.filter((s) => s.kind === "rect")) {
  assert.equal(charts.blocks.some((b) => nameOf(b).endsWith(`|${shape.name}`)), shape.h > 0, `${shape.name}: 높이 0 사각형은 그리지 않는다`);
}

// 화면과 PPT가 같은 맞춤 값을 쓴다: 한 줄 통계·해석 문장 pt
{
  const fit = analysisColumnFit({ col, scale: 1, summaryPt: 13, badges: chartsSlide.view.badges, headline: chartsSlide.view.headline, statText: analysisStatLine(mapCharts), filterLine: chartsSlide.view.filterLine, sentence: chartsSlide.view.sentence });
  const sz = (text) => {
    const block = charts.blocks.find((b) => textsOf(b).includes(text));
    assert.ok(block, `${text} 글상자`);
    return Number(block.match(/sz="(\d+)"/)[1]);
  };
  assert.equal(sz(analysisStatLine(mapCharts)), Math.round(fit.statPt * 100), "통계 pt: PPT = 맞춤 함수");
  assert.equal(sz(chartsSlide.view.sentence), Math.round(fit.sentPt * 100), "해석 문장 pt: PPT = 맞춤 함수");
  const m = render(chartsSlide);
  // 화면: 글자를 담은 div 또는 가장 가까운 윗 div의 font-size(px). 두 글자 크기의 비는 슬라이드 크기(unit)와 상관없다.
  const fontPx = (text) => {
    const at = m.indexOf(`>${text}</div>`);
    assert.ok(at > 0, `화면에 ${text}`);
    for (let i = m.lastIndexOf("<div", at); i >= 0; i = m.lastIndexOf("<div", i - 1)) {
      const found = /font-size:([\d.]+)px/.exec(m.slice(i, m.indexOf(">", i)));
      if (found) return Number(found[1]);
    }
    return NaN;
  };
  const ratioScreen = fontPx(chartsSlide.view.sentence) / fontPx(analysisStatLine(mapCharts));
  assert.ok(Math.abs(ratioScreen - fit.sentPt / fit.statPt) < 0.01, `화면 해석/통계 글자 비 ${ratioScreen} = ${fit.sentPt / fit.statPt}`);
}

// 필터 줄은 통계 칸의 둘째 줄(같은 글상자), 글자 크기 24 pt에서도 같은 맞춤 값(고덕 A05)
{
  const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
  const a05 = GODEOK_RESULTS.find((result) => result.tileCode === "A05");
  const a05View = { ...toTileView(a05, null, null, { distance: { max: 900 } }), callout: null };
  assert.ok(a05View.filterLine, "A05 필터 줄(전제)");
  const a05Views = new Map([[a05.tileId, a05View]]);
  const a05Ctx = { summary: toSummaryView(GODEOK_SUMMARY, [a05]), analysisDate: "2026-10-27", views: a05Views };
  const a05Page = recommendedPages(EMPTY_REPORT_DOC, a05Views, initBoard([a05]), a05Ctx).find((page) => page.kind === "tile");
  assert.equal(a05Page.layout, "map-charts");
  for (const fontSizes of [undefined, { summary: 24 }]) {
    const slide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...a05Page, ...(fontSizes ? { fontSizes } : {}) }] }, a05Views, a05Ctx).find((s) => s.kind === "tile");
    const a05Charts = analysisCharts(slide.map);
    const deck = await deckOf(slide);
    const block = deck.blocks.find((b) => textsOf(b).includes(a05View.filterLine));
    assert.ok(block, `필터 줄이 장에 있다 (${fontSizes ? "24 pt" : "기본"})`);
    assert.deepEqual(textsOf(block), [analysisStatLine(a05Charts), a05View.filterLine], "통계 줄 아래 필터 줄, 한 글상자");
    const summaryPt = fontSizes ? 24 : 13;
    const fit = analysisColumnFit({ col: chartsColumnLayout(slidePanelRects(slide.style, true, undefined, "wide").summary, summaryPt / 13), scale: summaryPt / 13, summaryPt, badges: slide.view.badges, headline: slide.view.headline, statText: analysisStatLine(a05Charts), filterLine: a05View.filterLine, sentence: slide.page?.summaryOverride ?? slide.view.sentence });
    assert.equal(Number(block.match(/sz="(\d+)"/)[1]), Math.round(fit.statPt * 100), "필터 줄이 있어도 통계 pt는 맞춤 함수 값");
  }
}

// 해석 문장: 고친 요약이 있으면 그것
{
  const edited = await deckOf(base.planOf({ ...base.tilePage, layout: "map-charts", summaryOverride: "사용자가 고친 요약 문장" }), images);
  assert.ok(edited.blocks.some((b) => textsOf(b).includes("사용자가 고친 요약 문장")), "고친 요약을 해석 자리에");
  assert.ok(!edited.blocks.some((b) => textsOf(b).includes(base.view.sentence)), "고친 요약이 있으면 view.sentence는 없다");
  assert.ok(charts.blocks.some((b) => textsOf(b).includes(base.view.sentence)), "기본은 view.sentence 그대로");
}

// I3: 아주 긴 고친 요약(600자, 24 pt) — 화면과 PPT가 줄 수에 맞게 자른 똑같은 글을 그리고, PPT 글상자는 요약 판 밖으로 나가지 않는다.
{
  const long = "낮은 층 건물이 대부분이고 높은 건물은 일부이며 반경 안 분포는 대지 가까이에 몰려 있다 ".repeat(12).slice(0, 600);
  assert.equal(long.length, 600);
  const slide = base.planOf({ ...base.tilePage, layout: "map-charts", summaryOverride: long, fontSizes: { summary: 24 } });
  const plate = slidePanelRects(slide.style, true, undefined, "wide").summary;
  const scale = 24 / 13;
  const colLong = chartsColumnLayout(plate, scale);
  const longCharts = analysisCharts(slide.map);
  const fitLong = analysisColumnFit({ col: colLong, scale, summaryPt: 24, badges: slide.view.badges, headline: slide.view.headline, statText: analysisStatLine(longCharts), filterLine: slide.view.filterLine, sentence: long });
  assert.ok(fitLong.sentence.length < long.length && fitLong.sentence.endsWith("…") && long.startsWith(fitLong.sentence.slice(0, -1).trimEnd()), "줄 수에 맞게 자르고 …로 닫는다");
  const deck = await deckOf(slide, images);
  const block = deck.blocks.find((b) => textsOf(b).includes(fitLong.sentence));
  assert.ok(block, "PPT는 자른 글 그대로를 그린다");
  assert.ok(!deck.blocks.some((b) => textsOf(b).includes(long)), "PPT에 600자 원문이 없다");
  assert.doesNotMatch(block, /normAutofit|spAutoFit/, "PPT 해석 문장은 자동 맞춤에 기대지 않는다");
  assert.ok(render(slide).includes(`>${fitLong.sentence}</div>`), "화면도 같은 글");
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(Number(off[2]) + Number(ext[2]) <= (plate.y + plate.h) * EMU + 1, "해석 문장 글상자 아래 ≤ 요약 판 아래");
  // 통계 줄도 마찬가지: 아주 긴 통계는 줄 수에 맞게 잘리고 PPT와 화면이 같다
  const longStat = `${analysisStatLine(longCharts)} · ${"꼬리표 ".repeat(120)}`;
  const fitStat = analysisColumnFit({ col: colLong, scale, summaryPt: 24, badges: [], headline: null, statText: longStat, filterLine: "적용 필터: 가나다 ".repeat(20), sentence: null });
  assert.ok(fitStat.statText.endsWith("…") && fitStat.statText.length < longStat.length, "통계 줄 자름");
  assert.ok(fitStat.filterLine.endsWith("…"), "필터 줄은 한 줄로 자름");
  // 기본 크기(13 pt)의 평소 판단 문장(~80자)은 fitBlock이 맞는다고 본 대로 자르지 않는다
  const routine = "반경 안 건물 1,734동 중 지상층수 확인 68.4%, 1층 가정(추정) 548동 → 확인·추정·미상을 분리해 표시 → 건축물대장 층수 확인 필요";
  const colBase = chartsColumnLayout(summaryRect, 1);
  const fitRoutine = analysisColumnFit({ col: colBase, scale: 1, summaryPt: 13, badges: slide.view.badges, headline: slide.view.headline, statText: analysisStatLine(longCharts), filterLine: null, sentence: routine });
  assert.equal(fitRoutine.sentence, routine, "평소 문장은 잘리지 않는다");
}

// 배지·큰 숫자는 화면과 같은 칸에
assert.ok(charts.blocks.some((b) => textsOf(b).includes("일부 자료만 집계")), "배지");
assert.ok(charts.blocks.some((b) => textsOf(b).includes("4층")) && charts.blocks.some((b) => textsOf(b).includes("층수 중앙값")), "큰 숫자·라벨");
assert.ok(charts.blocks.some((b) => textsOf(b).some((t) => t.includes(analysisStatLine(mapCharts)))), "한 줄 통계");

// 끈 레이어: 그래프 합계는 걸러진 모델(10동)
{
  const hidden = await deckOf(base.planOf({ ...base.tilePage, layout: "map-charts", frame: { ...defaultFrame(), hiddenLayers: ["floors_9_14"] } }), images);
  const filteredModel = modelWithHiddenLayers(chartsSlide.map, ["floors_9_14"]);
  const expected = analysisCharts(filteredModel);
  assert.equal(expected.total, 10);
  assert.ok(hidden.blocks.some((b) => textsOf(b).some((t) => t.includes(analysisStatLine(expected)))), "PPT 통계 = 걸러진 모델의 통계");
  assert.ok(!hidden.blocks.some((b) => textsOf(b).some((t) => t.includes("건물 12동"))), "12동이 아니다");
}

// 그래프 자료가 없는 map-charts 쪽은 map-summary 그대로(표 줄·각주를 본문에)
{
  const empty = { ...base.view, map: { ...base.view.map, features: [], polygons: [], total: 0 } };
  const views = new Map([[base.result.tileId, empty]]);
  const lost = await deckOf(base.planOf({ ...base.tilePage, layout: "map-charts" }, views), images);
  assert.doesNotMatch(lost.xml, /GRP\|chart-/, "자료가 없으면 그래프 도형이 없다");
  assert.ok(lost.blocks.some((b) => textsOf(b).some((t) => t.includes("표본 한계 문구 가나다"))), "자료가 없으면 각주를 본문에");
}

// ── 점 2,000개: 거리 산점도의 dots 도형 수 = 색 수
{
  const big = fixture(2400);
  const bigSlide = big.planOf({ ...big.tilePage, layout: "map-charts" });
  const bigCharts = analysisCharts(modelWithHiddenLayers(bigSlide.map, []));
  assert.equal(bigCharts.distance.kind, "scatter");
  assert.equal(bigCharts.distance.points.length, 2000, "점은 2,000개로 표본");
  const colours = new Set(bigCharts.distance.points.map((point) => point.color));
  assert.ok(colours.size >= 2, "색이 둘 이상");
  const deck = await deckOf(bigSlide, { [mapKeyOf(bigSlide) ?? bigSlide.view.tileId]: PNG });
  const dots = deck.blocks.filter((b) => /\|chart-distance-dots-\d+"/.test(nameOf(b) + '"'));
  assert.equal(dots.length, colours.size, `chart-distance-dots 도형 수(${dots.length}) = 색 수(${colours.size})`);
  assert.equal(dots.reduce((sum, b) => sum + (b.match(/<a:moveTo>/g) ?? []).length, 0), 2000, "점마다 하위 경로 하나");
  assert.ok(dots.every((b) => /<a:custGeom>/.test(b)), "dots는 custGeom");
  assert.equal(deck.blocks.filter((b) => nameOf(b).endsWith("|chart-distance-site")).length, bigCharts.distance.site === null ? 0 : 1, "대지 표식은 있으면 한 도형");
}

// ── 도형 변환: 선의 뒤집기·점선, 높이 0 사각형, 점 묶음의 선 굵기
{
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const slide = pptx.addSlide();
  const stroke = "#112233";
  addChartShapes(slide, [
    { kind: "line", x1: 1, y1: 1, x2: 3, y2: 2, stroke, width: 1, name: "l-down-right" },
    { kind: "line", x1: 3, y1: 2, x2: 1, y2: 1, stroke, width: 1, name: "l-up-left" },
    { kind: "line", x1: 1, y1: 2, x2: 3, y2: 1, stroke, width: 1, dash: true, name: "l-up-right" },
    { kind: "line", x1: 3, y1: 1, x2: 1, y2: 2, stroke, width: 1, name: "l-down-left" },
    { kind: "rect", x: 1, y: 3, w: 1, h: 0, fill: "#aabbcc", name: "r-flat" },
    { kind: "rect", x: 1, y: 3, w: 1, h: 0.5, fill: "#aabbcc", stroke: "#000000", name: "r-box" },
    { kind: "dots", color: "#c9404a", r: 0.04, opacity: 0.5, points: [[4, 4], [4.5, 4.2]], stroke: "#ffffff", strokeWidth: 1.5, name: "d-site" },
    { kind: "text", x: 5, y: 1, w: 1, h: 0.2, text: "글자", pt: 8.6, bold: true, color: "#3b3a35", align: "right", name: "t-right" },
  ], "GRP|chart-x|그래프|");
  const xml = await (await JSZip.loadAsync(await pptx.write({ outputType: "uint8array" }))).file("ppt/slides/slide1.xml").async("string");
  const blocks = shapeBlocks(xml);
  const by = (name) => blocks.find((b) => nameOf(b).endsWith(name));
  const flips = (name) => `${/flipH="1"/.test(by(name)) ? "H" : ""}${/flipV="1"/.test(by(name)) ? "V" : ""}`;
  assert.equal(flips("l-down-right"), "", "오른쪽 아래로: 뒤집지 않는다");
  assert.equal(flips("l-up-left"), "HV", "왼쪽 위로: 가로·세로 모두 뒤집는다(같은 선분)");
  assert.equal(flips("l-up-right"), "V", "오른쪽 위로: 세로만");
  assert.equal(flips("l-down-left"), "H", "왼쪽 아래로: 가로만");
  assert.match(by("l-up-right"), /<a:prstDash val="dash"\/>/, "점선");
  assert.match(by("l-down-right"), /<a:prstDash val="solid"\/>/, "실선");
  assert.ok(by("r-box") && !by("r-flat"), "높이 0 사각형은 건너뛴다");
  const site = by("d-site");
  assert.equal((site.match(/<a:moveTo>/g) ?? []).length, 2, "점마다 하위 경로");
  assert.match(site, /<a:ln w="19050">/, "점 묶음 선 굵기 1.5 pt");
  assert.match(site, /<a:alpha val="50000"\/>/, "점 묶음 불투명도 50%");
  assert.match(by("t-right"), /algn="r"/, "오른쪽 맞춤");
  assert.match(by("t-right"), /wrap="none"/, "줄바꿈 없음");
}

console.log("✓ v2 analysis page pptx");
