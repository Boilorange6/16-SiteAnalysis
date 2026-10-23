import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { defaultFrame } = await import("../../lib/v2/report/report-doc.ts");
const { sheetView } = await import("../../lib/v2/ui/sheet.ts");
const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");

const surfaceSource = readFileSync(new URL("../../components/v2/report/slide-surface.tsx", import.meta.url), "utf8");
const modeSource = readFileSync(new URL("../../components/v2/report/report-mode.tsx", import.meta.url), "utf8");
const surfaceCss = readFileSync(new URL("../../components/v2/report/slide-surface.module.css", import.meta.url), "utf8");

assert.match(surfaceSource, /function SheetCellEditSurface\s*\(/, "조판 칸 크게 편집 표면이 있다");
assert.match(surfaceSource, /크게 편집/, "칸 공통 막대에 크게 편집이 있다");
assert.match(surfaceSource, /범위 맞추기/, "칸 공통 막대에 범위 맞추기가 있다");
assert.match(surfaceSource, /sheetCellEditing/, "큰 편집은 문서가 아닌 표면 상태로 전달된다");
assert.match(surfaceSource, /onSheetCellNavigate/, "큰 편집은 이전·다음 칸 이동을 지원한다");
assert.match(modeSource, /type: "copyExtent"/, "범위 맞추기는 copyExtent 한 action을 사용한다");
assert.match(modeSource, /type: "removeCell"/, "칸 지우기는 removeCell action을 사용한다");
assert.match(surfaceCss, /sheetCellEditHeader/, "큰 편집 머리 줄은 흰 카드다");
assert.match(surfaceCss, /sheetCellEditDone/, "큰 편집 완료 버튼 스타일이 있다");
assert.match(surfaceCss, /\.sheetSlide\s*\{[\s\S]*position:\s*absolute/, "조판 무대가 슬라이드 전체를 채운다");
assert.match(surfaceCss, /\.sheetCell\s*\{[\s\S]*position:\s*absolute/, "조판 칸이 계산된 격자 위치를 사용한다");
assert.match(surfaceCss, /\.sheetCellButton\s*\{[\s\S]*inset:\s*0/, "조판 칸 선택 히트 영역이 칸 전체다");

const source = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
assert.ok(source, "A01 fixture");
const tile = toTileView(source);
const summary = toSummaryView(GODEOK_SUMMARY, [source]);
const sheet = sheetView("sheet-edit", [tile], "2x2");
const page = {
  id: "p-sheet",
  layout: "map-summary",
  panels: {},
  textBoxes: [],
  notes: "",
  kind: "compare",
  grid: "2x2",
  sameExtent: false,
  cells: [{ tileId: tile.tileId, settings: { face: "front", callout: "overview" }, frame: defaultFrame() }, null, null, null],
};
const slide = {
  kind: "sheet",
  view: sheet,
  grid: "2x2",
  cells: [{ view: tile, face: "front", mapKey: "cell-0", reportFrame: defaultFrame() }, null, null, null],
  no: 1,
  total: 1,
  footer: "출처 없음",
  key: "p-sheet",
  style: {},
  page,
};
const markup = renderToStaticMarkup(createElement(SlideSurface, {
  slide,
  basemap: "none",
  mode: "edit",
  selection: { kind: "sheetCell", cell: 0 },
  sheetCellEditing: 0,
  onSheetCellDone: () => undefined,
  onSheetCellNavigate: () => undefined,
  onFrame: () => undefined,
}));
assert.match(markup, /data-sheet-cell-editing="true"/, "큰 편집 표면 식별자");
assert.match(markup, /조판 1 \/ 4/, "큰 편집 위치 표시");
assert.match(markup, /칸 비율 그대로 크게 · 이 칸에만 적용/, "큰 편집은 현재 칸에만 적용된다는 안내를 표시한다");
assert.match(markup, />완료<\//, "큰 편집 완료 입구");
assert.match(markup, /aria-label="이전 조판 칸"/, "이전 칸 입구");
assert.match(markup, /aria-label="다음 조판 칸"/, "다음 칸 입구");

console.log("v2 report sheet edit contract tests passed");
