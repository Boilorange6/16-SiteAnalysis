import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { CAMERA_PRESETS, projectMass } = await import("../../lib/v2/ui/mass-projection.ts");
const { default: MassFigure } = await import("../../components/v2/mass-figure.tsx");
const { parseTileResult } = await import("../../lib/v2/tile-result.ts");
const { initBoard } = await import("../../lib/v2/ui/board-state.ts");
const { toSummaryView, toTileView } = await import("../../lib/v2/ui/tile-view.ts");
const { buildReportPlan, mapKeyOf } = await import("../../lib/v2/report/report-plan.ts");
const { renderReportPptx } = await import("../../lib/v2/report/render-pptx.ts");
const JSZip = (await import("jszip")).default;

const ring = (x, y, size = 10) => [[x - size, y - size], [x + size, y - size], [x + size, y + size], [x - size, y + size], [x - size, y - size]];
const scene = {
  version: "v2-scene@2",
  analysisId: "mass-test",
  manifestHash: "a".repeat(64),
  origin: { epsg: "EPSG:5179", x: 1000000, y: 2000000, lng: 127.1, lat: 37.5 },
  radiusM: 100,
  ground: { kind: "flat" },
  site: [ring(0, 0, 80)],
  buildings: [
    { id: "far", rings: [ring(40, 40, 8)], baseZ: null, heightM: 20, heightMethod: "source", floorsAbove: 6, useCode: null, approvalDate: null },
    { id: "near", rings: [ring(-40, -40, 8)], baseZ: null, heightM: 20, heightMethod: "source", floorsAbove: 6, useCode: null, approvalDate: null },
    { id: "unknown", rings: [ring(0, 0, 6)], baseZ: null, heightM: null, heightMethod: "unknown", floorsAbove: null, useCode: null, approvalDate: null },
  ],
  parcels: [],
  counts: { buildingsTotal: 3, buildingsIncluded: 3, parcelsTotal: 0, parcelsIncluded: 0 },
  sources: [{ sourceId: "building", releaseId: "2026-09-30", sourceAsOf: "2026-09-30", fetchedAt: "2026-09-30T00:00:00+09:00" }],
  limitations: [],
};
const camera = { azimuthDeg: 225, elevationDeg: 35, radiusM: 100 };

assert.deepEqual(CAMERA_PRESETS, {
  azimuth: [45, 135, 225, 315],
  elevation: [20, 35, 55],
});

const projection = projectMass(scene, camera, 800, 500);
const sourceFaces = projection.faces.filter((face) => face.layer === "mass_source");
assert.equal(sourceFaces.length, 6, "두 정육면체의 지붕 2개와 보이는 벽 4개");
assert.ok(sourceFaces.every((face, i) => i === 0 || sourceFaces[i - 1].depth <= face.depth), "먼 건물 면부터 깊이순으로 그린다");
assert.equal(projection.faces.filter((face) => face.layer === "mass_unknown").length, 1, "높이 미상 건물은 바닥 모양 하나만 그린다");
assert.ok(projection.scale > 0);

const markup = renderToStaticMarkup(createElement(MassFigure, { scene, camera, width: 800, height: 500, fixed: true }));
assert.ok((markup.match(/<path/g) ?? []).length >= 3, "매스 SVG는 path를 그린다");
assert.match(markup, /확보 높이/);
assert.match(markup, /높이 미상/);
assert.match(markup, /지형 미반영/);

const demScene = {
  ...scene,
  version: "v2-scene@2",
  ground: {
    kind: "dem",
    cellM: 10,
    cols: 3,
    rows: 3,
    originZ: 100,
    z: [0, 0, 0, 0, 10, 0, 0, 0, 0],
    resolutionM: 30,
    vertical: "EGM96",
    sourceId: "terrain-sample",
  },
  buildings: [
    { ...scene.buildings[0], baseZ: 10 },
  ],
};
const demProjection = projectMass(demScene, camera, 800, 500);
assert.equal(demProjection.faces.filter((face) => face.layer === "ground").length, 4, "3×3 지반 표본은 2×2 셀을 그린다");
assert.ok(demProjection.faces.some((face) => face.layer === "ground" && face.shade > 0.4));
assert.ok(demProjection.faces.every((face, index) => index === 0 || demProjection.faces[index - 1].depth <= face.depth), "DEM 셀과 건물 면을 함께 깊이 정렬한다");
const demMarkup = renderToStaticMarkup(createElement(MassFigure, { scene: demScene, camera, width: 800, height: 500, fixed: true }));
assert.match(demMarkup, /지형\(30m 격자\)/);

const demBaseZero = projectMass({ ...demScene, buildings: [{ ...demScene.buildings[0], baseZ: 0 }] }, camera, 800, 500);
const yAverage = (path) => [...path.matchAll(/(?:^|[ML])[-.0-9]+ ([-.0-9]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0) /
  Math.max(1, [...path.matchAll(/(?:^|[ML])[-.0-9]+ ([-.0-9]+)/g)].length);
assert.ok(yAverage(demProjection.faces.find((face) => face.layer === "mass_source").path) < yAverage(demBaseZero.faces.find((face) => face.layer === "mass_source").path), "baseZ가 지붕을 화면 위로 올린다");

const missingGround = {
  ...demScene,
  ground: { ...demScene.ground, z: [null, 0, 0, 0, 10, 0, 0, 0, 0] },
};
assert.equal(projectMass(missingGround, camera, 800, 500).faces.filter((face) => face.layer === "ground").length, 3, "결측 셀은 생략한다");

const tile = parseTileResult({
  tileId: "t-S01",
  analysisId: "analysis-1",
  tileType: "simulation",
  tileCode: "S01",
  status: "complete",
  engineVersion: "v2-p2-spatial-2",
  conditions: { address: "테스트", center: [127.1, 37.5], radiusM: 100, analysisDate: "2026-09-30", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [{ id: "buildings", label: "반경 안 건물", value: 1, unit: "동", formulaVersion: "test@1", numerator: 1, denominator: 1, status: "observed" }],
  judgment: { ruleId: "test@1", basisMetricIds: ["buildings"], sentence: "건물 1동 확인 → 매스를 표시 → 높이 확인 필요", level: null, criteria: null },
  presentation: { legend: [], camera: { kind: "axonometric", azimuthDeg: 225, elevationDeg: 35, radiusM: 100 }, layers: ["mass_source", "mass_estimated", "mass_unknown"], outputFace: "front" },
  provenance: { manifestHash: "a".repeat(64), sources: [{ sourceId: "building", releaseId: "2026-09-30", sourceAsOf: "2026-09-30", fetchedAt: "2026-09-30T00:00:00+09:00" }] },
  limitations: [],
});
const view = toTileView(tile, scene);
assert.equal(view.mass?.scene?.analysisId, "mass-test");
const board = initBoard([tile]);
const plan = buildReportPlan({ summary: toSummaryView({ address: "테스트", areaM2: null, zoning: null, radiusM: 100, facts: [] }, [tile]), views: new Map([[tile.tileId, view]]), board, analysisDate: "2026-09-30" });
const massSlide = plan.find((p) => p.kind === "tile");
assert.ok(massSlide && massSlide.kind === "tile");
assert.equal(mapKeyOf(massSlide), "t-S01:mass");
const zip = await JSZip.loadAsync(await renderReportPptx(plan));
const xml = await zip.file("ppt/slides/slide2.xml").async("string");
assert.match(xml, /DXF·GLB는 내보내기에서/);

console.log("✓ v2 S01 mass projection, figure, and report integration");
