/** VWorld 학교 학구도 GeoJSON 적재·학교 링크 계약. */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPointSource } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildSchoolZoneLinks, SCHOOL_SPEC } = await import("../../lib/v2/ingest/sources/school-kapt.ts");
const { buildSchoolZones, readSchoolZoneGeoJson, SCHOOL_ZONE_RIGHTS } = await import("../../lib/v2/ingest/sources/school-zones.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");

const fx = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const rel = (sourceId, rights = {}) => insertRelease(db, {
  sourceId,
  provider: "test",
  sourceUrl: "https://example.invalid",
  sourceAsOf: "2026-03-20",
  fetchedAt: "2026-10-01T00:00:00Z",
  checksum: "fixture",
  licenseCode: "TEST",
  rights,
});

const all = readSchoolZoneGeoJson(fx("school-zone-vworld-sample.json"));
const zoneRelease = rel("school_zone", SCHOOL_ZONE_RIGHTS);
const zoneStats = await buildSchoolZones(db, [
  { layer: "elem", releaseId: zoneRelease, records: all.filter((f) => String(f.properties?.hakgudo_id).startsWith("Z0001")) },
  { layer: "middle", releaseId: zoneRelease, records: all.filter((f) => String(f.properties?.hakgudo_id).startsWith("Z0002")) },
  { layer: "high", releaseId: zoneRelease, records: all.filter((f) => String(f.properties?.hakgudo_id).startsWith("Z0003")) },
]);
assert.deepEqual(zoneStats.map((s) => [s.received, s.accepted, s.rejected]), [[2, 2, 0], [1, 1, 0], [1, 1, 0]]);
assert.equal(db.prepare("SELECT COUNT(*) FROM feature").pluck().get(), 3, "동일 학구의 두 objectid는 하나의 stable feature");
assert.deepEqual(db.prepare("SELECT stable_id, kind FROM feature ORDER BY stable_id").all(), [
  { stable_id: "school_zone:Z000100973", kind: "school_zone_elem" },
  { stable_id: "school_zone:Z000200001", kind: "school_zone_middle" },
  { stable_id: "school_zone:Z000300001", kind: "school_zone_high" },
]);
const elem = db.prepare("SELECT geom_json, properties_json, legal_code FROM feature WHERE stable_id = 'school_zone:Z000100973'").get();
assert.equal(JSON.parse(elem.geom_json).type, "MultiPolygon");
assert.equal(JSON.parse(elem.geom_json).coordinates.length, 2, "여러 objectid 도형 병합");
assert.deepEqual(JSON.parse(elem.properties_json).objectids, ["6127", "6128"]);
assert.equal(elem.legal_code, "2723000000");

const schoolRelease = rel("school");
const school = await buildPointSource(db, SCHOOL_SPEC, (await csvRecords(fx("school-sample.csv"))).records, schoolRelease);
const linkRelease = rel("school_zone_link");
const attrRelease = rel("school_zone_elem");
const zoneIds = new Set(db.prepare("SELECT stable_id FROM feature WHERE kind LIKE 'school_zone_%'").pluck().all());
const [link, attr] = await buildSchoolZoneLinks(db, {
  link: (await csvRecords(fx("school-zone-link-sample.csv"))).records,
  elem: (await csvRecords(fx("school-zone-elem-sample.csv"))).records,
  linkReleaseId: linkRelease,
  elemReleaseId: attrRelease,
  zoneIds,
});
assert.equal(school.accepted, 3);
assert.deepEqual([link.received, link.accepted, link.unlocated, link.rejected], [5, 2, 1, 2]);
assert.deepEqual([attr.received, attr.accepted, attr.unlocated, attr.rejected], [4, 2, 0, 2]);
assert.ok(db.prepare("SELECT 1 FROM feature_link WHERE from_stable_id = 'school:B000002843' AND to_stable_id = 'school_zone:Z000100973' AND relation_type = 'serves_zone'").get());
assert.ok(db.prepare("SELECT 1 FROM feature_link WHERE from_stable_id = 'school:B000009527' AND to_stable_id = 'school_zone:Z000200001' AND relation_type = 'serves_zone'").get());
assert.equal(db.prepare("SELECT COUNT(*) FROM feature_link WHERE relation_type = 'serves_zone'").pluck().get(), 2);
assert.equal(JSON.parse(db.prepare("SELECT rights_json FROM source_release WHERE release_id = ?").pluck().get(zoneRelease)).provider, "국토교통부 VWorld");

db.close();
console.log("✓ v2 school-zone ingest");
