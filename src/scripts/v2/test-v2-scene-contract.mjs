import assert from "node:assert/strict";

const { SCENE_VERSION, groundZAt, parseScene, sceneBuildingSublabel, toLocalRing } = await import("../../lib/v2/scene.ts");

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
      name: "건물-1",
      sublabel: "4층",
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
assert.equal(scene.buildings[0].name, "건물-1", "원천 건물 이름을 보존한다");
assert.equal(scene.buildings[0].sublabel, "4층", "표시용 층수 sublabel을 보존한다");
assert.equal(scene.buildings[0].labelPriority, 0, "기존 장면의 명시 우선순위 0을 보존한다");
assert.equal(scene.buildings[1].name, null, "이름 없는 기존 장면은 null로 읽는다");
assert.equal(scene.buildings[1].sublabel, null, "sublabel 없는 기존 장면은 null로 읽는다");
assert.equal(scene.buildings[1].labelPriority, 0, "우선순위 없는 기존 장면은 0으로 보강한다");
assert.equal(scene.buildings[0].baseZ, null, "평탄 지반의 바닥 높이는 null이어야 한다");
assert.equal(scene.sources[0].sourceAsOf, null, "기준일 미상은 null이어야 한다");
assert.equal(scene.context, undefined, "옛 장면은 선택적 맥락층 없이도 읽혀야 한다");

assert.equal(sceneBuildingSublabel({ floorsAbove: 18, heightM: 54, heightMethod: "source" }), "18층", "층수가 있으면 층수 sublabel을 우선한다");
assert.equal(sceneBuildingSublabel({ floorsAbove: null, heightM: 48, heightMethod: "source" }), "48m", "층수 없이 높이만 있으면 m sublabel을 만든다");
assert.equal(sceneBuildingSublabel({ floorsAbove: 1, heightM: 3, heightMethod: "assumed_one_floor" }), null, "1층 가정은 sublabel을 숨긴다");

const contextual = validScene();
contextual.context = {
  roads: [{ points: [[-10, 0], [10, 0]], widthM: 6, hierarchy: "국지" }],
  green: [[[[20, 20], [30, 20], [30, 30], [20, 20]]]],
  water: [[[[40, 40], [50, 40], [50, 50], [40, 40]]]],
  canopy: [[[[60, 60], [70, 60], [70, 70], [60, 60]]]],
};
const parsedContextual = parseScene(contextual);
assert.deepEqual(parsedContextual.context, contextual.context, "맥락층은 장면 계약에 보존되어야 한다");

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
rejects((candidate) => {
  candidate.context = {
    roads: [{ points: [[0, 0], [1, 1]], widthM: 0, hierarchy: "국지" }],
    green: [],
    water: [],
  };
}, "context road width");

const legacy = validScene();
legacy.version = "v2-scene@1";
legacy.groundZ = 0;
delete legacy.ground;
for (const building of legacy.buildings) {
  delete building.baseZ;
  delete building.name;
  delete building.sublabel;
}
const upgraded = parseScene(legacy);
assert.equal(upgraded.version, SCENE_VERSION);
assert.deepEqual(upgraded.ground, { kind: "flat" });
assert.ok(upgraded.buildings.every((building) => building.baseZ === null));
assert.ok(upgraded.buildings.every((building) => building.name === null && building.sublabel === null && building.labelPriority === 0), "v1 장면의 새 라벨 필드는 기본값으로 보강한다");

const legacyV2 = validScene();
for (const building of legacyV2.buildings) {
  delete building.name;
  delete building.sublabel;
}
const upgradedV2 = parseScene(legacyV2);
assert.ok(upgradedV2.buildings.every((building) => building.name === null && building.sublabel === null && building.labelPriority === 0), "기존 v2@2 장면도 새 라벨 필드 없이 읽는다");

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
