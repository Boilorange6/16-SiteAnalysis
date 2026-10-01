import assert from "node:assert/strict";

let rhinoFactory;
try {
  rhinoFactory = (await import("rhino3dm")).default;
} catch {
  console.log("SKIP: rhino3dm 미설치");
  process.exit(0);
}

const rhino = await rhinoFactory();
const { RHINO_LAYERS, sceneTo3dm } = await import("../../lib/v2/export/rhino.ts");

const scene = {
  version: "v2-scene@2",
  analysisId: "analysis-3dm",
  manifestHash: "manifest-hash-3dm",
  origin: { epsg: "EPSG:5179", x: 930000.12, y: 1810000.34, lng: 127.1, lat: 37.5 },
  radiusM: 800,
  ground: {
    kind: "dem",
    cellM: 10,
    cols: 3,
    rows: 3,
    originZ: 52,
    z: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    resolutionM: 30,
    vertical: "EGM96",
    sourceId: "terrain:fixture",
  },
  site: [[[-20, -20], [20, -20], [20, 20], [-20, 20]]],
  buildings: [
    {
      id: "building-10m",
      rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
      baseZ: 2,
      heightM: 10,
      heightMethod: "source",
      floorsAbove: 3,
      useCode: "02000",
      approvalDate: "2020-01-01",
    },
    {
      id: "building-hole",
      rings: [
        [[-10, -10], [10, -10], [10, 0], [-10, 0]],
        [[-2, -8], [2, -8], [2, -2], [-2, -2]],
      ],
      baseZ: 4,
      heightM: 6,
      heightMethod: "floors_estimate",
      floorsAbove: 2,
      useCode: null,
      approvalDate: null,
    },
    {
      id: "building-unknown",
      rings: [[[20, 0], [24, 0], [24, 4], [20, 4]]],
      baseZ: 3,
      heightM: null,
      heightMethod: "unknown",
      floorsAbove: null,
      useCode: null,
      approvalDate: null,
    },
  ],
  parcels: [
    { pnu: "1111010100100010000", rings: [[[30, 30], [40, 30], [40, 40], [30, 40]]], jimok: "대", areaM2: 100, isSite: false },
  ],
  counts: { buildingsTotal: 3, buildingsIncluded: 3, parcelsTotal: 1, parcelsIncluded: 1 },
  sources: [],
  limitations: [],
};

const bytes = await sceneTo3dm(scene);
assert.ok(bytes instanceof Uint8Array);
const doc = rhino.File3dm.fromByteArray(bytes);
assert.ok(doc);
assert.equal(doc.settings().modelUnitSystem === rhino.UnitSystem.Meters, true, "단위는 미터");
assert.equal(doc.layers().count, 7);
assert.deepEqual(
  Array.from({ length: doc.layers().count }, (_, index) => doc.layers().get(index).name),
  RHINO_LAYERS,
);

const objects = Array.from({ length: doc.objects().count }, (_, index) => doc.objects().get(index));
const geometries = objects.map((object) => object.geometry());
const extrusions = geometries.filter((geometry) => geometry.constructor.name === "Extrusion");
assert.equal(extrusions.length, 2, "높이를 아는 두 건물은 압출 솔리드");
assert.ok(extrusions.every((extrusion) => extrusion.isSolid), "건물 압출은 닫힌 솔리드");
assert.equal(extrusions.find((extrusion) => extrusion.profileCount === 2)?.profileCount, 2, "구멍 profile");

const unknown = objects.find((object) => object.attributes().name === "building-unknown");
assert.ok(unknown);
assert.equal(unknown.geometry().constructor.name, "PolylineCurve", "높이 미상 건물은 평면 곡선");
assert.equal(unknown.attributes().getUserString("heightMethod"), "unknown");

const meshes = geometries.filter((geometry) => geometry.constructor.name === "Mesh");
assert.equal(meshes.length, 1, "DEM 지형 메시");
assert.equal(meshes[0].vertices().count, 9, "3x3 DEM 정점");

for (const [key, value] of [
  ["origin_epsg5179_x", "930000.12"],
  ["origin_epsg5179_y", "1810000.34"],
  ["origin_lng", "127.1"],
  ["origin_lat", "37.5"],
  ["originZ", "52"],
  ["units", "m"],
  ["north", "+Y"],
  ["manifestHash", "manifest-hash-3dm"],
  ["sceneVersion", "v2-scene@2"],
]) assert.equal(doc.strings().getvalue(key), value, `${key} 문서 문자열`);

console.log("✓ v2 3DM export");
