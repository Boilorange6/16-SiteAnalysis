import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
globalThis.React = React;
require.extensions[".css"] = (module) => {
  const styles = new Proxy({}, { get: (_target, key) => typeof key === "string" ? key : undefined });
  module.exports = { __esModule: true, default: styles };
};

const { GODEOK_RESULTS } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { default: TileCard } = await import("../../components/v2/tile-card.tsx");
const { default: TileDialog } = await import("../../components/v2/tile-dialog.tsx");
const { exportAvailability } = await import("../../lib/v2/ui/board-status.ts");

const result = GODEOK_RESULTS.find((item) => item.tileCode === "A01");
assert.ok(result, "A01 fixture가 필요하다");
const view = toTileView(result);

const cardProps = {
  view,
  analysisId: result.analysisId,
  layer: view.defaultLayer,
  onLayer: () => {},
  phase: null,
  canUp: false,
  canDown: false,
  size: 1,
  cellW: 320,
  rowH: 240,
  dragging: false,
  onHandleDown: () => {},
  onAction: () => {},
  cut: null,
  pinnedLabels: [],
  showMapLabels: false,
  cardFace: "summary",
  rovingTabIndex: 0,
  onRovingFocus: () => {},
  onRovingMove: () => {},
};

const summaryMarkup = renderToStaticMarkup(createElement(TileCard, cardProps));
const mapMarkup = renderToStaticMarkup(createElement(TileCard, { ...cardProps, cardFace: "map" }));
const dialogMarkup = renderToStaticMarkup(createElement(TileDialog, {
  view,
  layer: view.defaultLayer,
  onLayer: () => {},
  onRetry: () => {},
  cut: null,
  onCut: () => {},
  onClose: () => {},
  a05Filter: null,
  a05Counts: null,
  onA05Filter: () => {},
  pinnedLabels: [],
  onToggleLabel: () => {},
  onUnpinLabel: () => {},
  onSetAllLabels: () => {},
  address: "서울특별시 강동구 고덕동 250",
  analysisDate: "2026-10-19",
  terrainSection: "A",
  onTerrainSection: () => {},
}));

for (const [name, markup] of [["요약면", summaryMarkup], ["지도면", mapMarkup], ["상세 창", dialogMarkup]]) {
  assert.doesNotMatch(markup, /보고서/, `${name}에 보고서 조작이 남아 있다`);
  assert.doesNotMatch(markup, /aria-label="[^"]*보고서 포함/, `${name}에 보고서 포함 컨트롤이 남아 있다`);
}

const pageSource = readFileSync(new URL("../../app/v2/page.tsx", import.meta.url), "utf8");
assert.doesNotMatch(pageSource, /import\s+ReportPreview/, "page.tsx가 옛 ReportPreview를 import한다");

const reportModeSource = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const reportModeStyleSource = readFileSync(new URL("../../components/v2/report/report-mode.module.css", import.meta.url), "utf8");
const boardStyleSource = readFileSync(new URL("../../components/v2/board.module.css", import.meta.url), "utf8");
assert.doesNotMatch(reportModeSource, /styles\.reportHeader\b/, "ReportMode가 별도 보고서 머리 줄을 렌더링한다");
assert.doesNotMatch(reportModeSource, /대지분석 보고서/, "ReportMode에 옛 보고서 눈썹 제목이 남아 있다");
assert.match(reportModeSource, /createPortal/, "ReportMode가 topbar portal을 사용하지 않는다");
assert.match(reportModeSource, /document\.getElementById\("v2-report-actions"\)/, "ReportMode가 portal 대상을 찾지 않는다");
assert.match(reportModeSource, /<h1 className=\{styles\.srOnly\}>\{summary\.address\} 보고서<\/h1>/, "ReportMode에 화면 낭독기용 보고서 제목이 없다");
assert.match(pageSource, /<span className=\{styles\.spacer\} \/>\s*\{boardMode === "report" && <div id="v2-report-actions" className=\{styles\.reportActionsSlot\} \/>\}/, "보고서 topbar portal 대상이 spacer 뒤의 보고서 모드에 없다");
assert.match(reportModeSource, /className=\{styles\.reportHeaderActions\} inert=\{modalContentInert \|\| undefined\}/, "모달이 열려도 portal 보고서 동작 묶음이 inert가 아니다");
assert.doesNotMatch(pageSource, /보고서 · /, "모드 탭이 옛 점 구분 쪽수 표기를 사용한다");
assert.match(pageSource, /aria-label=\{`보고서, \$\{reportDocPageCount\}쪽`\}/, "보고서 모드 탭의 접근성 쪽수 라벨이 없다");
assert.match(pageSource, /보고서<span className=\{styles\.modeCount\}>\{reportDocPageCount\}<\/span>/, "보고서 모드 탭의 쪽수 배지가 없다");
assert.match(reportModeStyleSource, /\.reportRoot\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);/, "보고서 루트가 옛 머리 줄 행을 예약한다");
assert.doesNotMatch(reportModeStyleSource, /\.reportHeader\b|\.reportHeaderSpacer\b|\.reportHeading\b/, "죽은 보고서 머리 줄 CSS가 남아 있다");
assert.match(boardStyleSource, /\.reportActionsSlot\s*\{[\s\S]*display:\s*flex;[\s\S]*align-items:\s*center;[\s\S]*gap:\s*6px;/, "topbar 보고서 동작 칸 스타일이 없다");
assert.match(boardStyleSource, /\.modeCount\s*\{[\s\S]*margin-left:\s*6px;[\s\S]*color:\s*#676c76;[\s\S]*font-size:\s*12px;[\s\S]*font-weight:\s*500;/, "보고서 쪽수 배지 스타일이 없다");
assert.match(reportModeStyleSource, /\.exportPanel\s*\{[\s\S]*top:\s*8px;/, "내보내기 패널이 옛 보고서 머리 줄 아래 위치를 사용한다");

assert.deepEqual(
  Object.keys(exportAvailability({ activeJobs: false, making: false, sceneReady: true })),
  ["dxf", "glb", "dae", "3dm"],
  "타일 모드 파일 메뉴는 3D/CAD 내보내기만 제공한다",
);

console.log("v2 tile mode no-report tests passed");
