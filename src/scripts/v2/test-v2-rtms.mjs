import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildEngineFixture } = await import("./engine-fixture.mjs");
const { openDataFile, readManifest } = await import("../../lib/v2/data/manifest.ts");
const { fetchRtms, parseRtmsXml, monthsBetween, rawPath, maskKey } = await import("../../lib/v2/ingest/rtms-fetch.ts");
const { buildRtms, toTxRow, parseCancelDate } = await import("../../lib/v2/ingest/sources/rtms.ts");

const KEY = "SECRET/KEY+abc==";
const item = (o) => `<item>${Object.entries(o).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</item>`;
const page = (items, total) => `<?xml version="1.0"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items.join("")}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${total}</totalCount></body></response>`;
const base = { sggCd: "11680", umdCd: "10300", umdNm: "개포동", jibun: "660-4", bonbun: "0660", bubun: "0004", landCd: "1", aptNm: "디에이치", dealYear: "2026", dealMonth: "6", dealDay: "15", excluUseAr: "84.9", floor: "21", buildYear: "2023", cdealType: " ", cdealDay: " " };

// ---- 파싱 ----
assert.deepEqual(monthsBetween("2025-11", "2026-02"), ["202511", "202512", "202601", "202602"]);
assert.throws(() => parseRtmsXml("<response><header><resultCode>30</resultCode><resultMsg>KEY</resultMsg></header></response>"), /30/);
assert.equal(parseRtmsXml(page([item({ ...base, dealAmount: " 225,000" })], 1)).items[0].dealAmount, "225,000");
assert.equal(maskKey(`x ${KEY} y ${encodeURIComponent(KEY)}`, KEY), "x *** y ***");
assert.equal(parseCancelDate("26.03.15"), "2026-03-15");

