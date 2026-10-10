/**
 * v2 앱 DB 테스트.
 * 분석 결과가 다른 데이터 버전을 섞으면 화면과 PPT 숫자가 달라진다.
 * 저장된 프로젝트의 데이터 버전은 가비지 수집에서 보호되어야 한다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const A = await import("../../lib/v2/app-db.ts");

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const run = (id, hash) => ({
  analysisId: id, address: "경기도 남양주시 다산동", center: [127.1506, 37.6245], radiusM: 800,
  analysisDate: "2026-09-29", manifestHash: hash, engineVersion: "v2-p0", parameters: {}, userId: id === "a3" ? 8 : 7,
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
await assert.rejects(A.saveProject(db, dataDir, { projectId: "p1", name: "n", analysisId: "a1", board: {}, userId: 7 }), /DATA_VERSION_GONE/);
await assert.rejects(A.saveProject(db, dataDir, { projectId: "p1", name: "n", analysisId: "zzz", board: {}, userId: 7 }), /unknown analysis/);
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H2]), "거부된 저장은 핀을 만들지 않음");
archive(H1);
const savedBoard = { version: 1, order: ["a1-D02", "a1-A05"], a05Filter: { "a1-A05": { types: ["apt"], year: { min: 2010, max: null } } } };
await A.saveProject(db, dataDir, { projectId: "p1", name: "다산역 검토", analysisId: "a1", board: savedBoard, userId: 7 });
const createdAt = A.loadProject(db, "p1", 7).createdAt;
assert.deepEqual(A.loadProject(db, "p1", 7).board, savedBoard, "프로젝트 보드 저장→불러오기 왕복");
await A.saveProject(db, dataDir, { projectId: "p1", name: "다산역 검토", analysisId: "a1", board: { order: ["a1-D02"] }, userId: 7 });
assert.deepEqual(A.loadProject(db, "p1", 7).board, { order: ["a1-D02"] }, "a05Filter 없는 옛 프로젝트도 불러옴");
assert.equal(A.loadProject(db, "p1", 8), null, "남의 프로젝트는 not found");
await assert.rejects(A.saveProject(db, dataDir, { projectId: "p1", name: "탈취", analysisId: "a1", board: {}, userId: 8 }), /PROJECT_NOT_FOUND/);
const renamed = A.renameProject(db, "p1", 7, "다산역 최종 검토");
assert.equal(renamed.name, "다산역 최종 검토", "소유자만 이름 변경");
assert.equal(renamed.createdAt, createdAt, "이름 변경·덮어쓰기에도 created_at 보존");
assert.equal(A.renameProject(db, "p1", 8, "탈취"), null, "남의 프로젝트 이름 변경은 not found");
const projects = A.listProjects(db, 7);
assert.equal(projects.length, 1, "소유자별 목록");
assert.deepEqual(Object.keys(projects[0]).sort(), ["address", "analysisDate", "analysisId", "createdAt", "dataVersion", "engineVersion", "name", "projectId", "radiusM", "updatedAt", "userId"].sort());
assert.equal(projects[0].dataVersion, H1);
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H1, H2]));
A.finishAnalysisRun(db, "a2", "failed");
assert.deepEqual(A.pinnedManifestHashes(db), new Set([H1]), "끝난 분석은 핀 해제");
assert.equal(A.deleteProject(db, "p1", 8), false, "남의 프로젝트 삭제는 not found");
assert.equal(A.deleteProject(db, "p1", 7), true, "소유자 프로젝트 삭제");
assert.deepEqual(A.pinnedManifestHashes(db), new Set(), "삭제한 프로젝트는 GC 핀이 해제됨");

db.close();

// v2 saved_project에는 user_id가 없던 DB도 참조 분석의 소유자를 상속한다.
const legacy = new Database(":memory:");
legacy.exec(`
  CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE analysis_run (
    analysis_id TEXT PRIMARY KEY, address TEXT NOT NULL, center_lng REAL NOT NULL, center_lat REAL NOT NULL,
    radius_m REAL NOT NULL, analysis_date TEXT NOT NULL, manifest_hash TEXT NOT NULL, engine_version TEXT NOT NULL,
    parameters_json TEXT NOT NULL, user_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE saved_project (
    project_id TEXT PRIMARY KEY, name TEXT NOT NULL, analysis_id TEXT NOT NULL, board_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);
legacy.prepare("INSERT INTO analysis_run VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("legacy-run", "옛 주소", 127, 37, 800, "2026-09-29", H3, "v2-p0", "{}", "42", "complete", "2026-09-29T00:00:00.000Z");
legacy.prepare("INSERT INTO saved_project VALUES (?, ?, ?, ?, ?, ?)").run("legacy-project", "옛 프로젝트", "legacy-run", "{}", "2026-09-29T00:00:00.000Z", "2026-09-29T00:00:00.000Z");
A.initV2AppSchema(legacy);
assert.equal(legacy.prepare("SELECT user_id FROM saved_project WHERE project_id = 'legacy-project'").pluck().get(), "42", "v3 마이그레이션은 분석 소유자를 채움");
assert.equal(legacy.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").pluck().get(), "3");
legacy.close();
console.log("✓ v2 app db");
