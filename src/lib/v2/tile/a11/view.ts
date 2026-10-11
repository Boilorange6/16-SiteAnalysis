import type { TileClientModule } from "../types";

export const a11ClientModule = {
  code: "A11",
  headline: { ids: ["density_per_km2", "pop_est", "hh_est"] },
  mapNote: "구간은 반경 전체 기준",
  metricFilter: (metric) => !metric.id.startsWith("share_dens_") || metric.value !== 0,
} satisfies TileClientModule;