// ---- 수집: 페이징·이어받기·예산 ----
const tmp = mkdtempSync(join(tmpdir(), "rtms-"));
try {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const lawd = u.searchParams.get("LAWD_CD");
    const pageNo = Number(u.searchParams.get("pageNo"));
    if (lawd === "99999") return new Response("boom", { status: 500 });
    const total = lawd === "11680" ? 1500 : 1; // 11680은 2쪽
    const n = lawd === "11680" ? (pageNo === 1 ? 1000 : 500) : 1;
    return new Response(page(Array.from({ length: n }, (_, i) => item({ ...base, dealAmount: "100,000", floor: String(i + 1), jibun: `${pageNo}-${i}` })), total));
  };
  const common = { serviceKey: KEY, rawDir: tmp, types: ["apt-trade"], months: ["202606"], fetchImpl, sleep: async () => {}, today: "2026-09-30" };
  const s1 = await fetchRtms({ ...common, lawds: ["11680", "11710", "99999"] });
  assert.equal(s1.done, 2);
  assert.equal(s1.rows, 1501);
  assert.equal(s1.failed.length, 1); // 500 오류는 재시도(4회) 후 실패로 기록
  assert.ok(!JSON.stringify(s1.failed).includes(KEY) && !JSON.stringify(s1.failed).includes(encodeURIComponent(KEY)));
  assert.equal(s1.calls["apt-trade"], 2 + 1 + 4);
  const raw = JSON.parse(readFileSync(rawPath(tmp, "apt-trade", "202606", "11680"), "utf8"));
  assert.equal(raw.items.length, 1500);
  assert.ok(!existsSync(rawPath(tmp, "apt-trade", "202606", "99999")));
  // 이어받기: 받은 칸은 호출하지 않는다
  urls.length = 0;
  const s2 = await fetchRtms({ ...common, lawds: ["11680", "11710"] });
  assert.equal(s2.skipped, 2);
  assert.equal(urls.length, 0);
  // 예산: 한도에 닿으면 남은 칸을 받지 않고 깨끗이 멈춘다(원장은 파일로 남는다)
  const s3 = await fetchRtms({ ...common, lawds: ["11200", "11215", "11230", "11260"], dailyLimit: 7 + 2 });
  assert.equal(s3.done, 2);
  assert.deepEqual(s3.budgetStopped, ["apt-trade"]);
  assert.equal(JSON.parse(readFileSync(join(tmp, "rtms", "_ledger.json"), "utf8"))["2026-09-30"]["apt-trade"], 9);
  // 다음 날은 원장이 새로 시작한다
  const s4 = await fetchRtms({ ...common, today: "2026-10-01", lawds: ["11200", "11215", "11230", "11260"] });
  assert.equal(s4.done, 2);
  assert.deepEqual(s4.budgetStopped, []);
  // 미등록 서비스키(403)는 재시도 없이 fatal
  const noKey = async () => new Response("<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>", { status: 403 });
  const s5 = await fetchRtms({ ...common, types: ["apt-rent"], lawds: ["11680"], fetchImpl: noKey });
  assert.match(s5.fatal, /서비스키/);
  assert.equal(s5.calls["apt-rent"], 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- 적재 ----
const core = new Database(":memory:");
initDataFileSchema(core, "core");
const cRel = insertRelease(core, { sourceId: "legal", provider: "x", sourceUrl: "x", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
core.prepare("INSERT INTO legal_area VALUES ('11680','sigungu','서울특별시 강남구',NULL,?)").run(cRel);
core.prepare("INSERT INTO legal_area VALUES ('11680103','emd','개포동','11680',?)").run(cRel);
core.prepare("INSERT INTO parcel_point VALUES ('1168010300106600004', 127.05, 37.48, '대', ?)").run(cRel);
core.prepare("INSERT INTO parcel_point VALUES ('1168010300100010000', 127.06, 37.49, '대', ?)").run(cRel);

const rawDir = mkdtempSync(join(tmpdir(), "rtms-build-"));
try {
  const { writeAtomic } = await import("../../lib/v2/ingest/rtms-fetch.ts");
  const file = (type, ym, lawd, items) => writeAtomic(rawPath(rawDir, type, ym, lawd), JSON.stringify({ type, lawd, ym, fetchedAt: "2026-09-30T01:00:00.000Z", totalCount: items.length, items }));
  file("apt-trade", "202606", "11680", [
    { ...base, dealAmount: "225,000" },
    { ...base, dealAmount: "225,000" }, // 자연키 완전 중복 -> reject
    { ...base, dealAmount: "310,000", dealDay: "2", cdealType: "O", cdealDay: "26.07.01" }, // 취소 거래도 보관
    { ...base, dealAmount: "100,000", umdCd: "", bonbun: "", jibun: "1", umdNm: "개포동" }, // 구조화 코드 없음 -> 주소 풀이(660 아닌 1번지)
    { ...base, dealAmount: "90,000", jibun: "999", bonbun: "0999" }, // 대표점 없음 -> unlocated
    { ...base, dealAmount: "0" }, // 금액 없음 -> reject
  ]);
  file("apt-rent", "202606", "11680", [
    { ...base, contractType: "신규", deposit: "50,000", monthlyRent: "0" },
    { ...base, contractType: "갱신", deposit: "10,000", monthlyRent: "120", dealDay: "3" },
  ]);
  const db = new Database(":memory:");
  initDataFileSchema(db, "market");
  const stats = await buildRtms(db, { core, rawDir, now: new Date("2026-09-30T02:00:00Z") });
  const by = Object.fromEntries(stats.map((s) => [s.sourceId, s]));
  const a = by.rtms_apt_trade;
  assert.deepEqual([a.received, a.accepted, a.unlocated, a.rejected], [6, 3, 1, 2]);
  assert.equal(a.received, a.accepted + a.unlocated + a.rejected);
  assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction WHERE property_type='apt' AND contract_type='trade'").pluck().get(), 4); // located 3 + unlocated 1
  const cancelled = db.prepare("SELECT * FROM property_transaction WHERE cancelled_at IS NOT NULL").get();
  assert.equal(cancelled.cancelled_at, "2026-07-01");
  assert.equal(cancelled.price_krw, 3_100_000_000);
  assert.equal(cancelled.location_id, "1168010300106600004");
  assert.equal(cancelled.deal_date, "2026-06-02");
  const unl = db.prepare("SELECT match_status, location_id FROM property_transaction WHERE price_krw = 900000000").get();
  assert.deepEqual(unl, { match_status: "unlocated", location_id: null });
  assert.equal(db.prepare("SELECT location_id FROM property_transaction WHERE price_krw = 1000000000").pluck().get(), "1168010300100010000");
  const rent = db.prepare("SELECT contract_type, renewal, deposit_krw, rent_krw FROM property_transaction WHERE property_type='apt' AND contract_type != 'trade' ORDER BY deposit_krw").all();
  assert.deepEqual(rent, [
    { contract_type: "monthly", renewal: "renewal", deposit_krw: 100_000_000, rent_krw: 1_200_000 },
    { contract_type: "jeonse", renewal: "new", deposit_krw: 500_000_000, rent_krw: 0 },
  ]);
  const rel = db.prepare("SELECT source_as_of, fetched_at, coverage_json FROM source_release WHERE source_id = 'rtms_apt_trade'").get();
  assert.equal(rel.source_as_of, "2026-06-30");
  assert.equal(rel.fetched_at, "2026-09-30T02:00:00.000Z");
  assert.deepEqual(JSON.parse(rel.coverage_json).byRegion["11"], { received: 6, accepted: 3, unlocated: 1, rejected: 2 });
  // 실응답 모양(2026-08 강남구): 전월세는 umdCd·bonbun 없이 umdNm만, 오피스텔 단지명은 offiNm, 전월세엔 cdealType 없음
  const aptRent = toTxRow("apt-rent", "11680", "2026-09-30", { aptNm: "상록수", buildYear: "1993", contractTerm: "", contractType: "갱신", dealDay: "13", dealMonth: "8", dealYear: "2026", deposit: "40,000", excluUseAr: "74.54", floor: "3", jibun: "734", monthlyRent: "160", sggCd: "11680", umdNm: "일원동" });
  assert.deepEqual([aptRent.contractType, aptRent.renewal, aptRent.depositKrw, aptRent.rentKrw, aptRent.cancelledAt], ["monthly", "renewal", 400_000_000, 1_600_000, null]);
  const offiRent = toTxRow("offi-rent", "11680", "2026-09-30", { offiNm: "성우스타우스오피스텔", contractTerm: "26.09~28.09", contractType: "신규", dealDay: "30", dealMonth: "8", dealYear: "2026", deposit: "19,800", excluUseAr: "32.03", floor: "6", jibun: "832-33", monthlyRent: "0", sggCd: "11680", sggNm: "강남구", umdNm: "역삼동" });
  assert.deepEqual([offiRent.propertyType, offiRent.contractType, offiRent.renewal, offiRent.depositKrw], ["offi", "jeonse", "new", 198_000_000]);
  const offiTrade = toTxRow("offi-trade", "11680", "2026-09-30", { buyerGbn: "개인", cdealDay: "26.09.01", cdealType: "O", dealAmount: "21,000", dealDay: "12", dealMonth: "8", dealYear: "2026", dealingGbn: "중개거래", estateAgentSggNm: "서울 강남구", excluUseAr: "22.05", floor: "8", jibun: "96", offiNm: "(96)", sggCd: "11680", sggNm: "강남구", slerGbn: "개인", umdNm: "논현동" });
  assert.deepEqual([offiTrade.propertyType, offiTrade.renewal, offiTrade.priceKrw, offiTrade.cancelledAt], ["offi", null, 210_000_000, "2026-09-01"]);
  const unknownRenewal = toTxRow("apt-rent", "11680", "2026-09-30", { ...base, contractType: "", deposit: "40,000", monthlyRent: "0" });
  assert.equal(unknownRenewal.renewal, null);
  // 결정성: 같은 입력이면 같은 id
  const again = toTxRow("apt-trade", "11680", "2026-09-30", { ...base, dealAmount: "225,000" });
  assert.ok(db.prepare("SELECT 1 FROM property_transaction WHERE transaction_id = ?").get(again.transactionId));
  // 원본이 없는 유형은 릴리스도 만들지 않는다
  assert.equal(stats.length, 2);
} finally {
  rmSync(rawDir, { recursive: true, force: true });
}

// 엔진 fixture: 반경 안 전세 11·월세 4행, 신규 4·갱신 2, 취소·미확인과 옛 열 없는 파일 모양.
{
  const dir = mkdtempSync(join(tmpdir(), "rtms-rents-fixture-"));
  try {
    await buildEngineFixture(dir, "rents", { rents: true });
    const db = openDataFile(dir, readManifest(dir), "market");
    assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction WHERE property_type = 'apt' AND contract_type = 'jeonse' AND location_id IS NOT NULL").pluck().get(), 11);
    assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction WHERE property_type = 'apt' AND contract_type = 'monthly' AND location_id IS NOT NULL").pluck().get(), 4);
    assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction WHERE renewal = 'new'").pluck().get(), 4);
    assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction WHERE renewal = 'renewal'").pluck().get(), 2);
    assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction WHERE cancelled_at IS NOT NULL").pluck().get(), 1);
    assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction WHERE location_id IS NULL").pluck().get(), 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
{
  const dir = mkdtempSync(join(tmpdir(), "rtms-rents-nocolumn-"));
  try {
    await buildEngineFixture(dir, "legacy", { rents: "nocolumn" });
    const db = openDataFile(dir, readManifest(dir), "market");
    assert.equal(db.prepare("PRAGMA table_info(property_transaction)").all().some((column) => column.name === "renewal"), false);
    assert.equal(db.prepare("SELECT COUNT(*) FROM property_transaction").pluck().get(), 16);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("v2 rtms ok");
