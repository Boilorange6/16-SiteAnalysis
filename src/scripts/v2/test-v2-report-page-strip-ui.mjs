import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
globalThis.React = React;
require.extensions[".css"] = (module) => {
  module.exports = new Proxy({}, { get: () => "" });
};

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { EMPTY_REPORT_DOC } = await import("../../lib/v2/report/report-doc.ts");
const { planReportDoc, recommendedPages } = await import("../../lib/v2/report/report-doc-plan.ts");
const { pageStripItems } = await import("../../lib/v2/report/report-page-strip.ts");
const { default: PageStrip } = await import("../../components/v2/report/page-strip.tsx");
const { default: MapToolbar } = await import("../../components/v2/report/map-toolbar.tsx");

const summary = toSummaryView(GODEOK_SUMMARY, GODEOK_RESULTS);
const board = initBoard(GODEOK_RESULTS);
const views = new Map(GODEOK_RESULTS.map((result) => [result.tileId, toTileView(result)]));
const context = { summary, analysisDate: "2026-10-20", views };
const pages = recommendedPages({ ...EMPTY_REPORT_DOC, pages: [] }, views, board, context);
const plan = planReportDoc({ ...EMPTY_REPORT_DOC, pages }, views, context);
const items = pageStripItems(pages, plan);
assert.ok(items.length >= 3, "페이지 줄 fixture는 세 장 이상이어야 한다");

const selectedItem = items[1];
const markup = renderToStaticMarkup(createElement(PageStrip, {
  items: items.slice(0, 3),
  selectedId: selectedItem.page.id,
  selectedSlideKey: selectedItem.slide.key,
  onSelect: () => {},
  onNavigate: () => {},
  onReorder: () => {},
  onDropMove: () => {},
  onAddPage: () => {},
  onDuplicate: () => {},
  onDelete: () => {},
  classMap: {},
}));

assert.equal((markup.match(/tabindex="0"/g) ?? []).length, 1, "선택한 썸네일만 tabindex=0");
assert.equal((markup.match(/tabindex="-1"/g) ?? []).length, 2, "나머지 썸네일은 tabindex=-1");
const selectedButton = (markup.match(/<button\b[^>]*aria-selected="true"[^>]*>/) ?? [])[0];
assert.ok(selectedButton, "선택한 항목의 버튼");
assert.match(selectedButton, /tabindex="0"/, "선택한 항목의 버튼에 roving tabindex");
assert.match(markup, /<ol\b[^>]*aria-label="보고서 페이지"/, "페이지 줄 접근성 이름");

