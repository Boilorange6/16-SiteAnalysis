import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";

const dataDir = mkdtempSync(join(tmpdir(), "v2-admin-overview-data-"));
const appDir = mkdtempSync(join(tmpdir(), "v2-admin-overview-app-"));
const legacyDir = mkdtempSync(join(tmpdir(), "v2-admin-overview-legacy-"));
const emptyRepo = mkdtempSync(join(tmpdir(), "v2-admin-overview-repo-"));
process.env.V2_DATA_DIR = dataDir;
process.env.V2_APP_DB_PATH = join(appDir, "app.sqlite");
process.env.DB_PATH = join(legacyDir, "legacy.sqlite");
process.env.JWT_SECRET = "a".repeat(64);

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { createAnalysisRun, finishAnalysisRun, openV2AppDb } = await import("../../lib/v2/app-db.ts");
const { buildAdminOverview } = await import("../../lib/v2/admin/overview.ts");
const { ageDays, compareTileSources } = await import("../../lib/v2/admin/provenance-check.ts");
const U = await import("../../lib/server/user-store.ts");
const J = await import("../../lib/server/jwt.ts");
const overviewRoute = (await import("../../app/api/v2/admin/overview/route.ts")).GET;

assert.deepEqual(compareTileSources(["building", "terrain_tiles"], ["building"]), {
  status: "mismatch",
  missingFromCatalog: [],
  unusedInCatalog: ["terrain_tiles"],
});
assert.deepEqual(compareTileSources(["asos"], ["asos", "building"]), {
  status: "mismatch",
  missingFromCatalog: ["building"],
  unusedInCatalog: [],
});
assert.deepEqual(compareTileSources(["building", "ngii_topo"], ["building"]), {
  status: "ok",
  missingFromCatalog: [],
  unusedInCatalog: [],
});
assert.deepEqual(compareTileSources(["x"], null), { status: "unknown", missingFromCatalog: [], unusedInCatalog: [] });
assert.equal(ageDays("2026-09-08", "2026-10-26"), 48);
assert.equal(ageDays("2024", "2026-10-26"), 664);
assert.equal(ageDays("2026-06", "2026-10-26"), 118);
assert.equal(ageDays(null, "2026-10-26"), null);
assert.equal(ageDays("기준일 없음", "2026-10-26"), null);

mkdirSync(join(dataDir, "versions", "v1"), { recursive: true });
const dataPath = join(dataDir, "versions", "v1", "core.sqlite");
const dataDb = new Database(dataPath);
initDataFileSchema(dataDb, "core");
dataDb.prepare(`INSERT INTO source_release
  (release_id, source_id, provider, source_url, source_as_of, published_at, fetched_at, checksum, schema_version, license_code, rights_json, coverage_json)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  .run("building@2026-09-08", "building", "테스트 제공처", "https://example.test/building", "2026-09-08", "2026-10-01", "2026-10-02T00:00:00Z", "hash", 2, "TEST", "{}", "{}");
dataDb.prepare(`INSERT INTO ingest_run
  (run_id, source_id, partition_key, started_at, finished_at, status, expected_count, received_count, accepted_count, rejected_count, release_id, snapshot_json)
  VALUES (?, ?, '', ?, ?, 'succeeded', ?, ?, ?, ?, ?, ?)`)
  .run("run-building", "building", "2026-10-01", "2026-10-02", 9, 8, 7, 1, "building@2026-09-08", "{}");
dataDb.close();
writeFileSync(join(dataDir, "manifest.json"), JSON.stringify({
  version: "v1",
  createdAt: "2026-10-02T00:00:00Z",
  files: { core: { path: "versions/v1/core.sqlite", sha256: "0".repeat(64), kind: "core", schemaVersion: 2 } },
}));

const appDb = openV2AppDb(process.env.V2_APP_DB_PATH);
const admin = U.createUser("overview-admin", "password", "admin");
const user = U.createUser("overview-user", "password");
createAnalysisRun(appDb, {
  analysisId: "analysis-1",
  address: "서울특별시 중구 세종대로 110",
  center: [126.978, 37.5665],
  radiusM: 800,
  analysisDate: "2026-10-01",
  manifestHash: "1".repeat(64),
  engineVersion: "v2-test",
  parameters: {},
  userId: admin.id,
});
finishAnalysisRun(appDb, "analysis-1", "complete");
appDb.prepare(`INSERT INTO tile_result (tile_id, analysis_id, tile_code, cache_key, status, result_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`)
  .run("tile-1", "analysis-1", "A01", "cache-1", "complete", JSON.stringify({ provenance: { sources: [{ sourceId: "osm_subway" }] } }), "2026-10-02T00:00:00Z");

const noAnalysis = buildAdminOverview({ appDb, dataDir, analysisId: null, userId: user.id, today: "2026-10-26", repoRoot: emptyRepo });
assert.equal(noAnalysis.analysis, null);
assert.equal(noAnalysis.tiles.length, 33);
assert.ok(noAnalysis.tiles.every((tile) => tile.actualSources === null && tile.check.status === "unknown"));
assert.ok(noAnalysis.tiles.every((tile) => !tile.orphan));
assert.ok(noAnalysis.tiles.every((tile) => tile.files.length === 0));
assert.deepEqual(noAnalysis.sources.find((source) => source.sourceId === "building"), {
  sourceId: "building",
  name: "GIS건물통합정보",
  provider: "테스트 제공처",
  url: "https://example.test/building",
  asOf: "2026-09-08",
  fetchedAt: "2026-10-02T00:00:00Z",
  ageDays: 48,
  license: "TEST",
  group: null,
  collect: "수동 파일",
  cycle: "수시",
  expected: 9,
  accepted: 7,
  rejected: 1,
  fileKey: "core",
  runtime: false,
  usedBy: ["D02", "D03", "D04", "D05", "D16", "D29", "S01", "S02", "S03", "S04"],
});
for (const sourceId of ["vworld_wmts", "ngii_topo", "browser_lbm", "fallback_d2q9"]) {
  assert.equal(noAnalysis.sources.find((source) => source.sourceId === sourceId)?.runtime, true, sourceId);
}

const selected = buildAdminOverview({ appDb, dataDir, analysisId: "없는 분석", userId: admin.id, today: "2026-10-26", repoRoot: emptyRepo });
assert.equal(selected.analysis?.id, "analysis-1");
const a01 = selected.tiles.find((tile) => tile.code === "A01");
assert.equal(a01.resultStatus, "complete");
assert.deepEqual(a01.actualSources, ["osm_subway"]);
assert.equal(a01.check.status, "mismatch");
assert.ok(a01.check.unusedInCatalog.includes("bus_stop"));

const adminToken = await J.signAccessToken(admin.id);
const userToken = await J.signAccessToken(user.id);
const requestFor = (token) => new NextRequest("http://localhost/api/v2/admin/overview?analysis=analysis-1", token ? { headers: { Authorization: `Bearer ${token}` } } : {});
assert.equal((await overviewRoute(requestFor(null))).status, 401);
assert.equal((await overviewRoute(requestFor(userToken))).status, 403);
const response = await overviewRoute(requestFor(adminToken));
assert.equal(response.status, 200);
assert.ok((await response.json()).tiles);

appDb.close();
console.log("✓ admin overview and API");
