import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { CAMERA_PRESETS, EXPLODED_LAYERS, projectExploded, projectMass } = await import("../../lib/v2/ui/mass-projection.ts");
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

const contextScene = {
  ...scene,
  context: {
    water: [[ring(55, -20, 12)]],
    green: [[ring(-45, 25, 18)]],
    roads: [{ points: [[-90, 0], [90, 0]], widthM: 8, hierarchy: "집산" }],
  },
};

assert.deepEqual(CAMERA_PRESETS, {
  azimuth: [45, 135, 225, 315],
  elevation: [20, 35, 55],
});
assert.deepEqual(EXPLODED_LAYERS, ["terrain", "water", "green", "roads", "buildings", "complete"]);

const projection = projectMass(scene, camera, 800, 500);
const sourceFaces = projection.faces.filter((face) => face.layer === "mass_source");
assert.equal(sourceFaces.length, 6, "두 정육면체의 지붕 2개와 보이는 벽 4개");
assert.ok(sourceFaces.every((face, i) => i === 0 || sourceFaces[i - 1].depth <= face.depth), "먼 건물 면부터 깊이순으로 그린다");
assert.equal(projection.faces.filter((face) => face.layer === "mass_unknown").length, 1, "높이 미상 건물은 바닥 모양 하나만 그린다");
assert.ok(projection.scale > 0);

const exploded = projectExploded(contextScene, camera, 800, 700, 100);
assert.deepEqual(exploded.labels.map((label) => label.layer), [...EXPLODED_LAYERS], "분해 라벨은 아래층부터 완성층 순서다");
assert.ok(exploded.labels.every((label, index) => index === 0 || label.y < exploded.labels[index - 1].y), "분해 층 라벨의 화면 y는 위로 단조 증가한다");
assert.equal(exploded.plates?.length, EXPLODED_LAYERS.length, "분해 층마다 동일한 원판을 만든다");
assert.equal(exploded.guides?.length, (EXPLODED_LAYERS.length - 1) * 2, "좌우 원판 접선 가이드를 층 사이마다 만든다");
const plateWidths = exploded.plates.map((plate) => plate.rightX - plate.leftX);
assert.ok(Math.max(...plateWidths) - Math.min(...plateWidths) < 0.01, "모든 원판은 같은 투영 폭을 쓴다");
assert.ok(exploded.guides.every((guide) => guide.y1 !== guide.y2 && Number.isFinite(guide.x)), "가이드는 spread로 분리된 원판을 연결한다");
assert.ok(exploded.labels.every((label) => {
  const plate = exploded.plates.find((candidate) => candidate.layer === label.layer);
  return plate && Math.abs(label.x - plate.leftX - 10) < 0.01;
}), "층 라벨은 각 원판의 왼쪽 림에 맞춘다");
for (const layer of EXPLODED_LAYERS) {
  assert.ok(exploded.faces.some((face) => face.layer === layer), `${layer} 층을 그린다`);
}
assert.ok(exploded.faces.filter((face) => face.layer === "roads").length >= 1, "도로 폭을 가진 리본 면을 그린다");
const outlierContext = projectExploded({
  ...contextScene,
  context: { ...contextScene.context, roads: [{ points: [[-10000, 0], [10000, 0]], widthM: 80, hierarchy: "간선" }] },
}, camera, 800, 700, 100);
assert.deepEqual(outlierContext.plates, exploded.plates, "반경 밖으로 튀는 맥락선도 원판 축척을 흔들지 않는다");
assert.deepEqual(projectExploded(contextScene, camera, 800, 700, 100), exploded, "분해 SVG 입력은 결정적이다");

const legacyExploded = projectExploded(scene, camera, 800, 700, 100);
assert.deepEqual(new Set(legacyExploded.faces.map((face) => face.layer)), new Set(["terrain", "buildings", "complete"]), "맥락 없는 옛 장면은 지형·건물·완성만 그린다");
assert.match(legacyExploded.labels.find((label) => label.layer === "water").text, /자료 없음/);
assert.match(legacyExploded.labels.find((label) => label.layer === "green").text, /자료 없음/);
assert.match(legacyExploded.labels.find((label) => label.layer === "roads").text, /자료 없음/);

const roadsOnly = projectExploded({
  ...scene,
  context: { roads: contextScene.context.roads, green: [], water: [] },
}, camera, 800, 700, 100);
assert.ok(roadsOnly.faces.some((face) => face.layer === "roads"), "부분 맥락 장면은 확보된 도로를 유지한다");
assert.ok(!roadsOnly.faces.some((face) => face.layer === "water" || face.layer === "green"), "빈 수계·녹지 층은 면을 만들지 않는다");
assert.match(roadsOnly.labels.find((label) => label.layer === "water").text, /자료 없음/);
assert.match(roadsOnly.labels.find((label) => label.layer === "green").text, /자료 없음/);

const markup = renderToStaticMarkup(createElement(MassFigure, { scene, camera, width: 800, height: 500, fixed: true }));
assert.ok((markup.match(/<path/g) ?? []).length >= 3, "매스 SVG는 path를 그린다");
assert.match(markup, /확보 높이/);
assert.match(markup, /높이 미상/);
assert.match(markup, /지형 미반영/);

const explodedMarkup = renderToStaticMarkup(createElement(MassFigure, { scene: contextScene, camera, width: 800, height: 700, fixed: true, exploded: { spreadPct: 100 } }));
assert.match(explodedMarkup, /data-face-layer="water"/);
assert.match(explodedMarkup, /data-face-layer="green"/);
assert.match(explodedMarkup, /data-face-layer="roads"/);
assert.match(explodedMarkup, /data-face-layer="complete"/);
assert.match(explodedMarkup, /data-layer-label="complete"/);
for (const layer of EXPLODED_LAYERS) assert.match(explodedMarkup, new RegExp(`data-plate-layer="${layer}"`));
assert.equal((explodedMarkup.match(/<clipPath/g) ?? []).length, EXPLODED_LAYERS.length, "각 원판은 전용 clipPath를 가진다");
assert.equal((explodedMarkup.match(/data-guide-side=/g) ?? []).length, (EXPLODED_LAYERS.length - 1) * 2, "좌우 점선 가이드를 렌더링한다");
assert.match(explodedMarkup, /stroke-dasharray="4 5"/);
const emptyMarkup = renderToStaticMarkup(createElement(MassFigure, { scene, camera, width: 800, height: 700, fixed: true, exploded: { spreadPct: 60 } }));
assert.match(emptyMarkup, /수계 · 자료 없음/);
assert.match(emptyMarkup, /녹지 · 자료 없음/);
assert.match(emptyMarkup, /도로 · 자료 없음/);
assert.match(emptyMarkup, /data-plate-state="empty"/);
assert.equal((emptyMarkup.match(/data-plate-layer=/g) ?? []).length, EXPLODED_LAYERS.length, "빈 맥락층도 빈 원판을 유지한다");

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
