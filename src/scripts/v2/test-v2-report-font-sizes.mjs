import assert from "node:assert/strict";
import JSZip from "jszip";

const {
  DEFAULT_REPORT_FONT_SIZES,
  EMPTY_REPORT_DOC,
  defaultReportFontSizes,
  historyApply,
  historyUndo,
  mergeReportFontSizes,
  REPORT_FONT_SIZE_LIMITS,
  reportDocReducer,
  reportFontSizesFromLegacyScale,
} = await import("../../lib/v2/report/report-doc.ts");
const { restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");
const { fitFooterText, fontSizeForStyle } = await import("../../lib/v2/report/pptx-kit.ts");
const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, mapKeysOf } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
import { readFileSync } from "node:fs";

const page = (id, overrides = {}) => ({
  id,
  layout: "map-summary",
  panels: {},
  textBoxes: [],
  notes: "",
  kind: "tile",
  tileId: "t-A01",
  part: { type: "single" },
  settings: { face: "front", callout: "top10" },
  frame: {
    zoomDelta: 0,
    offsetM: [0, 0],
    scaleDenominator: null,
    locked: false,
    basemap: "base",
    hiddenLayers: [],
    labelRule: "site-near",
    pinnedKeys: [],
    legend: { order: [], hidden: [], visibleOnly: true, placement: "below" },
    decorations: { north: true, scaleBar: true, locator: false },
  },
  ...overrides,
});

