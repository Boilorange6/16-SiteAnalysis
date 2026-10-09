/** 화면·보고서 선택기가 공유하는 계절 순서. 저장 결과 스키마와 분리된 클라이언트 안전 상수다. */
export const ROSE_SEASONS = ["annual", "spring", "summer", "autumn", "winter"] as const;
export type RoseSeason = (typeof ROSE_SEASONS)[number];
export const ROSE_SEASON_LABELS: Record<RoseSeason, string> = { annual: "연간", spring: "봄", summer: "여름", autumn: "가을", winter: "겨울" };
