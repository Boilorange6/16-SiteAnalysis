import type { TileClientModule } from "../types";

export const s04ClientModule = {
  code: "S04",
  headline: { ids: ["utci_median_summer_h14", "shade_pct_summer_h14"] },
  caveat: "UTCI 근사 · 계절×시각 대표 기상 · 자리끼리 비교",
  modelBadge: "근사 · 건강 위험 예측 아님",
} satisfies TileClientModule;
