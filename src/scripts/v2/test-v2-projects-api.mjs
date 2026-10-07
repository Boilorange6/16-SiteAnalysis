import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A = await import("../../lib/v2/app-db.ts");
const P = await import("../../lib/v2/project-api.ts");

const manifestHash = "a".repeat(64);
const dataDir = mkdtempSync(join(tmpdir(), "v2-project-api-"));
const db = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-project-db-")), "app.sqlite"));
A.createAnalysisRun(db, {
  analysisId: "owned-analysis",
  address: "서울 강동구 고덕동 123",
  center: [127.15, 37.62],
  radiusM: 800,
  analysisDate: "2026-10-07",
  manifestHash,
  engineVersion: "v2-p4",
  parameters: { siteInput: { pnus: ["1".repeat(19)] }, inputAddress: "서울특별시 강동구 고덕동 250" },
  userId: 7,
});

await assert.rejects(
  A.saveProject(db, dataDir, { projectId: "gone", name: "사라진 버전", analysisId: "owned-analysis", board: {}, userId: 7 }),
  (error) => P.isDataVersionGone(error),
  "보관되지 않은 데이터 버전은 저장 전에 409 대상 오류",
);
mkdirSync(join(dataDir, "manifests"), { recursive: true });
writeFileSync(join(dataDir, "manifests", `${manifestHash}.json`), JSON.stringify({ version: "test", files: {} }));
await A.saveProject(db, dataDir, { projectId: "owned", name: "고덕동 검토", analysisId: "owned-analysis", board: { version: 1, order: [] }, userId: 7 });

assert.equal(A.loadProject(db, "owned", 8), null, "다른 사용자의 프로젝트는 404처럼 숨긴다");
assert.equal(A.renameProject(db, "owned", 8, "탈취"), null, "다른 사용자의 PATCH는 404처럼 숨긴다");
assert.equal(A.deleteProject(db, "owned", 8), false, "다른 사용자의 DELETE는 404처럼 숨긴다");
assert.equal(P.projectToJson(A.loadProject(db, "owned", 7), true).dataVersion, manifestHash);
assert.deepEqual(P.projectToJson(A.loadProject(db, "owned", 7), true).site, { pnus: ["1".repeat(19)] }, "프로젝트가 분석 원본 site 입력을 보존");
assert.equal(P.projectToJson(A.loadProject(db, "owned", 7), true).address, "서울특별시 강동구 고덕동 250", "프로젝트가 재지오코딩용 원주소를 보존");

const valid = P.parseProjectPayload({ name: "고덕동 검토", analysisId: "owned-analysis", board: { order: [] } });
assert.equal(valid.ok, true);
const tooLarge = P.parseProjectPayload({ name: "큰 보드", analysisId: "owned-analysis", board: "x".repeat(P.MAX_PROJECT_BOARD_BYTES) });
assert.equal(tooLarge.ok, false);
assert.equal(tooLarge.status, 413, "2MB 초과 board는 413");
assert.match(tooLarge.error, /2MB/);
assert.equal(P.parseProjectPayload({ name: "", analysisId: "owned-analysis", board: {} }).status, 400);

db.close();
console.log("v2 projects api tests passed");
