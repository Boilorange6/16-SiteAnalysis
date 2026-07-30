import assert from "node:assert/strict";

import {
  enhanceProjectsWithSeoulCleanup,
  findBridgeAttribute,
  isCompletedCleanupStage,
  mapCleanupStage,
  parseSeoulCleanupListPage,
  seoulCleanupArtifactSchema,
  splitCompletedMaintenanceProjects,
} from "../lib/server/maintenance/seoul-cleanup.ts";

// --- 단계 매핑 ---
assert.equal(mapCleanupStage("조합해산"), "준공");
assert.equal(mapCleanupStage("준공인가"), "준공");
assert.equal(mapCleanupStage("이전고시"), "준공");
assert.equal(mapCleanupStage("조합청산"), "준공");
assert.equal(mapCleanupStage("착공 및 일반분양"), "착공");
assert.equal(mapCleanupStage("관리처분인가"), "관리처분");
assert.equal(mapCleanupStage("철거"), "관리처분");
assert.equal(mapCleanupStage("사업시행인가"), "사업시행인가");
assert.equal(mapCleanupStage("조합설립인가"), "조합설립");
assert.equal(mapCleanupStage("추진위원회승인"), "추진위");
assert.equal(mapCleanupStage("정비구역지정"), "구역지정/변경");
assert.equal(mapCleanupStage("정비계획 수립"), "구역지정/변경");
assert.equal(mapCleanupStage("안전진단"), "구역지정/변경");
assert.equal(mapCleanupStage("알 수 없음"), "미확인");

assert.equal(isCompletedCleanupStage("조합해산"), true);
assert.equal(isCompletedCleanupStage("준공 인가"), true);
assert.equal(isCompletedCleanupStage("착공"), false);
assert.equal(isCompletedCleanupStage("사업시행인가"), false);

// --- 파서 ---
const sampleHtml = `<html><body><table><tbody>
<tr>
  <td>1137</td><td>강남구</td><td>재건축</td>
  <td class="wordBreakAll">개포주공3단지아파트 재건축정비사업 조합</td>
  <td>개포동 138</td><td>조합해산</td><td>1878건</td>
  <td>100.0%</td><td>100.0%</td>
  <td class="last">
    <a href="javascript:cafeOpenPopup('gaepo3');"><span>사업장</span></a>
    <a href="javascript:mapOpenPopup('11000AGZ201211160062');"><span>지도</span></a>
  </td>
</tr>
<tr>
  <td>1136</td><td>강남구</td><td>재건축</td><td>개포주공5단지</td>
  <td>개포동 187</td><td>관리처분인가</td><td>10건</td><td>1%</td><td>1%</td><td class="last"></td>
</tr>
<tr><td colspan="10">조회된 결과가 없습니다</td></tr>
</tbody></table></body></html>`;

const parsed = parseSeoulCleanupListPage(sampleHtml);
assert.equal(parsed.length, 2);
assert.deepEqual(parsed[0], {
  no: 1137, sigungu: "강남구", type: "재건축",
  name: "개포주공3단지아파트 재건축정비사업 조합",
  address: "개포동 138", stage_text: "조합해산",
  record_code: "11000AGZ201211160062", cafe_id: "gaepo3",
});
assert.equal(parsed[1].record_code, undefined);
assert.equal(parseSeoulCleanupListPage("<html><body>내용 없음</body></html>").length, 0);

// --- 아티팩트 스키마 ---
const validArtifact = {
  schema_version: 1,
  source_url: "https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do",
  retrieved_at: "2026-07-30T03:00:00.000Z",
  record_count: 2,
  records: parsed.map((row) => ({ ...row })),
};
assert.ok(seoulCleanupArtifactSchema.safeParse(validArtifact).success);
assert.equal(seoulCleanupArtifactSchema.safeParse({ ...validArtifact, record_count: 3 }).success, false);
assert.equal(seoulCleanupArtifactSchema.safeParse({ ...validArtifact, records: [] }).success, false);

// --- 공간조인 결합 ---
const squareBoundary = {
  type: "Polygon",
  coordinates: [[[127.05, 37.48], [127.07, 37.48], [127.07, 37.5], [127.05, 37.5], [127.05, 37.48]]],
};
function project(overrides = {}) {
  return {
    id: "maintenance-1", name: "개포주공3단지", lat: 37.49, lng: 127.06,
    category: "maintenance", type: "정비구역", stage: "미확인",
    address: "서울특별시 강남구", area_sqm: 1000, source: "molit_spatial",
    boundary: squareBoundary, boundary_status: "unmatched",
    ...overrides,
  };
}
function cleanupRow(overrides = {}) {
  return {
    no: 1, sigungu: "강남구", type: "재건축", name: "개포주공3단지아파트 재건축정비사업 조합",
    address: "개포동 138", stage_text: "사업시행인가", lat: 37.49, lng: 127.06,
    ...overrides,
  };
}

// 폴리곤 내부 단일 후보 → 단계 적용 + 주소·시행자·유형·면적 채움
{
  const { projects, appliedCount, ambiguousCount } = enhanceProjectsWithSeoulCleanup(
    [project({ area_sqm: 0 })], [cleanupRow()],
  );
  assert.equal(appliedCount, 1);
  assert.equal(ambiguousCount, 0);
  assert.equal(projects[0].stage, "사업시행인가");
  assert.equal(projects[0].stage_detail, "사업시행인가");
  assert.equal(projects[0].notice_url, "https://cleanup.seoul.go.kr/");
  assert.equal(projects[0].address, "서울특별시 강남구 개포동 138");
  assert.equal(projects[0].implementer, "개포주공3단지아파트 재건축정비사업 조합");
  assert.equal(projects[0].type, "재건축");
  assert.ok(projects[0].area_sqm > 100_000); // 약 1.8km x 2.2km 사각형
}

