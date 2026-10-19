import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { SLIDE, slideCalloutAvoidance, slideLegend, slidePanelRects, slideReserved, slideSiteX, terrainSectionLayout } = await import("../../lib/v2/ui/overlay-layout.ts");
const { terrainSectionBands, terrainSectionMapStyle } = await import("../../lib/v2/ui/terrain-section.ts");
const { calloutFrame, PX } = await import("../../lib/v2/ui/callout-layout.ts");
const { buildMapScene, mapLabelEntries, northArrowBox, scaleBarBox } = await import("../../lib/v2/ui/map-scene.ts");
const { metersPerPixel, slideViewport } = await import("../../lib/v2/ui/map-projection.ts");

const source = GODEOK_RESULTS[0];
const section = (axis) => ({
  axis,
  from: [0, 0],
  to: [120, 0],
  samples: Array.from({ length: 25 }, (_, index) => ({ d: index * 5, z: 100 + Math.sin(index / 4) * 4 })),
  siteSpan: [35, 85],
  crossings: [
    { d: 60, kind: "retaining", heightM: 4.2 },
    { d: 85, kind: "fence", heightM: null },
  ],
});
const d17 = structuredClone({
  ...source,
  tileId: "t-D17-t10-ppt",
  tileCode: "D17",
  tileType: "analysis",
  status: "complete",
  presentation: {
    ...source.presentation,
    features: [],
    featuresTotal: 0,
    lines: [
      { layer: "terrain_section_a", points: [[127.145, 37.555], [127.163, 37.555]], label: "A–A′" },
      { layer: "terrain_section_b", points: [[127.1535, 37.545], [127.1535, 37.565]], label: "B–B′" },
      { layer: "contour", points: [[127.145, 37.552], [127.163, 37.552]], label: "표고 25m" },
      { layer: "contour", points: [[127.145, 37.556], [127.150, 37.556]], label: "표고 75m" },
      { layer: "contour", points: [[127.158, 37.550], [127.163, 37.550]], label: "표고 50m" },
      { layer: "cut_fill", points: [[127.146, 37.548], [127.160, 37.548]], label: "절성토" },
      { layer: "fence", points: [[127.146, 37.560], [127.160, 37.560]], label: "울타리" },
      { layer: "retaining_wall", points: [[127.145, 37.562], [127.150, 37.562]], label: "옹벽" },
    ],
    linesTotal: 8,
    polygons: [
      ...(source.presentation.polygons ?? []),
      { layer: "topo_coverage", rings: [[[127.145, 37.545], [127.163, 37.545], [127.163, 37.565], [127.145, 37.565], [127.145, 37.545]]] },
    ],
    terrainSections: { A: section("EW"), B: section("NS") },
  },
});

let board = initBoard([d17]);
board = boardReducer(board, { type: "terrainSection", id: d17.tileId, section: "B" });
const view = toTileView(d17);
const plan = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, [d17]),
  views: new Map([[d17.tileId, view]]),
  board,
  analysisDate: "2026-10-19",
});
const d17Slide = plan.find((slide) => slide.kind === "tile" && slide.view.code === "D17");
assert.ok(d17Slide);
assert.equal(d17Slide.terrainSection, "B");

// D17 단면은 preview와 PPT가 같은 summary 기반 rect를 쓰고, 지도·범례·콜아웃 열·반경 원을 침범하지 않는다.
assert.ok(d17Slide.map, "D17 section layout needs a map");
// 실제 slide26.xml의 범례 판(top 3.58in)을 보존한 8-callout fixture.
const artifactLegendPanel = { x: 0.3 / SLIDE.w, y: 3.58 / SLIDE.h, w: 4.4 / SLIDE.w, h: 3.38 / SLIDE.h };
const fixtureSlide = { ...d17Slide, style: { ...d17Slide.style, panels: { ...(d17Slide.style.panels ?? {}), legend: artifactLegendPanel } } };
const previewPanels = slidePanelRects(fixtureSlide.style, true, slideLegend(fixtureSlide.map, true).rect);
const d17Panels = previewPanels;
const previewLayout = terrainSectionLayout(d17Panels);
const pptxLayout = terrainSectionLayout(d17Panels);
assert.ok(previewLayout && pptxLayout);
assert.deepEqual(previewLayout.rect, pptxLayout.rect, "preview/PPTX D17 section rect is shared");
assert.equal(previewLayout.mode, "summary", "default D17 layout uses the summary column");
assert.ok(previewLayout.summary && previewLayout.rect.x >= previewLayout.summary.x, "section stays in the summary column");
assert.ok(previewLayout.rect.h - 0.45 - 0.66 >= 1.2, "PPTX profile plot is at least 1.2in high");

