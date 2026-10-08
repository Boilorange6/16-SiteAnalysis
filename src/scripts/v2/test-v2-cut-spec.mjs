/** T31 CutSpec: 모든 시뮬레이션 컷·대기 선택·PPT 노트 계약. */
import assert from "node:assert/strict";
import JSZip from "jszip";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { boardReducer, defaultCutForCode, initBoard, reportPages } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { cutCandidates, viewForCut } = await import("../../lib/v2/ui/cut-selection.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const source = GODEOK_RESULTS.find((result) => result.tileCode === "D04");
const raster = (name, palette = name.startsWith("utci_") ? "utci" : name.startsWith("wind_") ? "wind_ratio" : name.startsWith("shade_") ? "shade_mask" : "sun_hours") => ({
  name,
  kind: palette === "wind_ratio" ? "vector2" : palette === "shade_mask" ? "mask" : "scalar",
  crs: "EPSG:5179",
  x0: 0,
  y0: 0,
  cellM: 2,
  cols: 2,
  rows: 2,
  dtype: "u8",
  bands: 1,
  scale: 1,
  offset: 0,
  nodata: 255,
  palette,
  label: name,
  bytes: 4,
  sha256: "a".repeat(64),
});
const model = { station: "near", dirs: Array.from({ length: 16 }, () => [1, 0, 0, 0, 0]), calmHours: 0, missingHours: 0, totalHours: 100 };

function result(code, rasters = [], extra = {}) {
  return structuredClone({
    ...source,
    tileId: `t-${code}`,
    tileCode: code,
    tileType: "simulation",
    status: "complete",
    presentation: {
      ...source.presentation,
      features: [],
      featuresTotal: 0,
      polygons: [],
      polygonsTotal: 0,
      lines: [],
      rasters,
      ...(code === "D22" ? { rose: model, roses: { annual: model, spring: model, summer: model, autumn: model, winter: model } } : {}),
      ...extra,
    },
  });
}

function planFor(item, cut) {
  const board = boardReducer(initBoard([item]), { type: "cut", id: item.tileId, cut });
  const view = toTileView(item);
  const plan = buildReportPlan({ summary: toSummaryView(GODEOK_SUMMARY, [item]), views: new Map([[item.tileId, view]]), board, analysisDate: "2026-09-30" });
  assert.equal(plan.length, reportPages(board).pages, `${item.tileCode} report page count`);
  return { board, view, plan };
}

const s02Rasters = [
  "spring", "summer", "autumn", "winter",
].flatMap((season) => [raster(`sun_hours_${season}`), raster(`shade_${season}_flow`)]).concat(
  ["09", "13", "15"].map((hour) => raster(`shade_summer_h${hour}`)),
);
const s02 = result("S02", s02Rasters);
const s02Metric = (id, label, value, unit) => ({ ...s02.metrics[0], id, label, value, unit, status: "estimated" });
s02.metrics = [
  s02Metric("mean_sun_h_winter", "동지 평균 일조시간", 4.7, "시간"),
  s02Metric("mean_sun_h_spring", "춘분 평균 일조시간", 7.2, "시간"),
  s02Metric("mean_sun_h_summer", "하지 평균 일조시간", 8.1, "시간"),
  s02Metric("mean_sun_h_autumn", "추분 평균 일조시간", 6.8, "시간"),
  s02Metric("share_cont2h_0915_pct_spring", "춘분 진태양시 09~15 연속 2시간 확보", 91.2, "%"),
  s02Metric("share_total4h_0816_pct_spring", "춘분 진태양시 08~16 총 4시간 확보", 88.4, "%"),
];
s02.judgment = { ...s02.judgment, sentence: "동지 반경 안 지면의 평균 일조 4.7 시간 → 추정" };
const s02View = toTileView(s02);
const s02SpringView = viewForCut(s02View, { tile: "S02", mode: "single", date: "spring" });
assert.equal(s02SpringView.map?.defaultRaster, "sun_hours_spring");
assert.equal(s02SpringView.headline?.label, "춘분 평균 일조시간");
assert.equal(s02SpringView.headline?.value, "7.2시간");
assert.match(s02SpringView.notes[1] ?? "", /^춘분 일조시간 · 계절 레이어/);
// 판단 문장은 동지 기준 숫자(4.7 시간)를 담고 있으므로 계절명만 바꾸지 않는다
assert.equal(s02SpringView.sentence, s02View.sentence);
const s02Hours = planFor(s02, { tile: "S02", mode: "hours3", date: "summer" });
const s02Sheet = s02Hours.plan.find((slide) => slide.kind === "sheet");
assert.equal(s02Sheet?.grid, "3x1");
assert.deepEqual(s02Sheet?.cells.map((cell) => cell.view.map.rasters[0].name), ["shade_summer_h09", "shade_summer_h13", "shade_summer_h15"]);
assert.deepEqual(s02Sheet?.cells.map((cell) => cell.view.notes[0]), ["하지 09:00", "하지 13:00", "하지 15:00"]);
const s02Seasons = planFor(s02, { tile: "S02", mode: "seasons4" });
assert.equal(s02Seasons.plan.find((slide) => slide.kind === "sheet")?.grid, "2x2");
assert.deepEqual(s02Seasons.plan.find((slide) => slide.kind === "sheet")?.cells.map((cell) => cell.view.map.rasters[0].name), ["sun_hours_spring", "sun_hours_summer", "sun_hours_autumn", "sun_hours_winter"]);
const s02Flow = planFor(s02, { tile: "S02", mode: "flow", date: "summer" });
assert.equal(s02Flow.plan.filter((slide) => slide.kind === "sheet").length, 1);
assert.equal(s02Flow.plan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-S02")?.view.map.rasters[0].name, "shade_summer_flow");

const s03 = result("S03", ["spring", "summer", "autumn", "winter"].map((season) => raster(`wind_${season}_z06`)));
const s03Plan = planFor(s03, { tile: "S03", mode: "seasons4", layerZ: 6 });
assert.equal(s03Plan.plan.find((slide) => slide.kind === "sheet")?.grid, "2x2");
assert.equal(s03Plan.plan.find((slide) => slide.kind === "sheet")?.cells[1].view.notes[0], "여름 6m");

const s04 = result("S04", ["spring", "summer", "autumn", "winter"].flatMap((season) => [10, 14, 18].map((hour) => raster(`utci_${season}_h${hour}`))));
const s04Single = planFor(s04, { tile: "S04", mode: "single", season: "summer", hour: 14 });
const s04Tile = s04Single.plan.find((slide) => slide.kind === "tile" && slide.view.tileId === "t-S04");
assert.equal(s04Tile?.view.map.rasters[0].name, "utci_summer_h14");
assert.equal(s04Tile?.view.notes[0], "여름 14시");
const s04Hours = planFor(s04, { tile: "S04", mode: "hours3", season: "summer" });
assert.deepEqual(s04Hours.plan.find((slide) => slide.kind === "sheet")?.cells.map((cell) => cell.view.map.rasters[0].name), ["utci_summer_h10", "utci_summer_h14", "utci_summer_h18"]);

const d22 = result("D22");
const d22Plan = planFor(d22, { tile: "D22", mode: "seasons4" });
assert.equal(d22Plan.plan.find((slide) => slide.kind === "sheet")?.grid, "2x2");
assert.deepEqual(d22Plan.plan.find((slide) => slide.kind === "sheet")?.cells.map((cell) => cell.roseSeason), ["spring", "summer", "autumn", "winter"]);

const pendingS04 = toTileView(result("S04", [raster("utci_summer_h14")]));
const pending = cutCandidates(pendingS04, defaultCutForCode("S04"));
assert.equal(pending.find((candidate) => candidate.label === "단일 · 여름 14시")?.disabled, false);
assert.equal(pending.find((candidate) => candidate.label === "단일 · 겨울 14시")?.disabled, true);
assert.equal(pending.find((candidate) => candidate.label.startsWith("계절 4컷"))?.disabled, true);

const xmlZip = await JSZip.loadAsync(await renderReportPptx(s02Hours.plan));
const sheetXml = await xmlZip.file("ppt/slides/slide2.xml").async("string");
assert.match(sheetXml, /하지 13:00/);

assert.deepEqual(defaultCutForCode("S01"), { tile: "S01", mode: "mass" });
console.log("✓ v2 CutSpec generalized S01/S02/S03/S04/D22 plans, pending choices, and PPT notes");
