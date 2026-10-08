import type { TileClientModule } from "../types";

export const d16ClientModule = {
  code: "D16",
  headline: { ids: ["dens_max", "gfa_per_ha"] },
  mapNote: "건물 수 KDE · 대역폭 100m · 20백분위 구간",
} satisfies TileClientModule;