const pxPerInch = 960 / SLIDE.w;
const asBox = (rect) => ({ x0: rect.x * pxPerInch, y0: rect.y * pxPerInch, x1: (rect.x + rect.w) * pxPerInch, y1: (rect.y + rect.h) * pxPerInch });
const intersects = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const sectionBox = asBox(previewLayout.rect);
const legendRect = previewPanels.legend;
assert.ok(legendRect, "D17 section layout keeps the legend panel");
assert.ok(previewLayout.summary, "D17 section layout keeps the summary panel");
const previewBoxes = [
  ["legend", asBox(legendRect)],
  ["section", sectionBox],
  ["summary", asBox(previewLayout.summary)],
];
for (let i = 0; i < previewBoxes.length; i += 1) {
  for (let j = i + 1; j < previewBoxes.length; j += 1) {
    assert.equal(intersects(previewBoxes[i][1], previewBoxes[j][1]), false, `${previewBoxes[i][0]} and ${previewBoxes[j][0]} rects do not intersect`);
  }
}
const summaryX = previewPanels.summary.x * pxPerInch;
const rightInset = Math.max(0, 960 - summaryX + SLIDE.edge * pxPerInch * 0.5);
const columns = calloutFrame({ W: 960, H: 540, m: PX, edge: 4, top: 4, bottom: 540, rightInset, perSide: 100, rows: 3, variant: "compact", maxFill: 0.8 });
for (const column of [columns.left, columns.right]) {
  assert.equal(intersects(sectionBox, { x0: column.x0, y0: column.top, x1: column.x1, y1: column.bottom }), false, "section does not intersect a callout column");
}
const mapAvoid = slideReserved(pxPerInch, { info: true, titleRect: previewPanels.title, infoRect: previewPanels.summary, legend: previewPanels.legend, terrainSection: previewLayout.rect });
const calloutAlignment = slideCalloutAvoidance(previewPanels, []);
const calloutTop = calloutAlignment.calloutTop * pxPerInch;
const calloutLeftBottom = calloutAlignment.calloutLeftBottom === undefined ? undefined : calloutAlignment.calloutLeftBottom * pxPerInch;
const northY = calloutTop + 13 * Math.min(1.5, Math.max(1, 540 / 360));
const bottomInset = SLIDE.stripH * pxPerInch;
const d17Viewport = slideViewport(fixtureSlide.map, fixtureSlide.style, { width: 960, height: 540, siteX: slideSiteX(fixtureSlide.style, true), siteY: previewLayout.mapSiteY ?? 0.5, fill: previewLayout.mapFill ?? 0.8 });
const d17ScaleBox = scaleBarBox(960, 540, metersPerPixel(d17Viewport.center[1], d17Viewport.zoom), bottomInset, rightInset);
const northBox = northArrowBox(960, 540, rightInset, northY);
const sceneOptions = {
  model: fixtureSlide.map,
  width: 960,
  height: 540,
  activeLayer: fixtureSlide.map.basemap ?? "white",
  fill: 0.8,
  siteX: slideSiteX(fixtureSlide.style, true),
  rightInset,
  bottomInset,
  scale: true,
  showAutomaticLabels: true,
  calloutTop,
  ...(calloutLeftBottom === undefined ? {} : { calloutLeftBottom }),
  terrainSection: fixtureSlide.terrainSection,
  viewport: d17Viewport,
};
const chromeAvoid = [...mapAvoid, d17ScaleBox, ...(northBox ? [northBox] : [])];
const previewScene = buildMapScene({ ...sceneOptions, north: false, avoid: chromeAvoid });
const pptxScene = buildMapScene({ ...sceneOptions, north: northY, avoid: chromeAvoid });
const previewUnit = 90.75;
const previewWidth = Math.round(SLIDE.w * previewUnit);
const previewHeight = Math.round(SLIDE.h * previewUnit);
const previewLayoutUnit = 1.5 * (previewUnit / pxPerInch);
const previewInset = rightInset / pxPerInch * previewUnit;
const previewBottomInset = SLIDE.stripH * previewUnit;
const previewViewport = slideViewport(fixtureSlide.map, fixtureSlide.style, { width: previewWidth, height: previewHeight, siteX: slideSiteX(fixtureSlide.style, true), siteY: previewLayout.mapSiteY ?? 0.5, fill: previewLayout.mapFill ?? 0.8 });
const previewScaleBox = scaleBarBox(previewWidth, previewHeight, metersPerPixel(previewViewport.center[1], previewViewport.zoom), previewBottomInset, previewInset, false, undefined, previewLayoutUnit);
const previewCalloutTop = calloutAlignment.calloutTop * previewUnit;
const previewCalloutLeftBottom = calloutAlignment.calloutLeftBottom === undefined ? undefined : calloutAlignment.calloutLeftBottom * previewUnit;
const previewNorthBox = northArrowBox(previewWidth, previewHeight, previewInset, previewCalloutTop + 13 * previewLayoutUnit, previewLayoutUnit);
const previewRealScene = buildMapScene({ ...sceneOptions, width: previewWidth, height: previewHeight, rightInset: previewInset, bottomInset: previewBottomInset, calloutTop: previewCalloutTop, ...(previewCalloutLeftBottom === undefined ? {} : { calloutLeftBottom: previewCalloutLeftBottom }), north: false, viewport: previewViewport, layoutUnit: previewLayoutUnit, avoid: [...slideReserved(previewUnit, { info: true, titleRect: previewPanels.title, infoRect: previewPanels.summary, legend: previewPanels.legend, terrainSection: previewLayout.rect }), previewScaleBox, ...(previewNorthBox ? [previewNorthBox] : [])] });
const placementColumns = (scene) => scene.labelPlacements.map(({ entry, placed }) => [entry.key, placed.side]).sort(([a], [b]) => a.localeCompare(b));
assert.ok(previewScene.labelPlacements.length > 0, "D17 fixture has callouts to compare");
assert.deepEqual(placementColumns(previewScene), placementColumns(pptxScene), "D17 preview/PPTX callout column assignment matches");
assert.deepEqual(placementColumns(previewRealScene), placementColumns(pptxScene), "D17 browser preview/PPTX callout column assignment matches");
const placementOf = (scene, key) => scene.labelPlacements.find((placement) => placement.entry.key === key);
assert.equal(placementOf(previewRealScene, "line|terrain_section_b|1")?.placed.side, "R", "D17 browser preview keeps B–B′ in the right column");
assert.equal(placementOf(pptxScene, "line|terrain_section_b|1")?.placed.side, "R", "D17 PPTX keeps B–B′ in the right column");
assert.equal(placementOf(previewRealScene, "line|contour|4")?.placed.side, "R", "D17 browser preview keeps 표고 50m in the right column");
assert.equal(placementOf(pptxScene, "line|contour|4")?.placed.side, "R", "D17 PPTX keeps 표고 50m in the right column");
const assertChromeAvoidance = (name, scene, sceneNorthBox) => {
  assert.ok(scene.labelPlacements.length > 0, `${name} fixture has callouts`);
  for (const placement of scene.labelPlacements) {
    assert.equal(intersects(placement.box, scene.scaleBox), false, `${name} ${placement.entry.autoText ?? placement.entry.key} callout avoids scale bar`);
    if (sceneNorthBox) assert.equal(intersects(placement.box, sceneNorthBox), false, `${name} ${placement.entry.autoText ?? placement.entry.key} callout avoids north arrow`);
  }
};
assertChromeAvoidance("D17 preview", previewScene, northBox);
assertChromeAvoidance("D17 PPTX", pptxScene, northBox);
assertChromeAvoidance("D17 browser preview", previewRealScene, previewNorthBox);
assert.deepEqual(previewScene.scaleBox, pptxScene.scaleBox, "D17 preview/PPTX scale bar geometry matches");
assert.deepEqual(previewRealScene.scaleBox, previewScaleBox, "D17 browser preview uses the drawn scale bar geometry");
const mapScene = previewScene;
const mapCircle = { x0: mapScene.center[0] - mapScene.radiusPx, y0: mapScene.center[1] - mapScene.radiusPx, x1: mapScene.center[0] + mapScene.radiusPx, y1: mapScene.center[1] + mapScene.radiusPx };
assert.equal(intersects(sectionBox, mapCircle), false, "section does not intersect the map circle bounds");
assert.equal(intersects(sectionBox, mapScene.scaleBox), false, "preview/PPT map scale bar avoids the section");

