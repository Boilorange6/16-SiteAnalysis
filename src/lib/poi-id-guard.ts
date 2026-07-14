/**
 * POI 이름이 원시 소스 ID로 노출된 경우를 판별하는 순수 함수 모듈 (예: "school-4346679989").
 * OSM 등 외부 소스에 사람이 읽는 name 태그가 없을 때 내부 폴백 ID가 그대로 표시 텍스트로 새는
 * 결함(P4R Task B-1)을 표시 계층(카테고리 슬라이드 목록 패널·지도 라벨 배지·팩트 시트 최근접)에서
 * 걸러내기 위해 쓴다.
 *
 * 카운트/집계에는 영향을 주지 않는다 — 호출부가 "표시용 후보 선택"에서만 이 함수로 걸러내고,
 * count·length 등 집계는 항상 원본(필터 이전) 배열을 기준으로 계산해야 한다.
 *
 * 의존성 없는 독립 모듈로 둔 이유: fact-summary.ts는 maintenance-analysis.ts를 이미 import하므로,
 * park-analysis.ts/maintenance-analysis.ts가 fact-summary.ts를 다시 import하면 순환 참조가
 * 생긴다. 이 모듈은 어디서도 다른 lib 모듈을 import하지 않아 모든 소비처(fact-summary,
 * park-analysis, maintenance-analysis, ppt-label-layout, 두 렌더러)가 안전하게 공유할 수 있다.
 */

/** "영문소문자 하이픈 숫자 6자리 이상"(예: school-4346679989) 형태의 원시 소스 ID 패턴. */
const RAW_POI_ID_PATTERN = /^[a-z]+-\d{6,}$/;

/** name이 원시 소스 ID로 보이면 true. 순수 함수 — 부수효과 없음. */
export function isRawPoiId(name: string | null | undefined): boolean {
  if (!name) return false;
  return RAW_POI_ID_PATTERN.test(name);
}

/**
 * 정렬된 후보 배열에서 원시 ID 이름이 아닌 첫 항목을 반환한다 — "최근접이 ID면 다음 후보로"
 * 규칙(팩트 시트/카테고리 인사이트 카드의 최근접 계산)에 쓰인다.
 */
export function firstDisplayable<T extends { readonly name: string }>(
  sortedCandidates: readonly T[]
): T | undefined {
  return sortedCandidates.find((item) => !isRawPoiId(item.name));
}
