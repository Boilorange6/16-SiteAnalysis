/**
 * 학교·학구 연계·K-APT 적재 테스트. 픽스처는 실제 원천 형식(K-APT는 EUC-KR)의 발췌다.
 * 실제 원천 전체 건수는 school-kapt-dryrun.mjs로 본다.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { insertFeature, queryFeaturesInRadius } = await import("../../lib/v2/data/features.ts");
const { buildPointSource } = await import("../../lib/v2/ingest/sources/points.ts");
const { buildKapt, buildSchoolZoneLinks, sidoCodeOfName, SCHOOL_SPEC } = await import("../../lib/v2/ingest/sources/school-kapt.ts");
const { csvRecords } = await import("../../lib/v2/a0/measure.ts");

const fx = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const invariant = (s) => assert.equal(s.received, s.accepted + s.unlocated + s.rejected, `${s.sourceId}: received = accepted + unlocated + rejected`);
const counts = (s) => [s.received, s.accepted, s.unlocated, s.rejected];
const newDb = (kind) => {
  const db = new Database(":memory:");
  initDataFileSchema(db, kind);
  return db;
};
const rel = (db, id) => insertRelease(db, { sourceId: id, provider: "test", sourceUrl: "https://www.data.go.kr", sourceAsOf: "2026-08-31", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });

// ─── 1. 시도 코드 ─────────────────────────────────────────────────────────
assert.equal(sidoCodeOfName("강원특별자치도 정선군"), "51");
assert.equal(sidoCodeOfName("전북특별자치도교육청"), "52");
assert.equal(sidoCodeOfName("서울특별시"), "11");
assert.equal(sidoCodeOfName(""), "(미상)");

// ─── 2. 학교 + 학구 연계 ──────────────────────────────────────────────────
async function buildReference() {
  const db = newDb("reference");
  const school = await buildPointSource(db, SCHOOL_SPEC, (await csvRecords(fx("school-sample.csv"))).records, rel(db, "school"));
  const zones = await buildSchoolZoneLinks(db, {
    link: (await csvRecords(fx("school-zone-link-sample.csv"))).records,
    elem: (await csvRecords(fx("school-zone-elem-sample.csv"))).records,
    linkReleaseId: rel(db, "school_zone_link"),
    elemReleaseId: rel(db, "school_zone_elem"),
  });
  return { db, school, zones };
}
{
  const { db, school, zones } = await buildReference();
  const [link, elem] = zones;
  for (const s of [school, link, elem]) invariant(s);
  assert.deepEqual(counts(school), [5, 3, 0, 2], "좌표 없음·완전 중복 reject, 폐교 행은 유지");
  assert.deepEqual(school.byRegion, { 27: 1, 41: 1, 51: 1 });
  assert.deepEqual(school.byType, { 초등학교: 2, 중학교: 1 });
  const closed = db.prepare("SELECT name, properties_json FROM feature WHERE stable_id = 'school:B000010001'").get();
  assert.equal(closed.name, "옛,폐교초등학교", "따옴표 속 쉼표");
  const closedProps = JSON.parse(closed.properties_json);
  assert.equal(closedProps.operatingStatus, "폐교");
  assert.equal(closedProps.campus, "분교");
  assert.equal(closedProps.foundation, "공립");
  assert.equal(closedProps.level, "초등학교");
  assert.equal(closedProps.address, "강원특별자치도 정선군 신동읍 1", "도로명 없으면 지번");
  assert.equal(JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = 'school:B000002843'").pluck().get()).address, "대구광역시 북구 칠성시장로23길 55");
  assert.deepEqual(counts(link), [5, 2, 1, 2], "중복 연계·학구ID 없음 reject, 없는 학교 unlocated");
  assert.deepEqual(link.byRegion, { 27: 1, 41: 1 });
  assert.deepEqual(counts(elem), [4, 2, 0, 2]);
  assert.deepEqual(elem.byRegion, { 27: 2 });
  const links = db.prepare("SELECT from_stable_id, to_stable_id, relation_type, method FROM feature_link ORDER BY relation_type, from_stable_id").all();
  assert.deepEqual(links.map((l) => `${l.from_stable_id}>${l.to_stable_id}:${l.relation_type}/${l.method}`), [
    "school:B000002843>school_zone:Z000100973:serves_zone/school_zone_link",
    "school:B000009527>school_zone:Z000200001:serves_zone/school_zone_link",
    "school_zone:Z000100973>school_zone_geom:6127:zone_geometry/school_zone_elem",
    "school_zone:Z000100999>school_zone_geom:2623:zone_geometry/school_zone_elem",
  ]);
  // 학구 폴리곤은 만들지 않는다
  assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE kind LIKE 'school_zone%'").pluck().get(), 0);

  // 반경 조회 (옥산초 35.8808955, 128.5978756)
  const near = queryFeaturesInRadius(db, [128.5978756, 35.8808955], 200, ["school"]);
  assert.deepEqual(near.map((h) => h.stableId), ["school:B000002843"]);
  assert.ok(near[0].distanceM < 1);

  // 결정성: 다시 만들어도 같은 stable id·연계
  const again = await buildReference();
  const ids = (d) => d.prepare("SELECT stable_id FROM feature ORDER BY stable_id").pluck().all();
  assert.deepEqual(ids(again.db), ids(db));
  assert.deepEqual(again.db.prepare("SELECT * FROM feature_link ORDER BY 1,2,3").all().map((r) => ({ ...r, release_id: "" })), db.prepare("SELECT * FROM feature_link ORDER BY 1,2,3").all().map((r) => ({ ...r, release_id: "" })));
}

// ─── 3. K-APT ─────────────────────────────────────────────────────────────
async function buildCore() {
  const db = newDb("core");
  const pre = rel(db, "ledger_recap");
  const pp = db.prepare("INSERT INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES (?, ?, ?, '대', ?)");
  pp.run("1111010100100010000", 126.97, 37.59, pre);
  pp.run("4136010600100050000", 127.2, 37.62, pre);
  pp.run("1168010100100200000", 127.04, 37.5, pre);
  insertFeature(db, { stableId: "recap:R1", kind: "housing_complex", sourceKey: "R1", releaseId: pre, geometry: { type: "Point", coordinates: [127.2, 37.62] }, pnu: "4136010600100050000", properties: {} });
  insertFeature(db, { stableId: "title-housing:1168010100100200000", kind: "housing_complex", sourceKey: "x", releaseId: pre, geometry: { type: "Point", coordinates: [127.04, 37.5] }, pnu: "1168010100100200000", properties: {} });
  const parsed = await csvRecords(fx("kapt-sample.csv"));
  assert.equal(parsed.encoding, "euc-kr", "K-APT 원천은 EUC-KR");
  const [stats] = await buildKapt(db, { records: parsed.records, releaseId: rel(db, "kapt") });
  return { db, stats };
}
{
  const { db, stats } = await buildCore();
  invariant(stats);
  assert.deepEqual(counts(stats), [8, 3, 2, 3], "PNU 없음·길이 오류·중복 ID reject, 필지 대표점 없는 행·블록 지번 PNU는 unlocated");
  assert.deepEqual(stats.byRegion, { 11: 2, 41: 1 });
  assert.deepEqual(stats.byType, { "type:1": 1, "type:2": 1, "type:3": 1 });
  assert.deepEqual(stats.expectedRegions.sort(), ["11", "41"]);
  const row = db.prepare("SELECT * FROM feature WHERE stable_id = 'kapt:41360200000001'").get();
  assert.equal(row.kind, "kapt_complex");
  assert.equal(row.pnu, "4136010600100050000", "공백 제거");
  assert.equal(row.legal_code, "4136010600");
  assert.equal(row.name, "다산아파트");
  assert.deepEqual(JSON.parse(row.properties_json), {
    complexId: "41360200000001", complexType: "1", buildingCount: 10, households: 1000, approvalDate: "2020-01-02",
    nameAppraisal: "다산아파트", nameLedger: "다산아파트", nameRoad: "다산아파트", address: "경기도 남양주시 다산동 5", roadAddress: "다산로 1",
  });
  const first = JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = 'kapt:11110200000003'").pluck().get());
  assert.equal(first.nameLedger, null);
  assert.equal(first.buildingCount, 9);
  assert.equal(db.prepare("SELECT name FROM feature WHERE stable_id = 'kapt:11680200000009'").pluck().get(), "역삼빌라", "공시가격 이름이 없으면 대장 이름");
  assert.equal(db.prepare("SELECT COUNT(*) FROM feature WHERE stable_id = 'kapt:41360200000002'").pluck().get(), 0, "unlocated는 feature를 만들지 않는다");

  // 같은 PNU의 ledger housing_complex로 연계
  const links = db.prepare("SELECT from_stable_id, to_stable_id, relation_type, method FROM feature_link ORDER BY from_stable_id").all();
  assert.deepEqual(links, [
    { from_stable_id: "kapt:11680200000009", to_stable_id: "title-housing:1168010100100200000", relation_type: "same_parcel", method: "pnu" },
    { from_stable_id: "kapt:41360200000001", to_stable_id: "recap:R1", relation_type: "same_parcel", method: "pnu" },
  ]);

  // 시도별 received/accepted/unlocated/rejected는 release coverage에 남는다
  const cov = JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE source_id = 'kapt'").pluck().get());
  assert.deepEqual(cov.byRegion["41"], { received: 3, accepted: 1, unlocated: 1, rejected: 1 });
  assert.deepEqual(cov.byRegion["11"], { received: 4, accepted: 2, unlocated: 1, rejected: 1 });
  assert.deepEqual(cov.byRegion["(미상)"], { received: 1, accepted: 0, unlocated: 0, rejected: 1 });
  assert.equal(cov.linkedToHousingComplex, 2);

  // 반경 조회: ledger 단지 옆에서 kapt 단지도 함께 나온다
  const near = queryFeaturesInRadius(db, [127.2, 37.62], 300, ["housing_complex", "kapt_complex"]);
  assert.deepEqual(near.map((h) => h.stableId).sort(), ["kapt:41360200000001", "recap:R1"]);

  // 결정성
  const again = await buildCore();
  const ids = (d) => d.prepare("SELECT stable_id FROM feature ORDER BY stable_id").pluck().all();
  assert.deepEqual(ids(again.db), ids(db));
}

console.log("v2 school/kapt ingest OK");
