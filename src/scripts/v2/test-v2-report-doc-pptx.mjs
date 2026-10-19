import assert from "node:assert/strict";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { layoutRects, slideSize } = await import("../../lib/v2/report/pptx-kit.ts");

assert.equal(typeof slideSize, "function", "판형별 slideSize가 공개되어야 한다");
assert.equal(typeof layoutRects, "function", "보고서 layoutRects가 공개되어야 한다");
assert.equal(slideSize("wide").w, 13.333, "wide 판형 폭");
assert.equal(slideSize("wide").h, 7.5, "wide 판형 높이");
assert.equal(slideSize("a3").w, 15120000 / 914400, "A3 XML 폭과 일치하는 판형 폭");
assert.equal(slideSize("a3").h, 10692000 / 914400, "A3 XML 높이와 일치하는 판형 높이");
assert.ok(layoutRects("numbers-first", "a3").map.x > 0.5, "numbers-first 지도 프레임은 오른쪽에 있어야 한다");
assert.ok(layoutRects("side-by-side", "a4").second, "side-by-side 두 번째 지도 프레임");

const source = GODEOK_RESULTS.find((result) => result.tileCode === "D04");
assert.ok(source, "D04 fixture가 필요하다");
const view = toTileView(source);
const base = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, [source]),
  views: new Map([[source.tileId, view]]),
  board: (await import("../../lib/v2/ui/board-state.ts")).initBoard([source]),
  analysisDate: "2026-10-19",
}).find((slide) => slide.kind === "tile" && slide.view.code === "D04");
assert.ok(base, "D04 PPT fixture plan이 필요하다");

const frame = {
  ...defaultFrame(),
  scaleDenominator: 2500,
  locked: true,
  hiddenLayers: ["건물"],
  labelRule: "all-visible",
  legend: { order: [], hidden: ["건물"], visibleOnly: true, placement: "below" },
  decorations: { north: true, scaleBar: true, locator: true },
};
const page = {
  id: "p-D04-format",
  layout: "numbers-first",
  panels: {},
  textBoxes: [{ id: "memo", x: 0.08, y: 0.82, w: 0.42, h: 0.08, text: "검토 메모", pt: 14 }],
  notes: "발표자 메모",
  kind: "tile",
  tileId: source.tileId,
  part: { type: "single" },
  settings: { face: "front", callout: "overview" },
  frame,
};
const a3Plan = { ...base, no: 1, total: 1, key: "t-D04", format: "a3", page, notes: page.notes };
const widePlan = { ...a3Plan, format: "wide", page: { ...page, layout: "map-summary" } };

const xmlOf = async (bytes) => {
  const zip = await JSZip.loadAsync(bytes);
  const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
  assert.ok(slide, "첫 슬라이드 XML");
  return { zip, slide };
};

const a3 = await xmlOf(await renderReportPptx([a3Plan]));
const wide = await xmlOf(await renderReportPptx([widePlan]));
const presentation = await a3.zip.file("ppt/presentation.xml")?.async("string");
assert.match(presentation ?? "", /<p:sldSz cx="15120000" cy="10692000"/, "A3 발표자 정의");
assert.match(a3.slide, /검토 메모/, "편집 가능한 글상자 텍스트");
assert.match(a3.slide, /GRP\|map-D04-/, "A3 지도 도형");
for (const hiddenLabel of ["1970년대 이전", "1980년대", "1990년대", "2000년대", "2010년대", "2020년 이후"]) {
  assert.doesNotMatch(a3.slide, new RegExp(`GRP\\|map-D04-[^\\"]*${hiddenLabel}`), "숨긴 건물 레이어가 지도·범례에 남지 않는다");
}
assert.match(a3.slide, /\|축척\|/, "A3 축척 장식");
assert.match(a3.slide, /\|위치도\|/, "A3 위치도 장식");
const mapOffset = a3.slide.match(/<p:cNvPr id="\d+" name="GRP\|map-D04-[^"]*"[\s\S]*?<a:off x="(\d+)"/);
assert.ok(mapOffset && Number(mapOffset[1]) / 914400 > slideSize("a3").w * 0.5, "numbers-first 지도는 오른쪽 프레임에 배치된다");

const noteNames = Object.keys(a3.zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
const notes = (await Promise.all(noteNames.map((name) => a3.zip.file(name).async("string")))).join("|");
assert.match(notes, /발표자 메모/, "발표자 메모가 speaker notes로 전달된다");
const scaleText = (xml) => [...xml.matchAll(/<p:grpSp>[\s\S]*?name="([^"]*map-D04-scale[^"]*)"[\s\S]*?<a:t>([^<]*)<\/a:t>[\s\S]*?<\/p:grpSp>/g)].map((match) => match[2]).join("|");
assert.equal(scaleText(a3.slide), scaleText(wide.slide), "잠긴 지도는 판형이 바뀌어도 축척이 같다");

console.log("v2 report doc PPTX tests passed");
