export const S02_DATE_KEYS = ["spring", "summer", "autumn", "winter", "analysis"] as const;
export type S02DateKey = (typeof S02_DATE_KEYS)[number];

export const S02_DATE_LABEL: Record<S02DateKey, string> = {
  spring: "춘분",
  summer: "하지",
  autumn: "추분",
  winter: "동지",
  analysis: "분석일",
};
