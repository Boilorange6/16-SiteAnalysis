import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const { layoutRects, slideGeometry, slideSiteX, slideSize } = await import("../../lib/v2/ui/overlay-layout.ts");
const { makeProjector, metersPerPixel, slideViewport } = await import("../../lib/v2/ui/map-projection.ts");
const {
  SCALE_PRESETS,
  mapFrameScaleOptions,
  parseScaleInput,
  scaleForFrame,
  siteAnchoredZoomPatch,
  siteFitPatch,
  scaleOptionsForFrame,
  scaleForViewport,
  visibleGroundWidthM,
  zoomForScale,
  formatScaleDenominator,
} = await import("../../lib/v2/ui/report-scale.ts");
const drawerMapSource = readFileSync(new URL("../../components/v2/report/drawer-map.tsx", import.meta.url), "utf8");
const reportModeSource = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");

assert.deepEqual(SCALE_PRESETS, [1000, 2500, 5000, 10000]);
assert.equal(parseScaleInput("1:2,500"), 2500);
assert.equal(parseScaleInput("2500"), 2500);
assert.equal(parseScaleInput("1/2500"), 2500);
assert.equal(parseScaleInput("499"), null);
assert.equal(parseScaleInput("1:50,001"), null);
assert.equal(parseScaleInput("1:abc"), null);
assert.equal(formatScaleDenominator(13120), "13,120");
assert.equal(formatScaleDenominator(1000), "1,000");
assert.match(drawerMapSource, /formatScaleDenominator/);
assert.match(drawerMapSource, /siteAnchoredZoomPatch/);
assert.match(drawerMapSource, /siteFitPatch/);
assert.match(reportModeSource, /siteAnchoredZoomPatch/);
assert.match(reportModeSource, /siteFitPatch/);
assert.match(reportModeSource, /terrainSectionLayout/);
assert.match(reportModeSource, /siteY: terrainLayout\?\.mapSiteY \?\? 0\.5/);
assert.match(reportModeSource, /fill: terrainLayout\?\.mapFill/);
assert.doesNotMatch(drawerMapSource, /SITE_FIT_PATCH/);
assert.doesNotMatch(reportModeSource, /SITE_FIT_PATCH/);
assert.match(drawerMapSource, /value=\{scaleEditing \? scaleText : formatScaleDenominator\(scale\)\}/);
assert.match(drawerMapSource, /<span>1:<\/span>/);
assert.doesNotMatch(drawerMapSource, /<span>1 :<\/span>/, "축척 표기에 콜론 앞 공백을 넣지 않는다");

const source = GODEOK_RESULTS.find((result) => result.tileCode === "D04");
assert.ok(source, "D04 fixture가 필요하다");
const view = toTileView(source);
const map = view.map ?? view.backdrop;
assert.ok(map, "D04 지도 모델이 필요하다");

function virtualViewportOptions(format, layout) {
  const rect = layoutRects(layout, format).map;
  assert.ok(rect, `${format}/${layout} 지도 프레임`);
  const geometry = slideGeometry(format);
  const width = Math.max(1, Math.round(rect.w * geometry.w * (960 / geometry.w)));
  const height = Math.max(1, Math.round(rect.h * geometry.h * (960 / geometry.w)));
  const hasSummary = layout !== "side-by-side";
  return mapFrameScaleOptions(format, layout, {
    width,
    height,
    siteX: slideSiteX({}, hasSummary, format),
    siteY: 0.5,
    fill: 0.8,
  });
}

function measuredGroundWidth(options, zoomDelta) {
  const viewport = slideViewport(map, { zoomDelta, offsetM: [0, 0] }, options);
  return metersPerPixel(viewport.center[1], viewport.zoom) * viewport.width;
}

