import assert from "node:assert/strict";

const { EXPORT_MIME, exportFileName, mimeFor } = await import("../../lib/v2/export/download.ts");

assert.equal(mimeFor("pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
assert.equal(mimeFor("dxf"), "application/dxf");
assert.equal(mimeFor("glb"), "model/gltf-binary");
assert.deepEqual(EXPORT_MIME, {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dxf: "application/dxf",
  glb: "model/gltf-binary",
});
assert.equal(exportFileName("dxf", "서울특별시 강동구/고덕동 123", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_123_20260930.dxf");
assert.equal(exportFileName("glb", " 주소 ", "20260930"), "사이트분석_주소_20260930.glb");

console.log("✓ v2 export UI download contract");
