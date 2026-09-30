import assert from "node:assert/strict";

const { glbFileName, sceneToGlb } = await import("../../lib/v2/export/glb.ts");

const scene = {
  version: "v2-scene@1",
  analysisId: "analysis-glb",
  manifestHash: "manifest-hash-123",
  origin: { epsg: "EPSG:5179", x: 1000000, y: 2000000, lng: 127.1, lat: 37.5 },
  radiusM: 800,
  groundZ: 0,
  site: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
  buildings: [
    {
      id: "source-square",
      rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]],
      heightM: 10,
      heightMethod: "source",
      floorsAbove: 3,
      useCode: "02000",
      approvalDate: "2020-01-02",
    },
    {
      id: "estimated-hole",
      rings: [
        [[-10, -10], [10, -10], [10, 10], [-10, 10]],
        [[-2, -2], [-2, 2], [2, 2], [2, -2]],
      ],
      heightM: 6,
      heightMethod: "floors_estimate",
      floorsAbove: 2,
      useCode: null,
      approvalDate: null,
    },
    {
      id: "unknown-square",
      rings: [[[20, 0], [24, 0], [24, 4], [20, 4]]],
      heightM: null,
      heightMethod: "unknown",
      floorsAbove: null,
      useCode: null,
      approvalDate: null,
    },
  ],
  parcels: [],
  counts: { buildingsTotal: 3, buildingsIncluded: 3, parcelsTotal: 0, parcelsIncluded: 0 },
  sources: [],
  limitations: [],
};

function readGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "glTF", "GLB magic");
  assert.equal(view.getUint32(4, true), 2, "glTF version");
  assert.equal(view.getUint32(8, true), bytes.byteLength, "GLB total length");

  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, "JSON chunk");
  const jsonStart = 20;
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength)).trim());
  const binHeader = jsonStart + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  assert.equal(view.getUint32(binHeader + 4, true), 0x004e4942, "BIN chunk");
  const binStart = binHeader + 8;
  assert.equal(binStart + binLength, bytes.byteLength, "BIN reaches GLB end");
  return { json, bin: bytes.subarray(binStart, binStart + binLength) };
}

function accessorPositions(gltf, bin, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const values = new Float32Array(bin.buffer, bin.byteOffset + start, accessor.count * 3);
  return [...values];
}

const bytes = sceneToGlb(scene);
assert.ok(bytes instanceof Uint8Array, "sceneToGlb returns Uint8Array");
const { json, bin } = readGlb(bytes);
assert.equal(json.asset.generator, "site-analysis v2");
assert.deepEqual(json.asset.extras, {
  origin: { epsg: "EPSG:5179", x: 1000000, y: 2000000, lng: 127.1, lat: 37.5 },
  units: "m",
  up: "+Y",
  north: "-Z",
  manifestHash: "manifest-hash-123",
  analysisId: "analysis-glb",
  sceneVersion: "v2-scene@1",
});
assert.equal(json.meshes[0].primitives.length, 4, "source/estimated/unknown/ground primitives");
assert.equal(json.materials.length, 4);
assert.equal(bin.byteLength % 4, 0, "BIN chunk is aligned");

const sourcePrimitive = json.meshes[0].primitives[0];
const sourcePositions = accessorPositions(json, bin, sourcePrimitive.attributes.POSITION);
assert.equal(Math.max(...sourcePositions.filter((_, i) => i % 3 === 1)), 10, "source building height");
assert.ok(sourcePositions.some((value, i) => i % 3 === 0 && value === 10), "east is +X");
assert.ok(sourcePositions.some((value, i) => i % 3 === 2 && value === -10), "north is -Z");

const estimatedPrimitive = json.meshes[0].primitives[1];
const estimatedIndices = json.accessors[estimatedPrimitive.indices].count;
assert.equal(estimatedIndices, 72, "hole roof uses earcut triangles and all ring edges have walls");

const unknownPrimitive = json.meshes[0].primitives[2];
const unknownPositions = accessorPositions(json, bin, unknownPrimitive.attributes.POSITION);
assert.ok(unknownPositions.length > 0);
assert.ok(unknownPositions.every((value, i) => i % 3 !== 1 || value === 0), "unknown height stays at ground");

const groundPrimitive = json.meshes[0].primitives[3];
assert.equal(json.accessors[groundPrimitive.indices].count, 64 * 3, "64-sided ground disk");

assert.equal(glbFileName("서울특별시 강동구/고덕동 123", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_123_20260930.glb");

console.log("✓ v2 GLB export");