const measurements = [];
for (const format of ["wide", "a3"]) {
  for (const layout of ["map-summary", "numbers-first", "side-by-side"]) {
    const options = virtualViewportOptions(format, layout);
    const zoomDelta = zoomForScale(2500, map, options);
    const groundWidthM = measuredGroundWidth(options, zoomDelta);
    const expectedGroundWidthM = visibleGroundWidthM(options.frameWidthMm, 2500);
    const relativeError = Math.abs(groundWidthM - expectedGroundWidthM) / expectedGroundWidthM;
    assert.ok(relativeError < 0.02, `${format}/${layout} 실제 지상 폭: actual=${groundWidthM.toFixed(3)}m expected=${expectedGroundWidthM.toFixed(3)}m error=${(relativeError * 100).toFixed(2)}%`);
    measurements.push({ format, layout, frameWidthMm: options.frameWidthMm, groundWidthM, expectedGroundWidthM, zoomDelta });
  }
}

const monotonicOptions = virtualViewportOptions("wide", "map-summary");
const zoomAt5000 = zoomForScale(5000, map, monotonicOptions);
const zoomAt2500 = zoomForScale(2500, map, monotonicOptions);
assert.ok(zoomAt2500 > zoomAt5000, `작은 분모가 더 크게 확대되어야 함: 1:2500=${zoomAt2500} 1:5000=${zoomAt5000}`);
const widthAt5000 = measuredGroundWidth(monotonicOptions, zoomAt5000);
const widthAt2500 = measuredGroundWidth(monotonicOptions, zoomAt2500);
assert.ok(widthAt2500 < widthAt5000, `작은 분모의 보이는 지상 폭이 더 작아야 함: 1:2500=${widthAt2500}m 1:5000=${widthAt5000}m`);

const defaultOptions = virtualViewportOptions("wide", "map-summary");
const defaultViewport = slideViewport(map, { zoomDelta: 0, offsetM: [0, 0] }, defaultOptions);
const measuredDefaultScale = scaleForViewport(defaultViewport, defaultOptions.frameWidthMm);
const displayedDefaultScale = scaleForFrame(map, { ...defaultFrame(), scaleDenominator: null }, defaultOptions);
assert.equal(displayedDefaultScale, measuredDefaultScale, `잠금 전 기본 축척 표시: displayed=${displayedDefaultScale} measured=${measuredDefaultScale}`);

function assertSiteFitKeepsAnchor(options, zoomDelta) {
  const frame = { ...defaultFrame(), zoomDelta, offsetM: [125, -240], scaleDenominator: null };
  const patch = siteFitPatch(map, frame, options);
  assert.deepEqual(Object.keys(patch).sort(), ["offsetM", "zoomDelta"], "대지 맞춤은 zoomDelta·offsetM만 패치한다");
  assert.equal(patch.zoomDelta, zoomDelta, "대지 맞춤은 현재 확대를 보존한다");
  const base = slideViewport(map, { zoomDelta: 0, offsetM: [0, 0] }, options);
  const fitted = slideViewport(map, patch, options);
  const before = makeProjector(base)(map.center[0], map.center[1]);
  const after = makeProjector(fitted)(map.center[0], map.center[1]);
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) <= 1, `대지 화면 좌표가 기본 자리에서 1px 이내여야 함: ${before} -> ${after}`);
  return patch;
}

const fitPatch = assertSiteFitKeepsAnchor(defaultOptions, 2);
const zeroFit = siteFitPatch(map, { ...defaultFrame(), zoomDelta: 0, offsetM: [125, -240], scaleDenominator: null }, defaultOptions);
assert.equal(zeroFit.zoomDelta, 0, "기본 축척의 대지 맞춤은 확대를 0으로 둔다");
assert.deepEqual(zeroFit.offsetM, [0, 0], "기본 축척의 대지 맞춤은 오프셋을 0으로 둔다");
const fixedFrame = { ...defaultFrame(), zoomDelta: -4, offsetM: [125, -240], scaleDenominator: 2500 };
const fixedPatch = siteFitPatch(map, fixedFrame, defaultOptions);
assert.equal(fixedPatch.zoomDelta, zoomForScale(2500, map, defaultOptions), "고정 축척의 실제 확대를 fit에 반영한다");
assert.equal("scaleDenominator" in fixedPatch, false, "대지 맞춤은 고정 축척 입력을 건드리지 않는다");
assert.notDeepEqual(fitPatch.offsetM, [0, 0], "비중앙 대지 앵커에서는 현재 확대에 맞는 오프셋이 필요하다");

