import type { TileClientModule } from "../types";

export const d18ClientModule = {
  code: "D18",
  headline: { ids: ["slope_median_deg", "slope_max_deg"] },
  mapNote: "Copernicus DEM GLO-30 30m 격자 경사 · EGM2008 · 옹벽·미세 지형 미반영",
} satisfies TileClientModule;