// A01/A03도 실제 미리보기와 같은 반올림·패널·뷰포트·축척/방위 회피 입력으로 검사한다.
const previewSceneFor = (model, style = {}, pinnedKeys = []) => {
  const panels = slidePanelRects(style, true, slideLegend(model, true).rect);
  const width = Math.max(1, Math.round(SLIDE.w * pxPerInch));
  const height = Math.max(1, Math.round(SLIDE.h * pxPerInch));
  const callout = slideCalloutAvoidance(panels, []);
  const unit = width / SLIDE.w;
  const inset = panels.summary
    ? Math.max(0, width - panels.summary.x * unit + SLIDE.edge * unit * 0.5)
    : SLIDE.edge * unit;
  const sceneBottomInset = unit * SLIDE.stripH;
  const siteX = slideSiteX(style, true);
  const viewport = slideViewport(model, style, { width, height, siteX, siteY: 0.5, fill: 0.8 });
  const scale = scaleBarBox(width, height, metersPerPixel(viewport.center[1], viewport.zoom), sceneBottomInset, inset);
  const top = callout.calloutTop * unit;
  const north = northArrowBox(width, height, inset, top + 13 * Math.min(1.5, Math.max(1, height / 360)));
  const reserved = slideReserved(unit, { info: true, titleRect: panels.title, infoRect: panels.summary, legend: panels.legend });
  const scene = buildMapScene({
    model,
    width,
    height,
    activeLayer: model.basemap ?? "white",
    siteX,
    rightInset: inset,
    bottomInset: sceneBottomInset,
    scale: true,
    showAutomaticLabels: true,
    pinnedKeys,
    calloutTop: top,
    north: false,
    avoid: [...reserved, scale, ...(north ? [north] : [])],
    viewport,
  });
  return { scene, north };
};
for (const code of ["A01", "A03"]) {
  const fixture = GODEOK_RESULTS.find((result) => result.tileCode === code);
  assert.ok(fixture, `GODEOK fixture ${code} exists`);
  const model = toTileView(fixture).map;
  assert.ok(model, `GODEOK fixture ${code} has a map`);
  const pinnedKeys = mapLabelEntries(model).slice(0, 4).map((entry) => entry.key);
  const fixtureScene = previewSceneFor(model, {}, pinnedKeys);
  assertChromeAvoidance(code, fixtureScene.scene, fixtureScene.north);
}

