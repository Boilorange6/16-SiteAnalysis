/**
 * 법정구역 테스트. 반경과 교차하는 모든 시군구·읍면동을 로컬에서 판별해야
 * 실거래 조회에서 시군구 경계 너머가 빠지지 않는다(spec §3.3).
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { toUtmk, toLngLat } = await import("../../lib/v2/crs.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { buildLegalAreas } = await import("../../lib/v2/ingest/sources/legal-areas.ts");
const { legalAreasForCircle } = await import("../../lib/v2/data/legal-areas.ts");
const { parseJibunAddress, resolveJibunAddress } = await import("../../lib/v2/data/jibun.ts");

const C = [127.1265, 37.47]; // 복정역 부근
const [cx, cy] = toUtmk(C);
const box = (x0, y0, w, h) => ({ type: "Polygon", coordinates: [[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h], [x0, y0]].map(([x, y]) => [...toLngLat([cx + x, cy + y])])] });
async function* from(arr) { for (const x of arr) yield x; }

const db = new Database(":memory:");
initDataFileSchema(db, "core");
const rel = insertRelease(db, { sourceId: "legal", provider: "국토교통부", sourceUrl: "https://www.vworld.kr", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });

const stats = await buildLegalAreas(db, {
  releaseId: rel,
  sig: from([
    { properties: { A1: "11710", A2: "서울특별시 송파구", A4: "11710" }, geometry: box(-3000, -1000, 3000, 3000) }, // 서쪽
    { properties: { A1: "41135", A2: "경기도 성남시 분당구", A4: "41135" }, geometry: box(0, -1000, 3000, 3000) }, // 동쪽
    { properties: { A1: "51150", A2: "강원특별자치도 강릉시", A4: "51150" }, geometry: box(50000, 50000, 1000, 1000) }, // 멀리
    { properties: { A1: "bad", A2: "x" }, geometry: box(0, 0, 1, 1) },
  ]),
  emd: from([
    { properties: { A1: "11710114", A2: "장지동", A4: "11710" }, geometry: box(-500, -500, 500, 1000) },
    { properties: { A1: "41135107", A2: "정자동", A4: "41135" }, geometry: box(0, -500, 500, 1000) },
    { properties: { A1: "51150118", A2: "견소동", A4: "51150" }, geometry: box(50000, 50000, 100, 100) },
    { properties: { A1: "51150250", A2: "주문진읍", A4: "51150" }, geometry: box(50200, 50000, 100, 100) },
    { properties: { A1: "51150112", A2: "송정동", A4: "51150" }, geometry: box(50400, 50000, 100, 100) },
    { properties: { A1: "41135108", A2: "구미동", A4: "41135" }, geometry: null },
  ]),
  ri: from([{ properties: { A1: "5115025021", A2: "주문리", A4: "51150" }, geometry: box(50200, 50000, 50, 50) }]),
});

// ─── 1. 적재 통계 ──────────────────────────────────────────────────────────
assert.deepEqual(stats.map((s) => [s.sourceId, s.accepted, s.rejected]), [["legal_sigungu", 3, 1], ["legal_emd", 5, 1], ["legal_ri", 1, 0]]);
assert.equal(db.prepare("SELECT legal_code FROM feature WHERE stable_id='emd:41135107'").pluck().get(), "4113510700");
assert.equal(db.prepare("SELECT parent_code FROM legal_area WHERE code='5115025021'").pluck().get(), "51150250");

// ─── 2. 반경 판별: 시군구 경계를 넘는 원 ───────────────────────────────────
{
  const r = legalAreasForCircle(db, C, 800);
  assert.deepEqual(r.sigungu, [{ code: "11710", name: "서울특별시 송파구" }, { code: "41135", name: "경기도 성남시 분당구" }]);
  assert.deepEqual(r.emd.map((e) => e.code), ["11710114", "41135107"]);
}

// ─── 3. 지번 주소 파싱 ─────────────────────────────────────────────────────
assert.deepEqual(parseJibunAddress("강원특별자치도 강릉시 견소동 219-0"), { head: "강원특별자치도 강릉시 견소동", mountain: false, bun: 219, ji: 0 });
assert.deepEqual(parseJibunAddress("강원특별자치도 강릉시 송정동 산 77-3"), { head: "강원특별자치도 강릉시 송정동", mountain: true, bun: 77, ji: 3 });
assert.deepEqual(parseJibunAddress("경기도 성남시 분당구 정자동 178번지"), { head: "경기도 성남시 분당구 정자동", mountain: false, bun: 178, ji: 0 });
assert.equal(parseJibunAddress("강원특별자치도 강릉시 견소동"), null);

// ─── 4. 주소 → PNU ────────────────────────────────────────────────────────
assert.deepEqual(resolveJibunAddress(db, "강원특별자치도 강릉시 견소동 219-0"), { legalCode: "5115011800", pnu: "5115011800102190000" });
assert.deepEqual(resolveJibunAddress(db, "강원 강릉시 주문진읍 주문리 762-5"), { legalCode: "5115025021", pnu: "5115025021107620005" }, "약칭 시도 + 리");
assert.deepEqual(resolveJibunAddress(db, "강원특별자치도 강릉시 송정동 산 77-3"), { legalCode: "5115011200", pnu: "5115011200200770003" }, "산 번지");
assert.deepEqual(resolveJibunAddress(db, "경기도 성남시 분당구 정자동 178"), { legalCode: "4113510700", pnu: "4113510700101780000" }, "두 단어 시군구");
assert.equal(resolveJibunAddress(db, "경기도 성남시분당구 정자동 178")?.legalCode, "4113510700", "시군구 사이 공백 없음");
assert.equal(resolveJibunAddress(db, "강원특별자치도 강릉시 없는동 1"), null, "모르는 동");
assert.equal(resolveJibunAddress(db, "강원특별자치도 강릉시 견소동 219 오션시티"), null, "뒤에 건물명 → 추측하지 않음");
assert.equal(resolveJibunAddress(db, "강원특별자치도 강릉시 주문진읍 없는리 1"), null, "모르는 리");
assert.equal(resolveJibunAddress(db, "강원특별자치도 강릉시 주문진읍 762-5"), null, "리가 있는 읍인데 리 생략 → 가짜 코드 금지");

// ─── 5. 모호하면 null (합성 데이터) ────────────────────────────────────────
{
  const d = new Database(":memory:");
  initDataFileSchema(d, "core");
  const r = insertRelease(d, { sourceId: "legal", provider: "x", sourceUrl: "x", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "x", licenseCode: "CC-BY" });
  const ins = d.prepare("INSERT INTO legal_area (code, level, name, parent_code, release_id) VALUES (?, ?, ?, ?, ?)");
  const add = (code, level, name, parent) => ins.run(code, level, name, parent, r);
  add("41135", "sigungu", "경기도 성남시 분당구", null);
  add("41135103", "emd", "정자동", "41135");
  add("41135104", "emd", "중복동", "41135");
  add("41135105", "emd", "중복동", "41135");
  add("36110", "sigungu", "세종특별자치시", null);
  add("36110101", "emd", "반곡동", "36110");
  add("42111", "sigungu", "강원특별자치도 갑시", null);
  add("42112", "sigungu", "강원특별자치도 갑 시", null); // 공백 무시 시 restName 동일
  add("42111101", "emd", "가동", "42111");
  add("52111", "sigungu", "전북특별차지도 전주시 완산구", null); // 실제 원천 표기(오타)
  add("52111101", "emd", "중화산동", "52111");
  add("50110", "sigungu", "제주도 제주시", null);
  add("50110101", "emd", "일도동", "50110");
  assert.equal(resolveJibunAddress(d, "전북특별자치도 전주시 완산구 중화산동 1")?.pnu, "5211110100100010000", "SIG '전북특별차지도'");
  assert.equal(resolveJibunAddress(d, "전북 전주시 완산구 중화산동 1")?.legalCode, "5211110100", "약칭도 같은 SIG");
  assert.equal(resolveJibunAddress(d, "제주특별자치도 제주시 일도동 1")?.pnu, "5011010100100010000", "SIG '제주도'");
  assert.equal(resolveJibunAddress(d, "경기도 성남시 분당구 정자동 178")?.legalCode, "4113510300");
  assert.equal(resolveJibunAddress(d, "경기도 성남시 분당구 중복동 1"), null, "동명 emd 두 개");
  assert.equal(resolveJibunAddress(d, "경기도 성남시 정자동 178"), null, "구 생략");
  assert.equal(resolveJibunAddress(d, "강원특별자치도 갑시 가동 1"), null, "시군구 후보 동률");
  assert.equal(resolveJibunAddress(d, "세종특별자치시 반곡동 1")?.pnu, "3611010100100010000", "세종은 시군구 없음");
  assert.equal(resolveJibunAddress(d, "세종 반곡동 1")?.legalCode, "3611010100", "세종 약칭");
  assert.equal(resolveJibunAddress(d, "경상북도 군위군 군위읍 1"), null, "없는 시군구");
}

console.log("✓ v2 legal areas");
