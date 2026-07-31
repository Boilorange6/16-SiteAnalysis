import assert from "node:assert/strict";

import { crossCheckMaintenanceCompletion } from "../lib/server/maintenance/completion-crosscheck.ts";

const squareBoundary = {
  type: "Polygon",
  coordinates: [[[127.05, 37.48], [127.07, 37.48], [127.07, 37.5], [127.05, 37.5], [127.05, 37.48]]],
};

function maintenance(overrides = {}) {
  return {
    id: "m-1", name: "개포1동주공 재건축", lat: 37.49, lng: 127.06,
    category: "maintenance", type: "재건축", stage: "착공", stage_detail: "착공",
    address: "서울특별시 강남구 개포동 660-4", area_sqm: 100000,
    source: "molit_spatial", boundary: squareBoundary, boundary_status: "unmatched",
    ...overrides,
  };
}

function apartment(overrides = {}) {
  return {
    id: "a-1", name: "디에이치퍼스티어아이파크", lat: 37.49, lng: 127.06,
    category: "apartment", units: 6702, parking_count: 0, sale_date: "2023-11",
    distance_m: 100, status: "existing", source: "ledger",
    ...overrides,
  };
}

// 폴리곤 안 신축(2023) 대단지 → 정비사업 제거
{
  const { pois, removedCount } = crossCheckMaintenanceCompletion([maintenance(), apartment()]);
  assert.equal(removedCount, 1);
  assert.equal(pois.some((poi) => poi.category === "maintenance"), false);
  assert.equal(pois.length, 1); // 아파트는 유지
}

// 구축(1983) 단지만 있으면 유지
{
  const { pois, removedCount } = crossCheckMaintenanceCompletion([maintenance(), apartment({ sale_date: "1983-06" })]);
  assert.equal(removedCount, 0);
  assert.equal(pois.length, 2);
}

// 폴리곤 밖 신축 → 유지
{
  const { removedCount } = crossCheckMaintenanceCompletion([maintenance(), apartment({ lat: 37.6, lng: 127.2 })]);
  assert.equal(removedCount, 0);
}

// 초기 단계(조합설립인가)는 검증 대상 아님 → 유지
{
  const { removedCount } = crossCheckMaintenanceCompletion([maintenance({ stage_detail: "조합설립인가" }), apartment()]);
  assert.equal(removedCount, 0);
}

// 소규모 단지(200세대 미만)로는 판정하지 않음
{
  const { removedCount } = crossCheckMaintenanceCompletion([maintenance(), apartment({ units: 50 })]);
  assert.equal(removedCount, 0);
}

// 구역지정일이 있으면 그 해 이후 준공만 인정
{
  const { removedCount } = crossCheckMaintenanceCompletion([
    maintenance({ designation_date: "2015-04-01" }), apartment({ sale_date: "2016-01" }),
  ]);
  assert.equal(removedCount, 1);
  const older = crossCheckMaintenanceCompletion([
    maintenance({ designation_date: "2015-04-01" }), apartment({ sale_date: "2014-01" }),
  ]);
  assert.equal(older.removedCount, 0);
}

// 분양예정(planned) 단지로는 판정하지 않음
{
  const { removedCount } = crossCheckMaintenanceCompletion([maintenance(), apartment({ status: "planned" })]);
  assert.equal(removedCount, 0);
}

// 대표지번 실거래의 건축년도가 임계 이상 → 폴리곤 내 POI 없이도 제외 (건축물대장 누락 신축 대응)
{
  const withNewTrade = maintenance({
    recent_trades: { count: 1, months: 6, latest_price_manwon: 165000, latest_date: "2026-02-05", latest_area_sqm: 112, max_price_manwon: 165000, max_build_year: 2023 },
  });
  const { removedCount } = crossCheckMaintenanceCompletion([withNewTrade]);
  assert.equal(removedCount, 1);
  // 구축 거래(1983)면 유지
  const withOldTrade = maintenance({
    recent_trades: { count: 2, months: 6, latest_price_manwon: 195000, latest_date: "2026-05-09", latest_area_sqm: 74, max_price_manwon: 195000, max_build_year: 1983 },
  });
  assert.equal(crossCheckMaintenanceCompletion([withOldTrade]).removedCount, 0);
}

console.log("test-completion-crosscheck: all assertions passed");
