import assert from "node:assert/strict";

import {
  LEDGER_CHECK_STAGE_PATTERN,
  assessLedgerCompletion,
  fetchRecapTitleInfo,
  formatUseApprovalDay,
  parseJibunAddress,
} from "../lib/server/maintenance/building-ledger.ts";

// --- 지번 파싱 ---
assert.deepEqual(parseJibunAddress("서울특별시 강남구 개포동 660-4"), { dong: "개포동", bun: "660", ji: "4" });
assert.deepEqual(parseJibunAddress("서울특별시 강남구 개포동 138"), { dong: "개포동", bun: "138", ji: "0" });
assert.deepEqual(parseJibunAddress("종로구 창신동 703 일대"), { dong: "창신동", bun: "703", ji: "0" });
assert.equal(parseJibunAddress("서울특별시 강남구"), null);
assert.equal(parseJibunAddress(""), null);
// 지번이 여러 개면 마지막 지번 사용
assert.deepEqual(parseJibunAddress("행운동 1666-99 일대 (행운동 100)"), { dong: "행운동", bun: "1666", ji: "99" });

// --- 대상 단계 패턴 ---
assert.ok(LEDGER_CHECK_STAGE_PATTERN.test("착공"));
assert.ok(LEDGER_CHECK_STAGE_PATTERN.test("관리처분인가"));
assert.ok(LEDGER_CHECK_STAGE_PATTERN.test("철거 및 착공"));
assert.ok(!LEDGER_CHECK_STAGE_PATTERN.test("조합설립인가"));
assert.ok(!LEDGER_CHECK_STAGE_PATTERN.test("추진위원회승인"));

// --- 완료 판정 ---
// 신축(2023 사용승인) + 지정일 2015 → 완료
assert.deepEqual(
  assessLedgerCompletion({ recap: { households: 6702, use_approval_day: "20231128" }, designationDate: "2015-04-01" }),
  { completed: true, use_approval_day: "20231128", households: 6702 },
);
// 구축(1983 사용승인) + 지정일 2015 → 미완료 (재건축 대상 구축은 오탐하지 않음)
assert.equal(assessLedgerCompletion({ recap: { households: 940, use_approval_day: "19830601" }, designationDate: "2015-04-01" }).completed, false);
// 지정일 미상 → 2018년 이후 사용승인만 완료로 인정
assert.equal(assessLedgerCompletion({ recap: { households: 100, use_approval_day: "20191001" } }).completed, true);
assert.equal(assessLedgerCompletion({ recap: { households: 100, use_approval_day: "20101001" } }).completed, false);
assert.equal(assessLedgerCompletion({ recap: null }).completed, false);
assert.equal(assessLedgerCompletion({ recap: { households: 0 } }).completed, false);

assert.equal(formatUseApprovalDay("20231128"), "2023-11-28");

// --- API 응답 파싱 (fake fetch) ---
function fakeFetch(response) {
  return async () => ({ ok: true, status: 200, json: async () => response });
}
{
  const recap = await fetchRecapTitleInfo({
    fetchImpl: fakeFetch({ response: { header: { resultCode: "00" }, body: { items: { item: [
      { hhldCnt: "940", useAprDay: "19830601" },
      { hhldCnt: "6702", useAprDay: "20231128" },
    ] } } } }),
    serviceKey: "key", sigunguCd: "11680", bjdongCd: "10300", bun: "660", ji: "4",
  });
  assert.deepEqual(recap, { households: 6702, use_approval_day: "20231128" });
}
{
  const recap = await fetchRecapTitleInfo({
    fetchImpl: fakeFetch({ response: { header: { resultCode: "00" }, body: { items: "" } } }),
    serviceKey: "key", sigunguCd: "11680", bjdongCd: "10300", bun: "1", ji: "0",
  });
  assert.equal(recap, null);
}
await assert.rejects(fetchRecapTitleInfo({
  fetchImpl: fakeFetch({ response: { header: { resultCode: "30", resultMsg: "SERVICE KEY ERROR" } } }),
  serviceKey: "key", sigunguCd: "11680", bjdongCd: "10300", bun: "1", ji: "0",
}), /30/);

console.log("test-building-ledger: all assertions passed");
