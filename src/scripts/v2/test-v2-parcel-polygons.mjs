import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const { initDataFileSchema, DATA_FILE_KINDS } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildParcelPolygons } = await import("../../lib/v2/ingest/sources/parcel-polygons.ts");
const { queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { buildEngineFixture, CENTER, PNU_DASAN_100 } = await import("./engine-fixture.mjs");
const M = await import("../../lib/v2/data/manifest.ts");

assert.ok(DATA_FILE_KINDS.includes("parcels"));
const db = new Database(":memory:");
initDataFileSchema(db, "parcels");
const rel = insertRelease(db, { sourceId: "parcel_polygon", provider: "t", sourceUrl: "u", sourceAsOf: "2026-09-08", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
const sq = (lng, lat, d) => ({ type: "Polygon", coordinates: [[[lng, lat], [lng + d, lat], [lng + d, lat + d], [lng, lat + d], [lng, lat]]] });
async function* recs() {
  yield { properties: { A1: "1111010100100800001", A2: "1111010100", A5: "80-1대", A7: "11110" }, geometry: sq(126.97, 37.58, 0.0005) };
  yield { properties: { A1: "1111010100100800001", A2: "1111010100", A5: "80-1대", A7: "11110" }, geometry: sq(126.97, 37.58, 0.0005) }; // 중복
  yield { properties: { A1: "1111010100200010000", A2: "1111010100", A5: "산1임", A7: "11110" }, geometry: sq(126.98, 37.58, 0.001) };
  yield { properties: { A1: "bad", A2: "1111010100", A5: "1대", A7: "11110" }, geometry: sq(126.99, 37.58, 0.001) };
  yield { properties: { A1: "1111010100100800002", A2: "1111010100", A5: "80-2대", A7: "11110" }, geometry: { type: "Point", coordinates: [126.97, 37.58] } };
}
const st = await buildParcelPolygons(db, recs(), rel);
assert.deepEqual([st.received, st.accepted, st.rejected], [5, 2, 3]);
const rows = db.prepare("SELECT stable_id, pnu, name, properties_json FROM feature ORDER BY feature_id").all();
assert.equal(rows[0].stable_id, "parcel:1111010100100800001");
const p0 = JSON.parse(rows[0].properties_json);
assert.equal(rows[0].name, "80-1대"); assert.equal(p0.jimok, "대"); assert.equal(p0.jibun, "80-1"); assert.equal(p0.sigungu, "11110"); assert.equal(p0.mountain, false); assert.ok(p0.areaM2 > 1900 && p0.areaM2 < 2600, `area ${p0.areaM2}`); // 0.0005° ≈ 44×55 m
const p1 = JSON.parse(rows[1].properties_json);
assert.equal(p1.jimok, "임"); assert.equal(p1.jibun, "산1"); assert.equal(p1.mountain, true);
assert.equal(queryFeaturesInRadius(db, [126.9702, 37.5802], 100, ["parcel"]).length, 1);
db.close();

// 픽스처: parcels·buildings 파일이 manifest에 실린다
const dataDir = mkdtempSync(join(tmpdir(), "v2-parcels-fx-"));
await buildEngineFixture(dataDir, "v1", { parcels: true, buildings: true });
const m = M.readManifest(dataDir);
assert.ok(m.files.parcels && m.files.buildings);
const pdb = M.openDataFile(dataDir, m, "parcels");
const hits = queryFeaturesInRadius(pdb, CENTER, 800, ["parcel"]);
assert.equal(hits.length, 8, "반경 800 안 필지 8(경계 걸침 포함, 반경 밖 1 제외)");
assert.ok(hits.some((h) => h.pnu === PNU_DASAN_100));
pdb.close();
console.log("✓ v2 parcel polygons");
