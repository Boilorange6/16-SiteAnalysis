import type { TileClientModule } from "../types";

export const a11ClientModule = {
  code: "A11",
  headline: { ids: ["density_per_km2", "pop_est", "hh_est"] },
  metricFilter: (metric) => !metric.id.startsWith("share_dens_") || metric.value !== 0,
} satisfies TileClientModule;
