/** v2 보고서 페이지 키·extra·페이지 스타일의 plan/렌더 공통 계약 회귀 테스트. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { boardReducer, initBoard, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const {
  buildReportPlan,
  complexCounts,
  legendItemsOf,
  mapKeysOf,
  pageKeyOf,
  sourcePageCountForViews,
} = await import("../../lib/v2/report/report-plan.ts");
const { buildMapScene } = await import("../../lib/v2/ui/map-scene.ts");
const { layerStyle } = await import("../../lib/v2/ui/map-layers.ts");
const { slideViewport } = await import("../../lib/v2/ui/map-projection.ts");
const { SLIDE, slidePanelRects, slideSiteX } = await import("../../lib/v2/ui/overlay-layout.ts");
const { fitBlock, linesOf } = await import("../../lib/v2/report/pptx-kit.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const counts = complexCounts(views);
const sourcePages = sourcePageCountForViews([...views.values()]);
const build = (board) => buildReportPlan({ summary, views, board, analysisDate: "2026-10-15" });
const baseBoard = initBoard(GODEOK_RESULTS);
const basePlan = build(baseBoard);

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
const withExtra = (id, after, tileId = "t-A02") => boardReducer(baseBoard, { type: "addPage", id, after, tileId, face: "front" });
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

  const sameAfter = boardReducer(withExtra("same-after-1", anchorKey), { type: "addPage", id: "same-after-2", after: anchorKey, tileId: "t-A02", face: "back" });
  const sameAfterPlan = build(sameAfter);
  const sameAfterKeys = sameAfterPlan.slice(extraIndex(sameAfterPlan, "same-after-1"), extraIndex(sameAfterPlan, "same-after-2") + 1).map((slide) => slide.key);
  assert.deepEqual(sameAfterKeys, ["extra:same-after-1", "extra:same-after-2"], "같은 after의 extra 배열 순서 보존");
  assertPlanContract(sameAfterPlan, sameAfter, "동일 after extra");
}

// included=false 타일이어도 사용자가 명시한 extra 페이지는 소비한다.
{
  let board = withExtra("explicit-off", null, "t-A01");
  board = boardReducer(board, { type: "include", id: "t-A01", value: false });
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
    assert.ok(Math.abs(large[part].w / base[part].w - 1.5) < 1e-9, `${part} 큰 패널 폭 비례`);
    assert.ok(Math.abs(small[part].w / base[part].w - 0.7) < 1e-9, `${part} 작은 패널 폭 비례`);
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
  const board = boardReducer(baseBoard, {
    type: "pageStyle",
    keys: [a01.key],
    patch: { pinnedKeys: pinned, legendFocus: focus.key, zoomDelta: 1, offsetM: [80, -20], summary: false, titleScale: 1.4, summaryScale: 1.4, legendScale: 1.4 },
  });
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

  if (process.env.V2_PAGE_STYLE_SAMPLE_PATH) {
    mkdirSync(dirname(process.env.V2_PAGE_STYLE_SAMPLE_PATH), { recursive: true });
    writeFileSync(process.env.V2_PAGE_STYLE_SAMPLE_PATH, bytes);
    console.log(`page style PPT sample: ${process.env.V2_PAGE_STYLE_SAMPLE_PATH}`);
  }
}

console.log("v2 report page style tests passed");