// 기존 값 보존: 숫자 있는 주소·시행자·면적·구체 유형은 덮지 않음
{
  const { projects } = enhanceProjectsWithSeoulCleanup([
    project({ address: "서울특별시 강남구 개포동 100", implementer: "기존시행자", type: "재개발", area_sqm: 5000 }),
  ], [cleanupRow()]);
  assert.equal(projects[0].address, "서울특별시 강남구 개포동 100");
  assert.equal(projects[0].implementer, "기존시행자");
  assert.equal(projects[0].type, "재개발");
  assert.equal(projects[0].area_sqm, 5000);
}

// 폴리곤 밖 좌표 → 미적용
{
  const { projects, appliedCount } = enhanceProjectsWithSeoulCleanup(
    [project()], [cleanupRow({ lat: 37.6, lng: 127.2 })],
  );
  assert.equal(appliedCount, 0);
  assert.equal(projects[0].stage, "미확인");
}

// 좌표 없는 레코드 → 미적용
{
  const { appliedCount } = enhanceProjectsWithSeoulCleanup([project()], [cleanupRow({ lat: undefined, lng: undefined })]);
  assert.equal(appliedCount, 0);
}

// 내부 다중 후보 + 서로 다른 단계 + 이름 비호환 → 모호로 스킵
{
  const { projects, appliedCount, ambiguousCount } = enhanceProjectsWithSeoulCleanup([project({ name: "전혀다른구역" })], [
    cleanupRow(), cleanupRow({ no: 2, name: "다른조합", stage_text: "조합해산" }),
  ]);
  assert.equal(appliedCount, 0);
  assert.equal(ambiguousCount, 1);
  assert.equal(projects[0].stage, "미확인");
}

// 내부 다중 후보라도 이름 호환 1건 → 적용
{
  const { projects, appliedCount } = enhanceProjectsWithSeoulCleanup([project()], [
    cleanupRow(), cleanupRow({ no: 2, name: "다른조합", stage_text: "조합해산" }),
  ]);
  assert.equal(appliedCount, 1);
  assert.equal(projects[0].stage_detail, "사업시행인가");
}

// 내부 다중 후보 + 동일 단계 → 적용
{
  const { projects } = enhanceProjectsWithSeoulCleanup([project({ name: "무관한이름" })], [
    cleanupRow({ stage_text: "조합설립인가" }), cleanupRow({ no: 2, name: "또다른", stage_text: "조합설립인가" }),
  ]);
  assert.equal(projects[0].stage, "조합설립");
}

// 기존 notice_url 보존
{
  const { projects } = enhanceProjectsWithSeoulCleanup([project({ notice_url: "https://example.test/notice" })], [cleanupRow()]);
  assert.equal(projects[0].notice_url, "https://example.test/notice");
}

// --- 국토부 속성 브리지 매칭 ---
const attributeRecord = {
  sido: "서울특별시", sigungu: "강남구", name: "개포주공3단지 재건축",
  planned_households: 1235, designation_date: "2012-11-16", implementer: "개포주공3단지 조합",
  floor_area_ratio: 249.9,
};
{
  // 조합명 ↔ 구역명 정규화 포함 매칭
  const found = findBridgeAttribute({ sigungu: "강남구", name: "개포주공3단지아파트 재건축정비사업 조합" }, [attributeRecord]);
  assert.equal(found?.planned_households, 1235);
  // 다른 구 → 미매칭
  assert.equal(findBridgeAttribute({ sigungu: "송파구", name: "개포주공3단지아파트 재건축정비사업 조합" }, [attributeRecord]), null);
  // 후보 2건(모호) → 미매칭
  assert.equal(findBridgeAttribute({ sigungu: "강남구", name: "개포주공3단지아파트 재건축정비사업 조합" }, [
    attributeRecord, { ...attributeRecord, name: "개포주공3단지아파트" },
  ]), null);
  // 짧은 일반명 → 미매칭
  assert.equal(findBridgeAttribute({ sigungu: "강남구", name: "재건축정비사업조합" }, [attributeRecord]), null);
}
{
  // enhance에 attributes를 주면 예정세대수·구역지정일·용적률·시행자 채움
  const { projects, bridgedCount } = enhanceProjectsWithSeoulCleanup(
    [project({ area_sqm: 0 })], [cleanupRow()], [attributeRecord],
  );
  assert.equal(bridgedCount, 1);
  assert.equal(projects[0].planned_households, 1235);
  assert.equal(projects[0].designation_date, "2012-11-16");
  assert.equal(projects[0].floor_area_ratio, 249.9);
  assert.equal(projects[0].implementer, "개포주공3단지 조합");
}

// --- 종료 분리 ---
{
  const { active, completed } = splitCompletedMaintenanceProjects([
    project({ id: "a", stage: "착공" }),
    project({ id: "b", stage: "준공" }),
    project({ id: "c", stage: "준공", stage_detail: "조합해산" }),
    project({ id: "d", stage: "미확인" }),
  ]);
  assert.deepEqual(active.map((row) => row.id), ["a", "d"]);
  assert.deepEqual(completed.map((row) => row.id), ["b", "c"]);
}

console.log("test-seoul-cleanup: all assertions passed");
