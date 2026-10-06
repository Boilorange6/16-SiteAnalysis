/** 화면·보고서 선택기가 공유하는 계절 순서. 저장 결과 스키마와 분리된 클라이언트 안전 상수다. */
export const ROSE_SEASONS = ["annual", "spring", "summer", "autumn", "winter"] as const;
export type RoseSeason = (typeof ROSE_SEASONS)[number];
