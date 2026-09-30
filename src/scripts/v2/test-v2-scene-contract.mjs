import assert from "node:assert/strict";

const { SCENE_VERSION, parseScene, toLocalRing } = await import("../../lib/v2/scene.ts");

const validScene = () => ({
  version: SCENE_VERSION,
  analysisId: "analysis-1",
  manifestHash: "manifest-hash",
  origin: { epsg: "EPSG:5179", x: 1000000, y: 2000000, lng: 127.1, lat: 37.5 },
  radiusM: 800,
  groundZ: 0,
  site: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
  buildings: [
    {
      id: "building-1",
      rings: [[[1, 1], [5, 1], [5, 5], [1, 5]]],
      heightM: 12.5,
      heightMethod: "source",
      floorsAbove: 4,
      useCode: "02000",
      approvalDate: "2020-01-02",
    },
    {
      id: "building-2",
      rings: [[[7, 7], [9, 7], [9, 9], [7, 9]]],
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
assert.equal(scene.sources[0].sourceAsOf, null, "기준일 미상은 null이어야 한다");

const rejects = (mutate, message) => {
  const candidate = validScene();
  mutate(candidate);
  assert.throws(() => parseScene(candidate), undefined, message);
};

rejects((candidate) => { candidate.buildings[0].heightM = 0; }, "heightM 0");
rejects((candidate) => { candidate.version = "v2-scene@0"; }, "version mismatch");
rejects((candidate) => { candidate.origin.x = Number.NaN; }, "NaN coordinate");

assert.deepEqual(toLocalRing([[1000010.123, 2000020.456]], { x: 1000000, y: 2000000 }), [[10.12, 20.46]]);

console.log("✓ v2 scene contract");
