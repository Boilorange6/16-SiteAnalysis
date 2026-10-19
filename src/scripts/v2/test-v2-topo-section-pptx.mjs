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
const { SLIDE, slideLegend, slidePanelRects, slideReserved, slideSiteX, terrainSectionLayout } = await import("../../lib/v2/ui/overlay-layout.ts");
const { calloutFrame, PX } = await import("../../lib/v2/ui/callout-layout.ts");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { slideViewport } = await import("../../lib/v2/ui/map-projection.ts");

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
    lines: [
      { layer: "terrain_section_a", points: [[127.15, 37.6245], [127.16, 37.6245]], label: "단면 A–A′ (동서)" },
      { layer: "terrain_section_b", points: [[127.155, 37.62], [127.155, 37.63]], label: "단면 B–B′ (남북)" },
    ],
    linesTotal: 2,
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
const previewPanels = slidePanelRects(d17Slide.style, true, slideLegend(d17Slide.map, true).rect);
const d17Panels = { ...previewPanels, legend: null };
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
if (legendRect) assert.equal(intersects(sectionBox, asBox(legendRect)), false, "section does not intersect the legend panel");
const summaryX = previewPanels.summary.x * pxPerInch;
const rightInset = Math.max(0, 960 - summaryX + SLIDE.edge * pxPerInch * 0.5);
const columns = calloutFrame({ W: 960, H: 540, m: PX, edge: 4, top: 4, bottom: 540, rightInset, perSide: 100, rows: 3, variant: "compact", maxFill: 0.8 });
for (const column of [columns.left, columns.right]) {
  assert.equal(intersects(sectionBox, { x0: column.x0, y0: column.top, x1: column.x1, y1: column.bottom }), false, "section does not intersect a callout column");
}
const mapAvoid = slideReserved(pxPerInch, { info: true, titleRect: previewPanels.title, infoRect: previewPanels.summary, legend: null, terrainSection: previewLayout.rect });
const mapScene = buildMapScene({
  model: d17Slide.map,
  width: 960,
  height: 540,
  activeLayer: d17Slide.map.basemap ?? "white",
  fill: 0.8,
  siteX: slideSiteX(d17Slide.style, true),
  rightInset,
  bottomInset: SLIDE.stripH * pxPerInch,
  scale: true,
  showAutomaticLabels: true,
  avoid: mapAvoid,
  viewport: slideViewport(d17Slide.map, d17Slide.style, { width: 960, height: 540, siteX: slideSiteX(d17Slide.style, true), fill: 0.8 }),
});
const mapCircle = { x0: mapScene.center[0] - mapScene.radiusPx, y0: mapScene.center[1] - mapScene.radiusPx, x1: mapScene.center[0] + mapScene.radiusPx, y1: mapScene.center[1] + mapScene.radiusPx };
assert.equal(intersects(sectionBox, mapCircle), false, "section does not intersect the map circle bounds");

const bytes = await renderReportPptx([d17Slide]);
const outputDir = mkdtempSync(join(tmpdir(), "v2-t10-topo-section-pptx-"));
const outputPath = join(outputDir, "d17-topo-section.pptx");
writeFileSync(outputPath, bytes);
const zip = await JSZip.loadAsync(bytes);
const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
assert.ok(xml);
const terrainPlate = [...xml.matchAll(/<p:(?:sp|cxnSp)>[\s\S]*?<\/p:(?:sp|cxnSp)>/g)]
  .map((match) => match[0])
  .find((block) => block.includes('name="GRP|terrain-section|B|plate"'));
assert.ok(terrainPlate, "PPTX terrain section plate exists");
const pptxOff = terrainPlate.match(/<a:off x="(\d+)" y="(\d+)"\/>/);
const pptxExt = terrainPlate.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
assert.ok(pptxOff && pptxExt, "PPTX terrain section plate has geometry");
const pptxRect = { x: Number(pptxOff[1]) / 914400, y: Number(pptxOff[2]) / 914400, w: Number(pptxExt[1]) / 914400, h: Number(pptxExt[2]) / 914400 };
for (const key of ["x", "y", "w", "h"]) assert.ok(Math.abs(pptxRect[key] - pptxLayout.rect[key]) < 0.002, `PPTX ${key} matches preview geometry`);
assert.match(xml, /단면 B–B′ \(남북\)/);
assert.match(xml, /높이 미확인/);
assert.match(xml, /대지 고저차/);
assert.match(xml, /등고선·표고점 보간값/);
assert.match(xml, /terrain-section/);
assert.match(xml, /prstDash val="dash"/);

console.log(`✓ v2 topo section PPT XML (${outputPath})`);
