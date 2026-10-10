import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const legacyDir = mkdtempSync(join(tmpdir(), "v2-ownership-legacy-"));
const appDir = mkdtempSync(join(tmpdir(), "v2-ownership-app-"));
process.env.DB_PATH = join(legacyDir, "legacy.sqlite");
process.env.V2_APP_DB_PATH = join(appDir, "app.sqlite");
process.env.JWT_SECRET = "a".repeat(64);

const U = await import("../../lib/server/user-store.ts");
const J = await import("../../lib/server/jwt.ts");
const A = await import("../../lib/v2/app-db.ts");
const { getAnalysis, getScene } = await import("../../lib/v2/engine/api.ts");
const { NextRequest } = await import("next/server");
const analysisRoute = (await import("../../app/api/v2/analyses/[id]/route.ts")).GET;
const sceneRoute = (await import("../../app/api/v2/analyses/[id]/scene/route.ts")).GET;

const oldDbPath = join(mkdtempSync(join(tmpdir(), "v2-ownership-old-")), "old.sqlite");
const oldDb = new Database(oldDbPath);
oldDb.exec(`CREATE TABLE analysis_run (
  analysis_id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  center_lng REAL NOT NULL,
  center_lat REAL NOT NULL,
  radius_m REAL NOT NULL,
  analysis_date TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);
oldDb.close();
const migratedDb = A.openV2AppDb(oldDbPath);
const migratedUserColumn = migratedDb.prepare("PRAGMA table_info(analysis_run)").all().find((column) => column.name === "user_id");
assert.ok(migratedUserColumn, "existing app DB receives analysis_run.user_id");
assert.equal(migratedUserColumn.notnull, 0);
assert.equal(migratedDb.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").pluck().get(), "3");
migratedDb.close();

const owner = U.createUser("owner", "password");
const other = U.createUser("other", "password");
const appDb = A.openV2AppDb();
const run = (analysisId, userId) => ({
  analysisId,
  address: "서울특별시 중구 세종대로 110",
  center: [126.978, 37.5665],
  radiusM: 800,
  analysisDate: "2026-09-30",
  manifestHash: "1".repeat(64),
  engineVersion: "v2-test",
  parameters: {},
  ...(userId === undefined ? {} : { userId }),
});

A.createAnalysisRun(appDb, run("owned", owner.id));
A.createAnalysisRun(appDb, run("legacy"));
A.saveScene(appDb, {
  version: "v2-scene@1",
  analysisId: "owned",
  manifestHash: "1".repeat(64),
  origin: { epsg: "EPSG:5179", x: 930000, y: 1810000, lng: 126.978, lat: 37.5665 },
  radiusM: 800,
  groundZ: 0,
  site: null,
  buildings: [],
  parcels: [],
  counts: { buildingsTotal: 0, buildingsIncluded: 0, parcelsTotal: 0, parcelsIncluded: 0 },
  sources: [],
  limitations: [],
});

const userColumn = appDb.prepare("PRAGMA table_info(analysis_run)").all().find((column) => column.name === "user_id");
assert.ok(userColumn, "analysis_run.user_id column");
assert.equal(userColumn.notnull, 0, "user_id is nullable");
assert.equal(appDb.prepare("SELECT user_id FROM analysis_run WHERE analysis_id = 'owned'").pluck().get(), String(owner.id));
assert.equal(getAnalysis(appDb, "owned", owner.id).status, 200);
assert.equal(getAnalysis(appDb, "owned", other.id).status, 404);
assert.equal(getAnalysis(appDb, "owned").status, 404, "owned analysis requires an owner context");
assert.equal(getAnalysis(appDb, "legacy", other.id).status, 200, "legacy NULL owner remains readable");
assert.equal(getScene(appDb, "owned", owner.id).status, 200);
assert.equal(getScene(appDb, "owned", other.id).status, 404);

const ownerToken = await J.signAccessToken(owner.id);
const otherToken = await J.signAccessToken(other.id);
const getBy = (token, path) => new NextRequest(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
const params = (id) => ({ params: Promise.resolve({ id }) });
assert.equal((await analysisRoute(getBy(ownerToken, "/api/v2/analyses/owned"), params("owned"))).status, 200);
assert.equal((await analysisRoute(getBy(otherToken, "/api/v2/analyses/owned"), params("owned"))).status, 404);
assert.equal((await sceneRoute(getBy(ownerToken, "/api/v2/analyses/owned/scene"), params("owned"))).status, 200);
assert.equal((await sceneRoute(getBy(otherToken, "/api/v2/analyses/owned/scene"), params("owned"))).status, 404);
assert.equal((await analysisRoute(getBy(otherToken, "/api/v2/analyses/legacy"), params("legacy"))).status, 200);

appDb.close();
console.log("✓ v2 analysis ownership");
