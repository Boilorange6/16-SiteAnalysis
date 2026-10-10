/** 화면과 가이드가 함께 쓰는 분석 반경의 실무 해석 라벨. 거리 자체는 직선 거리다. */
export const RADIUS_OPTIONS = [
  { m: 500, label: "500m", purpose: "역세권" },
  { m: 800, label: "800m", purpose: "도보권" },
  { m: 1000, label: "1km", purpose: "생활권" },
  { m: 2000, label: "2km", purpose: "생활권" },
  { m: 3000, label: "3km", purpose: "생활권·광역" },
] as const;

export const NEIGHBORHOOD_REFERENCE = { label: "300m", purpose: "근린권" } as const;

export const RADIUS_CAPTION = RADIUS_OPTIONS.map(({ label, purpose }) => `${purpose} ${label}`).join(" · ");
