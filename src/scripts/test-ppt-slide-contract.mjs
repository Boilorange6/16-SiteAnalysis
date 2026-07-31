/**
 * 보고서 슬라이드 계약 테스트 (Phase 5-1).
 * 슬라이드 수가 결과 데이터에 따라 흔들리면 목차·페이지 참조·검수 기준이 매번 달라진다.
 */
import assert from "node:assert/strict";

import {
  APT_PAGE_SIZE,
  RESIDENTIAL_SLIDE_BUDGET,
  TOTAL_SLIDE_COUNT,
  overflowNotice,
  pageResidentials,
} from "../lib/ppt-slide-contract.ts";

function complexes(count, { dated = true } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`, name: `단지${i}`, units: 100 + i,
    sale_date: dated ? `20${String(10 + (i % 15)).padStart(2, "0")}-01` : "",
  }));
}

// ── 페이지 수는 예산 안에서 고정된다 ──────────────────────────────────────
{
  // 예산을 넘는 단지가 있어도 페이지 수는 예산을 초과하지 않는다
  const pages = pageResidentials(complexes(200), APT_PAGE_SIZE);
  assert.equal(pages.length, RESIDENTIAL_SLIDE_BUDGET,
    `주거 슬라이드는 ${RESIDENTIAL_SLIDE_BUDGET}장으로 고정되어야 한다`);
  assert.ok(pages.every((page) => page.length <= APT_PAGE_SIZE));
}

{
  // 단지가 적으면 빈 페이지로 채워 총 장수를 유지한다
  const pages = pageResidentials(complexes(3), APT_PAGE_SIZE);
  assert.equal(pages.length, RESIDENTIAL_SLIDE_BUDGET, "부족해도 예산만큼 페이지를 유지한다");
  assert.equal(pages[0].length, 3);
  assert.equal(pages[1].length, 0, "남는 페이지는 빈 상태 슬라이드가 된다");
}

{
  // 단지가 아예 없어도 계약 장수는 같다
  const pages = pageResidentials([], APT_PAGE_SIZE);
  assert.equal(pages.length, RESIDENTIAL_SLIDE_BUDGET);
  assert.deepEqual(pages[0], []);
}

// ── 정렬 규칙은 유지된다 (준공일 오름차순, 미상은 뒤로) ───────────────────
{
  const mixed = [
    { id: "b", name: "B", units: 1, sale_date: "2020-01" },
    { id: "a", name: "A", units: 1, sale_date: "2010-01" },
    { id: "u", name: "U", units: 1, sale_date: "" },
  ];
  const [first] = pageResidentials(mixed, APT_PAGE_SIZE);
  assert.deepEqual(first.map((c) => c.id), ["a", "b", "u"]);
}

// ── 잘린 항목은 "외 N개"로 밝힌다 (조용한 절단 금지) ──────────────────────
{
  const total = APT_PAGE_SIZE * RESIDENTIAL_SLIDE_BUDGET + 12;
  const notice = overflowNotice(total, APT_PAGE_SIZE * RESIDENTIAL_SLIDE_BUDGET);
  assert.match(notice, /외 12개/, "표시하지 못한 개수를 밝혀야 한다");
  assert.equal(overflowNotice(10, 20), "", "잘린 것이 없으면 안내도 없다");
}

// ── 총 슬라이드 수가 고정 계약으로 선언되어 있다 ──────────────────────────
{
  assert.equal(typeof TOTAL_SLIDE_COUNT, "number");
  assert.ok(TOTAL_SLIDE_COUNT > RESIDENTIAL_SLIDE_BUDGET);
}

console.log("test-ppt-slide-contract: all assertions passed");
