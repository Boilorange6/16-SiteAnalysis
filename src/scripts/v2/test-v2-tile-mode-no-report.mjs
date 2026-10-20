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

assert.deepEqual(
  Object.keys(exportAvailability({ activeJobs: false, making: false, sceneReady: true })),
  ["dxf", "glb", "dae", "3dm"],
  "타일 모드 파일 메뉴는 3D/CAD 내보내기만 제공한다",
);

console.log("v2 tile mode no-report tests passed");
