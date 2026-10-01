/**
 * v2 앱 DB 테스트.
 * 분석 결과가 다른 데이터 버전을 섞으면 화면과 PPT 숫자가 달라진다.
 * 저장된 프로젝트의 데이터 버전은 가비지 수집에서 보호되어야 한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A = await import("../../lib/v2/app-db.ts");

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const run = (id, hash) => ({
  analysisId: id, address: "경기도 남양주시 다산동", center: [127.1506, 37.6245], radiusM: 800,
  analysisDate: "2026-09-29", manifestHash: hash, engineVersion: "v2-p0", parameters: {},
});
const tile = (analysisId, hash, code = "D02") => ({
  tileId: `${analysisId}-${code}`, analysisId, tileType: "diagram", tileCode: code, status: "complete", engineVersion: "v2-p0",
  conditions: { address: "경기도 남양주시 다산동", center: [127.1506, 37.6245], radiusM: 800, analysisDate: "2026-09-29", timezone: "Asia/Seoul", filters: {}, simulation: null, parcelSnapshotHash: null },
  metrics: [{ id: "building_count", label: "건물 수", value: 3, unit: "동", formulaVersion: "d02-count@1", numerator: null, denominator: null, status: "observed" }],
  judgment: null,
  presentation: { legend: [], camera: null, layers: ["building"], outputFace: "front" },
  provenance: { manifestHash: hash, sources: [{ sourceId: "gis_building", releaseId: "r1", sourceAsOf: null, fetchedAt: "2026-09-29T00:00:00+09:00" }] },
  limitations: [],
});

const db = A.openV2AppDb(join(mkdtempSync(join(tmpdir(), "v2-app-")), "app.sqlite"));
assert.equal(db.pragma("journal_mode", { simple: true }), "wal");

A.createAnalysisRun(db, run("a1", H1));
A.createAnalysisRun(db, run("a2", H2));
A.createAnalysisRun(db, run("a3", H3));
db.prepare("UPDATE analysis_run SET created_at = datetime('now', '-3 hours') WHERE analysis_id = 'a3'").run();
assert.equal(A.getAnalysisRun(db, "a1").manifestHash, H1);
assert.equal(A.getAnalysisRun(db, "a1").status, "running");
assert.deepEqual(A.getAnalysisRun(db, "a1").center, [127.1506, 37.6245]);
assert.equal(A.getAnalysisRun(db, "nope"), null);

// 결과 저장·복원
A.saveTileResult(db, tile("a1", H1), "k1");
assert.deepEqual(A.loadTileResults(db, "a1"), [tile("a1", H1)]);

// 다른 데이터 버전의 결과는 거부
assert.throws(() => A.saveTileResult(db, tile("a1", H2, "D03"), "k2"), /MANIFEST_HASH_MISMATCH/);
// 계약 위반은 거부
assert.throws(() => A.saveTileResult(db, { ...tile("a1", H1, "D04"), status: "complete", provenance: { manifestHash: H1, sources: [] } }, "k3"));
// 없는 분석은 거부
assert.throws(() => A.saveTileResult(db, tile("zzz", H1), "k4"), /unknown analysis/);

A.finishAnalysisRun(db, "a1", "complete");
assert.equal(A.getAnalysisRun(db, "a1").status, "complete");

// 저장 프로젝트가 참조하는 버전 + 최근 진행 중(running) 분석의 버전만 핀. a1은 complete, a2는 running, a3은 오래된 crash 잔재.
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H2]), "running a2만 핀");
const dataDir = mkdtempSync(join(tmpdir(), "v2-app-data-"));
const archive = (h) => { mkdirSync(join(dataDir, "manifests"), { recursive: true }); writeFileSync(join(dataDir, "manifests", `${h}.json`), JSON.stringify({ version: "x", createdAt: "x", files: {} })); };
// 실행이 쓴 버전이 이미 수집됐으면 저장 거부 (안 그러면 이후 모든 GC가 MISSING_PINNED_MANIFEST)
await assert.rejects(A.saveProject(db, dataDir, { projectId: "p1", name: "n", analysisId: "a1", board: {} }), /DATA_VERSION_GONE/);
await assert.rejects(A.saveProject(db, dataDir, { projectId: "p1", name: "n", analysisId: "zzz", board: {} }), /unknown analysis/);
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H2]), "거부된 저장은 핀을 만들지 않음");
archive(H1);
await A.saveProject(db, dataDir, { projectId: "p1", name: "다산역 검토", analysisId: "a1", board: { tiles: ["D02"] } });
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H1, H2]));
A.finishAnalysisRun(db, "a2", "failed");
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H1]), "끝난 분석은 핀 해제");

db.close();
console.log("✓ v2 app db");
