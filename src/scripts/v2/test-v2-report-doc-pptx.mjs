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
const groupBlocks = (xml) => [...xml.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)].map((match) => match[0]);
const groupGeometry = (xml, name) => {
  const group = groupBlocks(xml).find((block) => block.match(/<p:cNvPr id="\d+" name="([^"]*)"/)?.[1] === name);
  if (!group) return null;
  const off = group.match(/<p:grpSpPr>[\s\S]*?<a:xfrm>[\s\S]*?<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = group.match(/<p:grpSpPr>[\s\S]*?<a:xfrm>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!off || !ext) return null;
  return { x: Number(off[1]), y: Number(off[2]), w: Number(ext[1]), h: Number(ext[2]) };
};
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const locatorGroup = groupGeometry(a3.slide, "위치도");
const summaryGroup = groupGeometry(a3.slide, "요약");
assert.ok(locatorGroup, "A3 위치도 그룹 bbox");
assert.ok(summaryGroup, "A3 요약 plate 그룹 bbox");
assert.equal(overlaps(locatorGroup, summaryGroup), false, "위치도 group does not intersect summary plate");
const mapOffset = a3.slide.match(/<p:cNvPr id="\d+" name="GRP\|map-D04-[^"]*"[\s\S]*?<a:off x="(\d+)"/);
assert.ok(mapOffset && Number(mapOffset[1]) / 914400 > slideSize("a3").w * 0.5, "numbers-first 지도는 오른쪽 프레임에 배치된다");

const noteNames = Object.keys(a3.zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
const notes = (await Promise.all(noteNames.map((name) => a3.zip.file(name).async("string")))).join("|");
assert.match(notes, /발표자 메모/, "발표자 메모가 speaker notes로 전달된다");
const scaleText = (xml) => [...xml.matchAll(/<p:grpSp>[\s\S]*?name="([^"]*map-D04-scale[^"]*)"[\s\S]*?<a:t>([^<]*)<\/a:t>[\s\S]*?<\/p:grpSp>/g)].map((match) => match[2]).join("|");
// 막대 길이는 화면과 같은 최대(134u) 안에서 판형마다 1·2·5×10ⁿ m로 고르므로 라벨은 달라질 수 있다. 같아야 하는 것은 축척(라벨 m ÷ 막대 실제 길이)이다.
const scaleRatio = (xml) => {
  const bar = [...xml.matchAll(/<p:(?:sp|cxnSp)>([\s\S]*?)<\/p:(?:sp|cxnSp)>/g)].map((match) => match[1]).find((block) => /\|축척\|bar/.test(block));
  const emu = Number(bar?.match(/<a:ext cx="(\d+)"/)?.[1]);
  const label = scaleText(xml).trim().toLowerCase();
  const meters = label.endsWith("km") ? Number.parseFloat(label) * 1000 : Number.parseFloat(label);
  assert.ok(emu > 0 && meters > 0, `축척 막대·라벨: ${emu} EMU / ${label}`);
  return meters / ((emu / 914400) * 0.0254);
};
assert.ok(Math.abs(scaleRatio(a3.slide) - scaleRatio(wide.slide)) / scaleRatio(wide.slide) < 0.05, "잠긴 지도는 판형이 바뀌어도 축척이 같다");

// M-4: 바탕 이름 라벨은 위치도·옮긴 방위표를 피한다(도형 이름의 바탕 라벨 글상자 중심이 두 상자 안에 없다)
{
  const { toUtmk } = await import("../../lib/v2/crs.ts");
  const { mapBaseFromScene } = await import("../../lib/v2/ui/basemap.ts");
  const { addEditableMap } = await import("../../lib/v2/report/map-pptx.ts");
  const LNG = 127.0636;
  const LAT = 37.4979;
  const [ox, oy] = toUtmk([LNG, LAT]);
  const places = [];
  for (let i = 0; i < 7; i += 1) for (let j = 0; j < 5; j += 1) places.push({ name: `${"가나다라마바사"[i]}${"동서남북중"[j]}동`, kind: "dong", x: -420 + i * 140, y: -300 + j * 150 });
  const scene = {
    version: "v2-scene@2", analysisId: "a-m4", manifestHash: "h",
    origin: { epsg: "EPSG:5179", x: ox, y: oy, lng: LNG, lat: LAT }, radiusM: 500, ground: { kind: "flat" }, site: null,
    buildings: [{ id: "b0", name: null, sublabel: null, labelPriority: 0, rings: [[[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]], baseZ: null, heightM: 9, heightMethod: "source", floorsAbove: 3, useCode: null, approvalDate: null }],
    parcels: [],
    context: { roads: [{ points: [[-450, -60], [450, -60]], widthM: 20, hierarchy: "간선", name: "테헤란로" }], green: [], greenKinds: [], water: [], rail: [], stations: [], places },
    counts: { buildingsTotal: 1, buildingsIncluded: 1, parcelsTotal: 0, parcelsIncluded: 0 }, sources: [], limitations: [],
  };
  const model = { center: [LNG, LAT], radiusM: 500, features: [], total: 0, notes: [], tileCode: "A04", base: mapBaseFromScene(scene) };
  const mapPlan = { ...base, map: model };
  const draw = (reportFrame, style = mapPlan.style) => {
    const calls = [];
    const recorder = new Proxy({}, { get: (_, method) => (...args) => { calls.push({ method: String(method), args }); } });
    addEditableMap(recorder, mapPlan, model, { style, format: "wide", reportFrame, basemap: "vector" });
    return calls;
  };
  const named = (calls, part) => calls.filter((c) => typeof c.args[1]?.objectName === "string" && c.args[1].objectName.includes(part)).map((c) => c.args[1]);
  const labelsOf = (calls) => named(calls, "map-base-label-").filter((o) => o.objectName.endsWith("|text"));
  const center = (o) => [o.x + o.w / 2, o.y + o.h / 2];
  const inside = ([px, py], o) => px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h;
  const SLIDE_W = slideSize("wide").w;
  const SLIDE_H = slideSize("wide").h;

  const plain = draw({ ...defaultFrame(), decorations: { north: true, scaleBar: true, locator: false } });
  assert.ok(labelsOf(plain).length >= 8, `촘촘한 바탕에서 라벨이 충분히 남는다: ${labelsOf(plain).length}`);

  const withLocator = draw({ ...defaultFrame(), decorations: { north: true, scaleBar: true, locator: true } });
  const [locator] = named(withLocator, "|위치도|frame");
  assert.ok(locator, "위치도 틀");
  for (const label of labelsOf(withLocator)) assert.ok(!inside(center(label), locator), `바탕 라벨 ${label.objectName} 이 위치도 안에 있다`);

  // 라벨 하나의 한가운데로 방위표를 옮긴다(저장 패널은 쪽 비율)
  const target = labelsOf(plain).find((o) => !o.rotate);
  assert.ok(target, "방위표 아래로 옮길 라벨");
  const [tx, ty] = center(target);
  const w = 0.05;
  const h = 0.09;
  const panels = { north: { x: tx / SLIDE_W - w / 2, y: ty / SLIDE_H - h / 2, w, h } };
  const movedNorth = draw({ ...defaultFrame(), decorations: { north: true, scaleBar: true, locator: false } }, { ...mapPlan.style, panels });
  const [bg] = named(movedNorth, "|방위표|bg");
  assert.ok(bg && inside([tx, ty], bg), "방위표가 옮긴 자리에 있다");
  assert.ok(!labelsOf(movedNorth).some((o) => o.objectName === target.objectName), "옮긴 방위표 아래의 바탕 라벨은 버린다");
  for (const label of labelsOf(movedNorth)) assert.ok(!inside(center(label), bg), `바탕 라벨 ${label.objectName} 이 방위표 안에 있다`);
}

console.log("v2 report doc PPTX tests passed");
