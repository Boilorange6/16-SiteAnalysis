import assert from "node:assert/strict";

const { EXPORT_MIME, exportFileName, mimeFor } = await import("../../lib/v2/export/download.ts");
const { reportFileName } = await import("../../lib/v2/report/report-plan.ts");
const { exportAvailability, formatElapsedMs, jobProgress } = await import("../../lib/v2/ui/board-status.ts");

assert.equal(mimeFor("pptx"), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
assert.equal(mimeFor("dxf"), "application/dxf");
assert.equal(mimeFor("glb"), "model/gltf-binary");
assert.equal(mimeFor("3dm"), "application/octet-stream");
assert.deepEqual(EXPORT_MIME, {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  dxf: "application/dxf",
  glb: "model/gltf-binary",
  "3dm": "application/octet-stream",
});
assert.equal(exportFileName("dxf", "서울특별시 강동구/고덕동 123", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_123_20260930.dxf");
assert.equal(exportFileName("glb", " 주소 ", "20260930"), "사이트분석_주소_20260930.glb");
assert.equal(exportFileName("dae", "서울특별시 강동구\\고덕동:250", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_250_20260930.dae");
assert.equal(exportFileName("3dm", " 주소 ", "2026-09-30"), "사이트분석_주소_20260930.3dm");
assert.equal(exportFileName("pptx", "서울특별시 강동구 고덕동 250.", "2026-09-30"), "사이트분석_서울특별시_강동구_고덕동_250_20260930.pptx");
assert.equal(reportFileName("서울특별시 강동구 고덕동 250.", "2026-09-30"), exportFileName("pptx", "서울특별시 강동구 고덕동 250.", "2026-09-30"));
for (const format of ["dxf", "glb", "dae", "3dm", "pptx"]) {
  const name = exportFileName(format, "서울특별시 강동구/고덕동 250:1", "2026-09-30");
  assert.doesNotMatch(name, /[<>:"\/\\|?*\u0000-\u001f]/, `${format} 파일명에 Windows 금지 문자가 남음`);
  assert.doesNotMatch(name, /\s/, `${format} 파일명에 공백이 남음`);
}

// R3: queued/running 작업은 서버 시각으로 경과 시간을 보여 주고, 큐 위치를 설명한다.
const now = Date.parse("2026-10-01T00:13:05.000Z");
const progress = jobProgress(
  [
    { code: "S02", status: "running", enqueuedAt: "2026-10-01T00:00:00.000Z", startedAt: "2026-10-01T00:01:00.000Z", elapsedMs: null },
    { code: "S03", status: "queued", enqueuedAt: "2026-10-01T00:00:00.000Z", startedAt: null, elapsedMs: null },
    { code: "D29", status: "queued", enqueuedAt: "2026-10-01T00:00:00.000Z", startedAt: null, elapsedMs: null },
    { code: "D10", status: "done", enqueuedAt: "2026-10-01T00:00:00.000Z", startedAt: "2026-09-30T23:59:00.000Z", elapsedMs: 1200 },
  ],
  now,
);
assert.equal(progress.queued, 2);
assert.equal(progress.running, 1);
assert.equal(progress.completed, 1);
assert.equal(progress.waitingLabel, "대기 중 — 앞선 작업 2개");
assert.equal(progress.byCode.get("S03")?.note, "대기 중 — 앞선 작업 1개 · 경과 13분 5초 · 오래 걸리면 다시 시도");
assert.equal(progress.byCode.get("S02")?.note, "계산 중 · 경과 12분 5초 · 오래 걸리면 다시 시도");
assert.equal(formatElapsedMs(null), "시간 미확인");

// R4: 분석 작업이 남아 있어도 입력이 준비된 형식은 내보낼 수 있다.
const pendingWithScene = exportAvailability({ activeJobs: true, making: false, sceneReady: true });
assert.equal(pendingWithScene.ppt.enabled, true);
assert.equal(pendingWithScene.ppt.pendingNote, "계산 중인 타일은 PPT에 '계산 중'으로 표시됩니다.");
for (const kind of ["dxf", "glb", "dae", "3dm"]) assert.equal(pendingWithScene[kind].enabled, true, `${kind}는 장면만 준비되면 활성`);
const noScene = exportAvailability({ activeJobs: true, making: false, sceneReady: false });
for (const kind of ["dxf", "glb", "dae", "3dm"]) {
  assert.equal(noScene[kind].enabled, false, `${kind} 비활성`);
  assert.equal(noScene[kind].reason, "장면이 아직 준비되지 않았습니다.");
}
const making = exportAvailability({ activeJobs: true, making: true, sceneReady: true });
for (const kind of ["ppt", "dxf", "glb", "dae", "3dm"]) assert.equal(making[kind].enabled, false, `${kind}는 다른 내보내기 중 비활성`);

console.log("✓ v2 export UI download contract");
