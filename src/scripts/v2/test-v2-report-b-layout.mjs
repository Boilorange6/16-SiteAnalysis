import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reportDocSource = readFileSync(new URL("../../lib/v2/report/report-doc.ts", import.meta.url), "utf8");
const boardStateSource = readFileSync(new URL("../../lib/v2/ui/board-state.ts", import.meta.url), "utf8");
const renderPptxSource = readFileSync(new URL("../../lib/v2/report/render-pptx.ts", import.meta.url), "utf8");
const reportModeSource = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const slideSurfaceSource = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const reportModeStyles = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const slideSurfaceStyles = readFileSync(new URL("../../components/v2/report/slide-surface.module.css", import.meta.url), "utf8");
const drawerPagesSource = readFileSync(new URL("../../components/v2/report/drawer-pages.tsx", import.meta.url), "utf8");
const drawerTilesSource = readFileSync(new URL("../../components/v2/report/drawer-tiles.tsx", import.meta.url), "utf8");
const textBoxPopoverSource = readFileSync(new URL("../../components/v2/report/text-box-popover.tsx", import.meta.url), "utf8");
const sidePanelHeaderSource = readFileSync(new URL("../../components/v2/report/side-panel-header.tsx", import.meta.url), "utf8");
const panelSource = reportModeSource + sidePanelHeaderSource;

const {
  TEXT_BOX_DEFAULTS,
  TEXT_BOX_COLORS,
  clampTextBox,
  reportDocReducer,
  textBoxDefaults,
} = await import("../../lib/v2/report/report-doc.ts");
const { restoreReportDoc } = await import("../../lib/v2/ui/board-state.ts");

assert.deepEqual(TEXT_BOX_DEFAULTS.title, {
  w: 4.8,
  h: 0.86,
  pt: 20,
  bold: true,
  italic: false,
  color: "#15171c",
  align: "left",
}, "제목 글상자 기본값은 20pt 굵게·검정·왼쪽 정렬이다");
assert.deepEqual(TEXT_BOX_DEFAULTS.body, {
  w: 4.4,
  h: 0.72,
  pt: 14,
  bold: false,
  italic: false,
  color: "#15171c",
  align: "left",
}, "본문 글상자 기본값은 14pt 일반·검정·왼쪽 정렬이다");
assert.deepEqual(TEXT_BOX_DEFAULTS.note, {
  w: 3.8,
  h: 0.55,
  pt: 10,
  bold: false,
  italic: false,
  color: "#4a5160",
  align: "left",
}, "주석·출처 글상자 기본값은 10pt·회색·왼쪽 정렬이다");
assert.deepEqual(textBoxDefaults("title", "title-1", 1, 2), {
  id: "title-1",
  kind: "title",
  x: 1,
  y: 2,
  text: "",
  ...TEXT_BOX_DEFAULTS.title,
}, "종류별 글상자 생성 helper가 기본 스타일을 보존한다");
assert.deepEqual(TEXT_BOX_COLORS, ["#15171c", "#4a5160", "#2f6fdb", "#5b4fd6", "#d9480f", "#c92a2a", "#2e9e4a", "#fff"], "글자 색 견본은 허용된 8색이다");

const clamped = clampTextBox({
  ...textBoxDefaults("body", "clamp-1", 9, 4),
  w: 4,
  h: 3,
}, 10, 5);
assert.deepEqual({ x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h }, { x: 6, y: 2, w: 4, h: 3 }, "글상자 x/y는 w/h를 포함해 슬라이드 안으로 clamp한다");
const minClamped = clampTextBox({
  ...textBoxDefaults("note", "clamp-2", -9, -4),
  w: 0,
  h: 0,
}, 0.2, 0.2);
assert.ok(minClamped.x >= 0 && minClamped.y >= 0 && minClamped.w >= 1 && minClamped.h >= 0.45, "글상자 크기와 위치에는 최소값·슬라이드 경계가 있다");

const reducerPage = {
  id: "p-reducer",
  kind: "blank",
  layout: "map-full",
  panels: {},
  textBoxes: [],
  notes: "",
};
const reducerBox = {
  ...textBoxDefaults("note", "reducer-1", 0.2, 0.3),
  text: "출처",
  pt: 11,
  bold: true,
  italic: true,
  color: "#2f6fdb",
  align: "center",
};
const reduced = reportDocReducer({ v: 1, format: "wide", pages: [reducerPage] }, { type: "textBox", id: reducerPage.id, box: reducerBox });
assert.deepEqual(reduced.pages[0].textBoxes[0], reducerBox, "글상자 reducer가 pt·kind·bold·italic·color·align을 보존한다");

