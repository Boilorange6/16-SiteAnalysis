import type { TileClientModule } from "../types";

export const d16ClientModule = {
  code: "D16",
  headline: { ids: ["dens_max", "gfa_per_ha"] },
  parameterBadges: [
    { metricId: "kde_bandwidth_m", prefix: "KDE 대역폭", note: "건물 밀도 추정에 사용한 계산 설정값입니다. 지역 결론 수치가 아닙니다." },
  ],
  mapNote: "건물 수 KDE · 대역폭 100m · 20백분위 구간",
} satisfies TileClientModule;
