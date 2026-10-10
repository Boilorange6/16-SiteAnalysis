import type { TileClientModule } from "../types";

export const d02ClientModule = {
  code: "D02",
  headline: { ids: ["share_footprint_pct", "buildings"] },
  mapNote: "건물 발자국 · 도형 변환 실패 건물만 점 표시",
} satisfies TileClientModule;