const keys = ["title", "summary", "legend", "labels", "source", "scale"];
const previewSource = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const mapFigureSource = readFileSync(new URL("../../components/v2/map-figure.tsx", import.meta.url), "utf8");
const mapPptxSource = readFileSync(new URL("../../lib/v2/report/map-pptx.ts", import.meta.url), "utf8");
assert.match(previewSource, /fontSizeForStyle\(style, "title"\)/, "preview title reads the shared pt value");
assert.match(previewSource, /fontSizeForStyle\(slide\.style, "summary"\)/, "preview summary reads the shared pt value");
assert.match(previewSource, /fontSizeForStyle\(slide\.style, "legend"\)/, "preview legend reads the shared pt value");
assert.match(previewSource, /fontSizeForStyle\(style, "labels"\)\s*\/\s*DEFAULT_REPORT_FONT_SIZES\.labels/, "preview map labels read the shared pt value");
assert.match(previewSource, /fontSizeForStyle\(style, "scale"\)\s*\/\s*DEFAULT_REPORT_FONT_SIZES\.scale/, "preview scale text reads the shared pt value");
assert.match(previewSource, /fitFooterText\(slide\.footer[\s\S]*fontSizeForStyle\(slide\.style, "source"\)/, "preview source footer starts from the shared pt value");
assert.match(mapFigureSource, /scaleFontScale\?: number/, "map preview accepts the scale text size value");
assert.match(mapFigureSource, /scene\.scaleFontScale/, "map preview renders scale text with the shared scale value");
assert.match(mapPptxSource, /scaleFontScale: fontSizeForStyle\(style, "scale"\)\s*\/\s*DEFAULT_REPORT_FONT_SIZES\.scale/, "PPT map scene reads the page scale text value");
assert.match(mapPptxSource, /scene\.scaleFontScale/, "PPT scale text renders with the shared scale value");

assert.deepEqual(defaultReportFontSizes(), DEFAULT_REPORT_FONT_SIZES, "default helper exposes the pt defaults");
assert.equal(DEFAULT_REPORT_FONT_SIZES.scale, 9, "축척 기본 글자 크기는 9pt다");
assert.deepEqual(REPORT_FONT_SIZE_LIMITS.scale, { min: 7, max: 14 }, "축척 글자 크기 범위는 7–14pt다");
assert.deepEqual(
  mergeReportFontSizes(
    { title: 24, summary: 16, legend: 12, labels: 14, source: 11, scale: 11 },
    { title: 29, labels: 17, scale: 14 },
  ),
  { title: 29, summary: 16, legend: 12, labels: 17, source: 11, scale: 14 },
  "page overrides win over document values and defaults fill the rest",
);

const raw = {
  v: 1,
  format: "wide",
  fontScale: 1.15,
  fontSizes: { title: 31, source: 6, scale: 20, ignored: 99 },
  pages: [page("p1", { fontSizes: { summary: 99, labels: 7, scale: 6, ignored: 42 } })],
};
const restored = restoreReportDoc(raw, new Set(["t-A01"]));
assert.deepEqual(restored.fontSizes, { title: 31, summary: 15, legend: 12, labels: 12, source: 7, scale: 14 }, "legacy scale fills missing document values and clamps new values");
assert.deepEqual(restored.pages[0].fontSizes, { summary: 24, labels: 8, scale: 7 }, "page font sizes survive restore and clamp at the page boundary");
assert.equal(Object.prototype.hasOwnProperty.call(restored, "fontScale"), false, "new restored shape does not write legacy fontScale");
assert.deepEqual(restoreReportDoc(JSON.parse(JSON.stringify(restored)), new Set(["t-A01"])), restored, "storage serialization and restore preserve fontSizes");
assert.deepEqual(
  restoreReportDoc({ v: 1, format: "wide", fontScale: 0.85, pages: [] }, new Set()).fontSizes,
  reportFontSizesFromLegacyScale(0.85),
  "legacy document scale migrates to pt values",
);

let doc = { ...EMPTY_REPORT_DOC, pages: [page("p1"), page("p2")] };
doc = reportDocReducer(doc, { type: "fontSizes", scope: "document", key: "title", value: 25 });
doc = reportDocReducer(doc, { type: "fontSizes", scope: "page", id: "p1", key: "summary", value: 21 });
assert.equal(doc.fontSizes?.title, 25, "document fontSizes action has the stable contract");
assert.equal(doc.pages[0].fontSizes?.summary, 21, "page fontSizes action has the stable contract");
const themedLegacy = reportDocReducer({ ...doc, fontScale: 0.85 }, { type: "theme", fontScale: 1.15 });
assert.equal(Object.prototype.hasOwnProperty.call(themedLegacy, "fontScale"), false, "legacy theme action writes only the new fontSizes shape");
assert.deepEqual(themedLegacy.fontSizes, reportFontSizesFromLegacyScale(1.15), "legacy theme action maps to document pt values");
const migratedByReducer = reportDocReducer({ ...doc, fontScale: 0.85 }, { type: "notes", id: "p1", notes: "legacy" });
assert.equal(Object.prototype.hasOwnProperty.call(migratedByReducer, "fontScale"), false, "any reducer action removes legacy fontScale");
assert.deepEqual(migratedByReducer.fontSizes, { ...reportFontSizesFromLegacyScale(0.85), title: 25 }, "reducer migration keeps legacy values until explicit new overrides");
const clearedOne = reportDocReducer(doc, { type: "clearPageFontSizes", id: "p1", key: "summary" });
assert.equal(clearedOne.pages[0].fontSizes, undefined, "clearPageFontSizes removes one page override");
const withTwoPageValues = reportDocReducer(doc, { type: "fontSizes", scope: "page", id: "p1", key: "labels", value: 15 });
const clearedAll = reportDocReducer(withTwoPageValues, { type: "clearPageFontSizes", id: "p1" });
assert.equal(clearedAll.pages[0].fontSizes, undefined, "clearPageFontSizes without key removes all page overrides");
const resetDefaults = reportDocReducer(withTwoPageValues, { type: "resetFontSizes" });
assert.equal(resetDefaults.fontSizes, undefined, "기본 크기로는 문서 글자 크기 override를 제거한다");
assert.equal(resetDefaults.pages[0].fontSizes, undefined, "기본 크기로는 페이지 글자 크기 override도 제거한다");
const duplicate = reportDocReducer(withTwoPageValues, { type: "duplicate", id: "p1" });
assert.deepEqual(duplicate.pages[1].fontSizes, withTwoPageValues.pages[0].fontSizes, "duplicate preserves page fontSizes");

const beforeHistory = { past: [], present: doc, future: [] };
const afterFontStep = historyApply(beforeHistory, { type: "fontSizes", scope: "document", key: "legend", value: 13 });
assert.equal(afterFontStep.past.length, 1, "one font size action is one history step");
assert.deepEqual(historyUndo(afterFontStep).present, doc, "font size action undoes as one step");

const style = { titleScale: 22 / 18, summaryScale: 15 / 13, legendScale: 12 / 10, fontSizes: { title: 22, summary: 15, legend: 12, labels: 14, source: 11, scale: 11 } };
assert.deepEqual(Object.fromEntries(keys.map((key) => [key, fontSizeForStyle(style, key)])), style.fontSizes, "PPT and preview share the same page pt values");
assert.equal(fitFooterText("짧은 출처", false, 20, style.fontSizes.source).fontSize, style.fontSizes.source, "source footer starts at the shared source pt");

const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const board = initBoard(GODEOK_RESULTS);
const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const basePlan = buildReportPlan({ summary, views, board, analysisDate: "2026-10-15" });
const baseTile = basePlan.find((slide) => slide.kind === "tile" && slide.map);
assert.ok(baseTile, "PPT parity tile fixture");
const parityMap = { ...baseTile.map, features: baseTile.map.features.slice(0, 1), lines: [], polygons: [], total: 1, notes: [] };
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const defaultScaleScene = buildMapScene({ model: parityMap, width: 960, height: 540, activeLayer: "white", scale: true, north: false, avoid: [] });
const largeScaleScene = buildMapScene({ model: parityMap, width: 960, height: 540, activeLayer: "white", scale: true, north: false, scaleFontScale: 14 / 9, avoid: [] });
assert.equal(defaultScaleScene.scaleFontScale, 1, "축척 기본 글자 배율은 9pt 기준이다");
assert.equal(largeScaleScene.scaleFontScale, 14 / 9, "축척 글자 14pt가 장면에 보존된다");
const parityTile = { ...baseTile, map: parityMap, footer: "출처", style: { ...baseTile.style, ...style } };
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const bytes = await renderReportPptx([parityTile], Object.fromEntries(mapKeysOf([parityTile]).map((key) => [key, tinyPng])));
const zip = await JSZip.loadAsync(bytes);
const xml = await zip.file("ppt/slides/slide1.xml").async("string");
const shapes = [...xml.matchAll(/<p:(?:sp|cxnSp)>[\s\S]*?<\/p:(?:sp|cxnSp)>/g)].map((match) => ({
  block: match[0],
  name: match[0].match(/<p:cNvPr[^>]+name="([^"]+)"/)?.[1] ?? "",
  text: [...match[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((item) => item[1]).join(""),
}));
const runSizes = (shape) => [...shape.block.matchAll(/<a:(?:rPr|defRPr)[^>]*\bsz="(\d+)"/g)].map((match) => Number(match[1]));
const titleShape = shapes.find((shape) => shape.name.includes("panel-title") && shape.name.endsWith("|text"));
const summaryShape = shapes.find((shape) => shape.text.includes(baseTile.view.sentence));
const legendShapes = shapes.filter((shape) => shape.name.includes("panel-legend") && shape.text.length > 0);
const sourceShape = shapes.find((shape) => shape.text.includes("출처"));
const scaleShape = shapes.find((shape) => shape.name.includes("|축척|label"));
assert.ok(titleShape && runSizes(titleShape).includes(style.fontSizes.title * 100), "PPT title run uses the page title pt");
assert.ok(summaryShape && runSizes(summaryShape).includes(style.fontSizes.summary * 100), "PPT summary run uses the page summary pt");
assert.ok(legendShapes.some((shape) => runSizes(shape).includes(style.fontSizes.legend * 100)), "PPT legend run uses the page legend pt");
assert.ok(sourceShape && runSizes(sourceShape).includes(style.fontSizes.source * 100), "PPT source run uses the page source pt");
assert.ok(scaleShape && runSizes(scaleShape).length > 0, "PPT scale bar keeps an editable text run");

console.log("v2 report font size tests passed");
