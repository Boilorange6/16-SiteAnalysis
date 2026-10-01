import assert from "node:assert/strict";

const { SCENE_VERSION, groundZAt, parseScene, toLocalRing } = await import("../../lib/v2/scene.ts");

const validScene = () => ({
  version: SCENE_VERSION,
  analysisId: "analysis-1",
  manifestHash: "manifest-hash",
  origin: { epsg: "EPSG:5179", x: 1000000, y: 2000000, lng: 127.1, lat: 37.5 },
  radiusM: 800,
  ground: { kind: "flat" },
  site: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
  buildings: [
    {
      id: "building-1",
      rings: [[[1, 1], [5, 1], [5, 5], [1, 5]]],
      baseZ: null,
      heightM: 12.5,
      heightMethod: "source",
      floorsAbove: 4,
      useCode: "02000",
      approvalDate: "2020-01-02",
    },
    {
      id: "building-2",
      rings: [[[7, 7], [9, 7], [9, 9], [7, 9]]],
      baseZ: null,
      heightM: null,
      heightMethod: "unknown",
      floorsAbove: null,
      useCode: null,
      approvalDate: null,
    },
  ],
  parcels: [{ pnu: "pnu-1", rings: [[[0, 0], [20, 0], [20, 20], [0, 20]]], jimok: null, areaM2: null, isSite: true }],
  counts: { buildingsTotal: 2, buildingsIncluded: 2, parcelsTotal: 1, parcelsIncluded: 1 },
  sources: [{ sourceId: "source-1", releaseId: "release-1", sourceAsOf: null, fetchedAt: "2026-09-30T00:00:00+09:00" }],
  limitations: [{ kind: "unknown", note: "건물 높이 미상 1동" }],
});

const scene = parseScene(validScene());
assert.equal(scene.version, SCENE_VERSION);
assert.equal(scene.buildings[1].heightM, null, "미상 높이는 null이어야 한다");
assert.equal(scene.buildings[0].baseZ, null, "평탄 지반의 바닥 높이는 null이어야 한다");
assert.equal(scene.sources[0].sourceAsOf, null, "기준일 미상은 null이어야 한다");

const rejects = (mutate, message) => {
  const candidate = validScene();
  mutate(candidate);
  assert.throws(() => parseScene(candidate), undefined, message);
};

rejects((candidate) => { candidate.buildings[0].heightM = 0; }, "heightM 0");
rejects((candidate) => { candidate.version = "v2-scene@0"; }, "version mismatch");
rejects((candidate) => { candidate.origin.x = Number.NaN; }, "NaN coordinate");
rejects((candidate) => {
  candidate.ground = {
    kind: "dem",
    cellM: 10,
    cols: 2,
    rows: 2,
    originZ: 100,
    z: [0, 1, 2],
    resolutionM: 30,
    vertical: "EGM96",
    sourceId: "terrain-sample",
  };
}, "ground z length");

const legacy = validScene();
legacy.version = "v2-scene@1";
legacy.groundZ = 0;
delete legacy.ground;
for (const building of legacy.buildings) delete building.baseZ;
const upgraded = parseScene(legacy);
assert.equal(upgraded.version, SCENE_VERSION);
assert.deepEqual(upgraded.ground, { kind: "flat" });
assert.ok(upgraded.buildings.every((building) => building.baseZ === null));

const demGround = {
  kind: "dem",
  cellM: 10,
  cols: 3,
  rows: 3,
  originZ: 100,
  z: [0, 10, 20, 10, 20, 30, 20, 30, 40],
  resolutionM: 30,
  vertical: "EGM96",
  sourceId: "terrain-sample",
};
assert.equal(groundZAt(demGround, 0, 0), 20, "격자 중심값");
assert.equal(groundZAt(demGround, 5, 5), 30, "쌍선형 보간값");
assert.equal(groundZAt(demGround, 16, 0), null, "격자 밖은 null");
assert.equal(groundZAt({ ...demGround, z: [null, 10, 20, 10, 20, 30, 20, 30, 40] }, -5, -5), null, "결측을 0으로 보간하지 않는다");

assert.deepEqual(toLocalRing([[1000010.123, 2000020.456]], { x: 1000000, y: 2000000 }), [[10.12, 20.46]]);

console.log("✓ v2 scene contract");