function frameView(frame, options) {
  return {
    zoomDelta: frame.scaleDenominator === null ? frame.zoomDelta : zoomForScale(frame.scaleDenominator, map, options),
    offsetM: frame.offsetM,
  };
}

function siteScreenPoint(frame, options) {
  const viewport = slideViewport(map, frameView(frame, options), options);
  return makeProjector(viewport)(map.center[0], map.center[1]);
}

function assertAnchoredZoom(frame, options, nextZoomDelta, scaleDenominator) {
  const before = siteScreenPoint(frame, options);
  const patch = siteAnchoredZoomPatch(map, frame, options, nextZoomDelta, scaleDenominator);
  const after = siteScreenPoint({ ...frame, ...patch }, options);
  assert.equal(patch.zoomDelta, nextZoomDelta, "버튼이 요청한 zoomDelta를 그대로 적용한다");
  assert.equal(patch.scaleDenominator, scaleDenominator, "축척 입력의 분모 상태를 보존한다");
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) <= 1, `대지 화면 좌표를 1px 이내로 고정한다: ${before} -> ${after}`);
  return patch;
}

// ── 보고서 축척 조작은 현재 대지 화면 위치를 고정한다 ──
{
  const plusFrame = { ...defaultFrame(), scaleDenominator: null, zoomDelta: 0, offsetM: [0, 0] };
  const base = siteScreenPoint(plusFrame, defaultOptions);
  const expectedAnchor = [defaultOptions.width * (defaultOptions.siteX ?? 0.5), defaultOptions.height * (defaultOptions.siteY ?? 0.5)];
  assert.ok(Math.hypot(base[0] - expectedAnchor[0], base[1] - expectedAnchor[1]) <= 1, `기본 대지 앵커 ${base} -> ${expectedAnchor}`);
  assertAnchoredZoom(plusFrame, defaultOptions, 0.25, null);

  const movedFrame = { ...defaultFrame(), scaleDenominator: null, zoomDelta: 0.5, offsetM: [125, -240] };
  assertAnchoredZoom(movedFrame, defaultOptions, 0.75, null);
  assertAnchoredZoom(movedFrame, defaultOptions, -0.25, null);

  const fixedFrameForPreset = { ...defaultFrame(), scaleDenominator: 5000, zoomDelta: zoomForScale(5000, map, defaultOptions), offsetM: [125, -240] };
  const presetZoom = zoomForScale(2500, map, defaultOptions);
  assertAnchoredZoom(fixedFrameForPreset, defaultOptions, presetZoom, 2500);

  const inputZoom = zoomForScale(7500, map, defaultOptions);
  assertAnchoredZoom(fixedFrameForPreset, defaultOptions, inputZoom, 7500);

  const staleFixedFrame = { ...fixedFrameForPreset, zoomDelta: -4 };
  assertAnchoredZoom(staleFixedFrame, defaultOptions, zoomForScale(5000, map, defaultOptions) + 0.25, null);
}

const compareRects = (await import("../../lib/v2/ui/sheet.ts")).sheetCells("2x2");
for (const [index, rect] of compareRects.entries()) {
  const cellOptions = scaleOptionsForFrame(rect.w * 25.4, {
    width: 960,
    height: 960 * rect.h / rect.w,
    siteX: 0.5,
    siteY: 0.5,
    fill: 0.8,
  });
  assertSiteFitKeepsAnchor(cellOptions, 1.25);
  assert.ok(cellOptions.frameWidthMm > 0, `비교 ${index + 1}번 칸 기본 프레임`);
}

