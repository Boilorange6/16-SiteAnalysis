import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const {
  MASS_3D_COLORS,
  MASS_VERTICAL_EXAGGERATION,
  mass3dBuildingBottomZ,
  mass3dExtrusionSpecs,
  mass3dHeightCategory,
  mass3dExtrusionVertices,
  polygonizeMassRings,
} = await import("../../lib/v2/ui/mass-3d-model.ts");
const { mass3dCacheKey } = await import("../../lib/v2/ui/mass-3d-runtime.ts");

const ring = (x, y, size) => [[x - size, y - size], [x + size, y - size], [x + size, y + size], [x - size, y + size], [x - size, y - size]];
const ground = {
  kind: "dem",
  cellM: 10,
  cols: 3,
  rows: 3,
  originZ: 100,
  z: [0, 0, 0, 0, 12, 0, 0, 0, 0],
  resolutionM: 30,
  vertical: "EGM96",
  sourceId: "test-dem",
};

assert.equal(MASS_VERTICAL_EXAGGERATION, 1, "3D 높이 과장은 1.0이어야 한다");
const building = {
  id: "with-hole",
  rings: [ring(0, 0, 20), ring(0, 0, 5)],
  baseZ: 12,
  heightM: 18,
  heightMethod: "source",
  floorsAbove: 6,
  useCode: "01000",
  approvalDate: "2020-01-01",
};
const polygons = polygonizeMassRings(building.rings);
assert.equal(polygons.length, 1, "외곽 링 하나로 묶는다");
assert.equal(polygons[0].holes.length, 1, "내부 링은 Shape 구멍으로 보존한다");
const specs = mass3dExtrusionSpecs(building, ground);
assert.equal(specs[0].bottomZ, 12, "건물 바닥은 엔진 baseZ/지형 표고를 쓴다");
assert.equal(specs[0].topZ, 30, "높이는 1.0 배율로만 더한다");
assert.equal(specs[0].vertices.length, 16, "외곽·구멍의 바닥/지붕 정점을 모두 만든다");
const vertices = mass3dExtrusionVertices(polygons[0], 12, 18);
assert.ok(vertices.slice(0, 10).some(([x, y, z]) => x === -20 && y === -20 && z === 12), "바닥 외곽 정점을 유지한다");
assert.ok(vertices.slice(8, 12).some(([x, y, z]) => x === 5 && y === 5 && z === 12), "바닥 구멍 정점을 유지한다");

const derivedBase = { ...building, id: "derived", baseZ: null, rings: [ring(0, 0, 2)] };
assert.equal(mass3dBuildingBottomZ(derivedBase, ground), 12, "baseZ가 비면 DEM 중심 표고를 샘플한다");
assert.equal(mass3dHeightCategory(building), "confirmed");
assert.equal(mass3dHeightCategory({ heightM: 3, heightMethod: "assumed_one_floor" }), "estimated");
assert.equal(mass3dHeightCategory({ heightM: null, heightMethod: "unknown" }), "unknown");
assert.notEqual(MASS_3D_COLORS.confirmed, MASS_3D_COLORS.estimated);
assert.notEqual(MASS_3D_COLORS.estimated, MASS_3D_COLORS.unknown);

const input = { scene: { analysisId: "a", manifestHash: "m" }, camera: { azimuthDeg: 225, elevationDeg: 35, radiusM: 100 }, width: 960, height: 540 };
assert.notEqual(mass3dCacheKey(input), mass3dCacheKey({ ...input, exploded: { spreadPct: 24, scheme: "use" } }), "분해 키는 기본 매스와 분리한다");
assert.notEqual(mass3dCacheKey(input), mass3dCacheKey({ ...input, camera: { ...input.camera, azimuthDeg: 315 } }), "카메라 키를 캐시 키에 포함한다");

const runtimeSource = readFileSync(resolve(import.meta.dirname, "../../lib/v2/ui/mass-3d-runtime.ts"), "utf8");
const reportSource = readFileSync(resolve(import.meta.dirname, "../../lib/v2/report/map-image.ts"), "utf8");
assert.match(runtimeSource, /WebGLRenderer/);
assert.match(runtimeSource, /PCFSoftShadowMap/);
assert.match(runtimeSource, /disposeMassObject/);
assert.match(reportSource, /renderMass3dPng/);
assert.match(reportSource, /image\/png/);

console.log("✓ v2 S01 three.js model contract, cache, and PNG report path");
