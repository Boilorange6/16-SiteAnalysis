import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildSupply } = await import("../../lib/v2/ingest/sources/supply.ts");

// core: 강릉시 견소동 이름표 + 필지 대표점
const core = new Database(":memory:");
initDataFileSchema(core, "core");
const cRel = insertRelease(core, { sourceId: "legal", provider: "x", sourceUrl: "x", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
core.prepare("INSERT INTO legal_area VALUES ('51150','sigungu','강원특별자치도 강릉시',NULL,?)").run(cRel);
core.prepare("INSERT INTO legal_area VALUES ('51150118','emd','견소동','51150',?)").run(cRel);
core.prepare("INSERT INTO parcel_point VALUES ('5115011800102190000', 128.93, 37.77, '대', ?)").run(cRel);

const db = new Database(":memory:");
initDataFileSchema(db, "market");
const rel = (id) => insertRelease(db, { sourceId: id, provider: "한국부동산원", sourceUrl: "https://www.data.go.kr", sourceAsOf: "2026-06-30", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
async function* from(rows) { for (const properties of rows) yield { properties, point: null }; }

const stats = await buildSupply(db, {
  core,
  legacyReleaseId: rel("applyhome"),
  moveInReleaseId: rel("move_in"),
  legacy: [
    { id: "2026000123", name: "다산 자이", address: "경기도 남양주시 다산동 6000", area_name: "경기", kind: "apartment", units: 800, sale_date: "2026-03-10", move_in_month: "202809", homepage_url: "https://example.com/h", notice_url: "", lat: 37.62, lng: 127.15 },
    { id: "2026000124", name: "좌표없는 단지", address: "OO택지 A-3블록", area_name: "경기", kind: "apartment", units: 0, sale_date: "", move_in_month: "2028", homepage_url: "", notice_url: "", lat: null, lng: null },
  ],
  moveIn: from([
    { 입주예정월: "2026-12", 지역: "강원", 사업유형: "분양", 주소: "강원특별자치도 강릉시 견소동 219-0", 아파트명: "강릉 모아미래도 오션리버", 세대수: "561" },
    { 입주예정월: "2027-04", 지역: "강원", 사업유형: "분양", 주소: "강원특별자치도 강릉시 포남동 1153-0", 아파트명: "모르는 동", 세대수: "226" },
  ]),
});

const byId = Object.fromEntries(stats.map((s) => [s.sourceId, s]));
assert.deepEqual([byId.applyhome.accepted, byId.applyhome.unlocated], [1, 1]);
assert.deepEqual([byId.move_in.accepted, byId.move_in.unlocated], [1, 1]);

const ev = db.prepare("SELECT * FROM development_event WHERE event_id = 'applyhome:2026000123'").get();
assert.deepEqual(
  { t: ev.event_type, s: ev.stage, e: ev.effective_date, p: ev.planned_date, pr: ev.planned_date_precision, u: ev.units, g: ev.geometry_id, url: ev.evidence_url },
  { t: "sale_notice", s: "announced", e: "2026-03-10", p: "2028-09", pr: "month", u: 800, g: "applyhome:2026000123", url: "https://example.com/h" },
);
const ev2 = db.prepare("SELECT planned_date, planned_date_precision, units, geometry_id FROM development_event WHERE event_id = 'applyhome:2026000124'").get();
assert.deepEqual(ev2, { planned_date: null, planned_date_precision: "unknown", units: null, geometry_id: null }, "위치·일정·세대 미상도 사실로 남긴다");

const mv = db.prepare("SELECT e.*, f.pnu FROM development_event e JOIN feature f ON f.stable_id = e.geometry_id WHERE e.event_type = 'move_in'").get();
assert.equal(mv.planned_date, "2026-12");
assert.equal(mv.units, 561);
assert.equal(mv.pnu, "5115011800102190000");
assert.equal(db.prepare("SELECT count(*) FROM development_event WHERE event_type = 'move_in'").pluck().get(), 2);
assert.equal(db.prepare("SELECT count(*) FROM feature WHERE kind = 'planned_supply'").pluck().get(), 2);

console.log("✓ v2 supply");