const restored = restoreReportDoc({
  v: 1,
  format: "wide",
  pages: [{
    ...reducerPage,
    id: "p-restore",
    textBoxes: [
      { ...reducerBox, id: "restore-valid", kind: "title", color: "#5b4fd6", align: "center" },
      { ...reducerBox, id: "restore-invalid", kind: "subtitle", color: "#not-allowed", align: "justify" },
    ],
  }],
}, new Set());
const restoredBoxes = restored.pages[0]?.textBoxes ?? [];
assert.deepEqual({
  kind: restoredBoxes[0]?.kind,
  bold: restoredBoxes[0]?.bold,
  italic: restoredBoxes[0]?.italic,
  color: restoredBoxes[0]?.color,
  align: restoredBoxes[0]?.align,
}, {
  kind: "title",
  bold: true,
  italic: true,
  color: "#5b4fd6",
  align: "center",
}, "restoreReportDoc가 허용된 TextBox kind·bold·italic·color·align을 복원한다");
assert.notEqual(restoredBoxes[1]?.kind, "subtitle", "복원 시 허용되지 않은 TextBox kind를 버린다");
assert.notEqual(restoredBoxes[1]?.color, "#not-allowed", "복원 시 허용되지 않은 TextBox 색을 버린다");
assert.notEqual(restoredBoxes[1]?.align, "justify", "복원 시 허용되지 않은 TextBox 정렬을 버린다");

