/** v2 보고서 페이지 키·extra·페이지 스타일의 plan/렌더 공통 계약 회귀 테스트. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { boardReducer, initBoard, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { sheetView } = await import("../../lib/v2/ui/sheet.ts");
const {
  buildReportPlan,
  complexCounts,
  legendItemsOf,
  mapKeysOf,
  pageKeyOf,
  sourcePageCountForViews,
} = await import("../../lib/v2/report/report-plan.ts");
const { withLegacyReport, withLegacyStyle, withLegacyTileState } = await import("./legacy-report-fixture.mjs");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { slideViewport } = await import("../../lib/v2/ui/map-projection.ts");
const { SLIDE, SLIDE_LEGEND, slideLegend, slideLegendRowRects, slidePanelRects, slideReserved, slideSiteX } = await import("../../lib/v2/ui/overlay-layout.ts");
const { fitBlock, fitFooterText, linesOf } = await import("../../lib/v2/report/pptx-kit.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const VIEW_W = 960;
const VIEW_H = 540;
const EMU_PER_INCH = 914400;
const PX_PER_INCH = VIEW_W / SLIDE.w;
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SHAPE_BLOCK_RE = /<p:(?:sp|cxnSp)>[\s\S]*?<\/p:(?:sp|cxnSp)>/g;

const xmlShapes = (xml) => [...xml.matchAll(SHAPE_BLOCK_RE)].map((match) => {
  const block = match[0];
  const name = block.match(/<p:cNvPr[^>]+name="([^"]+)"/)?.[1] ?? "";
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(-?\d+)" cy="(-?\d+)"\/>/);
  const geometry = off && ext
    ? { x: Number(off[1]) / EMU_PER_INCH, y: Number(off[2]) / EMU_PER_INCH, w: Number(ext[1]) / EMU_PER_INCH, h: Number(ext[2]) / EMU_PER_INCH }
    : null;
  return { block, name, geometry, text: [...block.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((item) => item[1]).join(""), index: match.index ?? 0 };
});

const runSizes = (shape) => [...shape.block.matchAll(/<a:rPr[^>]*\bsz="(\d+)"/g)].map((match) => Number(match[1]));
const alphaValues = (shape) => [...shape.block.matchAll(/<a:alpha val="(\d+)"/g)].map((match) => Number(match[1]));
const colorValues = (shape) => [...shape.block.matchAll(/<a:srgbClr val="([0-9a-f]{6})"/gi)].map((match) => match[1].toUpperCase());
const hasAlpha = (shape, value) => alphaValues(shape).includes(value);
const hasColor = (shape, value) => colorValues(shape).includes(value.toUpperCase());
const textOf = (shape) => shape.text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const inside = (rect, box = { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h }, epsilon = 0.002) => (
  rect.x >= box.x - epsilon
  && rect.y >= box.y - epsilon
  && rect.x + rect.w <= box.x + box.w + epsilon
  && rect.y + rect.h <= box.y + box.h + epsilon
);
const intersects = (a, b = { x: 0, y: 0, w: SLIDE.w, h: SLIDE.h }) => (
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
);
const overlaps = (a, b) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
const imagesFor = (plan) => Object.fromEntries([...new Set(plan.flatMap(mapKeysOf))].map((key) => [key, TINY_PNG]));
const renderOneTile = async (tile) => {
  const bytes = await renderReportPptx([tile], imagesFor([tile]));
  const zip = await JSZip.loadAsync(bytes);
  return { bytes, zip, xml: await zip.file("ppt/slides/slide1.xml").async("string") };
};

const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const counts = complexCounts(views);
const sourcePages = sourcePageCountForViews([...views.values()]);
const build = (board) => buildReportPlan({ summary, views, board, analysisDate: "2026-10-15" });
const baseBoard = initBoard(GODEOK_RESULTS);
const basePlan = build(baseBoard);

// 긴 출처 목록도 출처 띠 안의 한 줄로 축약하고, PPT 텍스트 상자를 슬라이드 안에 둔다.
{
  const longSource = Array.from({ length: 24 }, (_, index) => `자료 원천 ${index + 1} 2026-${String((index % 12) + 1).padStart(2, "0")}`).join(" · ");
  const room = SLIDE.w - SLIDE.edge - 1.7;
  const fitted = fitFooterText(longSource, true, room);
  assert.equal(fitted.lines, 1, "긴 출처 목록은 출처 띠 한 줄");
  assert.ok(linesOf(fitted.text, fitted.fontSize, room) <= 1, "긴 출처 목록의 축약 텍스트 한 줄");
  assert.match(fitted.text, /출처 장 참조/, "긴 출처 목록 축약 안내");
  const sample = { ...basePlan.find((slide) => slide.kind === "tile"), footer: longSource };
  const { xml } = await renderOneTile(sample);
  const footerText = xmlShapes(xml).find((shape) => shape.geometry && shape.geometry.y >= SLIDE.h - SLIDE.stripH - 0.002 && shape.text.includes("출처"));
  assert.ok(footerText, "긴 출처 텍스트 상자");
  assert.ok(inside(footerText.geometry), "긴 출처 텍스트 상자가 슬라이드 안");
  assert.equal(fitted.lines, 1, "긴 출처 텍스트의 줄 수 1");
}

const styledPlanFor = (key, patch) => build(withLegacyStyle(baseBoard, [key], patch));
const styledTileFor = (key, patch) => {
  const plan = styledPlanFor(key, patch);
  const tile = plan.find((slide) => slide.key === key);
  assert.ok(tile && tile.kind === "tile", `스타일 계획 ${key} 타일`);
  return tile;
};

const assertPlanContract = (plan, board, label) => {
  const keys = plan.map((slide) => slide.key);
  assert.equal(new Set(keys).size, keys.length, `${label}: PageKey가 유일하다`);
  assert.ok(plan.every((slide) => slide.style && typeof slide.style === "object"), `${label}: 모든 계획 장에 style이 있다`);
  assert.deepEqual(plan.map((slide) => slide.no), plan.map((_, index) => index + 1), `${label}: no 재계산`);
  assert.ok(plan.every((slide) => slide.total === plan.length), `${label}: total 재계산`);
  assert.equal(plan.length, reportPages(board, counts, sourcePages).pages, `${label}: reportPages == plan 길이`);
};

assertPlanContract(basePlan, baseBoard, "기본 계획");
assert.equal(pageKeyOf(basePlan[0]), "cover", "표지 키");
assert.ok(basePlan.some((slide) => slide.kind === "sources" && /^sources:\d+$/.test(slide.key)), "출처 키 규칙");
const firstA01 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A01");
assert.ok(firstA01, "A01 계획 장");
assert.equal(firstA01.key, `t-A01:${firstA01.view.hasFace ? firstA01.body.face : "single"}`, "타일 face 키 규칙");

// 미리보기와 PPT 범례가 같은 행 상수를 쓰고, PPT 아이콘이 새 행 범위 안에 있는지 확인한다.
{
  const a03 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03");
  assert.ok(a03?.map, "범례 행 계약용 A03 지도");
  const legend = slideLegend(a03.map, !a03.muted);
  assert.ok(legend.rect && legend.items.length > 0, "범례 행 계약용 범례");
  const previewRows = slideLegendRowRects(legend.rect, legend.items.length, legend.notes.length);
  const { xml } = await renderOneTile(a03);
  const shapes = xmlShapes(xml);
  const firstLabel = shapes.find((shape) => shape.name.includes("GRP|panel-legend|범례|plate") && textOf(shape) === legend.items[0].label);
  assert.ok(firstLabel?.geometry, "PPT 범례 첫 라벨 행");
  assert.ok(Math.abs(previewRows.items[0].h - SLIDE_LEGEND.row) < 0.0001 && Math.abs(firstLabel.geometry.h - SLIDE_LEGEND.row) < 0.0001, "미리보기 행 높이와 PPT 행 높이가 같은 상수");
  const sameRect = (a, b) => ["x", "y", "w", "h"].every((key) => Math.abs(a[key] - b[key]) < 0.0001);
  const iconShapes = shapes.filter((shape) => shape.name.includes("GRP|panel-legend|범례|plate") && shape.geometry && !shape.text && !sameRect(shape.geometry, legend.rect));
  assert.ok(iconShapes.length > 0, "PPT 범례 아이콘 도형");
  for (const shape of iconShapes) {
    assert.ok(previewRows.items.some((row) => shape.geometry.y >= row.y - 0.0001 && shape.geometry.y + shape.geometry.h <= row.y + row.h + 0.0001), `PPT 범례 아이콘이 행 밖이다: ${shape.name}`);
  }
  console.log(`legend row contract: preview/PPT=${previewRows.items[0].h.toFixed(2)}in; icons=${iconShapes.length} within item rows`);
}

// 보드 순서를 바꾸어도 타일 자체의 키는 페이지 위치와 무관하다.
{
  const moved = boardReducer(baseBoard, { type: "move", id: "t-A02", dir: 1 });
  const identity = (slide) => slide.kind === "tile"
    ? `tile|${slide.view.tileId}|${slide.body.face}|${slide.callout?.page ?? -1}`
    : `${slide.kind}|${slide.key}`;
  const keysOf = (plan) => new Map(plan.map((slide) => [identity(slide), slide.key]));
  assert.deepEqual([...keysOf(build(moved)).entries()].sort(), [...keysOf(basePlan).entries()].sort(), "보드 순서 변경에도 타일 PageKey 안정성");
}

const anchorKey = firstA01.key;
const withExtra = (id, after, tileId = "t-A02") => withLegacyReport(baseBoard, {
  ...baseBoard.report,
  extra: [{ id, after, tileId, face: "front" }],
});
const extraIndex = (plan, id) => plan.findIndex((slide) => slide.key === `extra:${id}`);

// after가 일반 타일 키·null·소멸한 키인 세 경우와 같은 after의 배열 순서.
{
  const afterTile = withExtra("after-tile", anchorKey);
  const afterTilePlan = build(afterTile);
  assert.equal(afterTilePlan[extraIndex(afterTilePlan, "after-tile") - 1].key, anchorKey, "extra를 after 키 바로 뒤에 삽입");
  assertPlanContract(afterTilePlan, afterTile, "일반 타일 뒤 extra");

  const afterCover = withExtra("after-cover", null);
  const afterCoverPlan = build(afterCover);
  assert.equal(afterCoverPlan[extraIndex(afterCoverPlan, "after-cover") - 1].key, "cover", "after=null extra는 표지 뒤");
  assertPlanContract(afterCoverPlan, afterCover, "표지 뒤 extra");

  let stale = withExtra("stale-after", anchorKey);
  stale = boardReducer(stale, { type: "remove", id: "t-A01" });
  const stalePlan = build(stale);
  const staleAt = extraIndex(stalePlan, "stale-after");
  const sourceAt = stalePlan.findIndex((slide) => slide.kind === "sources");
  assert.ok(staleAt >= 0 && staleAt < sourceAt, "없어진 after 키의 extra는 출처 앞");
  assertPlanContract(stalePlan, stale, "소멸한 after 키 extra");

  const sameAfter = withLegacyReport(withExtra("same-after-1", anchorKey), {
    ...withExtra("same-after-1", anchorKey).report,
    extra: [
      { id: "same-after-1", after: anchorKey, tileId: "t-A02", face: "front" },
      { id: "same-after-2", after: anchorKey, tileId: "t-A02", face: "back" },
    ],
  });
  const sameAfterPlan = build(sameAfter);
  const sameAfterKeys = sameAfterPlan.slice(extraIndex(sameAfterPlan, "same-after-1"), extraIndex(sameAfterPlan, "same-after-2") + 1).map((slide) => slide.key);
  assert.deepEqual(sameAfterKeys, ["extra:same-after-1", "extra:same-after-2"], "같은 after의 extra 배열 순서 보존");
  assertPlanContract(sameAfterPlan, sameAfter, "동일 after extra");
}

// included=false 타일이어도 사용자가 명시한 extra 페이지는 소비한다.
{
  let board = withExtra("explicit-off", null, "t-A01");
  board = withLegacyTileState(board, "t-A01", { included: false });
  const plan = build(board);
  assert.ok(plan.some((slide) => slide.key === "extra:explicit-off"), "꺼진 타일의 명시 extra도 렌더 계획에 포함");
  assert.equal(plan.some((slide) => slide.kind === "tile" && slide.view.tileId === "t-A01" && slide.key !== "extra:explicit-off"), false, "꺼진 타일의 기본 장은 제외");
  assertPlanContract(plan, board, "꺼진 타일 extra");
}

// panel scale은 각 기준 rect에 비례하고, fitBlock은 줄 높이 합을 box 안에 둔다.
{
  const base = slidePanelRects({}, true);
  const large = slidePanelRects({ titleScale: 1.5, summaryScale: 1.5, legendScale: 1.5 }, true);
  const small = slidePanelRects({ titleScale: 0.7, summaryScale: 0.7, legendScale: 0.7 }, true);
  for (const part of ["title", "summary", "legend"]) {
    assert.ok(base[part] && large[part] && small[part]);
    assert.ok(large[part].w >= base[part].w, `${part} 큰 패널 폭이 기준보다 작지 않다`);
    assert.ok(small[part].w <= base[part].w, `${part} 작은 패널 폭이 기준보다 크지 않다`);
    assert.ok(large[part].h >= base[part].h, `${part} 큰 패널 높이가 기준보다 작지 않다`);
    assert.ok(small[part].h <= base[part].h, `${part} 작은 패널 높이가 기준보다 크지 않다`);
  }
  const lines = ["대지분석 보고서의 긴 제목과 자료 기준일", "범례와 설명이 들어가는 두 번째 줄"];
  const bigPt = fitBlock(lines, { w: 4.8, h: 1.2 }, 18, 7);
  const smallPt = fitBlock(lines, { w: 3.0, h: 1.2 }, 18, 7);
  const blockHeight = (pt, boxW) => lines.reduce((sum, line) => sum + linesOf(line, pt, boxW), 0) * (pt / 72) * 1.25;
  assert.ok(blockHeight(bigPt, 4.8) <= 1.2 + 1e-9, "fitBlock 큰 박스 높이 적합");
  assert.ok(blockHeight(smallPt, 3.0) <= 1.2 + 1e-9, "fitBlock 작은 박스 높이 적합");
  assert.ok(bigPt >= smallPt, "큰 박스의 fitBlock pt가 작지 않다");
  assert.ok(bigPt >= 7 && smallPt >= 7, "fitBlock 최소 7pt");
}

// summary=false는 요약 판을 제거하고 오른쪽까지 지도 프레임을 쓴다.
{
  const full = slidePanelRects({}, true);
  const off = slidePanelRects({ summary: false }, false);
  assert.equal(off.summary, null, "summary=false 요약 rect 없음");
  assert.ok(SLIDE.w > full.summary.x, "summary=false 지도 가용 폭이 오른쪽까지 확장");
  assert.ok(slideSiteX({}, false) > slideSiteX({}, true), "summary=false 대지 중심이 확장 지도 중앙으로 이동");
}

// panels는 0..1 비율을 슬라이드 Rect로 복원하고, scale과 공존해도 geometry를 바꾸지 않는다.
{
  const customStyle = {
    summary: true,
    titleScale: 1.5,
    summaryScale: 0.7,
    legendScale: 1.4,
    panels: {
      title: { x: 0.08, y: 0.1, w: 0.28, h: 0.12 },
      summary: { x: 0.65, y: 0.12, w: 0.27, h: 0.68 },
      legend: { x: 0.08, y: 0.66, w: 0.3, h: 0.2 },
    },
  };
  const baseLegend = slideLegend(firstA01.map, true).rect;
  const custom = slidePanelRects(customStyle, true, baseLegend);
  const expected = {
    title: { x: 0.08 * SLIDE.w, y: 0.1 * SLIDE.h, w: 0.28 * SLIDE.w, h: 0.12 * SLIDE.h },
    summary: { x: 0.65 * SLIDE.w, y: 0.12 * SLIDE.h, w: 0.27 * SLIDE.w, h: 0.68 * SLIDE.h },
    legend: { x: 0.08 * SLIDE.w, y: 0.66 * SLIDE.h, w: 0.3 * SLIDE.w, h: 0.2 * SLIDE.h },
  };
  for (const part of ["title", "summary", "legend"]) {
    for (const key of ["x", "y", "w", "h"]) assert.ok(Math.abs(custom[part][key] - expected[part][key]) < 1e-9, `${part}.${key} custom geometry 복원`);
    assert.ok(custom[part].y + custom[part].h <= SLIDE.h - SLIDE.stripH - SLIDE.edge * 0.6 + 1e-9, `${part} footer 위 안전범위`);
  }
  const scaleChanged = slidePanelRects({ ...customStyle, titleScale: 0.7, summaryScale: 1.5, legendScale: 0.7 }, true, baseLegend);
  assert.deepEqual(scaleChanged, custom, "custom panels가 scale geometry보다 우선");
  const reserved = slideReserved(PX_PER_INCH, { style: customStyle, hasSummary: true });
  for (const part of ["title", "summary", "legend"]) {
    const box = { x0: expected[part].x * PX_PER_INCH, y0: expected[part].y * PX_PER_INCH, x1: (expected[part].x + expected[part].w) * PX_PER_INCH, y1: (expected[part].y + expected[part].h) * PX_PER_INCH };
    assert.ok(reserved.some((entry) => Math.abs(entry.x0 - box.x0) < 1e-6 && Math.abs(entry.y0 - box.y0) < 1e-6 && Math.abs(entry.x1 - box.x1) < 1e-6 && Math.abs(entry.y1 - box.y1) < 1e-6), `${part} custom Rect가 slideReserved에 전달`);
  }
  assert.ok(Math.abs(slideSiteX(customStyle, true) - (custom.summary.x - SLIDE.edge) / 2 / SLIDE.w) < 1e-9, "slideSiteX가 custom summary를 소비");
  const noSummary = slidePanelRects({ ...customStyle, summary: false }, false, baseLegend);
  assert.equal(noSummary.summary, null, "custom summary도 summary=false에서 제거");
  assert.ok(noSummary.title.y + noSummary.title.h <= SLIDE.h - SLIDE.stripH - SLIDE.edge * 0.6 + 1e-9, "summary=false custom title footer safe");
  assert.equal(slideSiteX({ ...customStyle, summary: false }, false), 0.5, "summary=false custom siteX");
  const noSummaryReserved = slideReserved(PX_PER_INCH, { style: { ...customStyle, summary: false }, hasSummary: false });
  assert.equal(noSummaryReserved.length, 3, "summary=false slideReserved가 기본 요약 판을 되살리지 않는다");
}

// 같은 feature의 좌표 간격은 zoomDelta로 커지고, offsetM은 대지 표식을 옮긴다.
{
  const focusSlide = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03") ?? firstA01;
  const map = focusSlide.map;
  assert.ok(map, "투영 회귀용 A01 지도");
  const frame = { width: 960, height: 540, siteX: slideSiteX({}, true), fill: 0.8 };
  const sceneFor = (style) => buildMapScene({
    model: map,
    width: frame.width,
    height: frame.height,
    viewport: slideViewport(map, style, frame),
    activeLayer: "white",
    scale: false,
    showAutomaticLabels: false,
    avoid: [],
  });
  const base = sceneFor({});
  const zoomed = sceneFor({ zoomDelta: 1 });
  const target = base.features[0];
  assert.ok(target, "투영 feature");
  const baseDistance = Math.hypot(target.p[0] - base.center[0], target.p[1] - base.center[1]);
  const zoomedTarget = zoomed.features.find((entry) => entry.key === target.key);
  assert.ok(zoomedTarget);
  assert.ok(Math.hypot(zoomedTarget.p[0] - zoomed.center[0], zoomedTarget.p[1] - zoomed.center[1]) > baseDistance, "zoomDelta>0이면 feature 간격 확대");
  const shifted = sceneFor({ offsetM: [100, 0] });
  assert.notDeepEqual(shifted.center, base.center, "offsetM이 대지 표식 좌표를 이동");
}

// 범례 키는 미리보기와 PPT가 공유하며, focus 외 도형은 scene에서 dim 처리된다.
{
  const focusSlide = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03") ?? firstA01;
  const map = focusSlide.map;
  const legend = legendItemsOf(map);
  assert.ok(legend.length >= 2, "focus 회귀에 두 개 이상의 범례 항목");
  assert.match(legend[0].key, /^legend-[^-]+-/);
  assert.equal(legend[0].label.length > 0, true);
  const focus = legend[0].label;
  const scene = buildMapScene({
    model: map,
    width: 960,
    height: 540,
    viewport: slideViewport(map, {}, { width: 960, height: 540, siteX: slideSiteX({}, true), fill: 0.8 }),
    highlightLabel: focus,
    legendFocus: focus,
    activeLayer: "white",
    scale: false,
    showAutomaticLabels: false,
    avoid: [],
  });
  const entries = [
    ...scene.features.map((entry) => ({ entry, label: layerStyle(entry.feature.layer).label })),
    ...scene.lines.map((entry) => ({ entry, label: entry.line.legendLabel ?? layerStyle(entry.line.layer).label })),
  ];
  const focused = entries.find((entry) => entry.label === focus);
  const dimmed = entries.find((entry) => entry.label !== focus);
  assert.ok(focused && dimmed, "focus/비focus geometry");
  const focusedEntry = focused.entry;
  const dimmedEntry = dimmed.entry;
  assert.equal(scene.isElementDimmed(focusedEntry.feature?.layer ?? dimmedEntry.line.layer, focusedEntry.key, focusedEntry.line?.legendLabel), false, "강조 항목 원색");
  assert.equal(scene.isElementDimmed(dimmedEntry.feature?.layer ?? dimmedEntry.line.layer, dimmedEntry.key, dimmedEntry.line?.legendLabel), true, "비강조 항목 dim");
  assert.equal(scene.isElementStrong(focusedEntry.feature?.layer ?? focusedEntry.line.layer, focusedEntry.key, focusedEntry.line?.legendLabel), false, "legendFocus가 강조 항목의 기본 두께를 보존");
}

// 계획 스타일은 pinnedKeys를 페이지 단위로 덮어쓴다. PPT XML에는 summary group이 없다.
{
  const a01 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A01");
  const focus = legendItemsOf(a01.map)[0];
  const pinned = ["rail_line|fixture", "bus_stop|fixture"];
  const board = withLegacyStyle(baseBoard, [a01.key], { pinnedKeys: pinned, legendFocus: focus.key, zoomDelta: 1, offsetM: [80, -20], summary: false, titleScale: 1.4, summaryScale: 1.4, legendScale: 1.4 });
  const plan = build(board);
  const tile = plan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A01");
  assert.deepEqual(tile.pinnedKeys, pinned, "페이지 style pinnedKeys override");
  assert.equal(tile.style.legendFocus, focus.key, "페이지 style legendFocus 전달");
  assert.equal(mapKeysOf(tile)[0], `t-A01:style:${tile.key}`, "스타일 지도 캐시 키는 페이지 키에 종속");
  assertPlanContract(plan, board, "스타일 계획");

  const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const images = Object.fromEntries([...new Set(plan.flatMap(mapKeysOf))].map((key) => [key, tinyPng]));
  const bytes = await renderReportPptx(plan, images);
  const zip = await JSZip.loadAsync(bytes);
  const tileIndex = plan.indexOf(tile) + 1;
  const xml = await zip.file(`ppt/slides/slide${tileIndex}.xml`).async("string");
  const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]).join("|");
  assert.ok(!xml.includes("panel-summary") && !text.includes("요약"), "summary=false PPT 장에 요약 그룹 없음");
  assert.ok(xml.includes("transparency") || xml.includes("alpha"), "legendFocus PPT 도형 투명도 표현");
  assert.ok(!xml.includes("GRP|panel-summary"), "legendFocus PPT에 요약 패널 태그 없음");

}

// 렌더 PPTX XML의 제목·요약·범례 run 크기도 각 scale을 실제로 소비한다.
{
  const a03 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03");
  assert.ok(a03?.map, "scale 회귀용 A03 지도");
  for (const part of ["title", "summary", "legend"]) {
    const xmlFor = async (scale) => {
      const tile = styledTileFor(a03.key, {
        summary: true,
        titleScale: part === "title" ? scale : 1,
        summaryScale: part === "summary" ? scale : 1,
        legendScale: part === "legend" ? scale : 1,
      });
      return (await renderOneTile(tile)).xml;
    };
    const [smallXml, baseXml, largeXml] = await Promise.all([0.7, 1, 1.4].map(xmlFor));
    const maxRunSize = (xml) => {
      const sizes = xmlShapes(xml).filter((shape) => shape.name.includes(`panel-${part}`)).flatMap(runSizes);
      assert.ok(sizes.length > 0, `${part} scale XML run이 없다`);
      assert.ok(Math.min(...sizes) >= 700, `${part} scale XML run이 7pt 미만이다: ${sizes.join(",")}`);
      return Math.max(...sizes);
    };
    const small = maxRunSize(smallXml);
    const base = maxRunSize(baseXml);
    const large = maxRunSize(largeXml);
    assert.ok(large > base, `${part}Scale=1.4 run 최대 sz가 기준보다 크다: ${large} <= ${base}`);
    assert.ok(small < base, `${part}Scale=0.7 run 최대 sz가 기준보다 작다: ${small} >= ${base}`);
  }
}

// custom panels는 Preview와 PPT가 같은 Rect를 쓰고, 판·내부 텍스트를 그 Rect 안에 둔다.
// 사용자 geometry가 있는 지도 이미지는 panel geometry까지 캐시 키에 포함한다.
{
  const a03 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03");
  assert.ok(a03?.map, "custom panel XML 회귀용 A03 지도");
  const panelPatch = {
    summary: true,
    titleScale: 1.4,
    summaryScale: 1.2,
    legendScale: 1.3,
    panels: {
      title: { x: 0.08, y: 0.1, w: 0.28, h: 0.12 },
      summary: { x: 0.65, y: 0.12, w: 0.27, h: 0.68 },
      legend: { x: 0.08, y: 0.66, w: 0.3, h: 0.2 },
    },
  };
  const tile = styledTileFor(a03.key, panelPatch);
  const baseLegend = slideLegend(tile.map, !tile.muted).rect;
  const panels = slidePanelRects(tile.style, true, baseLegend);
  const { xml } = await renderOneTile(tile);
  const shapes = xmlShapes(xml);
  const closeRect = (actual, expected, label) => {
    assert.ok(actual, `${label} plate bbox가 없다`);
    for (const key of ["x", "y", "w", "h"]) assert.ok(Math.abs(actual[key] - expected[key]) < 0.002, `${label}.${key} bbox가 custom Rect와 다르다: ${actual[key]} != ${expected[key]}`);
  };
  for (const part of ["title", "summary", "legend"]) {
    const panel = panels[part];
    assert.ok(panel, `${part} custom Rect`);
    const plateShape = shapes.find((shape) => shape.name.includes(`GRP|panel-${part}`) && shape.name.endsWith("|plate"));
    closeRect(plateShape?.geometry, panel, `${part} panel`);
    const textEntries = shapes.filter((shape) => shape.name.includes(`GRP|panel-${part}`) && shape.geometry && shape.text);
    assert.ok(textEntries.length > 0, `${part} panel 내부 텍스트가 없다`);
    for (const entry of textEntries) assert.ok(inside(entry.geometry, panel), `${part} panel 텍스트 bbox가 판 밖이다: ${entry.name}`);
  }
  assert.ok(Object.values(panels).filter(Boolean).every((panel) => panel.y + panel.h <= SLIDE.h - SLIDE.stripH - SLIDE.edge * 0.6 + 0.002), "custom panel이 footer 안전범위를 침범하지 않는다");

  const customKey = mapKeysOf(tile)[0];
  assert.match(customKey, /:style:.*:panels:title=/, "custom panel geometry가 map cache key에 반영된다");
  const movedTile = styledTileFor(a03.key, {
    ...panelPatch,
    panels: { ...panelPatch.panels, title: { ...panelPatch.panels.title, x: 0.12 } },
  });
  assert.notEqual(mapKeysOf(movedTile)[0], customKey, "custom panel 위치 변경이 map cache key를 바꾼다");

  const noSummaryTile = styledTileFor(a03.key, { ...panelPatch, summary: false });
  const noSummaryXml = (await renderOneTile(noSummaryTile)).xml;
  assert.equal(noSummaryXml.includes("GRP|panel-summary"), false, "summary=false custom PPT에 요약 panel이 없다");
  const noSummaryShapes = xmlShapes(noSummaryXml);
  const noSummaryPanels = slidePanelRects(noSummaryTile.style, false, slideLegend(noSummaryTile.map, !noSummaryTile.muted).rect);
  for (const part of ["title", "legend"]) {
    const panel = noSummaryPanels[part];
    const plateShape = noSummaryShapes.find((shape) => shape.name.includes(`GRP|panel-${part}`) && shape.name.endsWith("|plate"));
    closeRect(plateShape?.geometry, panel, `summary=false ${part} panel`);
    for (const entry of noSummaryShapes.filter((shape) => shape.name.includes(`GRP|panel-${part}`) && shape.geometry && shape.text)) assert.ok(inside(entry.geometry, panel), `summary=false ${part} 텍스트 bbox가 판 밖이다`);
  }
}

// overlay-layout rect와 같은 좌표계에서 summary on/off·0.7/1.5의 패널/축척/방위표가
// 슬라이드 안에 있고 서로 겹치지 않는지 수치로 고정한다.
{
  const a03 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03");
  assert.ok(a03?.map, "overlay rect 회귀용 A03 지도");
  const baseLegend = slideLegend(a03.map, true).rect;
  const rectsFor = (hasSummary, scale) => {
    const style = { summary: hasSummary, titleScale: scale, summaryScale: scale, legendScale: scale };
    const panels = slidePanelRects(style, hasSummary, baseLegend);
    const siteX = slideSiteX(style, hasSummary);
    const rightInset = panels.summary
      ? Math.max(0, VIEW_W - panels.summary.x * PX_PER_INCH + SLIDE.edge * PX_PER_INCH * 0.5)
      : 0;
    const scene = buildMapScene({
      model: a03.map,
      width: VIEW_W,
      height: VIEW_H,
      activeLayer: a03.map.basemap ?? "white",
      siteX,
      rightInset,
      north: (panels.title.y + panels.title.h) * PX_PER_INCH + SLIDE.edge * PX_PER_INCH * 0.5 + 13 * Math.min(1.5, Math.max(1, VIEW_H / 360)),
      bottomInset: SLIDE.stripH * PX_PER_INCH,
      scale: true,
      showAutomaticLabels: false,
      avoid: slideReserved(PX_PER_INCH, { info: hasSummary, titleRect: panels.title, infoRect: panels.summary, legend: panels.legend }),
      viewport: slideViewport(a03.map, style, { width: VIEW_W, height: VIEW_H, siteX, fill: 0.8 }),
    });
    const fromPixels = (x, y, w, h) => ({ x: x / PX_PER_INCH, y: y / PX_PER_INCH, w: w / PX_PER_INCH, h: h / PX_PER_INCH });
    const unit = scene.unit;
    const rects = {
      title: panels.title,
      summary: panels.summary,
      legend: panels.legend,
      scale: fromPixels(scene.scale.x0 - 6 * unit, scene.scale.y - 14 * unit, scene.scale.px + 12 * unit, 22 * unit),
      north: scene.north ? fromPixels(scene.north.x - 13 * unit, scene.north.y - 13 * unit, 26 * unit, 26 * unit) : null,
    };
    return Object.entries(rects).filter(([, rect]) => rect).map(([name, rect]) => ({ name, rect }));
  };
  for (const hasSummary of [true, false]) {
    for (const scale of [0.7, 1.5]) {
      const rects = rectsFor(hasSummary, scale);
      assert.ok(rects.some(({ name }) => name === "title"), `summary=${hasSummary} scale=${scale} title rect`);
      assert.ok(rects.some(({ name }) => name === "legend"), `summary=${hasSummary} scale=${scale} legend rect`);
      for (const { name, rect } of rects) assert.ok(inside(rect), `summary=${hasSummary} scale=${scale} ${name}가 SLIDE 밖이다: ${JSON.stringify(rect)}`);
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          assert.equal(overlaps(rects[i].rect, rects[j].rect), false, `summary=${hasSummary} scale=${scale} ${rects[i].name}/${rects[j].name} 겹침`);
        }
      }
    }
  }
}

// zoomDelta=2 + offsetM의 native 도형 bbox/점 중심과 출처 띠 z-order.
{
  const a03 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03");
  const zoomStyle = { summary: false, zoomDelta: 2, offsetM: [80, -20] };
  const zoomTile = styledTileFor(a03.key, zoomStyle);
  const [lng, lat] = zoomTile.map.center;
  const span = 0.02;
  const partialMap = {
    ...zoomTile.map,
    lines: [{ layer: "road:간선", fid: "page-style-partial-line", points: [[lng - span, lat], [lng + span, lat]], label: "간선도로", name: "간선도로" }],
    polygons: [{ layer: "building", fid: "page-style-partial-polygon", rings: [[[lng - span, lat - span], [lng + span, lat - span], [lng + span, lat + span], [lng - span, lat - span]]], label: "건물", name: "건물" }],
    total: (zoomTile.map.total ?? zoomTile.map.features.length) + 2,
  };
  const partialTile = {
    ...zoomTile,
    map: partialMap,
    view: { ...zoomTile.view, map: partialMap, backdrop: partialMap },
  };
  const { xml } = await renderOneTile(partialTile);
  const records = xmlShapes(xml);
  const native = records.filter((shape) => shape.name.includes("GRP|map-A03-"));
  assert.ok(native.length > 0, "zoom native 지도 도형이 없다");
  const partial = native.filter((shape) => shape.name.endsWith("|geometry"));
  assert.ok(partial.length >= 2, "선·면 partial clipping 회귀 도형이 없다");
  assert.ok(partial.some((shape) => intersects(shape.geometry)), "선·면 partial clipping 회귀 도형이 없다");
  for (const shape of native) {
    assert.ok(shape.geometry, `native 도형 bbox가 없다: ${shape.name}`);
    assert.ok(inside(shape.geometry), `native 도형 bbox가 SLIDE 밖이다: ${shape.name} ${JSON.stringify(shape.geometry)}`);
    if (/\|(?:dot|badge-\d+)$/.test(shape.name)) {
      const centerY = shape.geometry.y + shape.geometry.h / 2;
      assert.ok(centerY < SLIDE.h - SLIDE.stripH + 0.002, `점 중심이 출처 띠 위가 아니다: ${shape.name} y=${centerY}`);
    }
  }
  const footerIndex = records.findIndex((shape) => shape.geometry
    && Math.abs(shape.geometry.x) < 0.002
    && Math.abs(shape.geometry.y - (SLIDE.h - SLIDE.stripH)) < 0.002
    && shape.geometry.w >= SLIDE.w - 0.01
    && shape.geometry.h >= SLIDE.stripH - 0.01);
  const lastNativeIndex = Math.max(...records.map((shape, index) => shape.name.includes("GRP|map-A03-") ? index : -1));
  assert.ok(footerIndex > lastNativeIndex, `footer z-order가 native 지도 뒤가 아니다: footer=${footerIndex}, map=${lastNativeIndex}`);
}

// legendFocus XML: 사용자가 고정한 라벨·콜아웃·대지·반경은 dim하지 않고,
// 비강조 범례 geometry/panel entry만 dim transparency를 받는다.
{
  const a03 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03");
  const legend = legendItemsOf(a03.map);
  const focusItem = legend[0];
  const focusTile = styledTileFor(a03.key, { summary: false, legendFocus: focusItem.key, pinnedKeys: ["store:other|0"] });
  const focusXml = (await renderOneTile(focusTile)).xml;
  const focusShapes = xmlShapes(focusXml);
  const focusedGeometry = focusShapes.filter((shape) => shape.name.includes(`GRP|map-A03-legend-${focusItem.label}`));
  const dimmedGeometry = focusShapes.filter((shape) => shape.name.includes("GRP|map-A03-legend-") && !shape.name.includes(`GRP|map-A03-legend-${focusItem.label}`));
  assert.ok(focusedGeometry.length > 0, "legendFocus 강조 geometry 태그가 없다");
  assert.ok(dimmedGeometry.length > 0, "legendFocus 비강조 geometry 태그가 없다");
  assert.equal(focusedGeometry.some((shape) => hasAlpha(shape, 20000)), false, "강조 geometry가 dim transparency를 받았다");
  assert.ok(dimmedGeometry.some((shape) => hasAlpha(shape, 20000)), "비강조 geometry에 dim transparency가 없다");

  const panelShapes = focusShapes.filter((shape) => shape.name.includes("GRP|panel-legend"));
  const focusedPanelText = panelShapes.find((shape) => textOf(shape) === focusItem.label);
  const otherPanelText = panelShapes.find((shape) => textOf(shape) && textOf(shape) !== focusItem.label && textOf(shape) !== "대지");
  assert.ok(focusedPanelText && otherPanelText, "범례 panel의 강조/비강조 text entry가 없다");
  assert.equal(hasColor(focusedPanelText, "8C919B"), false, "강조 panel entry가 dim 색이다");
  assert.equal(hasColor(otherPanelText, "8C919B"), true, "비강조 panel entry가 dim 색이 아니다");
  assert.ok(panelShapes.some((shape) => hasAlpha(shape, 35000)), "비강조 panel geometry의 dim transparency가 없다");

  const userLabelShapes = focusShapes.filter((shape) => shape.name.includes("GRP|map-A03-label-store:other-0"));
  assert.ok(userLabelShapes.length > 0, "pinned 사용자 라벨 XML 태그가 없다");
  assert.equal(userLabelShapes.some((shape) => hasAlpha(shape, 20000)), false, "사용자 라벨이 dim transparency를 받았다");
  for (const token of ["GRP|map-A03-site", "GRP|map-A03-radius"]) {
    const shapes = focusShapes.filter((shape) => shape.name.includes(token));
    assert.ok(shapes.length > 0, `${token} XML 태그가 없다`);
    assert.equal(shapes.some((shape) => hasAlpha(shape, 20000)), false, `${token}이 dim transparency를 받았다`);
  }

  const a05 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A05" && slide.callout?.page === 0);
  assert.ok(a05, "콜아웃 focus 회귀용 A05 개요 장");
  const calloutTile = styledTileFor(a05.key, { legendFocus: focusItem.key });
  const calloutShapes = xmlShapes((await renderOneTile(calloutTile)).xml).filter((shape) => shape.name.startsWith("GRP|callout-"));
  assert.ok(calloutShapes.length > 0, "콜아웃 XML 태그가 없다");
  assert.equal(calloutShapes.some((shape) => hasAlpha(shape, 20000)), false, "콜아웃이 dim transparency를 받았다");
}

// PowerPoint COM은 호출하지 않는다. env가 지정된 경우에만 판별 가능한 다중 슬라이드 샘플을 쓴다.
if (process.env.V2_PAGE_STYLE_SAMPLE_PATH) {
  const a03 = basePlan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-A03");
  const focusItem = legendItemsOf(a03.map)[0];
  const sampleTile = (patch, marker) => {
    const tile = styledTileFor(a03.key, patch);
    return {
      ...tile,
      view: { ...tile.view, title: `${tile.view.title} · ${marker}` },
      footer: `${marker} · ${tile.footer}`,
    };
  };
  const sampleA = sampleTile({ summary: false, titleScale: 1.4, summaryScale: 1.4, legendScale: 1.4, legendFocus: focusItem.key, zoomDelta: 1, offsetM: [80, -20] }, "[SAMPLE-A]");
  const sampleB = sampleTile({ summary: true, titleScale: 1.4, summaryScale: 1.4, legendScale: 1.4 }, "[SAMPLE-B]");
  const sampleC = sampleTile({ summary: true, titleScale: 0.7, summaryScale: 0.7, legendScale: 0.7 }, "[SAMPLE-C]");
  const sampleD = sampleTile({ summary: false, zoomDelta: 2, offsetM: [80, -20] }, "[SAMPLE-D]");
  const sheetViews = ["t-A01", "t-A03", "t-A04", "t-A05"].map((tileId) => views.get(tileId)).filter(Boolean);
  assert.equal(sheetViews.length, 4, "샘플 2x2 sheet에 네 셀이 필요하다");
  const sheetModel = sheetView("sample-sheet", sheetViews, "2x2");
  const sheetStyle = { zoomDelta: 2, offsetM: [40, -20], legendFocus: focusItem.key };
  const sampleSheet = {
    kind: "sheet",
    view: { ...sheetModel, title: `${sheetModel.title} · [SAMPLE-E]` },
    grid: "2x2",
    cells: sheetViews.map((view, index) => ({
      view,
      face: "front",
      mapKey: `sample-sheet-${index}`,
      sourceLine: view.sourceLine,
      pinnedKeys: [],
      style: { ...sheetStyle, pinnedKeys: [], legendFocus: legendItemsOf(view.map ?? view.backdrop)[0]?.key ?? focusItem.key },
    })),
    footer: "[SAMPLE-E] zoomDelta=2 · legendFocus",
    key: "sample-sheet",
    style: sheetStyle,
    no: 0,
    total: 0,
  };
  const samplePlan = [sampleA, sampleB, sampleC, sampleD, sampleSheet].map((slide, index, all) => ({ ...slide, no: index + 1, total: all.length }));
  assert.ok(samplePlan.some((slide) => slide.kind === "sheet" && slide.grid === "2x2"), "샘플에 2x2 sheet가 없다");
  assert.ok(sampleSheet.cells.every((cell) => cell.style.zoomDelta === 2 && cell.style.legendFocus), "샘플 2x2 sheet에 zoom/legendFocus가 전달되지 않았다");
  const sampleBytes = await renderReportPptx(samplePlan, imagesFor(samplePlan));
  mkdirSync(dirname(process.env.V2_PAGE_STYLE_SAMPLE_PATH), { recursive: true });
  writeFileSync(process.env.V2_PAGE_STYLE_SAMPLE_PATH, sampleBytes);
  const sampleZip = await JSZip.loadAsync(sampleBytes);
  const sampleSlideNames = Object.keys(sampleZip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.ok(sampleSlideNames.length >= 5, `페이지 스타일 샘플이 단일/소수 장이다: ${sampleSlideNames.length}`);
  const sampleText = (await Promise.all(sampleSlideNames.map((name) => sampleZip.file(name).async("string")))).join("|");
  for (const marker of ["[SAMPLE-A]", "[SAMPLE-B]", "[SAMPLE-C]", "[SAMPLE-D]", "[SAMPLE-E]"]) assert.ok(sampleText.includes(marker), `${marker} 식별 표식이 없다`);
  console.log(`page style PPT sample: ${process.env.V2_PAGE_STYLE_SAMPLE_PATH} (${sampleSlideNames.length} slides)`);
}

console.log("v2 report page style tests passed");