const pageStripSource = readFileSync(new URL("../../components/v2/report/page-strip.tsx", import.meta.url), "utf8");
assert.doesNotMatch(pageStripSource, /onMove\(/, "페이지 줄은 onMove 계약을 사용하지 않는다");
const itemDragOverSource = pageStripSource.match(/onDragOver=\{\(event\) => \{([\s\S]*?)\n\s*\}\}/)?.[1] ?? "";
assert.match(pageStripSource, /Array\.from\(event\.dataTransfer\.types\)/, "페이지 끌기는 DataTransfer types로 판정한다");
assert.match(itemDragOverSource, /isPageDrag\(event\)/, "항목 dragover는 페이지 끌기만 처리한다");
assert.doesNotMatch(itemDragOverSource, /getData\(/, "항목 dragover는 보호 모드의 getData를 읽지 않는다");
assert.match(itemDragOverSource, /draggingPageId\.current/, "항목 dragover는 dragstart에서 기억한 page id를 쓴다");
assert.match(itemDragOverSource, /item\.page\.id/, "항목 dragover는 같은 page id 위의 표시를 막는다");
assert.match(pageStripSource, /if \(!isPageDrag\(event\)\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/, "페이지 드롭일 때만 전파를 막는다");
const reorderKeySource = pageStripSource.match(/if \(intent\.kind === "reorder"\) \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
assert.match(reorderKeySource, /requestAnimationFrame[\s\S]*pageButtonRefs\.current\.get\(item\.slide\.key\)\?\.focus/, "키보드 재배치 뒤 같은 썸네일에 포커스를 복구한다");
const reportModeSource = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const pageNavigationSource = reportModeSource.slice(reportModeSource.indexOf('if (event.key === "PageUp"'), reportModeSource.indexOf("if (!(event.ctrlKey"));
assert.match(pageNavigationSource, /event\.altKey \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.shiftKey/, "수정자가 있는 PageUp/PageDown은 가로채지 않는다");
const reportModeCss = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
assert.match(reportModeCss, /\.pageDropIndicator[\s\S]*?width:\s*3px[\s\S]*?background:\s*#2f6fdb/, "드롭 위치 표시 막대");

const toolbarProps = {
  scale: 2500,
  locked: false,
  editing: false,
  settingsOpen: false,
  lockAttention: false,
  onZoom: () => {},
  onFit: () => {},
  onToggleLock: () => {},
  onToggleSettings: () => {},
  onDone: () => {},
};
const toolbarMarkup = renderToStaticMarkup(createElement(MapToolbar, toolbarProps));
const toolbarLabels = ["축척 줄이기", "축척 키우기", "대지 맞춤", "지도 위치 고정", "지도 설정"];
let previousToolbarLabelIndex = -1;
for (const label of toolbarLabels) {
  const labelIndex = toolbarMarkup.indexOf(`aria-label="${label}"`);
  assert.ok(labelIndex >= 0, `지도 막대에 ${label} 버튼`);
  assert.ok(labelIndex > previousToolbarLabelIndex, `지도 막대 버튼 순서: ${label}`);
  previousToolbarLabelIndex = labelIndex;
}
assert.doesNotMatch(toolbarMarkup, /지도 이동|이동 끝내기/, "지도 막대에는 이동 토글이 없다");

const editingToolbarMarkup = renderToStaticMarkup(createElement(MapToolbar, { ...toolbarProps, editing: true }));
assert.match(editingToolbarMarkup, /aria-label="지도 편집 끝내기 \(Esc\)"/, "편집 중에는 Esc 완료 버튼이 있다");
assert.doesNotMatch(editingToolbarMarkup, /aria-label="대지 맞춤"|aria-label="지도 위치 고정"|aria-label="지도 설정"/, "편집 중에는 설정 조작을 숨긴다");
const attentionToolbarMarkup = renderToStaticMarkup(createElement(MapToolbar, { ...toolbarProps, lockAttention: true }));
assert.match(attentionToolbarMarkup, /data-attention="true"/, "잠긴 지도 편집 시도는 고정 버튼을 강조한다");

const stageBlock = reportModeSource.slice(reportModeSource.indexOf("className={styles.stageFit}"), reportModeSource.indexOf('<nav className={`${styles.floatCard} ${styles.toolPill}`}'));
const dockBlock = reportModeSource.slice(reportModeSource.indexOf('data-dock-lead="true"'), reportModeSource.lastIndexOf("<PageStrip"));
assert.doesNotMatch(stageBlock, /<MapToolbar/, "지도 막대는 슬라이드 무대 위에 그리지 않는다");
assert.match(dockBlock, /<MapToolbar/, "지도 막대는 pageDock의 왼쪽 묶음에 그린다");
assert.doesNotMatch(reportModeSource, /styles\.mapHint|mapToolbarReason|지도를 끌어 옮기고/, "이전 무대 안내 CSS/문구를 제거한다");
assert.match(reportModeSource, /const drawerOpen = rail !== null;/, "지도 선택은 왼쪽 서랍을 열지 않는다");
assert.match(reportModeSource, /data-settings-open=\{settingsOpen \? "true" : "false"\}/, "설정 카드 상태는 settingsOpen에 연결한다");

console.log("v2 report page strip UI: PASS");
