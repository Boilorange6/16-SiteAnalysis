/**
 * 건축물대장 테스트. 대장에는 좌표가 없어 PNU → 필지 대표점으로 위치를 얻는다.
 * 대장의 0은 "없음"이 아니라 "미상"이다(A0 측정).
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { ledgerPnu, buildLedger, buildLedgerUnitTypes } = await import("../../lib/v2/ingest/sources/ledger.ts");

const db = new Database(":memory:");
initDataFileSchema(db, "core");
const rel = (id) => insertRelease(db, { sourceId: id, provider: "국토교통부 건축HUB", sourceUrl: "https://www.hub.go.kr", sourceAsOf: "2026-08-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
const recapRel = rel("ledger_recap");
const titleRel = rel("ledger_title");
const pp = db.prepare("INSERT INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES (?, ?, ?, '대', ?)");
pp.run("3611011100106400000", 127.27, 36.52, recapRel);
pp.run("4136010100160000000", 127.15, 37.62, recapRel);
pp.run("1168010100100100000", 127.05, 37.49, recapRel);
pp.run("1168010100100200000", 127.06, 37.49, recapRel);

const addr = (sgg, bjd, gb, bun, ji) => ({ 시군구_코드: sgg, 법정동_코드: bjd, 대지_구분_코드: gb, 번: bun, 지: ji });
async function* from(rows) { for (const properties of rows) yield { properties, point: null }; }

// ─── 1. PNU ───────────────────────────────────────────────────────────────
assert.deepEqual(ledgerPnu(addr("36110", "11100", "0", "0640", "0000")), { legalCode: "3611011100", pnu: "3611011100106400000" });
assert.equal(ledgerPnu(addr("36110", "11100", "1", "12", "3"))?.pnu, "3611011100200120003");
assert.equal(ledgerPnu(addr("36110", "11100", "2", "0001", "0000")), null, "블록 지번");
assert.equal(ledgerPnu(addr("36110", "", "0", "0640", "0000")), null);

// ─── 2. 적재 ──────────────────────────────────────────────────────────────
const stats = await buildLedger(db, {
  recapReleaseId: recapRel,
  titleReleaseId: titleRel,
  recap: from([
    { 관리_건축물대장_PK: "108215000068706", 건물_명: "가재마을4단지", ...addr("36110", "11100", "0", "0640", "0000"), 주_용도_코드_명: "공동주택", 기타_용도: "아파트", "세대_수(세대)": "1010", "가구_수(가구)": "0", 주_건축물_수: "12", 총_주차_수: "0", 사용승인_일: "20120330" },
    { 관리_건축물대장_PK: "P2", 건물_명: "블록단지", ...addr("41360", "10100", "2", "0001", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "500", 사용승인_일: "" },
    { 관리_건축물대장_PK: "P3", 건물_명: "창고", ...addr("41360", "10100", "0", "6000", "0000"), 주_용도_코드_명: "창고시설", "세대_수(세대)": "0" },
    { 관리_건축물대장_PK: "P5", 건물_명: "점없는단지", ...addr("41360", "10100", "0", "8000", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "200" },
    { 관리_건축물대장_PK: "P4", 건물_명: "대표점없음", ...addr("41360", "10100", "0", "7000", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "30", 사용승인_일: "00000000" },
  ]),
  title: from([
    { 관리_건축물대장_PK: "T1", 대장_종류_코드_명: "표제부", 건물_명: "가재마을4단지", 동_명: "401동", ...addr("36110", "11100", "0", "0640", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "84" }, // recap 있음 → 제외
    { 관리_건축물대장_PK: "T2", 대장_종류_코드_명: "표제부", 건물_명: "해피빌라", 동_명: "A동", ...addr("11680", "10100", "0", "0010", "0000"), 주_용도_코드_명: "공동주택", 기타_용도: "다세대주택", "세대_수(세대)": "8", 사용승인_일: "20051201" },
    { 관리_건축물대장_PK: "T3", 대장_종류_코드_명: "표제부", 건물_명: "해피빌라", 동_명: "B동", ...addr("11680", "10100", "0", "0010", "0000"), 주_용도_코드_명: "공동주택", 기타_용도: "다세대주택", "세대_수(세대)": "6", 사용승인_일: "20031101" },
    { 관리_건축물대장_PK: "T4", 대장_종류_코드_명: "표제부", 건물_명: "역삼오피스텔", ...addr("11680", "10100", "0", "0020", "0000"), 주_용도_코드_명: "업무시설", 기타_용도: "오피스텔,근린생활시설", "호_수(호)": "0", "높이(m)": "45.2", 지상_층_수: "15", 사용승인_일: "20190510" },
    { 관리_건축물대장_PK: "T6", 대장_종류_코드_명: "표제부", 건물_명: "점없는단지", 동_명: "101동", ...addr("41360", "10100", "0", "8000", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "50" }, // recap 단지는 위치 미확인 → 표제부로 다시 세지 않는다
    { 관리_건축물대장_PK: "T7", 대장_종류_코드_명: "표제부", 건물_명: "세대미상", ...addr("11680", "10100", "0", "0010", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "0" },
    { 관리_건축물대장_PK: "T8", 대장_종류_코드_명: "표제부", 건물_명: "점없는빌라", ...addr("41360", "10100", "0", "9000", "0000"), 주_용도_코드_명: "공동주택", "세대_수(세대)": "5" },
    { 관리_건축물대장_PK: "T9", 대장_종류_코드_명: "표제부", 건물_명: "단일빌라", 동_명: "1동", ...addr("11680", "10100", "0", "0020", "0000"), 주_용도_코드_명: "공동주택", 기타_용도: "다세대주택", "세대_수(세대)": "3", 지상_층_수: "4", 연면적: "300", 건축면적: "100" },
    { 관리_건축물대장_PK: "T5", 대장_종류_코드_명: "표제부", 건물_명: "사무동", ...addr("11680", "10100", "0", "0020", "0000"), 주_용도_코드_명: "업무시설", 기타_용도: "사무소" },
  ]),
});

const byId = Object.fromEntries(stats.map((s) => [s.sourceId, s]));
const counts = (s) => [s.received, s.accepted, s.unlocated, s.rejected];
for (const s of stats) assert.equal(s.received, s.accepted + s.unlocated + s.rejected, `${s.sourceId}: received = accepted + unlocated + rejected`);
assert.deepEqual(counts(byId.ledger_recap_housing), [4, 1, 3, 0], "창고는 대상 아님(세지 않음), 블록·대표점없음·점없는단지는 위치 미확인");
assert.deepEqual(counts(byId.ledger_title_housing), [5, 3, 1, 1], "T2+T3·T9 → 3행 accept·feature 2개, T8 점 없음, T7 세대 미상 reject, T1·T6은 recap PNU라 대상 아님");
assert.deepEqual(counts(byId.ledger_title_officetel), [1, 1, 0, 0]);
assert.equal(db.prepare("SELECT count(*) FROM feature WHERE kind = 'housing_complex' AND stable_id LIKE 'title-housing:%'").pluck().get(), 2, "위치 미확인 recap 단지의 동은 title-housing이 되지 않는다");

const props = (id) => JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = ?").pluck().get(id));
assert.deepEqual(props("recap:108215000068706"), { source: "recap", ledgerPk: "108215000068706", mainUse: "공동주택", otherUse: "아파트", units: 1010, households: null, parking: null, approvalDate: "2012-03-30", buildingCount: 12 }, "0은 미상(null)");
assert.deepEqual(props("title-housing:1168010100100100000"), { source: "title", ledgerPk: null, mainUse: "공동주택", otherUse: "다세대주택", units: 14, households: null, parking: null, approvalDate: "2003-11-01", buildingCount: 2 });
assert.deepEqual(props("title-housing:1168010100100200000"), { source: "title", ledgerPk: "T9", mainUse: "공동주택", otherUse: "다세대주택", units: 3, households: null, parking: null, approvalDate: null, buildingCount: 1, floorsAbove: 4, grossFloorAreaM2: 300, footprintAreaM2: 100 });
assert.deepEqual(props("title:T4"), { ledgerPk: "T4", units: null, floorsAbove: 15, heightM: 45.2, approvalDate: "2019-05-10", otherUse: "오피스텔,근린생활시설" });
assert.equal(db.prepare("SELECT pnu FROM feature WHERE stable_id = 'recap:108215000068706'").pluck().get(), "3611011100106400000");
assert.equal(db.prepare("SELECT count(*) FROM feature WHERE stable_id LIKE 'recap:P%'").pluck().get(), 0, "위치 미확인은 feature를 만들지 않는다");

// ─── 2-1. 전유부: 같은 호의 전유 행 합산, 공용 제외, PK 직접 연결 ───────────
{
  const exclusiveRel = rel("ledger_exclusive_area");
  const ex = (p) => ({
    "관리_건축물대장_PK": "108215000068706", "시군구_코드": "36110", "법정동_코드": "11100", "대지_구분_코드": "0", 번: "0640", 지: "0000",
    동_명: "101동", 층_번호: "2", 호_명: "201", "전유_공용_구분_코드": "1", "전유_공용_구분_코드_명": "전유", "주_용도_코드_명": "공동주택", "기타_용도": "아파트", "면적(㎡)": "42.1", ...p,
  });
  const exOffi = { ...ex({ "관리_건축물대장_PK": "T4", "시군구_코드": "11680", "법정동_코드": "10100", 번: "0020", 동_명: "", 층_번호: "3", 호_명: "301", "주_용도_코드_명": "업무시설", "기타_용도": "오피스텔", "면적(㎡)": "17.8" }) };
  const unitStats = await buildLedgerUnitTypes(db, from([
    ex(),
    ex({ "면적(㎡)": "42.9" }),
    ex({ 호_명: "202", "면적(㎡)": "59.5" }),
    ex({ "전유_공용_구분_코드": "2", "전유_공용_구분_코드_명": "공용", "면적(㎡)": "100" }),
    exOffi,
  ]), exclusiveRel);
  assert.deepEqual([unitStats.received, unitStats.accepted, unitStats.rejected], [5, 3, 1]);
  assert.deepEqual(props("recap:108215000068706").unitTypes, [{ typeM2: 59, units: 1 }, { typeM2: 85, units: 1 }]);
  assert.deepEqual(props("title:T4").unitTypes, [{ typeM2: 17, units: 1 }]);
}

// ─── 3. 같은 PK가 두 번 → 첫 행만 feature, 뒤는 reject (PK 오류로 적재가 죽지 않는다) ──
{
  const d = new Database(":memory:");
  initDataFileSchema(d, "core");
  const r = insertRelease(d, { sourceId: "ledger_recap", provider: "t", sourceUrl: "https://example.invalid", sourceAsOf: "2026-08-01", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
  d.prepare("INSERT INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES (?, ?, ?, '대', ?)").run("3611011100106400000", 127.27, 36.52, r);
  d.prepare("INSERT INTO parcel_point (pnu, lng, lat, jimok, release_id) VALUES (?, ?, ?, '대', ?)").run("1168010100100200000", 127.06, 37.49, r);
  const a = addr("36110", "11100", "0", "0640", "0000");
  const o = addr("11680", "10100", "0", "0020", "0000");
  const dup = await buildLedger(d, {
    recapReleaseId: r,
    titleReleaseId: r,
    recap: from([
      { 관리_건축물대장_PK: "D1", 건물_명: "첫째", ...a, 주_용도_코드_명: "공동주택", "세대_수(세대)": "100" },
      { 관리_건축물대장_PK: "D1", 건물_명: "둘째", ...a, 주_용도_코드_명: "공동주택", "세대_수(세대)": "200" },
    ]),
    title: from([
      { 관리_건축물대장_PK: "O1", 건물_명: "오피1", ...o, 주_용도_코드_명: "업무시설", 기타_용도: "오피스텔" },
      { 관리_건축물대장_PK: "O1", 건물_명: "오피2", ...o, 주_용도_코드_명: "업무시설", 기타_용도: "오피스텔" },
    ]),
  });
  for (const s of dup) assert.equal(s.received, s.accepted + s.unlocated + s.rejected, `${s.sourceId}: 행 단위 불변식`);
  const [recap, , officetel] = dup;
  assert.deepEqual(counts(recap), [2, 1, 0, 1]);
  assert.deepEqual(counts(officetel), [2, 1, 0, 1]);
  assert.equal(d.prepare("SELECT name FROM feature WHERE stable_id = 'recap:D1'").pluck().get(), "첫째", "첫 행을 남긴다");
  assert.equal(d.prepare("SELECT name FROM feature WHERE stable_id = 'title:O1'").pluck().get(), "오피1");
}

console.log("✓ v2 ledger");
