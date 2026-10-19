import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { SlideSurface } = await import("../../components/v2/report/slide-surface.tsx");

const source = GODEOK_RESULTS.find((result) => result.tileCode === "A01");
assert.ok(source, "A01 fixture가 필요하다");
const base = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, [source]),
  views: new Map([[source.tileId, toTileView(source)]]),
  board: initBoard([source]),
  analysisDate: "2026-10-19",
}).find((slide) => slide.kind === "tile" && slide.view.code === "A01");
assert.ok(base, "A01 표면 fixture가 필요하다");

const a3 = { ...base, no: 1, total: 1, key: "t-A01", format: "a3", page: { ...base.page, layout: "numbers-first" } };
const exportMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: a3, basemap: "none", mode: "export" }));
assert.match(exportMarkup, /aspect-ratio:16\.535 \/ 11\.693/, "A3 표면 비율");

const thumbMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: a3, basemap: "none", mode: "thumb" }));
assert.equal((thumbMarkup.match(/<button\b/g) ?? []).length, 0, "thumb 표면은 조작 버튼이 없다");
assert.match(exportMarkup, /data-surface-map[^>]*left:55%/, "numbers-first 지도 영역은 오른쪽에 있다");

const missing = {
  ...a3,
  key: "missing",
  missing: true,
  body: { kind: "state", face: "single", message: "결과 없음" },
  map: null,
};
const missingMarkup = renderToStaticMarkup(createElement(SlideSurface, { slide: missing, basemap: "none", mode: "export" }));
assert.match(missingMarkup, /결과 없음/, "missing 표면 문구");

console.log("v2 report surface tests passed");
