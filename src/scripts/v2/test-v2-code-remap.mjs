/**
 * 법정동 코드 재매핑 테스트. 코드·이름은 실제 값이다: 새 코드는 게시된 core(legal_area, 2026-09-09 법정구역),
 * 옛 코드·법정동명은 개별공시지가 CSV(AL_D151_29·46·28·41)에서 뽑았다.
 */
import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { remapLegalCode, remapPnu } = await import("../../lib/v2/data/code-remap.ts");
const { remapRenumberedPnu, resolveJibunDetailed } = await import("../../lib/v2/data/jibun.ts");
const { buildLandPrice, LAND_PRICE_RIGHTS } = await import("../../lib/v2/ingest/sources/land-price.ts");

const core = new Database(":memory:");
initDataFileSchema(core, "core");
const relOf = (db, sourceId) => insertRelease(db, { sourceId, provider: "t", sourceUrl: "u", sourceAsOf: "2026-09-09", fetchedAt: "2026-09-30T00:00:00Z", checksum: "c", licenseCode: "UNRESTRICTED", rights: {} });
const r = relOf(core, "legal_areas");
const la = core.prepare("INSERT INTO legal_area (code, level, name, parent_code, release_id) VALUES (?, ?, ?, ?, ?)");
const SIDO = { 12: "전남광주통합특별시", 28: "인천광역시", 41: "경기도", 11: "서울특별시" };
for (const [code, name] of [
  ["12190", "광양시"], ["12210", "동구"], ["28125", "제물포구"], ["28155", "영종구"], ["28275", "서해구"], ["28290", "검단구"], ["28245", "계양구"], ["41461", "용인시 처인구"], ["11680", "강남구"],
]) la.run(code, "sigungu", `${SIDO[code.slice(0, 2)]} ${name}`, null, r);
for (const [code, name] of [
  ["12190250", "광양읍"], ["12190330", "옥곡면"], ["12210134", "금남로4가"], ["28125106", "금곡동"], ["28125133", "신흥동1가"], ["28155103", "운서동"],
  ["28275111", "청라동"], ["28290107", "금곡동"], ["28290110", "불로동"], ["41461262", "양지읍"], ["11680101", "역삼동"],
]) la.run(code, "emd", name, code.slice(0, 5), r);
for (const [code, name] of [["1219025022", "구산리"], ["1219033023", "묵백리"], ["4146126224", "제일리"]]) la.run(code, "ri", name, code.slice(0, 8), r);

const code = (c, a) => remapLegalCode(core, c, a);

// 현재 코드는 그대로
assert.deepEqual(code("1168010100", null), { code: "1168010100", via: "current" });
assert.deepEqual(code("1219025022", null), { code: "1219025022", via: "current" });

// 광주 동구·전남 광양: 시군구만 재번호(29110→12210, 46230→12190), 나머지 자리는 그대로
assert.deepEqual(code("2911013400", "광주광역시 동구 금남로4가"), { code: "1221013400", via: "sigungu" });
assert.deepEqual(code("4623025022", "전라남도 광양시 광양읍 구산리"), { code: "1219025022", via: "sigungu" });
assert.deepEqual(code("4623033023", "전라남도 광양시 옥곡면 묵백리"), { code: "1219033023", via: "sigungu" });
assert.equal(remapPnu(core, "2911013400101330010", "광주광역시 동구 금남로4가").pnu, "1221013400101330010", "지번 부분은 그대로");

// 인천: 코드 자체가 바뀐다. 중구 → 영종구·제물포구, 서구 → 서해구·검단구, 동구 → 제물포구
assert.deepEqual(code("2811014700", "인천광역시 중구 운서동"), { code: "2815510300", via: "emd-name" });
assert.deepEqual(code("2811012600", "인천광역시 중구 신흥동1가"), { code: "2812513300", via: "emd-name" });
assert.deepEqual(code("2826012200", "인천광역시 서구 청라동"), { code: "2827511100", via: "emd-name" });
assert.deepEqual(code("2826012100", "인천광역시 서구 불로동"), { code: "2829011000", via: "emd-name" });
// 금곡동은 동구에도 서구에도 있다 — 옛 구 이름이 후보 구를 좁혀서 갈린다
assert.equal(code("2814010600", "인천광역시 동구 금곡동").code, "2812510600");
assert.equal(code("2826011800", "인천광역시 서구 금곡동").code, "2829010700");
assert.equal(code("2826010100", "인천광역시 서구 신흥동1가").code, null, "서구 후보(서해·검단)에 없는 동은 시도 전체(제물포구 신흥동1가)로 넓혀 찾지 않는다");
// 표에 없는 코드 + 표에 없는 이름은 추측하지 않는다
assert.equal(remapPnu(core, "2824510100100010000", "인천광역시 계양구 효성동").pnu, null);

