/** A05 재집계: 범위 필터, 정보 없음 유지·집계, 빈 결과, 필터 없음=원본 */
import assert from "node:assert/strict";

const { reaggregateA05, describeA05Filter, normalizeA05Filter } = await import("../../lib/v2/engine/a05-filter.ts");

const f = (layer, o) => ({ layer, lng: 127, lat: 37.5, households: null, approvalYear: null, floorsMax: null, buildingCount: null, parking: null, distanceM: 100, ...o });
const features = [
  f("apt", { households: 1000, approvalYear: 1995, floorsMax: 15, parking: 1200 }),
  f("apt", { households: 500, approvalYear: 2010, floorsMax: null, parking: 600 }),
  f("apt", { households: null, approvalYear: null }),
  f("other_housing", { households: 10, approvalYear: 2000 }),
  f("other_housing", { households: 20, approvalYear: 2020 }),
  f("officetel", { households: 50, approvalYear: 2015, floorsMax: 20 }),
  f("dormant", {}), // 주거 외 레이어는 무시
];
const original = [{ id: "households", value: 1500, label: "", unit: "", formulaVersion: "x", numerator: null, denominator: null, status: "observed" }];
const result = { conditions: { analysisDate: "2026-10-06" }, presentation: { features }, metrics: original };

// 필터 없음 = 원본 지표·지물 그대로
{
  const r = reaggregateA05(result, {});
  assert.equal(r.filter, null);
  assert.equal(r.description, null);
  assert.equal(r.metrics, original);
  assert.equal(r.counts.total, 6);
  assert.equal(r.counts.unknownKept, 0);
  assert.equal(normalizeA05Filter({ types: ["apt", "other_housing", "officetel"], year: { min: null } }), null, "전체 유형·빈 범위는 필터 아님");
}

// 준공연도 범위: 1995~2010. 연도 없는 아파트는 유지·집계
{
  const r = reaggregateA05(result, { year: { min: 1990, max: 2010 } });
  assert.equal(r.features.length, 4, "1995, 2010, 연도 없음, 2000 유지");
  assert.equal(r.counts.excluded, 2, "2020 기타, 2015 오피스텔 제외");
  assert.equal(r.counts.unknownKept, 1);
  assert.equal(r.counts.unknownByField.year, 1);
  const v = (id) => r.metrics.find((x) => x.id === id);
  assert.equal(v("apartment_complexes").value, 3);
  assert.equal(v("households").value, 1500);
  assert.equal(v("households").numerator, 2, "세대수 확인 2곳");
  assert.equal(v("households_unknown_complexes").value, 1);
  assert.equal(v("median_approval_year").value, 1995, "1995,2010 하위 중앙");
  assert.equal(v("filter_unknown_kept").value, 1);
  assert.match(r.description, /준공연도 1990~2010년 · 정보 없음 포함 1건/);
}

// 세대수 이상 + 유형: 모르는 세대수 단지 유지, 층수 필터는 값 없는 지물 유지
{
  const r = reaggregateA05(result, { types: ["apt"], households: { min: 800 } });
  assert.equal(r.features.length, 2, "1000세대 + 세대수 미상 단지");
  assert.equal(r.counts.unknownByField.households, 1);
  const r2 = reaggregateA05(result, { floors: { min: 10, max: 30 } });
  assert.equal(r2.counts.unknownKept, 4, "층수 모르는 4건은 유지(층수 있는 15·20은 범위 안)");
  assert.equal(r2.counts.excluded, 0);
  const r3 = reaggregateA05(result, { floors: { max: 16 } });
  assert.equal(r3.counts.excluded, 1, "20층 오피스텔만 제외");
}

// 빈 결과: 지표는 0·확인 필요(missing), 오류 없음
{
  const r = reaggregateA05(result, { households: { min: 100000 }, types: ["officetel"] });
  assert.equal(r.features.length, 0);
  assert.equal(r.counts.kept, 0);
  const v = (id) => r.metrics.find((x) => x.id === id);
  assert.equal(v("apartment_complexes").value, 0);
  assert.equal(v("median_approval_year").value, null);
  assert.equal(v("median_approval_year").status, "missing");
  assert.equal(v("aged_share_pct").status, "missing");
}

// 설명
assert.equal(describeA05Filter({ types: ["apt"], households: { min: 300 }, distance: { max: 500 } }), "유형 아파트, 세대수 300세대 이상, 거리 500m 이하");
assert.equal(describeA05Filter(null), null);
console.log("a05-filter ok");
