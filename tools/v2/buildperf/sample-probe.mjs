import { performance } from "node:perf_hooks";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const value = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const stage = value("stage");
const raw = value("raw", ".cache/v2/raw");
const dbPath = value("db");
const limit = Number(value("limit", "100000"));
if (!stage || !dbPath || !["gis", "juso", "parcel"].includes(stage) || !Number.isSafeInteger(limit) || limit <= 0) {
  console.error("usage: sample-probe.mjs --stage gis|juso|parcel --raw <raw> --db <sqlite> [--limit N]");
  process.exit(2);
}

const [{ readShp }, { initDataFileSchema }, { beginFeatureBulk, finishFeatureBulk }, { insertRelease }, { buildBuildings }, { buildJusoBuildings, jusoShpPerSido, shpExtent }, { buildParcelPolygons }, { latestShpPerSido }] = await Promise.all([
  import("../../../src/lib/v2/ingest/shp.ts"),
  import("../../../src/lib/v2/data/schema.ts"),
  import("../../../src/lib/v2/data/features.ts"),
  import("../../../src/lib/v2/ingest/build.ts"),
  import("../../../src/lib/v2/ingest/sources/buildings.ts"),
  import("../../../src/lib/v2/ingest/sources/juso-buildings.ts"),
  import("../../../src/lib/v2/ingest/sources/parcel-polygons.ts"),
  import("../../../src/lib/v2/ingest/shp-parts.ts"),
]);

async function* take(records, n) {
  let count = 0;
  for await (const record of records) {
    if (count++ >= n) break;
    yield record;
  }
}

const find = (dir, re) => {
  if (dir === "juso") {
    const file = jusoShpPerSido([...walk(join(raw, dir))]).get("11")?.file;
    if (!file) throw new Error(`no sido 11 ${dir} SHP under ${raw}`);
    return file;
  }
  const sets = latestShpPerSido([...walk(join(raw, dir))], re);
  const files = sets.get("11")?.files ?? [];
  if (files.length === 0) throw new Error(`no sido 11 ${dir} SHP under ${raw}`);
  return files[0];
};
function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else yield file;
  }
}

const gisFile = find("gis_building", "AL_D010");
const jusoFile = find("juso", "TL_SPBD_BULD");
const parcelFile = find("cadastral", "AL_D002");
mkdirSync(dirname(dbPath), { recursive: true });
rmSync(dbPath, { force: true });
const db = new Database(dbPath);
const kind = stage === "parcel" ? "parcels" : "buildings";
initDataFileSchema(db, kind);
const releaseId = insertRelease(db, {
  sourceId: `buildperf_${stage}`,
  provider: "buildperf sample",
  sourceUrl: "about:blank",
  sourceAsOf: "2026-10-09",
  fetchedAt: "2026-10-09T00:00:00.000Z",
  checksum: `sample:${stage}:${limit}`,
  licenseCode: "UNRESTRICTED",
});

const started = performance.now();
let stats;
beginFeatureBulk(db);
if (stage === "gis") {
  stats = await buildBuildings(db, take(readShp(gisFile), limit), releaseId, { ledger: null, spatial: null });
} else if (stage === "parcel") {
  stats = await buildParcelPolygons(db, take(readShp(parcelFile), limit), releaseId);
} else {
  const gis = await buildBuildings(db, take(readShp(gisFile), limit), releaseId, { ledger: null, spatial: null });
  finishFeatureBulk(db, { dropPending: false });
  const maxId = Number(db.prepare("SELECT COALESCE(MAX(feature_id), 0) FROM feature").pluck().get());
  const jusoRelease = insertRelease(db, {
    sourceId: "buildperf_juso",
    provider: "buildperf sample",
    sourceUrl: "about:blank",
    sourceAsOf: "2026-10-09",
    fetchedAt: "2026-10-09T00:00:00.000Z",
    checksum: `sample:juso:${limit}`,
    licenseCode: "UNRESTRICTED",
  });
  const jusoStarted = performance.now();
  const juso = await buildJusoBuildings(db, take(readShp(jusoFile, { native: true }), limit), jusoRelease, { extent: shpExtent(jusoFile), gisMaxFeatureId: maxId });
  stats = { gis, juso, jusoMs: Number((performance.now() - jusoStarted).toFixed(1)) };
  db.exec("ANALYZE feature; ANALYZE feature_rtree;");
  db.close();
  console.log(JSON.stringify({ stage, limit, files: { gisFile, jusoFile }, elapsedMs: Number((performance.now() - started).toFixed(1)), stats, featureRows: count(dbPath, "feature") }, null, 2));
  process.exit(0);
}
finishFeatureBulk(db);
db.exec("ANALYZE feature; ANALYZE feature_rtree;");
const featureRows = Number(db.prepare("SELECT COUNT(*) FROM feature").pluck().get());
const rtreeRows = Number(db.prepare("SELECT COUNT(*) FROM feature_rtree").pluck().get());
db.close();
console.log(JSON.stringify({ stage, limit, files: { gisFile, jusoFile, parcelFile }, elapsedMs: Number((performance.now() - started).toFixed(1)), stats, featureRows, rtreeRows }, null, 2));

function count(path, table) {
  const check = new Database(path, { readonly: true });
  const result = Number(check.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get());
  check.close();
  return result;
}
