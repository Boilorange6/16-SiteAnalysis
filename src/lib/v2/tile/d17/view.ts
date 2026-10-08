import type { TileClientModule } from "../types";

export const d17ClientModule = {
  code: "D17",
  headline: { ids: ["relief_median_m", "center_elevation_m"] },
  mapNote: "Copernicus GLO-30 표면모델(DSM, 30 m) · EGM2008 · 중심 상대고",
} satisfies TileClientModule;
