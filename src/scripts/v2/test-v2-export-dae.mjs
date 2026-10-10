import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const { DAE_LAYERS, daeFileName, sceneToDae } = await import("../../lib/v2/export/dae.ts");
const { sceneToGlb } = await import("../../lib/v2/export/glb.ts");
const { DAE_MIME, mimeFor } = await import("../../lib/v2/export/download.ts");

const scene = {
  version: "v2-scene@2",
  analysisId: "analysis-dae",
  manifestHash: "manifest-hash-dae",
  origin: { epsg: "EPSG:5179", x: 1000000.25, y: 2000000.5, lng: 127.1, lat: 37.5 },
  radiusM: 800,
  ground: {
    kind: "dem",
    cellM: 10,
    cols: 3,
    rows: 3,
    originZ: 100,
    z: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    resolutionM: 30,
    vertical: "EGM96",
    sourceId: "terrain:fixture",
  },
  site: [[[0, 0], [20, 0], [20, 20], [0, 20]]],
  buildings: [
    {
      id: "source-square",
      rings: [[[0, 0], [0, 10], [10, 10], [10, 0]]],
      baseZ: 5,
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
      baseZ: 2,
      heightM: 6,
      heightMethod: "floors_estimate",
      floorsAbove: 2,
      useCode: null,
      approvalDate: null,
    },
    {
      id: "unknown-square",
      rings: [[[20, 0], [24, 0], [24, 4], [20, 4]]],
      baseZ: 3,
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

function glbTriangleCount(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const jsonStart = 20;
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength)).trim());
  return json.meshes[0].primitives.reduce((sum, primitive) => sum + json.accessors[primitive.indices].count / 3, 0);
}

const dae = sceneToDae(scene);
if (process.env.V2_DAE_OUTPUT) await writeFile(process.env.V2_DAE_OUTPUT, dae, "utf8");
assert.equal(typeof dae, "string", "sceneToDae returns UTF-8 XML text");
assert.match(dae, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
assert.match(dae, /<COLLADA[^>]+version="1\.4\.1"/);
assert.match(dae, /<unit name="meter" meter="1"\/>/);
assert.match(dae, /<up_axis>Y_UP<\/up_axis>/);
assert.match(dae, /<param name="origin_epsg">EPSG:5179<\/param>/);
assert.match(dae, /<param name="origin_x">1000000\.25<\/param>/);
assert.match(dae, /<param name="origin_y">2000000\.5<\/param>/);
assert.match(dae, /<param name="units">m<\/param>/);
assert.match(dae, /<param name="north">-Z<\/param>/);

for (const layer of DAE_LAYERS) {
  assert.match(dae, new RegExp(`<node id="layer-${layer}" name="${layer}"`), `layer ${layer}`);
}
assert.match(dae, /<library_geometries>/);
assert.match(dae, /<library_visual_scenes>/);
assert.match(dae, /<instance_geometry url="#geometry-BLDG"/);
assert.match(dae, /<instance_geometry url="#geometry-TERRAIN"/);

const daeTriangleCount = [...dae.matchAll(/<triangles\b[^>]*\bcount="(\d+)"/g)]
  .reduce((sum, match) => sum + Number(match[1]), 0);
assert.equal(daeTriangleCount, glbTriangleCount(sceneToGlb(scene)), "DAE triangles match GLB triangles");
assert.equal(daeTriangleCount, 45, "fixture has the expected building plus DEM triangles");

assert.equal(daeFileName("서울특별시 강동구/고덕동 123", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_123_20260930.dae");
assert.equal(DAE_MIME, "model/vnd.collada+xml");
assert.equal(mimeFor("dae"), DAE_MIME);

console.log("✓ v2 DAE export");
