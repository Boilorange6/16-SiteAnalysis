/**
 * v2 앱 DB 테스트.
 * 분석 결과가 다른 데이터 버전을 섞으면 화면과 PPT 숫자가 달라진다.
 * 저장된 프로젝트의 데이터 버전은 가비지 수집에서 보호되어야 한다.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A = await import("../../lib/v2/app-db.ts");

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
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

// 저장 프로젝트가 참조하는 버전만 핀
assert.deepEqual(A.pinnedManifestHashes(db), new Set());
A.saveProject(db, { projectId: "p1", name: "다산역 검토", analysisId: "a1", board: { tiles: ["D02"] } });
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H1]));

db.close();
console.log("✓ v2 app db");
