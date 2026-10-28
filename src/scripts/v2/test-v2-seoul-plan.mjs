import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { loadSeoulPlanZones } = await import("../../lib/v2/ingest/sources/seoul-plan.ts");

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const releaseId = insertRelease(db, { sourceId: "seoul_plan_zone", provider: "서울시", sourceUrl: "", sourceAsOf: "2026-09-01", fetchedAt: "2026-10-28", checksum: "test", licenseCode: "KOGL_4" });
const geometry = { type: "Polygon", coordinates: [[[127, 37], [127.01, 37], [127.01, 37.01], [127, 37.01], [127, 37]]] };
const row = (id, cls, stage, name, area, grp = null, sg = "11680") => ({ geometry, properties: { PRESENT_SN: id, SCLAS_CL: cls, PROPEL_CD: stage, DGM_NM: name, DGM_AR: area, GRP: grp, SIGNGU_SE: sg, CREATE_DAT: "20260930" } });
const records = [
  row("a", "BZ101", "PP0103", "은마", 100, "GRP188"),
  row("b", "BZ105", "PP0206", "은마", 100, "GRP188"),
  row("c", "BZ202", "PP0500", "이름연결 구역", 200),
  row("d", "BZ201", "PP0406", "모아", 300),
  row("e", "BZ401", "PP1209", "촉진", 400),
  row("f", "BZ103", "PP0204", "모호", 500),
  row("g", "BZ103", "PP0204", "다른구", 600, null, "11710"),
  row("h", "BZ101", "PP0102", "이름시군구", 800),
  row("h", "BZ101", "PP0102", "중복ID", 900),
  row("j", "BZ103", "PP0204", "중복명", 1000),
  row("x", "BZ301", "PP0801", "제외", 700),
];
const api = [
  { SITE_CODE: "11680", BSNS_NAME: "은마", BSNS_AREA: 100.5, PROPEL_DT: "2024-02-29 00:00:00.0", SUPLY_HSHLD: 5893, FLAR_RT: 250, FLOOR: "2/33" },
  { SITE_CODE: "11680", BSNS_NAME: "이름연결(가칭) 정비사업", BSNS_AREA: 999, PROPEL_DT: "2023-02-29 00:00:00.0" },
  { SITE_CODE: "11680", BSNS_NAME: "또다른사업", BSNS_AREA: 500 },
  { SITE_CODE: "11680", BSNS_NAME: "모호", BSNS_AREA: 500 },
  { SITE_CODE: "11680", BSNS_NAME: "다른구", BSNS_AREA: 600 },
  { SITE_CODE_NM: "강남구", BSNS_NAME: "이름시군구", BSNS_AREA: 800, PROPEL_DT: "2024-13-01 00:00:00.0" },
  { SITE_CODE: "11680", BSNS_NAME: "중복명", BSNS_AREA: 2000 },
  { SITE_CODE: "11680", BSNS_NAME: "중복명 구역", BSNS_AREA: 2001 },
];
const stats = await loadSeoulPlanZones(db, { releaseId, records, api, sigungu: new Map([["11|강남구", "11680"]]) });
const features = db.prepare("SELECT stable_id, name, legal_code, properties_json FROM feature ORDER BY stable_id").all();
const get = (id) => JSON.parse(features.find((f) => f.stable_id === `seoulplan:${id}`).properties_json);
assert.equal(stats.received, 11);
assert.equal(stats.accepted, 10);
assert.equal(features.length, 10);
assert.equal(get("a").projectType, "재건축");
assert.equal(get("b").program, "신속통합기획");
assert.equal(get("a").projectKey, get("b").projectKey);
assert.equal(get("a").stageCode, "PP0206");
assert.equal(get("a").stageName, "조합설립인가");
assert.equal(get("a").stageDate, "2024-02-29");
assert.equal(get("a").households, 5893);
assert.equal(get("a").overview.floors, "2/33");
assert.equal(get("c").stage, "추진위");
assert.equal(get("c").apiMatched, true);
assert.equal(get("c").stageDate, null);
assert.equal(get("d").stage, "구역지정");
assert.equal(get("d").areaKind, "모아타운");
assert.equal(get("e").stage, "미확인");
assert.equal(get("e").areaKind, "재정비촉진지구");
assert.equal(get("f").apiMatched, false);
assert.equal(get("g").apiMatched, false);
assert.equal(get("h").apiMatched, true);
assert.equal(get("h").stageDate, null);
assert.equal(get("h").projectType, "신속통합기획");
assert.equal(get("h").program, "신속통합기획");
assert.equal(get("j").apiMatched, false);
assert.equal(JSON.parse(features.find((f) => f.stable_id === "seoulplan:h#1").properties_json).projectKey, "seoulplan:h#1");
const coverage = JSON.parse(db.prepare("SELECT coverage_json FROM source_release WHERE release_id = ?").pluck().get(releaseId));
assert.deepEqual(coverage, { polygons: 10, apiRows: 8, matchedByArea: 3, matchedByName: 1, unmatchedApi: 5, excludedClasses: { BZ301: 1 } });
db.close();
console.log("test-v2-seoul-plan PASS");
