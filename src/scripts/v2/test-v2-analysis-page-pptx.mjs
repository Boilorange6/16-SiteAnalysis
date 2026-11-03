/**
 * 보고서 타일 장 PPT(지도 + 숫자 · 지도 + 그래프): 모든 사각형·카드 안·그래프가 화면과 같은 장 기하(`reportPageFrame`)·카드 맞춤(`keyFigureFit`)·
 * 그래프 기하(chart-geometry)에서 오고, 그래프는 편집 가능한 도형 그룹이며 화면과 같은 글자·글자 크기·건물 수를 쓴다.
 */
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
const { analysisCharts } = await import("../../lib/v2/report/analysis-charts.ts");
const { compositionShapes, distanceShapes } = await import("../../lib/v2/report/chart-geometry.ts");
const { modelWithHiddenLayers } = await import("../../lib/v2/ui/map-layers.ts");
const { addChartShapes } = await import("../../lib/v2/report/analysis-column-pptx.ts");
const { pageFrameFor } = await import("../../lib/v2/report/report-page-frame.ts");
const { CHIP } = await import("../../lib/v2/report/pptx-kit.ts");
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
    // 핵심 숫자 카드(화면 surface 테스트와 같은 표본)
    keyFigure: {
      question: "가장 많은 층수대",
      answer: { value: "1~4층", post: " 건물", kind: "number" },
      sub: "층수가 확인된 12동 기준",
      stats: [{ value: "100%", label: "층수 확인률" }, { value: "0%", label: "1층 가정 비율" }, { value: "12동", label: "반경 건물" }],
    },
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

