import type { TileClientModule } from "../types";

export const d28ClientModule = {
  code: "D28",
  headline: { ids: ["area_10min_km2", "reach_ratio_10min_pct"] },
  mapNote: "OSM 보행망 · 80 m/분 · 내부 제안 기준",
} satisfies TileClientModule;