function planFor(format, layout) {
  const base = buildReportPlan({
    summary: toSummaryView(GODEOK_SUMMARY, [source]),
    views: new Map([[source.tileId, view]]),
    board: initBoard([source]),
    analysisDate: "2026-10-20",
  }).find((slide) => slide.kind === "tile" && slide.view.code === "D04");
  assert.ok(base, `${format}/${layout} PPTX 계획`);
  const frame = {
    ...defaultFrame(),
    scaleDenominator: 2500,
    locked: true,
    decorations: { north: true, scaleBar: true, locator: false },
  };
  const page = {
    id: `p-D04-${format}-${layout}`,
    layout,
    panels: {},
    textBoxes: [],
    notes: "",
    kind: "tile",
    tileId: source.tileId,
    part: { type: "single" },
    settings: { face: "front", callout: "overview" },
    frame,
  };
  return { ...base, no: 1, total: 1, key: page.id, format, page, notes: "" };
}

async function firstSlideXml(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
  assert.ok(xml, "PPTX 첫 슬라이드 XML");
  return xml;
}

function labelMeters(label) {
  const normalized = label.trim().toLowerCase();
  if (normalized.endsWith("km")) return Number.parseFloat(normalized.slice(0, -2)) * 1000;
  if (normalized.endsWith("m")) return Number.parseFloat(normalized.slice(0, -1));
  return Number.NaN;
}

function scaleBarRatio(xml) {
  const barShape = [...xml.matchAll(/<p:(?:sp|cxnSp)>([\s\S]*?)<\/p:(?:sp|cxnSp)>/g)]
    .map((match) => match[1])
    .find((block) => /\|축척\|bar/.test(block));
  assert.ok(barShape, "PPTX 네이티브 축척 막대 도형");
  const barLengthEmu = Number(barShape.match(/<a:ext cx="(\d+)" cy="\d+"\s*\/>/)?.[1] ?? 0);
  assert.ok(barLengthEmu > 0, "PPTX 축척 막대 길이 EMU");
  const labelShape = [...xml.matchAll(/<p:(?:sp|cxnSp)>([\s\S]*?)<\/p:(?:sp|cxnSp)>/g)]
    .map((match) => match[1])
    .find((block) => /\|축척\|label/.test(block));
  assert.ok(labelShape, "PPTX 네이티브 축척 라벨 도형");
  const label = labelShape.match(/<a:t>([^<]+)<\/a:t>/)?.[1] ?? "";
  const labelM = labelMeters(label);
  assert.ok(Number.isFinite(labelM) && labelM > 0, `축척 라벨 단위: ${label}`);
  const barPhysicalM = (barLengthEmu / 914400) * 0.0254;
  return { label, barLengthEmu, ratio: labelM / barPhysicalM };
}

const pptxRatios = [];
for (const [format, layout] of [["wide", "map-summary"], ["a3", "numbers-first"]]) {
  const xml = await firstSlideXml(await renderReportPptx([planFor(format, layout)]));
  const visibleText = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join(" ");
  assert.doesNotMatch(visibleText, /\bD04\b/, "PPT 제목의 내부 타일 코드는 사용자에게 보이지 않는다");
  const result = scaleBarRatio(xml);
  const relativeError = Math.abs(result.ratio - 2500) / 2500;
  assert.ok(relativeError < 0.05, `${format}/${layout} PPTX 축척 막대: ratio=${result.ratio.toFixed(2)} label=${result.label} bar=${result.barLengthEmu}EMU`);
  pptxRatios.push({ format, layout, ...result, relativeError });
}

console.log(`report scale measurements: ${JSON.stringify(measurements)}`);
console.log(`report scale PPTX ratios: ${JSON.stringify(pptxRatios)}`);
console.log("report scale: PASS");
