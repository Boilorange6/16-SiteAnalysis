import assert from "node:assert/strict";
import Database from "better-sqlite3";

const { addressSuggestionText, addressValueForSelection, isSelectableSuggestion, mapAddressSearchResult } = await import("../../lib/address-search.ts");
const { initDataFileSchema } = await import("../../lib/v2/data/schema.ts");
const { resolveJibunDetailed } = await import("../../lib/v2/data/jibun.ts");
const { insertRelease } = await import("../../lib/v2/ingest/build.ts");
const { isRoadAddress } = await import("../../lib/v2/site.ts");

const result = mapAddressSearchResult({
  id: "127123456-375678901",
  name: "개포우성1차아파트",
  address: "서울특별시 강남구 개포로 307",
  jibunAddress: " 서울특별시 강남구 개포동 1281 ",
  lat: 37.485,
  lng: 127.055,
});
assert.equal(result.jibunAddress, "서울특별시 강남구 개포동 1281");
assert.equal(addressValueForSelection(result), "서울특별시 강남구 개포동 1281");
assert.equal(addressSuggestionText(result), "서울특별시 강남구 개포동 1281");

const withoutJibun = mapAddressSearchResult({
  id: "fallback",
  name: "도로명 결과",
  address: "서울특별시 강남구 개포로 307",
  jibunAddress: "  ",
  lat: 37.485,
  lng: 127.055,
});
assert.equal("jibunAddress" in withoutJibun, false, "blank jibunAddress is omitted");
assert.equal(addressValueForSelection(withoutJibun), withoutJibun.address);

const db = new Database(":memory:");
initDataFileSchema(db, "core");
const releaseId = insertRelease(db, {
  sourceId: "legal_areas",
  provider: "test",
  sourceUrl: "https://example.invalid",
  sourceAsOf: "2026-09-09",
  fetchedAt: "2026-10-13T00:00:00Z",
  checksum: "address-suggest-test",
  licenseCode: "TEST",
});
const insertArea = db.prepare("INSERT INTO legal_area (code, level, name, parent_code, release_id) VALUES (?, ?, ?, ?, ?)");
insertArea.run("11680", "sigungu", "서울특별시 강남구", null, releaseId);
insertArea.run("11680103", "emd", "개포동", "11680", releaseId);

for (const address of ["서울특별시 강남구 개포동 12-3", "서울특별시 강남구 개포동 1281"]) {
  const resolved = resolveJibunDetailed(db, address);
  assert.equal("pnu" in resolved, true, `${address} resolves as jibun`);
  assert.equal(isRoadAddress(address), false, `${address} is not a road address`);
}
assert.equal(isRoadAddress("서울특별시 강남구 개포로 307"), true, "road address remains rejected by V2 contract");
// 실제 네이버 응답(2026-10-13 "개포우성1차"): 입구·정문 항목은 번지 없는 지번이라 V2가 해석하지 못한다.
assert.equal(isSelectableSuggestion({ jibunAddress: "서울특별시 강남구 대치동 503" }), true);
assert.equal(isSelectableSuggestion({ jibunAddress: "서울특별시 강남구 대치동 산 12-3" }), true);
assert.equal(isSelectableSuggestion({ jibunAddress: "서울특별시 강남구 대치동" }), false, "no lot number");
assert.equal(isSelectableSuggestion({}), false, "no jibun at all");
db.close();

console.log("v2 address suggestion mapping, selection, and Naver jibun parsing: ok");