const pptxWarnings = [];
const originalWarn = console.warn;
const originalError = console.error;
let bytes;
try {
  console.warn = (...args) => { pptxWarnings.push(args.join(" ")); };
  console.error = (...args) => { pptxWarnings.push(args.join(" ")); };
  bytes = await renderReportPptx([fixtureSlide]);
} finally {
  console.warn = originalWarn;
  console.error = originalError;
}
const colorFallbackWarnings = pptxWarnings.filter((message) => /not a valid scheme color|used instead/i.test(message));
assert.deepEqual(colorFallbackWarnings, [], "PPTX export does not fall back from an invalid color");
const outputDir = mkdtempSync(join(tmpdir(), "v2-t10-topo-section-pptx-"));
const outputPath = join(outputDir, "d17-topo-section.pptx");
writeFileSync(outputPath, bytes);
const zip = await JSZip.loadAsync(bytes);
const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
assert.ok(xml);
const shapeBlocks = [...xml.matchAll(/<p:(?:sp|cxnSp)>[\s\S]*?<\/p:(?:sp|cxnSp)>/g)].map((match) => match[0]);
const xmlRect = (block) => {
  const off = block.match(/<a:off x="(\d+)" y="(\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  assert.ok(off && ext, "PPTX shape has geometry");
  return { x: Number(off[1]) / 914400, y: Number(off[2]) / 914400, w: Number(ext[1]) / 914400, h: Number(ext[2]) / 914400 };
};
const xmlPxRect = (block) => {
  const rect = xmlRect(block);
  return { x0: rect.x * 72, y0: rect.y * 72, x1: (rect.x + rect.w) * 72, y1: (rect.y + rect.h) * 72 };
};
const nativeScaleBox = shapeBlocks.find((block) => block.includes('name="GRP|map-D17-scale|축척|bg"'));
const nativeBCallout = shapeBlocks.find((block) => block.includes('name="GRP|map-D17-label-line-terrain_section_b-1|라벨 · B–B′|box"'));
assert.ok(nativeScaleBox, "PPTX contains the native D17 scale bar box");
assert.ok(nativeBCallout, "PPTX contains the native D17 B–B′ callout box");
assert.equal(intersects(xmlPxRect(nativeBCallout), xmlPxRect(nativeScaleBox)), false, "native D17 B–B′ callout avoids the drawn scale bar");
assert.ok(xmlPxRect(nativeBCallout).x0 > 480, "native D17 B–B′ callout is in the right column");
const terrainPlate = shapeBlocks.find((block) => block.includes('name="GRP|terrain-section|B|plate"'));
assert.ok(terrainPlate, "PPTX terrain section plate exists");
const pptxRect = xmlRect(terrainPlate);
for (const key of ["x", "y", "w", "h"]) assert.ok(Math.abs(pptxRect[key] - pptxLayout.rect[key]) < 0.002, `PPTX ${key} matches preview geometry`);
const legendPlate = shapeBlocks.find((block) => block.includes('name="GRP|panel-legend|범례|plate"'));
assert.ok(legendPlate, "PPTX D17 section slide keeps the legend plate group");
const pptxLegendRect = xmlRect(legendPlate);
for (const key of ["x", "y", "w", "h"]) assert.ok(Math.abs(pptxLegendRect[key] - previewPanels.legend[key]) < 0.002, `PPTX ${key} matches preview legend geometry`);
const lineXml = (block) => block.match(/<a:ln(?:\s|>)[\s\S]*?<\/a:ln>/)?.[0] ?? "";
const legendItems = slideLegend(d17Slide.map, true).items;
const legendItemIndex = (label) => {
  const index = legendItems.findIndex((item) => item.label === label);
  assert.ok(index >= 0, `D17 legend contains ${label}`);
  return index;
};
const legendItemBlocks = (label) => {
  const index = legendItemIndex(label);
  return shapeBlocks.filter((block) => block.includes(`name="GRP|panel-legend|범례|plate|item-${index}|`));
};
const lineLegendItem = (label, dash) => {
  const blocks = legendItemBlocks(label);
  const line = blocks.find((block) => block.includes("|line\""));
  assert.ok(line, `${label} uses a PPTX line swatch`);
  assert.doesNotMatch(line, /prstGeom prst="ellipse"/, `${label} is not an ellipse swatch`);
  if (dash === "solid") assert.match(lineXml(line), /<a:prstDash val="solid"\/>/);
  else assert.match(lineXml(line), new RegExp(`<a:prstDash val="${dash}"\/>`));
};
lineLegendItem("단면 A–A′ (동서)", "solid");
lineLegendItem("단면 B–B′ (남북)", "dash");
lineLegendItem("등고선", "solid");
lineLegendItem("절성토", "dash");
lineLegendItem("울타리", "sysDot");
const coverageBlocks = legendItemBlocks("수치지형도 범위 · 밖은 기존 자료");
assert.ok(coverageBlocks.some((block) => block.includes("|polygon\"") && block.includes('<a:prstGeom prst="rect"')), "topo coverage uses a rectangle swatch");

// native PPT 지도도 preview와 같은 B 선택 스타일을 쓴다. A는 얇은 점선·45%이고 B는 굵은 실선이다.
const sectionGeometry = (label) => shapeBlocks.filter((block) => block.includes(`name="GRP|map-D17-legend-${label}`) && block.includes("|geometry"));
const aMapSection = sectionGeometry("단면 A–A′ (동서)");
const bMapSection = sectionGeometry("단면 B–B′ (남북)");
assert.equal(aMapSection.length, 1, "PPTX contains native A section line");
assert.equal(bMapSection.length, 1, "PPTX contains native B section line");
const aStyle = terrainSectionMapStyle("A", "B");
const bStyle = terrainSectionMapStyle("B", "B");
const pptWidthEmu = (width) => Math.round(width * 0.75 * 12700);
assert.match(aMapSection[0], new RegExp(`<a:ln w="${pptWidthEmu(aStyle.strokeWidth)}"`));
assert.match(lineXml(aMapSection[0]), /<a:prstDash val="dash"\/>/);
assert.match(lineXml(aMapSection[0]), /<a:alpha val="45000"\/>/);
assert.match(bMapSection[0], new RegExp(`<a:ln w="${pptWidthEmu(bStyle.strokeWidth)}"`));
assert.match(lineXml(bMapSection[0]), /<a:prstDash val="solid"\/>/);
assert.doesNotMatch(lineXml(bMapSection[0]), /<a:alpha val=/);

// 요약 글상자는 모두 줄인 summary rect 안에 있고, 단면의 공용 band끼리는 간격을 갖는다.
const summaryTextBlocks = shapeBlocks.filter((block) => block.includes('name="GRP|panel-summary|요약|plate"') && block.includes("<p:txBody>"));
assert.ok(summaryTextBlocks.length > 0, "PPTX summary has text boxes");
const summaryBox = pptxLayout.summary;
assert.ok(summaryBox);
for (const block of summaryTextBlocks) {
  const box = xmlRect(block);
  assert.ok(box.x >= summaryBox.x - 0.002 && box.y >= summaryBox.y - 0.002 && box.x + box.w <= summaryBox.x + summaryBox.w + 0.002 && box.y + box.h <= summaryBox.y + summaryBox.h + 0.002, "summary text box stays inside terrainLayout.summary");
}
const sectionBands = terrainSectionBands(pptxLayout.rect);
const bandNames = ["header", "plot", "axis", "table", "footer"];
for (let i = 0; i < bandNames.length; i += 1) {
  for (let j = i + 1; j < bandNames.length; j += 1) {
    assert.equal(intersects(sectionBands[bandNames[i]], sectionBands[bandNames[j]]), false, `${bandNames[i]} and ${bandNames[j]} bands do not intersect`);
  }
}
const bandContains = (block, band, label) => {
  const box = xmlRect(block);
  assert.ok(box.x >= band.x - 0.002 && box.y >= band.y - 0.002 && box.x + box.w <= band.x + band.w + 0.002 && box.y + box.h <= band.y + band.h + 0.002, `${label} stays in its section band`);
};
const terrainShape = (part) => shapeBlocks.filter((block) => block.includes(`name="GRP|terrain-section|B|${part}`));
for (const block of terrainShape("title")) bandContains(block, sectionBands.header, "section header");
for (const block of terrainShape("axis-label")) bandContains(block, sectionBands.axis, "section axis");
for (const block of terrainShape("summary")) bandContains(block, sectionBands.footer, "section footer");
for (const block of [...terrainShape("table-"), ...terrainShape("caveat")]) bandContains(block, sectionBands.table, "section table");
const caveatBlocks = terrainShape("caveat");
assert.equal(caveatBlocks.length, 1, "section caveat is present once");
const caveatSizes = [...caveatBlocks[0].matchAll(/<a:rPr[^>]*\bsz="(\d+)"/g)].map((match) => Number(match[1]));
assert.ok(caveatSizes.some((size) => size >= 700), "section caveat stays at or above 7pt");

assert.match(xml, /단면 B–B′ \(남북\)/);
assert.match(xml, /높이 미확인/);
assert.match(xml, /대지 고저차/);
assert.match(xml, /보간값\(추정\) · 현장 실측 아님/);
assert.match(xml, /terrain-section/);
assert.match(xml, /prstDash val="dash"/);

console.log(`✓ v2 topo section PPT XML (${outputPath})`);
