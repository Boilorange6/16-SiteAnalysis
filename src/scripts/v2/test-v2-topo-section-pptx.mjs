import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { GODEOK_RESULTS, GODEOK_SUMMARY } = await import("../../lib/v2/ui/fixtures/godeok.ts");
const { initBoard, boardReducer } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");

const source = GODEOK_RESULTS[0];
const section = (axis) => ({
  axis,
  from: [0, 0],
  to: [120, 0],
  samples: Array.from({ length: 25 }, (_, index) => ({ d: index * 5, z: 100 + Math.sin(index / 4) * 4 })),
  siteSpan: [35, 85],
  crossings: [
    { d: 60, kind: "retaining", heightM: 4.2 },
    { d: 85, kind: "fence", heightM: null },
  ],
});
const d17 = structuredClone({
  ...source,
  tileId: "t-D17-t10-ppt",
  tileCode: "D17",
  tileType: "analysis",
  status: "complete",
  presentation: {
    ...source.presentation,
    lines: [
      { layer: "terrain_section_a", points: [[127.15, 37.6245], [127.16, 37.6245]], label: "단면 A–A′ (동서)" },
      { layer: "terrain_section_b", points: [[127.155, 37.62], [127.155, 37.63]], label: "단면 B–B′ (남북)" },
    ],
    linesTotal: 2,
    terrainSections: { A: section("EW"), B: section("NS") },
  },
});

let board = initBoard([d17]);
board = boardReducer(board, { type: "terrainSection", id: d17.tileId, section: "B" });
const view = toTileView(d17);
const plan = buildReportPlan({
  summary: toSummaryView(GODEOK_SUMMARY, [d17]),
  views: new Map([[d17.tileId, view]]),
  board,
  analysisDate: "2026-10-19",
});
const d17Slide = plan.find((slide) => slide.kind === "tile" && slide.view.code === "D17");
assert.ok(d17Slide);
assert.equal(d17Slide.terrainSection, "B");

const bytes = await renderReportPptx([d17Slide]);
const outputDir = mkdtempSync(join(tmpdir(), "v2-t10-topo-section-pptx-"));
const outputPath = join(outputDir, "d17-topo-section.pptx");
writeFileSync(outputPath, bytes);
const zip = await JSZip.loadAsync(bytes);
const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
assert.ok(xml);
assert.match(xml, /단면 B–B′ \(남북\)/);
assert.match(xml, /높이 미확인/);
assert.match(xml, /대지 고저차/);
assert.match(xml, /등고선·표고점 보간값/);
assert.match(xml, /terrain-section/);
assert.match(xml, /prstDash val="dash"/);

console.log(`✓ v2 topo section PPT XML (${outputPath})`);