const pageTextBoxesBlock = renderPptxSource.slice(renderPptxSource.indexOf("function pageTextBoxes"), renderPptxSource.indexOf("function pageNotes"));
assert.match(pageTextBoxesBlock, /color:\s*hex\(box\.color\s*\?\?/, "PPT 글상자 색상 옵션은 TextBox color를 사용한다");
assert.match(pageTextBoxesBlock, /bold:\s*box\.bold\s*\?\?/, "PPT 글상자 굵기 옵션은 TextBox bold를 사용한다");
assert.match(pageTextBoxesBlock, /italic:\s*box\.italic\s*\?\?/, "PPT 글상자 기울임 옵션은 TextBox italic을 사용한다");
assert.match(pageTextBoxesBlock, /align:\s*box\.align\s*\?\?/, "PPT 글상자 정렬 옵션은 TextBox align을 사용한다");

const railStart = reportModeSource.indexOf("styles.toolPill");
const railEnd = reportModeSource.indexOf("styles.pageDock", railStart);
const railSource = railStart >= 0 && railEnd > railStart ? reportModeSource.slice(railStart, railEnd) : reportModeSource;
assert.doesNotMatch(reportModeSource, /addTextBoxFromRail[\s\S]{0,500}addTextBox\(\)/, "글상자 레일 버튼은 누르자마자 글상자를 만들지 않는다");
assert.match(reportModeSource, /(?:textBoxPlacement|placementKind|placementMode|textBoxPlace)/, "글상자 T2는 종류 선택 후 놓기 상태를 가진다");
assert.match(reportModeSource, /(?:onPlaceTextBox|onTextBoxPlacement|placementCallback|setTextBoxPlacement|placeTextBox)/, "글상자 T2는 놓기 callback 계약을 가진다");
for (const label of ["제목", "본문 글", "주석·출처"]) {
  assert.match(textBoxPopoverSource, new RegExp(label), `글상자 T2 종류 선택지: ${label}`);
}
assert.match(slideSurfaceSource, /crosshair|placementPreview|textBoxPlacementPreview/, "글상자 놓기 모드는 crosshair와 따라오는 미리보기를 가진다");
for (const [name, aliases] of [
  ["왼쪽 위", /top[-_]left|topLeft|["'`]nw["'`]|handle--nw/],
  ["위", /resizeHandleTop\b|["'`]n["'`]|handle--top/],
  ["오른쪽 위", /top[-_]right|topRight|["'`]ne["'`]|handle--ne/],
  ["오른쪽", /resizeHandleRight\b|["'`]e["'`]|handle--right/],
  ["오른쪽 아래", /bottom[-_]right|bottomRight|["'`]se["'`]|handle--se/],
  ["아래", /resizeHandleBottom\b|["'`]s["'`]|handle--bottom/],
  ["왼쪽 아래", /bottom[-_]left|bottomLeft|["'`]sw["'`]|handle--sw/],
  ["왼쪽", /resizeHandleLeft\b|["'`]w["'`]|handle--left/],
]) {
  assert.match(slideSurfaceSource, aliases, `글상자 ${name} 크기 조절 손잡이`);
}
for (const label of ["굵게", "기울임", "글자 색", "삭제", "완료"]) {
  assert.match(slideSurfaceSource, new RegExp(label), `글상자 서식 막대: ${label}`);
}
assert.doesNotMatch(slideSurfaceSource, /textBoxMoveHandle|textBoxResizeHandle|↕|↘/, "옛 글상자 이동·크기 손잡이를 제거한다");
assert.doesNotMatch(slideSurfaceStyles, /textBoxMoveHandle|textBoxResizeHandle|↕|↘/, "옛 글상자 손잡이 CSS를 제거한다");

assert.ok(/--(?:report-)?(?:side|panel)-width\s*:\s*288px/.test(reportModeStyles) || /\.(?:drawerCard|sidePanel|panelCard|railPopover)[^{]*\{[^}]*width:\s*(?:288px|min\(288px)/.test(reportModeStyles), "모든 보고서 사이드창의 공통 폭은 288px이다");
assert.match(panelSource, /(?:sidePanelOpacity|panelOpacity|sharedOpacity|windowOpacity|\[opacity,\s*setOpacity\])/, "모든 사이드창이 공유하는 투명도 상태가 있다");
assert.match(panelSource, /type=["']range["']/, "사이드창 투명도는 range 입력이다");
assert.match(panelSource, /min=\{?(?:40|SIDE_PANEL_OPACITY_MIN)\}?/, "창 투명도 최소값은 40이다");
assert.match(panelSource, /max=\{?(?:100|SIDE_PANEL_OPACITY_MAX)\}?/, "창 투명도 최대값은 100이다");
assert.match(panelSource, /step=\{?(?:5|SIDE_PANEL_OPACITY_STEP)\}?/, "창 투명도 간격은 5이다");
assert.match(panelSource, /aria-label=["']창 투명도["']/, "창 투명도 range에 접근성 이름이 있다");
assert.match(panelSource, /localStorage/, "창 투명도는 localStorage에 기억한다");
assert.match(panelSource, /try\s*\{|catch\s*\(/, "창 투명도 localStorage 실패를 안전하게 처리한다");
assert.match(reportModeSource + drawerPagesSource + drawerTilesSource, /(?:SidePanelHeader|PanelHeader|CommonPanelHeader|ReportPanelHeader|SharedPanelHeader)/, "서랍과 팝오버는 공통 머리 컴포넌트를 쓴다");
assert.match(reportModeStyles, /\.tileList\s*\{[^}]*grid-template-columns:\s*repeat\(2,/, "사이드창 타일은 2열이다");
assert.match(reportModeStyles, /(?:aspect-ratio:\s*4\s*\/\s*3|grid-template-rows:[^;]*4\s*\/\s*3)/, "사이드창 카드는 4:3 비율이다");
assert.match(reportModeStyles, /\.railButton\s*\{[^}]*\b(?:width|inline-size):\s*44px;[^}]*\b(?:height|block-size):\s*44px;/, "레일 버튼은 모두 고정 44×44px이다");
assert.match(reportModeStyles, /\.toolPill\s*\{[^}]*width:\s*56px;[^}]*.*(?:place-items:\s*center|justify-items:\s*center)/s, "도구 막대는 56px 열 안에서 아이콘을 가운데 정렬한다");
assert.doesNotMatch(railSource, /<span(?![^>]*railTooltip)[^>]*>\s*(페이지|분석 타일|글상자|글자 크기|레이아웃|메모)\s*<\/span>/, "레일 버튼에 보이는 옛 라벨을 남기지 않는다");
assert.ok((railSource.match(/aria-label=/g) ?? []).length >= 6, "아이콘 전용 레일 버튼은 aria-label을 유지한다");
assert.match(reportModeSource + reportModeStyles, /(?:tooltip|railTooltip|data-tooltip|role=["']tooltip["'])/i, "레일은 흰 툴팁 계약을 가진다");
assert.match(reportModeStyles, /400ms|\.4s/, "레일 hover 툴팁은 0.4초 지연을 가진다");
assert.match(reportModeStyles, /focus-visible/, "레일 툴팁은 키보드 focus-visible 상태를 지원한다");
assert.doesNotMatch(reportModeStyles, /drawerLinkAction/, "옛 파란 글자 보조 버튼 CSS를 제거한다");
assert.doesNotMatch(drawerPagesSource, /drawerLinkAction/, "페이지 서랍은 파란 글자 보조 버튼을 쓰지 않는다");
assert.doesNotMatch(reportModeSource, /styles\.linkButton\b/, "빈 보고서의 옛 파란 글자 버튼을 제거한다");
assert.match(drawerPagesSource, /secondaryAction/, "페이지 서랍 보조 동작은 모양 있는 버튼을 쓴다");

assert.match(drawerTilesSource, /SlideSurface/, "분석 타일 카드가 SlideSurface를 사용한다");
assert.match(drawerTilesSource, /mode=["']thumb["']|mode=\{["']thumb["']\}/, "분석 타일 카드는 thumb SlideSurface를 사용한다");
assert.match(drawerTilesSource, /IntersectionObserver|useInView|visible(?:Tile|Cards?|Only)|virtual(?:ize|ized)/i, "분석 타일은 보이는 카드만 실제 렌더한다");
assert.match(drawerTilesSource, /(?:tilePreview|tileCardPreview)[\s\S]*SlideSurface|SlideSurface[\s\S]*(?:tilePreview|tileCardPreview)/, "실제 타일 렌더가 카드 미리보기 영역을 채운다");

console.log("v2 report B layout contract tests passed (GREEN)");
