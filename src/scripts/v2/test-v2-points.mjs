import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildPointSource, STORE_SPEC, BUS_STOP_SPEC, PARK_SPEC } = await import("../../lib/v2/ingest/sources/points.ts");

const db = new Database(":memory:");
initDataFileSchema(db, "reference");
const rel = (id) => insertRelease(db, { sourceId: id, provider: "공공데이터포털", sourceUrl: "https://www.data.go.kr", sourceAsOf: "2026-06-30", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "UNRESTRICTED" });
async function* from(rows) { for (const properties of rows) yield { properties, point: null }; }
const props = (id) => JSON.parse(db.prepare("SELECT properties_json FROM feature WHERE stable_id = ?").pluck().get(id));

// ─── 1. 상가 ──────────────────────────────────────────────────────────────
{
  const s = await buildPointSource(db, STORE_SPEC, from([
    { 상가업소번호: "MA01", 상호명: "다산마트", 지점명: "2호점", 상권업종대분류명: "소매", 상권업종중분류명: "종합 소매", 상권업종소분류명: "슈퍼마켓", 상권업종소분류코드: "G20405", 시도코드: "41", 법정동코드: "4136010100", 도로명주소: "경기도 남양주시 다산중앙로 1", 층정보: "1", 경도: "127.1506", 위도: "37.6245" },
    { 상가업소번호: "MA02", 상호명: "좌표없음", 시도코드: "41", 경도: "", 위도: "" },
    { 상가업소번호: "MA03", 상호명: "투영좌표", 시도코드: "41", 경도: "200000", 위도: "500000" },
    { 상가업소번호: "MA01", 상호명: "중복", 시도코드: "41", 경도: "127.15", 위도: "37.62" },
    { 상가업소번호: "", 상호명: "번호없음", 경도: "127.15", 위도: "37.62" },
  ]), rel("store"));
  assert.deepEqual([s.received, s.accepted, s.rejected], [5, 1, 4]);
  assert.deepEqual(s.byRegion, { 41: 1 });
  const row = db.prepare("SELECT name, legal_code, kind FROM feature WHERE stable_id = 'store:MA01'").get();
  assert.deepEqual(row, { name: "다산마트 2호점", legal_code: "4136010100", kind: "store" });
  assert.deepEqual(props("store:MA01"), { majorCategory: "소매", midCategory: "종합 소매", minorCategory: "슈퍼마켓", categoryCode: "G20405", floor: "1", address: "경기도 남양주시 다산중앙로 1" });
}

// ─── 2. 버스정류장 (EUC-KR 원천, 도시별) ───────────────────────────────────
{
  const s = await buildPointSource(db, BUS_STOP_SPEC, from([
    { 정류장번호: "11001", 정류장명: "복정역", 위도: "37.4702", 경도: "127.1265", 정보수집일: "2025-12-01", 모바일단축번호: "24001", 도시코드: "11", 도시명: "서울특별시" },
    { 정류장번호: "", 정류장명: "번호없음", 위도: "37.47", 경도: "127.12", 도시코드: "11", 도시명: "서울특별시" },
  ]), rel("bus_stop"));
  assert.deepEqual([s.accepted, s.rejected], [1, 1]);
  assert.deepEqual(props("bus_stop:11:11001"), { cityCode: "11", cityName: "서울특별시", stopNo: "11001", mobileNo: "24001", collectedAt: "2025-12-01" });
  assert.deepEqual(s.byRegion, { 서울특별시: 1 });
}

// ─── 3. 공원: 면적 빈 값은 null ───────────────────────────────────────────
{
  const s = await buildPointSource(db, PARK_SPEC, from([
    { 관리번호: "P1", 공원명: "다산중앙공원", 공원구분: "근린공원", 소재지도로명주소: "", 소재지지번주소: "경기도 남양주시 다산동 4000", 위도: "37.62", 경도: "127.15", 공원면적: "35000.5", 지정고시일: "2016-03-02" },
    { 관리번호: "P2", 공원명: "쌈지공원", 공원구분: "소공원", 소재지지번주소: "서울특별시 송파구 장지동 1", 위도: "37.47", 경도: "127.12", 공원면적: "", 지정고시일: "" },
  ]), rel("park"));
  assert.equal(s.accepted, 2);
  assert.deepEqual(props("park:P2"), { parkType: "소공원", areaM2: null, designatedAt: null, jibunAddress: "서울특별시 송파구 장지동 1", roadAddress: null });
  assert.deepEqual(s.byRegion, { 경기도: 1, 서울특별시: 1 });
  assert.deepEqual(s.byType, { 근린공원: 1, 소공원: 1 });
}

console.log("✓ v2 points");
