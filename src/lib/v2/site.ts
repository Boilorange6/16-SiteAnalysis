/** 주소 입력 계약. 도로명 데이터 공급원이 붙으면 이 순수 검사만 제거하면 된다. */
export const ROAD_ADDRESS_UNSUPPORTED_MESSAGE = "도로명 주소는 아직 지원하지 않습니다 — 지번(예: 고덕동 250)으로 입력해 주세요";

const ROAD_ADDRESS_PATTERN = /(?:대로|로|길)\s*\d+(?:-\d+)?(?:\s|$)/u;

export function isRoadAddress(address: string): boolean {
  return ROAD_ADDRESS_PATTERN.test(address.trim().replace(/\s+/g, " "));
}