// 경기 용인 양지면 → 양지읍 승격: 읍면동 이름이 없어져도 리 이름이 시군구 안에서 유일하면 리 코드로
assert.deepEqual(code("4146136024", "경기도 용인시 처인구 양지면 제일리"), { code: "4146126224", via: "ri-name" });

// 못 정하는 경우는 null + 이유
assert.deepEqual(code("2911013400", null), { code: null, reason: "no_names" });
assert.deepEqual(code("2911013400", "서울특별시 강남구 역삼동"), { code: null, reason: "not_found" }, "코드는 광주인데 주소는 서울");
assert.deepEqual(code("4699910700", "전라남도 없는군 어딘가"), { code: null, reason: "not_found" });
assert.deepEqual(code("2811014700", "인천광역시 중구"), { code: null, reason: "no_names" });
assert.deepEqual(code("abc", "x"), { code: null, reason: "bad_code" });
assert.equal(code("2811014700", "인천광역시 중구 존재하지않는동").code, null);

// remapRenumberedPnu(K-APT): 못 옮기면 원래 PNU
assert.equal(remapRenumberedPnu(core, "4623025022100010000", "전라남도 광양시 광양읍 구산리 1"), "1219025022100010000");
assert.equal(remapRenumberedPnu(core, "2811014700100010000", "인천광역시 중구 운서동 1"), "2815510300100010000");
assert.equal(remapRenumberedPnu(core, "2917010700100010000", null), "2917010700100010000");

// 지번 주소 풀이(입주예정 등): 갈라진 인천 옛 구 주소도 새 법정동으로
assert.deepEqual(resolveJibunDetailed(core, "인천광역시 중구 운서동 3051-7"), { legalCode: "2815510300", pnu: "2815510300130510007" });
assert.deepEqual(resolveJibunDetailed(core, "인천광역시 서구 불로동 1005-1"), { legalCode: "2829011000", pnu: "2829011000110050001" });
assert.deepEqual(resolveJibunDetailed(core, "인천광역시 서구 마전동 1"), { reason: "not_found" }, "표에 없는 동");
assert.deepEqual(resolveJibunDetailed(core, "인천광역시 미추홀구 숭의동 1"), { reason: "not_found" });

// 공시지가 적재: core를 주면 저장 PNU는 현재 코드, 옮길 수 없는 행은 unlocated, expectedRegions는 저장 시도로
const ref = new Database(":memory:");
initDataFileSchema(ref, "reference");
const rid = insertRelease(ref, { sourceId: "land_price", provider: "t", sourceUrl: "u", sourceAsOf: "2026-05-26", fetchedAt: "2026-09-30T00:00:00Z", checksum: "c", licenseCode: "UNRESTRICTED", rights: LAND_PRICE_RIGHTS });
const row = (pnu, name) => ({ properties: { 고유번호: pnu, 법정동코드: pnu.slice(0, 10), 법정동명: name, 기준연도: "2026", 기준월: "1", 공시지가: "1000", 표준지여부: "N" } });
async function* rows() {
  yield row("2911013400101330010", "광주광역시 동구 금남로4가");
  yield row("2811014700130510007", "인천광역시 중구 운서동");
  yield row("1168010100100010000", "서울특별시 강남구 역삼동");
  yield row("2811099900100010000", "인천광역시 중구 없는동"); // 못 옮김
}
const stats = await buildLandPrice(ref, rows(), rid, ["29", "28", "11"], core);
assert.deepEqual([stats.received, stats.accepted, stats.unlocated, stats.rejected], [4, 3, 1, 0]);
assert.deepEqual(ref.prepare("SELECT pnu FROM land_price ORDER BY pnu").pluck().all(), ["1168010100100010000", "1221013400101330010", "2815510300130510007"]);
assert.deepEqual(stats.expectedRegions.sort(), ["11", "12", "28"]);
assert.deepEqual(stats.byRegion, { 12: 1, 28: 1, 11: 1 });
console.log("code-remap ok");
