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

console.log("✓ v2 legal areas");