const EMU = 914400;
const unescapeXml = (s) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const shapeBlocks = (xml) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
const nameOf = (block) => block.match(/<p:cNvPr id="\d+" name="([^"]*)"/)?.[1] ?? "";
const textsOf = (block) => [...block.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unescapeXml(m[1]));
const picCount = (xml) => (xml.match(/<p:pic>/g) ?? []).length;
const rectOf = (block) => {
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  return { x: Number(off[1]) / EMU, y: Number(off[2]) / EMU, w: Number(ext[1]) / EMU, h: Number(ext[2]) / EMU };
};
/** 도형 그룹 이름 → 그룹 상자(inch). 그룹 상자는 자식 도형을 모두 감싼다. */
const groupsOf = (xml) => [...xml.matchAll(/<p:grpSp><p:nvGrpSpPr><p:cNvPr id="\d+" name="([^"]*)"\/>[\s\S]*?<p:grpSpPr>([\s\S]*?)<\/p:grpSpPr>/g)].map((m) => ({ name: m[1], ...rectOf(m[2]) }));
const pictures = (xml) => [...xml.matchAll(/<p:pic>[\s\S]*?<\/p:pic>/g)].map((m) => rectOf(m[0]));
const near = (actual, expected, tol, label) => assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} ≈ ${expected} (±${tol})`);
const szOf = (block) => Number(block.match(/sz="(\d+)"/)[1]);

async function deckOf(slide, images = {}, options = {}) {
  const zip = await JSZip.loadAsync(await renderReportPptx([slide], images, options));
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  const noteNames = Object.keys(zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  const notes = (await Promise.all(noteNames.map((name) => zip.file(name).async("string")))).join("|");
  return { xml, notes, blocks: shapeBlocks(xml), groups: groupsOf(xml) };
}

const render = (slide) => renderToStaticMarkup(createElement(SlideSurface, { slide, basemap: "none", mode: "edit" }));

// ── 12동 D05: 기본 계획
const base = fixture(12);
const chartsSlide = base.planOf({ ...base.tilePage, layout: "map-charts" });
const summarySlide = base.planOf({ ...base.tilePage, layout: "map-summary" }); // 저장된 옛 값은 ①(map-key)로 그린다
assert.equal(chartsSlide.page.layout, "map-charts");
assert.equal(summarySlide.page.layout, "map-key");
const images = { [mapKeyOf(chartsSlide) ?? chartsSlide.view.tileId]: PNG };
const charts = await deckOf(chartsSlide, images);
const plain = await deckOf(summarySlide, images);
// PPT가 읽는 같은 장 계산 묶음(화면 SlidePreview와 같은 함수 `reportPageFrame`이 만든다)
const frame = pageFrameFor(chartsSlide);
const plainFrame = pageFrameFor(summarySlide);
assert.equal(frame.layout, "map-charts");
assert.ok(frame.geometry.column && frame.fit && frame.chart1 && frame.chart2, "② 열·카드·그래프 카드 둘(전제)");
assert.equal(plainFrame.layout, "map-key");
assert.ok(plainFrame.geometry.keyCard && !plainFrame.geometry.column && plainFrame.fit, "① 카드(전제)");
const geo = frame.geometry;

// 그래프는 편집 가능한 도형 그룹: 구성비·거리 각각 한 그룹
assert.match(charts.xml, /name="GRP\|chart-composition-D05\|그래프 · 구성비\|chart-composition-/, "구성비 도형 이름");
assert.match(charts.xml, /name="GRP\|chart-distance-D05\|그래프 · 거리\|chart-distance-/, "거리 도형 이름");
const groupNames = charts.groups.map((g) => g.name);
assert.ok(groupNames.includes("그래프 · 구성비") && groupNames.includes("그래프 · 거리"), `그래프마다 그룹 하나: ${groupNames.join(",")}`);
assert.equal(groupNames.filter((n) => n === "그래프 · 구성비").length, 1);
assert.equal(groupNames.filter((n) => n === "그래프 · 거리").length, 1);
assert.doesNotMatch(plain.xml, /GRP\|chart-/, "① 지도 + 숫자에는 그래프 도형이 없다");

// ② 핵심 숫자 카드: 그룹 「핵심 숫자」 = 기하의 column.key(±0.01 in), 숫자 run 글자 크기 = keyFigureFit의 valuePt
{
  const group = charts.groups.find((g) => g.name === "핵심 숫자");
  assert.ok(group, "「핵심 숫자」 그룹");
  for (const k of ["x", "y", "w", "h"]) near(group[k], geo.column.key[k], 0.01, `② 핵심 숫자 그룹 ${k}`);
  assert.equal(frame.fit.height, geo.column.key.h, "카드 높이는 keyFigureFit이 정하고 기하가 그대로 받는다");
  const answer = charts.blocks.find((b) => textsOf(b).includes("1~4층"));
  assert.ok(answer, "큰 답 글상자");
  assert.deepEqual(textsOf(answer), ["1~4층", " 건물"], "큰 답은 상자 하나에 run(숫자·뒷말)");
  assert.ok(new RegExp(`sz="${Math.round(frame.fit.valuePt * 100)}"`).test(answer), `숫자 run 글자 크기 = valuePt ${frame.fit.valuePt}`);
  assert.ok(new RegExp(`sz="${Math.round(frame.fit.postPt * 100)}"`).test(answer), "뒷말 run 글자 크기 = postPt");
  assert.doesNotMatch(answer, /normAutofit|spAutoFit/, "큰 답은 자동 맞춤에 기대지 않는다");
  assert.match(answer, /<a:bodyPr[^>]*wrap="none"/, "큰 답은 줄바꿈하지 않는다");
  // 카드 안 글: 질문·보조 줄·보조 숫자 셋이 모두 카드 상자 안에 있다
  for (const phrase of ["가장 많은 층수대", "층수가 확인된 12동 기준", "100%", "층수 확인률", "12동", "반경 건물"]) {
    const block = charts.blocks.find((b) => textsOf(b).includes(phrase));
    assert.ok(block, `카드 글 「${phrase}」`);
    const r = rectOf(block);
    assert.ok(r.x >= group.x - 0.01 && r.y >= group.y - 0.01 && r.x + r.w <= group.x + group.w + 0.01 && r.y + r.h <= group.y + group.h + 0.01, `「${phrase}」는 카드 안`);
  }
  assert.ok(charts.blocks.some((b) => textsOf(b).includes("일부 자료만 집계")), "상태 배지");
}

// ① 핵심 숫자 카드: 기하의 keyCard, 카드 맨 아래 해석 줄 포함
{
  const group = plain.groups.find((g) => g.name === "핵심 숫자");
  assert.ok(group, "① 「핵심 숫자」 그룹");
  for (const k of ["x", "y", "w", "h"]) near(group[k], plainFrame.geometry.keyCard[k], 0.01, `① 핵심 숫자 그룹 ${k}`);
  assert.ok(plain.blocks.some((b) => textsOf(b).join("\n") === plainFrame.fit.sentenceLines.join("\n")), "① 해석 줄은 카드 안에 fit이 나눈 줄 그대로");
  assert.ok(!plain.groups.some((g) => g.name === "열 바탕"), "① 에는 열이 없다");
}

// 지도 그림은 쪽 전체가 아니라 기하의 지도 틀 안에만(① 전체 폭, ② 0.68 폭)
{
  assert.ok(picCount(plain.xml) >= 1, "이 픽스처에는 지도 배경 그림이 있다(비교의 전제)");
  assert.equal(picCount(charts.xml), picCount(plain.xml), "그래프는 그림을 더하지 않는다");
  for (const [deck, f, label] of [[plain, plainFrame, "①"], [charts, frame, "②"]]) {
    const pic = pictures(deck.xml)[0];
    for (const k of ["x", "y", "w", "h"]) near(pic[k], f.geometry.map[k], 0.01, `${label} 지도 그림 ${k} = 기하 map`);
  }
  assert.ok(geo.map.w < plainFrame.geometry.map.w - 1, "② 지도 틀은 ①보다 좁다(비교가 헛돌지 않는다)");
  // 「이미지 한 장」도 같다
  const whole = await deckOf(chartsSlide, images, { mapDrawing: "image" });
  const pic = pictures(whole.xml)[0];
  for (const k of ["x", "y", "w", "h"]) near(pic[k], geo.map[k], 0.01, `이미지 한 장 지도 그림 ${k}`);
}

// 열 바탕 띠: 지도 틀 오른쪽 끝에서 장 오른쪽 끝까지
{
  const band = charts.blocks.find((b) => nameOf(b) === "GRP|column-band|열 바탕|band");
  assert.ok(band, "열 바탕 띠");
  const r = rectOf(band);
  near(r.x, geo.map.w, 0.01, "열 바탕 x");
  near(r.x + r.w, 13.333, 0.01, "열 바탕 오른쪽 끝 = 장 오른쪽 끝");
  assert.match(band, /<a:srgbClr val="F0EFE9"/, "열 바탕 색");
}

// 각주 띠: 글은 `출처 `로 시작하고 첫 한계를 포함한다(화면 각주와 같은 문자열), 출처 9 pt일 때 7.5 pt
{
  const foot = charts.blocks.find((b) => textsOf(b)[0]?.startsWith("출처 "));
  assert.ok(foot, "각주 글");
  assert.equal(textsOf(foot)[0], frame.footer.text, "화면 각주와 같은 문자열");
  assert.ok(frame.footer.text.includes(chartsSlide.view.caveats[0]), "첫 한계가 각주에 있다");
  assert.equal(szOf(foot), 750, "출처 9 pt일 때 각주 7.5 pt");
  assert.match(foot, /<a:bodyPr[^>]*wrap="none"/, "각주는 줄바꿈하지 않는다");
  const r = rectOf(foot);
  near(r.y, geo.footer.y, 0.01, "각주 글 y");
  assert.ok(r.x + r.w <= geo.pageNo.x + 0.01, "각주 글은 쪽 번호 앞에서 끝난다");
  assert.ok(charts.blocks.some((b) => textsOf(b).includes("1 / 1") || textsOf(b).some((t) => /^\d+ \/ \d+$/.test(t))), "쪽 번호");
}

// 첫 한계 밖의 각주(메모)는 장 본문에 없고 발표자 노트에 있다(중복은 한 번)
{
  const phrase = "보조 메모 라마바";
  assert.ok(!charts.blocks.some((b) => textsOf(b).some((t) => t.includes(phrase))), `${phrase}는 장 본문에 없다`);
  assert.ok(charts.notes.includes(phrase), `${phrase}는 발표자 노트에 있다`);
  assert.ok(plain.notes.includes(phrase), "① 도 같다");
  assert.ok(charts.notes.includes("표본 한계 문구 가나다"), "한계 전체는 노트에 있다");
  assert.equal(charts.notes.split("표본 한계 문구 가나다").length - 1, 1, "중복 각주는 노트에 한 번");
  assert.ok(!charts.blocks.some((b) => textsOf(b).some((t) => /^주석 \d/.test(t))), "PPT에는 주석 칩이 없다");
}

// 화면 그래프 글자 집합 = PPT 그래프 글자 집합(같은 기하)
const mapCharts = analysisCharts(modelWithHiddenLayers(chartsSlide.map, []));
const svgTexts = [...render(chartsSlide).matchAll(/<svg[^>]*data-chart="[^"]*"[^>]*>([\s\S]*?)<\/svg>/g)].flatMap((m) => [...m[1].matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((t) => unescapeXml(t[1])));
const pptTexts = charts.blocks.filter((b) => nameOf(b).startsWith("GRP|chart-")).flatMap(textsOf);
assert.ok(svgTexts.length > 8, "화면 그래프 글자가 충분하다");
assert.deepEqual([...pptTexts].sort(), [...svgTexts].sort(), "화면 그래프 글자 = PPT 그래프 글자");

// 글자는 줄바꿈하지 않고, 크기·자리는 그래프 카드 안쪽 칸 기하 그대로
const geometry = [...compositionShapes(mapCharts.composition, frame.chart1, frame.chartScale, mapCharts.titles.composition), ...distanceShapes(mapCharts.distance, mapCharts.radiusM, frame.chart2, frame.chartScale, mapCharts.titles.distance)];
for (const shape of geometry.filter((s) => s.kind === "text")) {
  const block = charts.blocks.find((b) => nameOf(b).endsWith(`|${shape.name}`));
  assert.ok(block, `${shape.name} 글상자`);
  assert.match(block, /<a:bodyPr[^>]*wrap="none"/, `${shape.name}: 줄바꿈 없음`);
  assert.doesNotMatch(block, /normAutofit|spAutoFit/, `${shape.name}: 자동 맞춤 없음`);
  assert.match(block, new RegExp(`sz="${Math.round(shape.pt * 100)}"`), `${shape.name}: 글자 크기 그대로`);
  const r = rectOf(block);
  assert.ok(Math.abs(r.x * EMU - shape.x * EMU) <= 1 && Math.abs(r.y * EMU - shape.y * EMU) <= 1, `${shape.name}: 자리`);
  assert.ok(Math.abs(r.w * EMU - shape.w * EMU) <= 1 && Math.abs(r.h * EMU - shape.h * EMU) <= 1, `${shape.name}: 크기`);
}
for (const shape of geometry.filter((s) => s.kind === "rect")) {
  assert.equal(charts.blocks.some((b) => nameOf(b).endsWith(`|${shape.name}`)), shape.h > 0, `${shape.name}: 높이 0 사각형은 그리지 않는다`);
}
// 그래프 카드는 기하의 column.chart1·chart2 칸이다
for (const [key, rect] of [["composition", geo.column.chart1], ["distance", geo.column.chart2]]) {
  const card = charts.blocks.find((b) => nameOf(b).endsWith(`|card`) && nameOf(b).includes(`chart-${key}-`));
  assert.ok(card, `${key} 그래프 카드`);
  const r = rectOf(card);
  for (const k of ["x", "y", "w", "h"]) near(r[k], rect[k], 0.01, `${key} 그래프 카드 ${k}`);
}
// 구성비 이름은 같은 앞말을 뗀 이름(G1)이고, 그래프 카드 제목은 9.4 pt다(화면과 같은 상수)
assert.equal(szOf(charts.blocks.find((b) => nameOf(b).endsWith("|chart-composition-title"))), 940, "그래프 카드 제목 9.4 pt");

// 해석 줄: 열 맨 아래, fit이 나눈 줄 그대로·같은 pt·열 안. 화면과 pt 비가 같다(keyFigureFit 값 비교로 대신한다)
{
  const info = frame.sentence;
  assert.ok(info && info.lines.length > 0, "해석 줄(전제)");
  const group = charts.groups.find((g) => g.name === "해석 줄");
  assert.ok(group, "「해석 줄」 그룹");
  near(group.y + group.h, geo.column.sentence.y + geo.column.sentence.h, 0.01, "해석 줄은 열 맨 아래");
  const block = charts.blocks.find((b) => nameOf(b).endsWith("|text") && nameOf(b).includes("column-sentence"));
  assert.deepEqual(textsOf(block), info.lines, "PPT 해석 줄 = fit이 나눈 줄");
  assert.equal(szOf(block), Math.round(info.pt * 100), "해석 pt = keyFigureFit 값");
  assert.equal(info.pt, frame.fit.sentencePt, "해석 pt는 카드 맞춤 값 그대로");
  const html = render(chartsSlide);
  const px = (part) => Number(new RegExp(`data-part="${part}"[^>]*style="[^"]*font-size:([\\d.]+)px`).exec(html)?.[1]);
  const question = charts.blocks.find((b) => textsOf(b).includes("가장 많은 층수대"));
  assert.ok(px("column-sentence") > 0 && px("key-question") > 0, "화면 해석 줄·카드 질문 글자 크기를 읽었다(전제)");
  near(px("column-sentence") / px("key-question"), szOf(block) / szOf(question), 0.01, "화면 해석/질문 글자 비 = PPT 해석/질문 글자 비");
}

// 배지·큰 숫자는 같은 카드 칸에
assert.ok(charts.blocks.some((b) => textsOf(b).includes("일부 자료만 집계")), "배지");
assert.ok(charts.blocks.some((b) => textsOf(b).includes("1~4층")) && charts.blocks.some((b) => textsOf(b).includes("가장 많은 층수대")), "큰 답·질문");

// 필터 줄은 카드 안(줄은 keyFigureFit이 나눈 대로), 글자 크기 24 pt에서도 같은 맞춤 값(고덕 A05)
{
  const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
  const a05 = GODEOK_RESULTS.find((result) => result.tileCode === "A05");
  const rawA05 = toTileView(a05, null, null, { distance: { max: 900 } });
  const a05View = { ...rawA05, callout: null, keyFigure: rawA05.keyFigure ?? { question: "반경 확인 세대", answer: { value: "21,549세대", kind: "number" }, stats: [{ value: "1곳", label: "아파트 단지" }] } };
  assert.ok(a05View.filterLine, "A05 필터 줄(전제)");
  const a05Views = new Map([[a05.tileId, a05View]]);
  const a05Ctx = { summary: toSummaryView(GODEOK_SUMMARY, [a05]), analysisDate: "2026-10-27", views: a05Views };
  const a05Page = recommendedPages(EMPTY_REPORT_DOC, a05Views, initBoard([a05]), a05Ctx).find((page) => page.kind === "tile");
  assert.equal(a05Page.layout, "map-charts");
  for (const fontSizes of [undefined, { summary: 24 }]) {
    const slide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...a05Page, ...(fontSizes ? { fontSizes } : {}) }] }, a05Views, a05Ctx).find((s) => s.kind === "tile");
    const f = pageFrameFor(slide);
    assert.ok(f.fit && f.fit.filterLines.length > 0, `필터 줄이 카드에 있다 (${fontSizes ? "24 pt" : "기본"})`);
    const deck = await deckOf(slide);
    const block = deck.blocks.find((b) => textsOf(b).join("") === f.fit.filterLines.join(""));
    assert.ok(block, `PPT 필터 줄 = fit이 나눈 줄 (${fontSizes ? "24 pt" : "기본"}): ${f.fit.filterLines.join(" / ")}`);
    assert.deepEqual(textsOf(block), f.fit.filterLines, "줄은 fit이 나눈 그대로");
    assert.equal(szOf(block), Math.round(f.fit.subPt * 100), "필터 줄 pt = 맞춤 함수 값");
    const group = deck.groups.find((g) => g.name === "핵심 숫자");
    const r = rectOf(block);
    assert.ok(r.y + r.h <= group.y + group.h + 0.01, "필터 줄은 카드 안");
    if (fontSizes) assert.ok(f.fit.subPt > 9.4 + 1e-9, "요약 24 pt면 필터 줄 글자가 시안 9.4 pt보다 크다(비교가 헛돌지 않는다)");
  }
}

// A05·A06 설명선 개요: 화면과 같은 틀 투영(overviewFrame)으로 그린다 — 번호 점은 지도 틀 안 같은 자리, 카드·열은 새 배치(옛 요약 판 없음)
{
  const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
  const { a05ReportModule } = await import("../../lib/v2/tile/a05/report.ts");
  const isDot = (name) => /callout-key:[^|]*\|[^|]*\|dot$/.test(name ?? "");
  for (const code of ["A05", "A06"]) {
    const result = GODEOK_RESULTS.find((r) => r.tileCode === code);
    if (!result) continue;
    const raw = toTileView(result, null, null, code === "A05" ? { distance: { max: 900 } } : null);
    assert.ok(raw.callout, `${code}: 설명선 모델(전제)`);
    const cView = { ...raw, keyFigure: raw.keyFigure ?? { question: "반경 확인", answer: { value: "21,549세대", kind: "number" }, stats: [{ value: "35개", label: "단지" }] }, backdrop: raw.backdrop ?? raw.map };
    const cViews = new Map([[result.tileId, cView]]);
    const cCtx = { summary: toSummaryView(GODEOK_SUMMARY, [result]), analysisDate: "2026-10-27", views: cViews };
    const pages = recommendedPages(EMPTY_REPORT_DOC, cViews, initBoard([result]), cCtx).filter((p) => p.kind === "tile");
    const overview = planReportDoc({ ...EMPTY_REPORT_DOC, pages }, cViews, cCtx).find((s) => s.kind === "tile" && s.callout?.page === 0);
    assert.ok(overview, `${code}: 개요 슬라이드`);
    const f = pageFrameFor(overview);
    assert.ok(f && f.calloutOverview, `${code}: 새 배치 개요 틀`);
    const deck = await deckOf(overview);
    // 번호 점 = 화면이 같은 모듈로 같은 틀에 그리는 점(기록한 그리기 호출과 같은 자리·크기)
    const ops = [];
    const recorder = { addShape: (type, o) => { ops.push({ type, o }); return recorder; }, addText: () => recorder };
    a05ReportModule.report.render({ slide: recorder, planned: overview, part: "overview", overviewFrame: f.calloutOverview });
    const key = (r) => `${r.x.toFixed(3)},${r.y.toFixed(3)},${r.w.toFixed(3)}`;
    const screenDots = ops.filter((op) => isDot(op.o.objectName)).map((op) => key(op.o)).sort();
    const pptDots = deck.blocks.filter((b) => isDot(nameOf(b))).map((b) => key(rectOf(b))).sort();
    assert.ok(screenDots.length > 0, `${code}: 번호 점이 있다(전제)`);
    assert.deepEqual(pptDots, screenDots, `${code}: PPT 번호 점 = 화면 번호 점(같은 틀 투영)`);
    const map = f.geometry.map;
    for (const b of deck.blocks.filter((x) => isDot(nameOf(x)))) {
      const r = rectOf(b);
      assert.ok(r.x >= map.x - 0.01 && r.y >= map.y - 0.01 && r.x + r.w <= map.x + map.w + 0.01 && r.y + r.h <= map.y + map.h + 0.01, `${code}: 번호 점은 지도 틀 안`);
    }
    // 카드·열은 새 배치, 옛 오른쪽 요약 판은 없다. 범례 판은 지도 틀 안.
    const wideRing = deck.groups.find((g) => g.name === "반경");
    near(wideRing.w, 0.72 * Math.min(map.w, map.h), 0.15, `${code}: wide 개요의 반경 원 지름 = 0.72 × 틀 짧은 변`);
    assert.ok(deck.groups.some((g) => g.name === "핵심 숫자"), `${code}: 핵심 숫자 카드`);
    assert.ok(!deck.groups.some((g) => g.name === "요약"), `${code}: 옛 요약 판이 없다`);
    const legend = deck.groups.find((g) => g.name === "범례");
    assert.ok(legend, `${code}: 설명선 범례`);
    assert.ok(legend.x >= map.x - 0.01 && legend.y + legend.h <= map.y + map.h + 0.01 && legend.x + legend.w <= map.x + map.w + 0.01, `${code}: 범례는 지도 틀 안`);
    if (code === "A05") assert.ok(deck.blocks.some((b) => textsOf(b).join("") === f.fit.filterLines.join("")), "A05 필터 줄이 카드 안에 있다");
    // N4: 보조 숫자 이름은 fit이 나눈 줄 그대로, PPT 상자가 다시 접지 않는다(wrap none).
    f.fit.statLabelLines.forEach((lines, i) => {
      const block = deck.blocks.find((b) => nameOf(b).endsWith(`stat-label-${i}`));
      assert.ok(block, `${code}: 보조 숫자 이름 ${i}`);
      assert.deepEqual(textsOf(block), lines, `${code}: 보조 숫자 이름 ${i} 줄 = fit 줄`);
      assert.match(block, /wrap="none"/, `${code}: 보조 숫자 이름 ${i}은 다시 접히지 않는다`);
    });
    // A3·A4(Ruling 39): 새 틀 장은 판형과 상관없이 설명선 개요를 그린다. PPT 번호 점 = 화면 번호 점, 설명선 범례 1개, 반경 원 0.72.
    if (code === "A05") {
      for (const format of ["a3", "a4"]) {
        const sized = planReportDoc({ ...EMPTY_REPORT_DOC, format, pages: pages.map((p) => ({ ...p })) }, cViews, cCtx).find((s) => s.kind === "tile" && s.callout?.page === 0);
        assert.ok(sized, `${format}: 개요 슬라이드`);
        const sf = pageFrameFor(sized);
        assert.ok(sf.calloutOverview, `${format}: 설명선 개요 틀`);
        assert.equal(sf.legend, null, `${format}: 일반 지도 범례 판 없음(설명선 범례)`);
        const sd = await deckOf(sized);
        assert.equal(sd.groups.filter((g) => g.name === "범례").length, 1, `${format}: 범례 그룹 1개`);
        const sizedOps = [];
        const sizedRecorder = { addShape: (type, o) => { sizedOps.push({ type, o }); return sizedRecorder; }, addText: () => sizedRecorder };
        a05ReportModule.report.render({ slide: sizedRecorder, planned: sized, part: "overview", overviewFrame: sf.calloutOverview });
        const sizedScreen = sizedOps.filter((op) => isDot(op.o.objectName)).map((op) => key(op.o)).sort();
        const sizedPpt = sd.blocks.filter((b) => isDot(nameOf(b))).map((b) => key(rectOf(b))).sort();
        assert.ok(sizedScreen.length > 0, `${format}: 번호 점이 있다(전제)`);
        assert.deepEqual(sizedPpt, sizedScreen, `${format}: PPT 번호 점 = 화면 번호 점`);
        const lg = sd.groups.find((g) => g.name === "범례");
        for (const k of ["x", "y", "w", "h"]) near(lg[k], sf.geometry.legend[k], 0.02, `${format}: 범례 판 ${k} = 기하 legend`);
        const ring = sd.groups.find((g) => g.name === "반경");
        near(ring.w, 0.72 * Math.min(sf.geometry.map.w, sf.geometry.map.h), 0.15, `${format}: 반경 원 지름 = 0.72 × 틀 짧은 변`);
      }
    }
    // 상세 장은 옛 경로 그대로(쪽 전체)
    const detail =planReportDoc({ ...EMPTY_REPORT_DOC, pages }, cViews, cCtx).find((s) => s.kind === "tile" && s.callout && s.callout.page > 0);
    if (detail) {
      assert.equal(pageFrameFor(detail), null, `${code}: 상세 장은 옛 경로`);
      assert.ok(!(await deckOf(detail)).groups.some((g) => g.name === "핵심 숫자"), `${code}: 상세 장에는 카드가 없다`);
    }
  }
}

// M1: 범례 판(legendFit 칸·글·pt) — 고덕 D04(2열, 항목 8개)와 긴 주석(2줄 접기)
{
  const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
  const result = GODEOK_RESULTS.find((r) => r.tileCode === "D04");
  assert.ok(result, "D04 고덕 결과(전제)");
  const raw = toTileView(result);
  const longNote = "도로 중심선 · 실제 폭·공식 도로대장 아님 · © OpenStreetMap contributors · 이 문구는 두 줄을 넘도록 일부러 길게 적은 범례 주석입니다 · 전문은 title에 있다";
  const lView = { ...raw, map: { ...raw.map, notes: ["짧은 주석", longNote] } };
  const lViews = new Map([[result.tileId, lView]]);
  const lCtx = { summary: toSummaryView(GODEOK_SUMMARY, [result]), analysisDate: "2026-10-27", views: lViews };
  const pages = recommendedPages(EMPTY_REPORT_DOC, lViews, initBoard([result]), lCtx).filter((p) => p.kind === "tile");
  const slide = planReportDoc({ ...EMPTY_REPORT_DOC, pages }, lViews, lCtx).find((s) => s.kind === "tile");
  const f = pageFrameFor(slide);
  const fit = f.legend;
  assert.ok(fit && fit.cols === 2 && fit.items.length >= 6, "2열 범례(전제)");
  assert.ok(fit.noteLines.some((lines) => lines.length === 2), "긴 주석은 2줄로 접힌다(전제)");
  const deck = await deckOf(slide);
  const panel = deck.groups.find((g) => g.name === "범례");
  assert.ok(panel, "범례 그룹");
  for (const k of ["x", "y", "w", "h"]) near(panel[k], f.geometry.legend[k], 0.02, `범례 판 ${k} = 기하 legend`);
  const legendBlocks = deck.blocks.filter((b) => /panel-legend/.test(nameOf(b)));
  fit.items.forEach((item, i) => {
    const slot = fit.itemRects[i];
    const expectedText = fit.labelLines[i];
    const block = legendBlocks.find((b) => textsOf(b).join("\n") === expectedText.join("\n") && Math.abs(rectOf(b).y - (f.geometry.legend.y + slot.y)) < 0.02 && Math.abs(rectOf(b).x - (f.geometry.legend.x + slot.x + fit.iconW + fit.iconGap)) < 0.02);
    assert.ok(block, `항목 ${i} 「${expectedText.join(" / ")}」 글상자가 legendFit 칸 자리에 있다`);
    const r = rectOf(block);
    near(r.w, slot.w - fit.iconW - fit.iconGap, 0.02, `항목 ${i} 글상자 폭`);
    near(r.h, slot.h, 0.02, `항목 ${i} 글상자 높이 = 칸 높이`);
    assert.equal(szOf(block), Math.round(fit.labelPt * 100), `항목 ${i} 글자 크기 = labelPt`);
    assert.match(block, /<a:bodyPr[^>]*wrap="none"/, `항목 ${i} 줄바꿈 없음`);
  });
  fit.notes.forEach((_, i) => {
    const slot = fit.noteRects[i];
    const block = legendBlocks.find((b) => textsOf(b).join("\n") === fit.noteLines[i].join("\n") && Math.abs(rectOf(b).y - (f.geometry.legend.y + slot.y)) < 0.02);
    assert.ok(block, `주석 ${i} 글상자(줄 = legendFit)`);
    assert.equal(szOf(block), Math.round(fit.notePt * 100), `주석 ${i} 글자 크기 = notePt`);
  });

  // T23a: 항목 이름이 열 폭을 넘어 2줄로 접히는 장(엔진 범례 이름을 길게 한 표본)에서도 PPT 글상자가 접힌 줄(`\n`)을 그대로 싣는다.
  const foldedLegend = fit.items.filter((item) => !item.site).map((item) => ({ label: `${item.label} · 열 폭을 넘는 긴 이름`, min: null, max: null }));
  const foldedView = toTileView({ ...result, presentation: { ...result.presentation, legend: foldedLegend } });
  const foldedViews = new Map([[result.tileId, foldedView]]);
  const foldedCtx = { ...lCtx, views: foldedViews };
  const foldedPages = recommendedPages(EMPTY_REPORT_DOC, foldedViews, initBoard([result]), foldedCtx).filter((p) => p.kind === "tile");
  const bigSlide = planReportDoc({ ...EMPTY_REPORT_DOC, pages: foldedPages }, foldedViews, foldedCtx).find((s) => s.kind === "tile");
  const bigFit = pageFrameFor(bigSlide).legend;
  assert.ok(bigFit.labelLines.some((lines) => lines.length === 2), "항목 이름이 2줄로 접힌다(전제)");
  const bigLegendBlocks = (await deckOf(bigSlide)).blocks.filter((b) => /panel-legend/.test(nameOf(b)));
  bigFit.labelLines.forEach((lines, i) => {
    if (lines.length !== 2) return;
    assert.ok(bigLegendBlocks.some((b) => textsOf(b).join("\n") === lines.join("\n")), `2줄 항목 ${i} 「${lines.join(" / ")}」가 PPT 글상자에서 줄바꿈을 지킨다`);
  });
}

// M1: A12식 카드(구성 막대 + 큰 % 두 줄 설명)와 배지 3개 이상의 `+n` 칩
{
  const parts = [
    { label: "제3종일반주거지역", share: 50, color: "#f5c542", site: true },
    { label: "제2종일반주거지역", share: 24.9, color: "#f5c542" },
    { label: "제1종일반주거지역", share: 18.5, color: "#f5c542" },
    { label: "일반상업지역", share: 5, color: "#e05a47" },
    { label: "그 밖", share: 1.6, color: "#b9bdc6" },
  ];
  const zoneKey = { question: "대지 용도지역", answer: { value: "제3종일반주거지역", kind: "name" }, stats: [{ value: "50.0%", label: "반경 1km 중 같은 용도지역" }, { value: "95.0%", label: "반경 1km 중 주거지역" }], parts };
  const badges = [{ text: "일부 자료만 집계", tone: "limit" }, { text: "미확인", tone: "status" }, { text: "추정", tone: "limit" }, { text: "표본 적음", tone: "limit" }];
  const zView = { ...base.view, keyFigure: zoneKey, badges };
  const zViews = new Map([[base.result.tileId, zView]]);
  const zSlide = base.planOf({ ...base.tilePage, layout: "map-key" }, zViews);
  const zf = pageFrameFor(zSlide);
  const rows = zf.fit.rows;
  assert.ok(rows.lead && rows.partsBar && rows.partsSegments.length === parts.length, "A12식 카드 맞춤(전제)");
  const zDeck = await deckOf(zSlide, images);
  const card = zDeck.groups.find((g) => g.name === "핵심 숫자");
  assert.ok(card, "카드 그룹");
  const lead = zDeck.blocks.find((b) => nameOf(b).endsWith("|lead"));
  assert.ok(lead, "큰 % 글상자");
  assert.deepEqual(textsOf(lead), ["50.0%"]);
  assert.equal(szOf(lead), Math.round(zf.fit.leadPt * 100), "큰 % 글자 크기 = leadPt");
  near(rectOf(lead).x, zf.geometry.keyCard.x + rows.lead.value.x, 0.01, "큰 % x");
  near(rectOf(lead).y, zf.geometry.keyCard.y + rows.lead.value.y, 0.01, "큰 % y");
  const desc = zDeck.blocks.find((b) => nameOf(b).endsWith("|lead-desc"));
  assert.ok(desc && textsOf(desc).join("").includes("95.0%"), "두 줄 설명(주거지역 전체 95.0%)");
  assert.ok(/<a:rPr[^>]*b="1"[^>]*>(?:(?!<\/a:r>)[\s\S])*<a:t>95\.0%<\/a:t>/.test(desc), "설명 둘째 줄 끝의 %는 굵게");
  const named = (suffix) => zDeck.blocks.filter((b) => new RegExp(`\\|${suffix}-\\d+$`).test(nameOf(b)));
  assert.equal(named("parts-segment").length, rows.partsSegments.length, "구성 막대 칸 수");
  assert.equal(named("parts-site").length, 1, "대지 칸 테두리 1개");
  assert.equal(named("parts-gap").length, rows.partsSegments.length - 1, "칸 사이 흰 구분선");
  assert.equal(named("part-label").length, rows.parts.length, "항목 이름 수");
  assert.deepEqual(named("part-label").map((b) => textsOf(b)[0]), rows.parts.map((row) => row.labelText), "항목 이름은 fit의 줄임 글");
  assert.deepEqual(named("part-share").map((b) => textsOf(b)[0]), rows.parts.map((row) => row.shareText), "몫 글");
  // 배지 4개: 보이는 배지 + `+n`, `+n`은 CHIP.limit 색
  assert.ok(zf.fit.badgesMore > 0 && rows.badges.length >= 2, "배지 접기(전제)");
  const badgeTexts = rows.badges.map((b) => b.text);
  assert.equal(badgeTexts.at(-1), `+${zf.fit.badgesMore}`, "마지막 배지는 +n");
  rows.badges.forEach((badge, i) => {
    const label = zDeck.blocks.find((b) => nameOf(b).endsWith(`|badge-${i}`));
    assert.deepEqual(textsOf(label), [badge.text], `배지 ${i} 글`);
    near(rectOf(label).x, zf.geometry.keyCard.x + badge.rect.x, 0.01, `배지 ${i} x`);
    assert.equal(szOf(label), Math.round(zf.fit.chipPt * 100), `배지 ${i} 글자 크기`);
  });
  const moreBg = zDeck.blocks.find((b) => nameOf(b).endsWith(`|badge-${rows.badges.length - 1}-bg`));
  assert.match(moreBg, new RegExp(`<a:srgbClr val="${CHIP.limit.fill}"`), "+n 칩은 한계(limit) 색");
  assert.ok(zf.notes.includes(zf.fit.badgesFolded[0]), "접힌 배지 글은 주석 목록에 합쳐진다");
  assert.ok(zDeck.notes.includes(zf.fit.badgesFolded[0]), "접힌 배지 글은 발표자 노트에 있다");
}

// 해석 문장: 고친 요약이 있으면 그것
{
  // 해석 줄은 폭에 맞게 줄이 나뉘므로 공백을 뺀 글로 비교한다.
  const squash = (value) => value.replace(/\s+/g, "");
  const sentenceBlock = (deck, text) => deck.blocks.find((b) => nameOf(b).includes("column-sentence") && squash(textsOf(b).join("")) === squash(text));
  const edited = await deckOf(base.planOf({ ...base.tilePage, layout: "map-charts", summaryOverride: "사용자가 고친 요약 문장" }), images);
  assert.ok(sentenceBlock(edited, "사용자가 고친 요약 문장"), "고친 요약을 해석 자리에");
  assert.ok(!sentenceBlock(edited, base.view.sentence), "고친 요약이 있으면 view.sentence는 없다");
  assert.ok(sentenceBlock(charts, base.view.sentence), "기본은 view.sentence 그대로");
}

// I3: 아주 긴 고친 요약(600자, 24 pt) — 화면과 PPT가 줄 수에 맞게 자른 똑같은 글을 그리고, PPT 글상자는 열 밖으로 나가지 않는다.
{
  const long = "낮은 층 건물이 대부분이고 높은 건물은 일부이며 반경 안 분포는 대지 가까이에 몰려 있다 ".repeat(12).slice(0, 600);
  assert.equal(long.length, 600);
  const slide = base.planOf({ ...base.tilePage, layout: "map-charts", summaryOverride: long, fontSizes: { summary: 24 } });
  const f = pageFrameFor(slide);
  const lines = f.sentence.lines;
  const squashed = (value) => value.replace(/\s+/g, "");
  assert.ok(lines.length <= 3 && lines.at(-1).endsWith("…") && squashed(long).startsWith(squashed(lines.join("")).slice(0, -1)), "최대 3줄로 자르고 …로 닫는다");
  const deck = await deckOf(slide, images);
  const block = deck.blocks.find((b) => textsOf(b).join("") === lines.join(""));
  assert.ok(block, "PPT는 자른 글 그대로를 그린다");
  assert.deepEqual(textsOf(block), lines, "줄은 fit이 나눈 그대로");
  assert.ok(!deck.blocks.some((b) => textsOf(b).join("").includes(long.slice(0, 200))), "PPT에 600자 원문이 없다");
  assert.doesNotMatch(block, /normAutofit|spAutoFit/, "PPT 해석 문장은 자동 맞춤에 기대지 않는다");
  const r = rectOf(block);
  const col = f.geometry.column.rect;
  assert.ok(r.y + r.h <= col.y + col.h + 0.01 && r.x + r.w <= col.x + col.w + 0.01, "해석 글상자는 열 밖으로 나가지 않는다");
  assert.equal(szOf(block), Math.round(f.sentence.pt * 100), "해석 pt = 맞춤 값");
}

// 끈 레이어: 그래프 합계는 걸러진 모델(10동)
{
  const hiddenSlide = base.planOf({ ...base.tilePage, layout: "map-charts", frame: { ...defaultFrame(), hiddenLayers: ["floors_9_14"] } });
  const hidden = await deckOf(hiddenSlide, images);
  const hf = pageFrameFor(hiddenSlide);
  const expected = analysisCharts(modelWithHiddenLayers(chartsSlide.map, ["floors_9_14"]));
  assert.equal(expected.total, 10);
  assert.equal(hf.charts.total, 10, "장 계산 묶음의 그래프 자료 = 걸러진 모델");
  const textsFor = (c, f2) => [...compositionShapes(c.composition, f2.chart1, f2.chartScale, c.titles.composition), ...distanceShapes(c.distance, c.radiusM, f2.chart2, f2.chartScale, c.titles.distance)].filter((s) => s.kind === "text").map((s) => s.text).sort();
  const pptHidden = hidden.blocks.filter((b) => nameOf(b).startsWith("GRP|chart-")).flatMap(textsOf).sort();
  assert.deepEqual(pptHidden, textsFor(expected, hf), "PPT 그래프 글자 = 걸러진 모델의 그래프 글자");
  assert.notDeepEqual(textsFor(expected, hf), textsFor(mapCharts, frame), "걸러진 모델과 걸러지지 않은 모델의 그래프가 다르다(비교가 헛돌지 않는다)");
}

// 그래프 자료가 없는 map-charts 쪽은 ①로(빈 그래프 카드를 남기지 않는다): 그래프 도형 0개, 핵심 숫자 카드 1개
{
  const empty = { ...base.view, map: { ...base.view.map, features: [], polygons: [], total: 0 } };
  const views = new Map([[base.result.tileId, empty]]);
  const lost = await deckOf(base.planOf({ ...base.tilePage, layout: "map-charts" }, views), images);
  assert.doesNotMatch(lost.xml, /GRP\|chart-/, "자료가 없으면 그래프 도형이 없다");
  assert.equal(lost.groups.filter((g) => g.name === "핵심 숫자").length, 1, "핵심 숫자 카드는 1개");
  assert.ok(!lost.groups.some((g) => g.name === "열 바탕"), "열도 없다");
  // 저장된 map-charts 쪽의 그래프 자료가 계획 뒤에 사라진 경우도 같다(PPT가 스스로 ①로 내린다)
  const stale = { ...chartsSlide, map: { ...chartsSlide.map, features: [], polygons: [], total: 0 }, view: empty };
  assert.equal(stale.page.layout, "map-charts", "저장 판정은 map-charts(전제)");
  const staleDeck = await deckOf(stale, images);
  assert.doesNotMatch(staleDeck.xml, /GRP\|chart-/, "그래프 도형 0개");
  assert.equal(staleDeck.groups.filter((g) => g.name === "핵심 숫자").length, 1, "핵심 숫자 카드 1개");
  const f = pageFrameFor(stale);
  near(pictures(staleDeck.xml)[0].w, f.geometry.map.w, 0.01, "지도는 전체 폭");
  near(f.geometry.map.w, 13.333, 0.01, "전체 폭(전제)");
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

// M-8: 카드 칸 넘침은 fit이 미리 자른 글을 화면·PPT가 그대로 그린다. 화면은 잘린 글마다 title에 전문을 단다.
{
  const { keyFigureFit } = await import("../../lib/v2/report/key-figure-fit.ts");
  const { drawKeyFigureCard } = await import("../../lib/v2/report/key-figure-pptx.ts");
  const { KeyFigureCard } = await import("../../components/v2/report/key-figure-card.tsx");
  const longQ = "반경 안에서 지금 가장 가까운 지하철역과 그 역까지 걸어서 가는 데 걸리는 시간은 얼마인가";
  const longSub = "원천 높이와 층수 추정을 함께 쓴 값이라 실제와 다를 수 있고 확인되지 않은 건물은 3 m 가정이 적용되었습니다 그래서 크게 다를 수 있습니다";
  const longSentence = "이 문장은 아주 길어서 세 줄에 다 들어가지 않습니다 ".repeat(8);
  const zoneLabel = "제3종일반주거지역과 그 주변의 아주 긴 이름을 가진 지구단위계획구역";
  const figures = [
    { question: longQ, answer: { value: "26.4m", kind: "number" }, sub: longSub, stats: [{ value: "1,234,567,890,123,456,789만원", label: "값" }, { value: "73%", label: "비율" }] },
    { question: "대지 용도지역", answer: { value: "제3종일반주거지역", kind: "name" }, stats: [{ value: "60.0%", label: "같은 용도지역" }, { value: "95.0%", label: "주거지역" }], parts: [{ label: zoneLabel, share: 60, color: "#F2C94C", site: true }, { label: "일반상업지역", share: 40, color: "#E2574C" }] },
  ];
  const draw = (figure) => {
    const fit = keyFigureFit({ figure, badges: ["일부 자료만 집계"], grades: [], filterLine: null, sentence: longSentence, width: 3.125, columns: 2, summaryPt: 13 });
    const view = { keyFigure: figure, color: "#2f6fdb", badges: [{ text: "일부 자료만 집계", tone: "limit" }], grades: [] };
    const markup = renderToStaticMarkup(createElement(KeyFigureCard, { styles: {}, view, fit, rect: { x: 0, y: 0, w: 3.125, h: fit.height }, unit: 96 }));
    const tagOf = (part) => new RegExp(`<[a-z]+ [^>]*data-part="${part}"[^>]*>[^<]*`).exec(markup)?.[0] ?? "";
    const recorded = [];
    const recorder = { addShape: () => recorder, addText: (value, o) => { recorded.push({ value, o }); return recorder; } };
    drawKeyFigureCard(recorder, { view, fit, rect: { x: 1, y: 1, w: 3.125, h: fit.height }, tag: (part) => `T|${part}` });
    const textOf = (part) => { const hit = recorded.find((r) => r.o.objectName === `T|${part}`); return typeof hit?.value === "string" ? hit.value : (hit?.value ?? []).map((run) => run.text).join("\n"); };
    return { fit, tagOf, textOf };
  };
  {
    const { fit, tagOf, textOf } = draw(figures[0]);
    assert.ok(tagOf("key-question").includes(fit.questionText) && tagOf("key-question").includes(`title="${longQ}"`), "질문: 자른 글 + title 전문");
    assert.ok(tagOf("key-stat-value").includes(fit.statValueText[0]) && tagOf("key-stat-value").includes(`title="${figures[0].stats[0].value}"`), "보조 숫자 값: 자른 글 + title 전문");
    assert.ok(tagOf("key-sub").includes(`title="${fit.subFull}"`), "보조 줄: title 전문");
    assert.ok(tagOf("key-sentence").includes(`title="${fit.sentenceFull}"`), "해석 줄: title 전문");
    assert.equal(textOf("question"), fit.questionText, "PPT 질문 = fit 자른 글");
    assert.equal(textOf("stat-value-0"), fit.statValueText[0], "PPT 보조 숫자 값 = fit 자른 글");
    assert.equal(textOf("sub"), fit.subLines.join("\n"), "PPT 보조 줄 = fit 줄");
    assert.equal(textOf("sentence"), fit.sentenceLines.join("\n"), "PPT 해석 줄 = fit 줄");
  }
  {
    const { fit, tagOf, textOf } = draw(figures[1]);
    assert.ok(tagOf("key-part-label").includes(fit.rows.parts[0].labelText) && tagOf("key-part-label").includes(`title="${zoneLabel}"`), "구성 이름: 자른 글 + title 전문");
    assert.equal(textOf("part-label-0"), fit.rows.parts[0].labelText, "PPT 구성 이름 = fit 자른 글");
  }
}

// M-7: 긴 제목은 한 줄로 잘려 제목 칩 안에 있고, PPT는 화면과 같은 자른 글을 그린다(종류 칩도 칩 밖으로 나가지 않는다).
{
  const long = "서울특별시 강남구 대치동 503번지 일대 매매 실거래가 분포와 단지별 평균·중앙값 비교 분석 결과";
  const slide = base.planOf({ ...base.tilePage, layout: "map-key", titleOverride: long });
  const f = pageFrameFor(slide);
  assert.ok(f.title.titleClipped && f.title.text.endsWith("…"), "전제: 제목이 잘린다");
  const deck = await deckOf(slide);
  const part = (name) => deck.blocks.find((b) => nameOf(b) === `GRP|panel-title|제목|${name}`);
  const plate = rectOf(part("plate"));
  const title = part("text");
  assert.deepEqual(textsOf(title), [f.title.text], "PPT 제목 글 = 화면이 그리는 자른 글");
  const kind = rectOf(part("kind-bg"));
  const text = rectOf(title);
  assert.ok(text.x + text.w <= plate.x + plate.w + 0.01 && kind.x + kind.w <= plate.x + plate.w + 0.01, "제목 글·종류 칩이 제목 칩 안");
  assert.ok(text.x + text.w <= kind.x + 0.01, "제목 글이 종류 칩을 덮지 않는다");
  // T18: 잘린 제목의 전문은 마우스 title에만 두지 않고 스크린리더용 aria-label로도 둔다
  assert.match(render(slide), new RegExp(`<h3[^>]*aria-label="${f.title.fullText}"`), "잘린 제목 전문이 aria-label에 있다");
}

// T18: 카드 해석 줄이 잘리면 전문이 스크린리더용 숨은 글(srOnly)로 같이 있고, 잘린 쪽은 aria-hidden이다.
{
  const sentence = "낮은 층 건물이 대부분이고 높은 건물은 일부다 ".repeat(8).trim();
  const longViews = new Map([[base.result.tileId, { ...base.view, sentence }]]);
  const slide = base.planOf({ ...base.tilePage, layout: "map-key" }, longViews);
  const f = pageFrameFor(slide);
  assert.ok(f.fit.sentenceClipped, "전제: 해석 줄이 카드 안에서 잘린다");
  const html = render(slide);
  assert.match(html, /data-part="key-sentence"[^>]*aria-hidden="true"/, "잘린 해석 줄은 aria-hidden");
  assert.ok(html.includes(`<span class="srOnly">${f.fit.sentenceFull}</span>`), "해석 전문이 srOnly로 있다");
}

// T21: 표지 타일 목록은 줄이 많아도 마지막 줄까지 오른쪽 판 안에 든다(와이드 30줄이 판 밖으로 잘리던 문제). 화면 목록 상자도 줄 합 이상이다.
{
  const { coverLayout } = await import("../../lib/v2/report/pptx-kit.ts");
  for (const format of ["wide", "a4", "a3"]) {
    for (const n of [1, 10, 15, 30, 40]) {
      const l = coverLayout({ address: "서울특별시 강남구 대치동 503", metricCount: 4, lineCount: n, incomplete: false }, format);
      const last = l.row(n - 1);
      assert.ok(last.y + last.h <= l.right.y + l.right.h + 1e-9, `${format} ${n}줄: 마지막 줄 아래 ${last.y + last.h} ≤ 판 아래 ${l.right.y + l.right.h}`);
      assert.ok(l.right.h - 0.67 >= n * l.rowH - 1e-9, `${format} ${n}줄: 화면 목록 상자 ${l.right.h - 0.67} ≥ 줄 합 ${n * l.rowH}`);
    }
  }
}

// 표지 목록은 카드 큰 답(keyFigure)을 쓰고, 카드가 없을 때만 headline을 쓴다(「반경 교차면적: 기타 …」 같은 거짓 인상 숫자 방지).
{
  const views = new Map([[base.result.tileId, { ...base.view, headline: { value: "10,567,076㎡", label: "반경 교차면적: 기타" } }]]);
  const coverOf = (v) => planReportDoc({ ...EMPTY_REPORT_DOC, pages: [{ ...base.tilePage, id: "cover", kind: "cover" }, base.tilePage] }, v, { ...base.ctx ?? { summary: toSummaryView(GODEOK_SUMMARY, [base.result]), analysisDate: "2026-10-27" }, views: v }).find((s) => s.kind === "cover");
  assert.equal(coverOf(views).lines[0].text, "1~4층 건물", "표지 목록 = 카드 큰 답");
  const noCard = new Map([[base.result.tileId, { ...views.get(base.result.tileId), keyFigure: null }]]);
  assert.equal(coverOf(noCard).lines[0].text, "반경 교차면적: 기타 10,567,076㎡", "카드가 없으면 headline");
}

console.log("✓ v2 analysis page pptx");
